/* eslint-disable no-console */
/**
 * Pot Shot VRF fallback + claim helpers for devnet lifecycle tests.
 *
 * Mirrors the flipyou mock-vrf-fallback.ts pattern but adapted for Pot Shot:
 *   - claim_payout requires tier + round_number as instruction args
 *   - CPI into platform for player profile updates (game_type = 1)
 *   - Winner determined by: u64_from_le(randomness[0..8]) % total_entries
 *
 * Reuses shared VRF helpers from tx-utils.ts (getOraoRandomnessPda, sendSignedTx).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { PotShotIDL } from "@taunt-bet/anchor-client";
import {
  getLordConfigPda,
  getLordProgram,
  getLordRoundPda,
  POTSHOT_PROGRAM_ID,
  type PotShotRoundAccount,
} from "../../local/helpers/on-chain";
import {
  ORAO_VRF_PROGRAM_ID,
  ORAO_TREASURY,
  ORAO_NETWORK_STATE,
  getOraoRandomnessPda,
  sendSignedTx,
} from "./tx-utils";

// ── Instruction Discriminators ─────────────────────────────────────────

/** Anchor discriminator for Pot Shot `create_round` instruction. */
const LORD_CREATE_ROUND_DISC = createHash("sha256")
  .update("global:create_round")
  .digest()
  .subarray(0, 8);

/** Anchor discriminator for Pot Shot `join_round` instruction. */
const LORD_JOIN_ROUND_DISC = createHash("sha256")
  .update("global:join_round")
  .digest()
  .subarray(0, 8);

/** Anchor discriminator for Pot Shot `start_spin` instruction. */
const LORD_START_SPIN_DISC = createHash("sha256")
  .update("global:start_spin")
  .digest()
  .subarray(0, 8);

/** Anchor discriminator for Pot Shot `claim_payout` instruction. */
const LORD_CLAIM_PAYOUT_DISC = Buffer.from(
  PotShotIDL.instructions.find((ix) => ix.name === "claim_payout")!.discriminator,
);

/** Anchor discriminator for Orao `request_v2` instruction. */
const REQUEST_V2_DISC = createHash("sha256")
  .update("global:request_v2")
  .digest()
  .subarray(0, 8);

// ── Programmatic round lifecycle ─────────────────────────────────────

/**
 * Create a Pot Shot round on-chain (programmatic, no UI).
 * Fetches config to determine the next round number, then sends create_round.
 */
