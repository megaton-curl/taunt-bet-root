/* eslint-disable no-console */
/**
 * Robust VRF fulfillment polling with exponential backoff and timeout budget
 * tracking for devnet E2E tests.
 *
 * Polls the Orao VRF randomness account to detect when randomness is fulfilled.
 * With real Orao VRF, the match stays "locked" until claim_payout is called —
 * so we check the randomness bytes directly, not the match phase.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  fetchMatch,
  type MatchAccount,
} from "../../local/helpers/on-chain";
import { getOraoRandomnessPda } from "./tx-utils";

// ── Polling config ──────────────────────────────────────────────────────

/** Initial polling interval (ms). */
const INITIAL_INTERVAL = 2_000;

/** Maximum polling interval after backoff (ms). */
const MAX_INTERVAL = 10_000;

/** Backoff multiplier per poll attempt. */
const BACKOFF_FACTOR = 1.5;

// ── Types ───────────────────────────────────────────────────────────────

export interface VrfPollResult {
  /** Final match account state after fulfillment. */
  match: MatchAccount;
  /** Match PDA address. */
  matchPda: PublicKey;
  /** Phase detected ("resolved" on success). */
  phase: string;
  /** Total wall-clock time spent polling (ms). */
  elapsedMs: number;
  /** Number of RPC poll attempts made. */
  attempts: number;
}

