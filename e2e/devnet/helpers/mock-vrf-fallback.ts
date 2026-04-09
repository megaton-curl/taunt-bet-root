/* eslint-disable no-console */
/**
 * Mock-VRF fallback for devnet lifecycle tests.
 *
 * When the flipyou program is deployed with the `mock-vrf` feature (default),
 * `request_orao_randomness` is a no-op — no Orao VRF account is created after
 * join. This module detects that situation and:
 *   1. Requests Orao VRF directly (creating the randomness account)
 *   2. Waits for oracle fulfillment
 *   3. Calls claim_payout on-chain (settling the match programmatically)
 *
 * Mock-VRF always reads data[0] from the Orao account (the Anchor discriminator
 * byte = 0x8b = 139, odd → TAILS), so Player A (HEADS) always loses in mock-VRF
 * mode. This is deterministic.
 *
 * This fallback should be REMOVED once the flipyou program is redeployed with
 * `--no-default-features` (real VRF).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import {
  getConfigPda,
  getTreasuryAddress,
  FLIPYOU_PROGRAM_ID,
  fetchMatch,
} from "../../local/helpers/on-chain";
import {
  ORAO_VRF_PROGRAM_ID,
  ORAO_TREASURY,
  ORAO_NETWORK_STATE,
  getOraoRandomnessPda,
  sendSignedTx,
  CLAIM_PAYOUT_DISC,
} from "./tx-utils";

// ── Constants ──────────────────────────────────────────────────────────

/** Anchor discriminator for `request_v2` instruction. */
const REQUEST_V2_DISC = createHash("sha256")
  .update("global:request_v2")
  .digest()
  .subarray(0, 8);

// ── Detection ─────────────────────────────────────────────────────────

/**
 * Detect whether the deployed flipyou program has mock-VRF enabled.
 *
 * After join, a real-VRF program creates an Orao randomness account via CPI.
 * Mock-VRF does not. Check for the randomness account existence.
 */
export async function detectMockVrf(
  connection: Connection,
  matchPda: PublicKey,
): Promise<boolean> {
  const randomnessPda = getOraoRandomnessPda(matchPda.toBytes());
  const account = await connection.getAccountInfo(randomnessPda);
  if (!account) {
    console.log(
      `[mock-vrf] No Orao randomness account at ${randomnessPda.toBase58()} — mock-VRF detected`,
    );
    return true;
  }
  console.log(
    `[mock-vrf] Orao randomness account exists at ${randomnessPda.toBase58()} — real VRF`,
  );
  return false;
}

// ── Request Orao VRF ─────────────────────────────────────────────────

/**
 * Request Orao VRF directly (bypassing the flipyou program).
 *
 * Constructs a `request_v2(seed)` instruction to the Orao program with the
 * match PDA bytes as seed, creating the randomness account that the flipyou
 * program's claim_payout will read.
 */
export async function requestOraoVrf(
  connection: Connection,
  payer: Keypair,
  matchPda: PublicKey,
): Promise<string> {
  const seed = matchPda.toBytes();
  const randomnessPda = getOraoRandomnessPda(seed);

  // Build request_v2 instruction data: discriminator(8) + seed(32)
  const data = Buffer.alloc(8 + 32);
  REQUEST_V2_DISC.copy(data, 0);
  Buffer.from(seed).copy(data, 8);

  const ix = new TransactionInstruction({
    programId: ORAO_VRF_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ORAO_NETWORK_STATE, isSigner: false, isWritable: true },
      { pubkey: ORAO_TREASURY, isSigner: false, isWritable: true },
      { pubkey: randomnessPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return sendSignedTx(connection, [ix], payer, "requestOraoVrf");
}

// ── Wait for Orao fulfillment ────────────────────────────────────────

/**
 * Poll the Orao randomness account until it's fulfilled.
 * Orao V2 FulfilledRequest: [0..8] disc, [8] variant(1=Fulfilled),
 * [9..41] client, [41..73] seed, [73..137] randomness(64 bytes)
 */
export async function waitForOraoFulfillment(
  connection: Connection,
  matchPda: PublicKey,
  timeoutMs: number,
): Promise<void> {
  const randomnessPda = getOraoRandomnessPda(matchPda.toBytes());
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    const account = await connection.getAccountInfo(randomnessPda);
    if (account && account.data.length >= 137 && account.data[8] === 1) {
      const randomness = account.data.subarray(73, 137);
      if (randomness.some((b) => b !== 0)) {
        console.log(
          `[mock-vrf] Orao VRF fulfilled in ${Date.now() - startTime}ms (${attempts} polls)`,
        );
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  throw new Error(
    `Orao VRF fulfillment timed out after ${timeoutMs}ms (${attempts} polls)`,
  );
}

// ── Claim payout on-chain ────────────────────────────────────────────

/**
 * Call claim_payout directly on-chain.
 *
 * Any match participant can call this. Settles the match, pays the winner,
 * updates profiles, and closes the match PDA.
 */
export async function claimPayoutOnChain(
  connection: Connection,
  caller: Keypair,
  matchPda: PublicKey,
): Promise<string> {
  // Fetch match data for account addresses
  const match = await fetchMatch(connection, matchPda);
  if (!match) {
    throw new Error(`Match PDA ${matchPda.toBase58()} not found (already closed?)`);
  }

  // Fetch treasury from config
  const [configPda] = getConfigPda();
  const treasury = await getTreasuryAddress(connection);

  const randomnessAccount = getOraoRandomnessPda(matchPda.toBytes());

  const ix = new TransactionInstruction({
    programId: FLIPYOU_PROGRAM_ID,
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: matchPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: match.creator, isSigner: false, isWritable: true },
      { pubkey: match.opponent, isSigner: false, isWritable: true },
      { pubkey: randomnessAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: CLAIM_PAYOUT_DISC,
  });

  return sendSignedTx(connection, [ix], caller, "claimPayout");
}

// ── Mock-VRF winner determination ────────────────────────────────────

/**
 * Determine the winner under mock-VRF.
 *
 * Mock-VRF `read_orao_randomness` returns raw data[0..32] where data[0] is the
 * Orao Anchor discriminator byte (0x8b = 139). The on-chain `from_randomness`
 * uses `randomness[0] % 2`: 139 % 2 = 1 → TAILS always wins in mock-VRF.
 *
 * @param creatorSide - The side the creator chose (0 = heads, 1 = tails)
 * @returns "creator" or "opponent"
 */
export function mockVrfWinner(creatorSide: number): "creator" | "opponent" {
  // Orao discriminator byte 0 = 0x8b = 139, 139 % 2 = 1 → TAILS
  const resultSide = 1; // TAILS always in mock-VRF
  return resultSide === creatorSide ? "creator" : "opponent";
}