export async function createLordRoundOnChain(
  connection: Connection,
  creator: Keypair,
  tier: number,
  numEntries: number,
): Promise<{ roundPda: PublicKey; roundNumber: number }> {
  const [configPda] = getLordConfigPda();
  const program = getLordProgram(connection);

  // Fetch config to get the next round number for this tier
  const config = await program.account.lordConfig.fetch(configPda);
  const configData = config as unknown as { roundCounters: { toNumber(): number }[] };
  const roundNumber = configData.roundCounters[tier]!.toNumber();
  const [roundPda] = getLordRoundPda(tier, roundNumber);

  // Instruction data: disc(8) + tier(u8) + round_number(u64 LE) + num_entries(u32 LE)
  const data = Buffer.alloc(8 + 1 + 8 + 4);
  LORD_CREATE_ROUND_DISC.copy(data, 0);
  data.writeUInt8(tier, 8);
  data.writeBigUInt64LE(BigInt(roundNumber), 9);
  data.writeUInt32LE(numEntries, 17);

  const ix = new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys: [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  await sendSignedTx(connection, [ix], creator, `createLordRound(tier=${tier}, round=${roundNumber})`);
  return { roundPda, roundNumber };
}

/**
 * Join an existing Pot Shot round on-chain (programmatic, no UI).
 */
export async function joinLordRoundOnChain(
  connection: Connection,
  player: Keypair,
  tier: number,
  roundNumber: number,
  numEntries: number,
): Promise<void> {
  const [configPda] = getLordConfigPda();
  const [roundPda] = getLordRoundPda(tier, roundNumber);

  const data = Buffer.alloc(8 + 1 + 8 + 4);
  LORD_JOIN_ROUND_DISC.copy(data, 0);
  data.writeUInt8(tier, 8);
  data.writeBigUInt64LE(BigInt(roundNumber), 9);
  data.writeUInt32LE(numEntries, 17);

  const ix = new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys: [
      { pubkey: player.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  await sendSignedTx(connection, [ix], player, `joinLordRound(tier=${tier}, round=${roundNumber})`);
}

/**
 * Trigger start_spin on-chain (programmatic, no UI).
 * This calls the Lord program which CPIs into Orao VRF to request randomness.
 */
export async function startLordSpinOnChain(
  connection: Connection,
  caller: Keypair,
  tier: number,
  roundNumber: number,
  roundPda: PublicKey,
): Promise<void> {
  const [configPda] = getLordConfigPda();
  const oraoRandom = getOraoRandomnessPda(roundPda.toBytes());

  const data = Buffer.alloc(8 + 1 + 8);
  LORD_START_SPIN_DISC.copy(data, 0);
  data.writeUInt8(tier, 8);
  data.writeBigUInt64LE(BigInt(roundNumber), 9);

  const ix = new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: ORAO_VRF_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ORAO_NETWORK_STATE, isSigner: false, isWritable: true },
      { pubkey: ORAO_TREASURY, isSigner: false, isWritable: true },
      { pubkey: oraoRandom, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  await sendSignedTx(connection, [ix], caller, `startLordSpin(tier=${tier}, round=${roundNumber})`);
}

// ── Detection ─────────────────────────────────────────────────────────

/**
 * Detect whether the deployed potshot program has mock-VRF enabled.
 * After start_spin, a real-VRF program creates an Orao randomness account.
 * Mock-VRF does not.
 */
export async function detectLordMockVrf(
  connection: Connection,
  roundPda: PublicKey,
): Promise<boolean> {
  const randomnessPda = getOraoRandomnessPda(roundPda.toBytes());
  const account = await connection.getAccountInfo(randomnessPda);
  if (!account) {
    console.log(
      `[lord-vrf] No Orao randomness account at ${randomnessPda.toBase58()} — mock-VRF detected`,
    );
    return true;
  }
  console.log(
    `[lord-vrf] Orao randomness account exists at ${randomnessPda.toBase58()} — real VRF`,
  );
  return false;
}

// ── Request Orao VRF ──────────────────────────────────────────────────

/**
 * Request Orao VRF directly (bypassing the Lord program).
 * Uses round PDA bytes as the seed — same as on-chain start_spin.
 */
export async function requestLordOraoVrf(
  connection: Connection,
  payer: Keypair,
  roundPda: PublicKey,
): Promise<string> {
  const seed = roundPda.toBytes();
  const randomnessPda = getOraoRandomnessPda(seed);

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

  return sendSignedTx(connection, [ix], payer, "requestLordOraoVrf");
}

// ── Wait for Orao fulfillment ────────────────────────────────────────

/**
 * Poll the Orao randomness account for a Lord round until fulfilled.
 */
export async function waitForLordOraoFulfillment(
  connection: Connection,
  roundPda: PublicKey,
  timeoutMs: number,
): Promise<void> {
  const randomnessPda = getOraoRandomnessPda(roundPda.toBytes());
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    const account = await connection.getAccountInfo(randomnessPda);
    if (account && account.data.length >= 137 && account.data[8] === 1) {
      const randomness = account.data.subarray(73, 137);
      if (randomness.some((b) => b !== 0)) {
        console.log(
          `[lord-vrf] Orao VRF fulfilled in ${Date.now() - startTime}ms (${attempts} polls)`,
        );
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  throw new Error(
    `Lord Orao VRF fulfillment timed out after ${timeoutMs}ms (${attempts} polls)`,
  );
}

// ── Read VRF & determine winner ──────────────────────────────────────

/**
 * Read VRF randomness and determine the winning player.
 * Mirrors on-chain logic: u64_from_le(randomness[0..8]) % total_entries.
 *
 * @returns The winning player's public key and the winning slot index.
 */
export async function readLordVrfWinner(
  connection: Connection,
  roundPda: PublicKey,
  round: PotShotRoundAccount,
): Promise<{ winner: PublicKey; winningSlot: number }> {
  const randomnessPda = getOraoRandomnessPda(roundPda.toBytes());
  const vrfAccount = await connection.getAccountInfo(randomnessPda);
  if (!vrfAccount) {
    throw new Error(`VRF randomness account not found at ${randomnessPda.toBase58()}`);
  }

  // Orao V2 layout: randomness starts at byte 73 (64 bytes)
  const randomness = vrfAccount.data.subarray(73, 137);

  // u64 from first 8 bytes (little-endian)
  const randU64 = randomness.slice(0, 8).reduce(
    (acc, byte, i) => acc + BigInt(byte) * (1n << BigInt(i * 8)),
    0n,
  );
  const totalEntries = BigInt(round.totalEntries);
  const winningSlot = Number(randU64 % totalEntries);

  // Map winning slot to player
  let cumulative = 0;
  let winner = PublicKey.default;
  for (const entry of round.players) {
    cumulative += entry.entries;
    if (winningSlot < cumulative) {
      winner = entry.player;
      break;
    }
  }

  console.log(
    `[lord-vrf] VRF byte0=${randomness[0]}, randU64=${randU64}, ` +
      `winningSlot=${winningSlot}/${round.totalEntries}, winner=${winner.toBase58().slice(0, 8)}…`,
  );

  return { winner, winningSlot };
}

// ── Claim payout on-chain ────────────────────────────────────────────

/**
 * Call Pot Shot claim_payout directly on-chain.
 *
 * Accounts (from claim_payout.rs):
 *   0. caller (signer, mut)
 *   1. round (mut, PDA)
 *   2. config (PDA)
 *   3. treasury (mut)
 *   4. round_creator (mut)
 *   5. winner_account (mut)
 *   6. randomness_account
 *   7. platform_program
 *   8. system_program
 *   + remaining accounts: player profile PDAs (one per player, same order as round.players)
 *
 * Instruction data: discriminator(8) + tier(1) + round_number(8)
 */
export async function claimLordPayoutOnChain(
  connection: Connection,
  caller: Keypair,
  roundPda: PublicKey,
  round: PotShotRoundAccount,
  winnerPubkey: PublicKey,
): Promise<string> {
  const [configPda] = getLordConfigPda();

  // Read treasury from config
  const program = getLordProgram(connection);
  const config = await program.account.lordConfig.fetch(configPda);
  const treasury = (config as unknown as { treasury: PublicKey }).treasury;

  const randomnessAccount = getOraoRandomnessPda(roundPda.toBytes());

  // Build instruction data: disc(8) + tier(u8) + round_number(u64 LE)
  const data = Buffer.alloc(8 + 1 + 8);
  LORD_CLAIM_PAYOUT_DISC.copy(data, 0);
  data.writeUInt8(round.tier, 8);
  data.writeBigUInt64LE(BigInt(round.roundNumber.toNumber()), 9);

  const ix = new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys: [
      { pubkey: caller.publicKey, isSigner: true, isWritable: true },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: round.creator, isSigner: false, isWritable: true },
      { pubkey: winnerPubkey, isSigner: false, isWritable: true },
      { pubkey: randomnessAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return sendSignedTx(connection, [ix], caller, "lordClaimPayout");
}