export interface VrfTimeoutError extends Error {
  /** Elapsed time before timeout (ms). */
  elapsedMs: number;
  /** Number of poll attempts made. */
  attempts: number;
  /** Last observed phase (if any). */
  lastPhase: string | null;
  /** Transaction signatures on the match PDA (for debugging). */
  signatures: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Collect recent transaction signatures for a match PDA.
 * Used for failure diagnostics — shows what transactions touched the account.
 */
export async function collectMatchSignatures(
  connection: Connection,
  matchPda: PublicKey,
  limit = 10,
): Promise<string[]> {
  try {
    const sigs = await connection.getSignaturesForAddress(matchPda, { limit });
    return sigs.map((s) => s.signature);
  } catch {
    return [];
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

// ── Main polling function ───────────────────────────────────────────────

/**
 * Poll the match PDA on-chain for VRF fulfillment with exponential backoff.
 *
 * Waits for the match phase to transition from "locked" to "resolved",
 * which indicates the Orao VRF callback has executed. Logs timing budget
 * at each attempt for observability.
 *
 * @param connection - Solana RPC connection
 * @param matchPda - The match PDA address to poll
 * @param timeoutMs - Maximum time to poll before giving up
 * @returns VrfPollResult on success
 * @throws VrfTimeoutError with diagnostics on timeout
 */
export async function pollVrfFulfillment(
  connection: Connection,
  matchPda: PublicKey,
  timeoutMs: number,
): Promise<VrfPollResult> {
  const startTime = Date.now();
  let interval = INITIAL_INTERVAL;
  let attempts = 0;
  let lastPhase: string | null = null;

  console.log(
    `[vrf-poll] Starting VRF fulfillment polling for match PDA ${matchPda.toBase58()}`,
  );
  console.log(
    `[vrf-poll] Timeout budget: ${formatMs(timeoutMs)}, initial interval: ${formatMs(INITIAL_INTERVAL)}`,
  );

  while (true) {
    const elapsed = Date.now() - startTime;
    const remaining = timeoutMs - elapsed;

    if (remaining <= 0) {
      // Timeout — collect diagnostic info
      console.log(`[vrf-poll] TIMEOUT after ${formatMs(elapsed)} (${attempts} attempts)`);
      const signatures = await collectMatchSignatures(connection, matchPda);
      if (signatures.length > 0) {
        console.log(`[vrf-poll] Match PDA transaction signatures:`);
        signatures.forEach((sig, i) => console.log(`  [${i}] ${sig}`));
      } else {
        console.log(`[vrf-poll] No transaction signatures found on match PDA`);
      }

      const err = new Error(
        `VRF fulfillment timed out after ${formatMs(elapsed)} (${attempts} attempts). ` +
          `Last phase: ${lastPhase ?? "unknown"}. ` +
          `Signatures: ${signatures.length > 0 ? signatures.join(", ") : "none"}`,
      ) as VrfTimeoutError;
      err.elapsedMs = elapsed;
      err.attempts = attempts;
      err.lastPhase = lastPhase;
      err.signatures = signatures;
      throw err;
    }

    // Wait before polling (skip initial wait on first attempt)
    if (attempts > 0) {
      const sleepMs = Math.min(interval, remaining);
      await new Promise((r) => setTimeout(r, sleepMs));
    }

    attempts++;
    const elapsed2 = Date.now() - startTime;
    const budgetPct = Math.round((elapsed2 / timeoutMs) * 100);

    try {
      // Check VRF fulfillment directly on the Orao randomness account.
      // With real Orao VRF, the match stays "locked" until claim_payout —
      // so checking match phase would never see "resolved".
      const randomnessPda = getOraoRandomnessPda(matchPda.toBytes());
      const vrfAccount = await connection.getAccountInfo(randomnessPda);
      // Orao V2 FulfilledRequest: [0..8] disc, [8] variant(1=Fulfilled),
      // [9..41] client, [41..73] seed, [73..137] randomness(64 bytes)
      const vrfFulfilled = vrfAccount &&
        vrfAccount.data.length >= 137 &&
        vrfAccount.data[8] === 1 &&
        vrfAccount.data.subarray(73, 137).some((b) => b !== 0);

      // Also fetch match for phase info (logging + return value)
      const match = await fetchMatch(connection, matchPda);

      if (!match) {
        console.log(
          `[vrf-poll] Attempt ${attempts}: match PDA closed (already claimed?) ` +
            `[${formatMs(elapsed2)} / ${formatMs(timeoutMs)}, ${budgetPct}% budget]`,
        );
        lastPhase = "closed";
      } else {
        const phase = Object.keys(match.phase)[0];
        lastPhase = phase;

        console.log(
          `[vrf-poll] Attempt ${attempts}: phase="${phase}" vrf=${vrfFulfilled ? "fulfilled" : "pending"} ` +
            `[${formatMs(elapsed2)} / ${formatMs(timeoutMs)}, ${budgetPct}% budget]`,
        );

        if (vrfFulfilled || phase === "resolved") {
          console.log(
            `[vrf-poll] VRF fulfilled! Detected in ${formatMs(elapsed2)} after ${attempts} attempts`,
          );

          const signatures = await collectMatchSignatures(connection, matchPda);
          if (signatures.length > 0) {
            console.log(`[vrf-poll] Match PDA transaction signatures:`);
            signatures.forEach((sig, i) => console.log(`  [${i}] ${sig}`));
          }

          return {
            match,
            matchPda,
            phase: vrfFulfilled ? "vrf_fulfilled" : phase,
            elapsedMs: elapsed2,
            attempts,
          };
        }
      }
    } catch (err) {
      console.log(
        `[vrf-poll] Attempt ${attempts}: RPC error — ${err} ` +
          `[${formatMs(elapsed2)} / ${formatMs(timeoutMs)}, ${budgetPct}% budget]`,
      );
    }

    // Exponential backoff
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_INTERVAL);
  }
}

/**
 * Log transaction signatures for a player's recent activity on devnet.
 * Useful for post-failure diagnostics.
 *
 * @param connection - Solana RPC connection
 * @param address - Address to inspect
 * @param label - Human-readable label for logging
 * @param limit - Max signatures to fetch
 */
export async function logRecentSignatures(
  connection: Connection,
  address: PublicKey,
  label: string,
  limit = 5,
): Promise<string[]> {
  try {
    const sigs = await connection.getSignaturesForAddress(address, { limit });
    if (sigs.length === 0) {
      console.log(`[tx-log] ${label}: no recent signatures`);
      return [];
    }
    console.log(`[tx-log] ${label}: ${sigs.length} recent signature(s):`);
    const result: string[] = [];
    for (const sig of sigs) {
      const status = sig.err ? `FAILED: ${JSON.stringify(sig.err)}` : "OK";
      console.log(`  ${sig.signature} [slot ${sig.slot}, ${status}]`);
      result.push(sig.signature);
    }
    return result;
  } catch {
    console.log(`[tx-log] ${label}: failed to fetch signatures`);
    return [];
  }
}
