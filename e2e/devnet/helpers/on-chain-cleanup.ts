/* eslint-disable no-console */
/**
 * On-chain pre-flight cleanup for deterministic devnet wallets.
 *
 * Deterministic wallets share match PDAs across test runs. Before creating
 * a new match, this module checks the on-chain state and clears stale
 * matches via direct on-chain transactions that match the current
 * backend-assisted commit-reveal contract.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getFlipYouProgram,
  FLIPYOU_PHASE_LOCKED,
  FLIPYOU_PHASE_SETTLED,
  FLIPYOU_PHASE_REFUNDED,
  FLIPYOU_PHASE_WAITING,
  type MatchAccount,
} from "../../local/helpers/on-chain";
import { sendSignedTx } from "./tx-utils";

/** Match phase extracted from the current numeric phase field. */
export type MatchPhase = "waiting" | "locked" | null;

function toMatchPhase(phase: number): MatchPhase {
  switch (phase) {
    case FLIPYOU_PHASE_WAITING:
      return "waiting";
    case FLIPYOU_PHASE_LOCKED:
      return "locked";
    case FLIPYOU_PHASE_SETTLED:
    case FLIPYOU_PHASE_REFUNDED:
      return null;
    default:
      return null;
  }
}

/**
 * Check the on-chain match state for a creator.
 * Uses memcmp filter to find any active match regardless of nonce.
 * Returns the phase string or null if no match PDA exists.
 */
export async function checkMatchState(
  connection: Connection,
  creator: PublicKey,
): Promise<{ phase: MatchPhase; match: MatchAccount | null; matchPda: PublicKey }> {
  const program = getFlipYouProgram(connection);
  const matches = await program.account.flipyouMatch.all([
    { memcmp: { offset: 8, bytes: creator.toBase58() } },
    { dataSize: program.account.flipyouMatch.size },
  ]);
  const activeMatches = matches.filter((m) => {
    const match = m.account as unknown as MatchAccount;
    return (
      match.phase !== FLIPYOU_PHASE_SETTLED &&
      match.phase !== FLIPYOU_PHASE_REFUNDED
    );
  });

  if (activeMatches.length === 0) {
    return { phase: null, match: null, matchPda: PublicKey.default };
  }

  const acc = activeMatches[0];
  const match = acc.account as unknown as MatchAccount;
  const matchPda = acc.publicKey;
  const phase = toMatchPhase(match.phase);
  return { phase, match, matchPda };
}

async function buildCancelMatchIx(
  connection: Connection,
  creator: PublicKey,
  matchPda: PublicKey,
  server: PublicKey,
): Promise<TransactionInstruction> {
  const program = getFlipYouProgram(connection);
  return program.methods
    .cancelMatch()
    .accountsStrict({
      creator,
      flipyouMatch: matchPda,
      server,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

async function buildTimeoutRefundIx(
  connection: Connection,
  caller: PublicKey,
  matchPda: PublicKey,
  creator: PublicKey,
  opponent: PublicKey,
  server: PublicKey,
): Promise<TransactionInstruction> {
  const program = getFlipYouProgram(connection);
  return program.methods
    .timeoutRefund()
    .accountsStrict({
      caller,
      creator,
      opponent,
      server,
      flipyouMatch: matchPda,
    })
    .instruction();
}

async function sendCleanupTx(
  connection: Connection,
  creatorKeypair: Keypair,
  phase: "waiting" | "locked",
  match: MatchAccount,
  matchPda: PublicKey,
  label: string,
): Promise<string> {
  const creator = creatorKeypair.publicKey;

  if (phase === "waiting") {
    const ix = await buildCancelMatchIx(connection, creator, matchPda, match.server);
    return sendSignedTx(connection, [ix], creatorKeypair, `${label} cancelMatch`);
  }

  // Locked phase: can only clean up via timeoutRefund after deadline expires
  const deadline = match.resolveDeadline.toNumber();
  const now = Math.floor(Date.now() / 1_000);
  if (!(deadline > 0 && now > deadline)) {
    throw new Error(
      `Settlement in-flight: ${label} has stale locked match (deadline=${deadline}, now=${now}). ` +
        `Wait for backend settlement or deadline expiry, then rerun. ` +
        `PDA: ${matchPda.toBase58()}`,
    );
  }

  const ix = await buildTimeoutRefundIx(
    connection,
    creator,
    matchPda,
    match.creator,
    match.opponent,
    match.server,
  );
  return sendSignedTx(connection, [ix], creatorKeypair, `${label} timeoutRefund`);
}

/**
 * Ensure a clean state for a deterministic wallet before creating a new match.
 *
 * - No match PDA → clean, return immediately
 * - "waiting" → on-chain cancelMatch
 * - "locked" + expired deadline → on-chain timeoutRefund
 * - "locked" + not yet expired → throw
 *
 * On tx failure, re-checks on-chain state before retrying. The tx may have
 * landed despite the error.
 */
export async function ensureCleanState(
  connection: Connection,
  creatorKeypair: Keypair,
  label: string,
): Promise<void> {
  const creator = creatorKeypair.publicKey;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { phase, match, matchPda } = await checkMatchState(connection, creator);

    if (!phase || !match) {
      console.log(
        attempt === 1
          ? `[cleanup] ${label}: no stale match PDA — clean`
          : `[cleanup] ${label}: match PDA gone after attempt ${attempt - 1} — clean`,
      );
      return;
    }

    console.log(
      `[cleanup] ${label}: stale match detected (phase="${phase}", pda=${matchPda.toBase58()}, attempt=${attempt})`,
    );

    try {
      await sendCleanupTx(connection, creatorKeypair, phase, match, matchPda, label);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[cleanup] ${label}: tx attempt ${attempt} failed — ${msg}`);
      if (attempt === MAX_ATTEMPTS) {
        const finalState = await checkMatchState(connection, creator);
        if (!finalState.phase) {
          console.log(`[cleanup] ${label}: match PDA gone despite tx error — clean`);
          return;
        }
        throw new Error(
          `[cleanup] ${label}: cleanup failed after ${MAX_ATTEMPTS} attempts. ` +
            `Last error: ${msg}. Match PDA still exists (phase="${finalState.phase}").`,
        );
      }
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }

    const postCleanup = await checkMatchState(connection, creator);
    if (!postCleanup.phase) {
      console.log(`[cleanup] ${label}: cleanup complete — clean state verified`);
      return;
    }

    console.log(
      `[cleanup] ${label}: WARNING — tx confirmed but match PDA persists (phase="${postCleanup.phase}")`,
    );
  }
}
