/* eslint-disable no-console */
/**
 * Shared devnet test utilities: transaction sending, Orao VRF constants/PDAs,
 * and flipyou instruction discriminators.
 *
 * Centralizes constants and helpers used by both on-chain-cleanup.ts and
 * mock-vrf-fallback.ts to avoid duplication.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { FlipYouIDL, PotShotIDL } from "@rng-utopia/anchor-client";

// ── IDL-driven discriminator lookup ─────────────────────────────────

function getInstructionDiscriminator(
  idl: { instructions: Array<{ name: string; discriminator: number[] }> },
  name: string,
): Buffer {
  const ix = idl.instructions.find((entry) => entry.name === name);
  if (!ix) throw new Error(`Instruction ${name} not found in IDL`);
  return Buffer.from(ix.discriminator);
}

// ── Orao VRF Constants ───────────────────────────────────────────────

/** Orao VRF program (devnet + mainnet share the same ID). */
export const ORAO_VRF_PROGRAM_ID = new PublicKey(
  "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y",
);

/** Orao VRF treasury on devnet (read from network state PDA). */
export const ORAO_TREASURY = new PublicKey(
  "9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR",
);

/** Orao VRF network state PDA. */
export const ORAO_NETWORK_STATE = PublicKey.findProgramAddressSync(
  [Buffer.from("orao-vrf-network-configuration")],
  ORAO_VRF_PROGRAM_ID,
)[0];

// ── PDA Helpers ──────────────────────────────────────────────────────

/** Derive Orao randomness PDA from a 32-byte seed (match PDA bytes). */
export function getOraoRandomnessPda(seed: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), seed],
    ORAO_VRF_PROGRAM_ID,
  );
  return pda;
}

// ── Instruction Discriminators (from IDL — no hardcoded byte arrays) ─

export const CANCEL_MATCH_DISC = getInstructionDiscriminator(FlipYouIDL, "cancel_match");
export const CLAIM_PAYOUT_DISC = getInstructionDiscriminator(PotShotIDL, "claim_payout");

// ── Transaction Helper ───────────────────────────────────────────────

/**
 * Sign, send, and confirm a transaction with a single keypair signer.
 *
 * On failure, does NOT blindly retry the same ix — the tx may have landed
 * but confirmation failed (e.g. WebSocket-based confirmation unsupported).
 * Instead, returns the error so callers can re-check on-chain state.
 */
export async function sendSignedTx(
  connection: Connection,
  ixs: TransactionInstruction[],
  signer: Keypair,
  label: string,
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log(`[tx] ${label}: confirmed — ${sig}`);
  return sig;
}
