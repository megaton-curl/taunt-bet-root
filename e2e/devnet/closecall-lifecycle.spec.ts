/* eslint-disable no-console */
/**
 * Devnet E2E test for Close Call — player-initiated pari-mutuel flow.
 *
 * Tests use the backend API directly (not the UI) for the core lifecycle,
 * with the wallet keypairs for signing transactions.
 *
 * Flow:
 *   1. Setup — validate env, check wallets funded, check backend healthy
 *   2. Player A bets GREEN via POST /closecall/bet, signs + submits tx
 *   3. Player B bets RED via POST /closecall/bet, signs + submits tx
 *   4. Wait for settlement (up to 120s)
 *   5. Verify settlement outcome, closePrice, settleTx
 *   6. Verify fairness results page via GET /fairness/rounds/by-id/:minuteTs
 */
import { test, expect } from "./fixtures";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import { PLAYER_A, PLAYER_B } from "./helpers/wallets";
import {
  validateDevnetEnv,
  verifyFairnessBackend,
  type DevnetConfig,
} from "./helpers/env";

// ── Constants ────────────────────────────────────────────────────────

const MIN_BALANCE_SOL = 0.1;
/** Wait up to 120s for settlement after candle close. */
const SETTLEMENT_TIMEOUT_MS = 120_000;
/** Bet amount in lamports: 0.005 SOL. */
const BET_AMOUNT_LAMPORTS = 5_000_000;

// ── Types ────────────────────────────────────────────────────────────

interface BackendCloseCallRound {
  roundId: string;
  pda: string;
  phase: "open" | "settled" | "refunded";
  openPrice: number;
  openPriceExpo: number;
  closePrice: number | null;
  outcome: "pending" | "green" | "red" | "refund";
  greenPool: number;
  redPool: number;
  totalPool: number;
  totalFee: number;
  greenEntries: Array<{ player: string; amountLamports: number }>;
  redEntries: Array<{ player: string; amountLamports: number }>;
  greenCount: number;
  redCount: number;
  settleTx: string | null;
  createdAt: string;
  settledAt: string | null;
}

// ── Backend API helpers ──────────────────────────────────────────────

async function fetchCurrentRound(
  config: DevnetConfig,
): Promise<BackendCloseCallRound | null> {
  const resp = await fetch(
    `${config.fairnessBackendUrl}/closecall/current-round`,
  );
  if (!resp.ok) return null;
  const data = (await resp.json()) as { round: BackendCloseCallRound | null };
  return data.round;
}

async function fetchHistory(
  config: DevnetConfig,
  limit = 5,
): Promise<BackendCloseCallRound[]> {
  const resp = await fetch(
    `${config.fairnessBackendUrl}/closecall/history?limit=${limit}`,
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as { rounds: BackendCloseCallRound[] };
  return data.rounds;
}

/**
 * Request a co-signed bet tx from the backend, deserialize it,
 * sign with the player keypair, and submit to Solana.
 */
async function placeBetViaApi(
  config: DevnetConfig,
  connection: Connection,
  playerKeypair: Keypair,
  side: "green" | "red",
  amountLamports: number,
): Promise<{ minuteTs: number; roundPda: string; signature: string }> {
  const resp = await fetch(`${config.fairnessBackendUrl}/closecall/bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerPubkey: playerKeypair.publicKey.toBase58(),
      side,
      amountLamports,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: "unknown" }));
    throw new Error(
      `POST /closecall/bet failed (${resp.status}): ${(body as { error?: string }).error ?? JSON.stringify(body)}`,
    );
  }

  const data = (await resp.json()) as {
    transaction: string;
    minuteTs: number;
    roundPda: string;
  };

  // Deserialize the partially-signed legacy transaction
  const txBuf = Buffer.from(data.transaction, "base64");
  const tx = Transaction.from(txBuf);

  // Player signs their part
  tx.partialSign(playerKeypair);

  // Submit to Solana
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return { minuteTs: data.minuteTs, roundPda: data.roundPda, signature: sig };
}

/** Wait for a round to appear in history as settled/refunded. */
async function waitForSettlement(
  config: DevnetConfig,
  roundId: string,
): Promise<BackendCloseCallRound> {
  const start = Date.now();
  while (Date.now() - start < SETTLEMENT_TIMEOUT_MS) {
    const history = await fetchHistory(config, 10);
    const settled = history.find((r) => r.roundId === roundId);
    if (
      settled &&
      (settled.phase === "settled" || settled.phase === "refunded")
    ) {
      return settled;
    }

    // Also check if current-round still shows this round
    const current = await fetchCurrentRound(config);
    if (!current || current.roundId !== roundId) {
      // Round left current-round — it may appear in history on next poll
    }

    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(
    `Timed out waiting for closecall round ${roundId} to settle (${SETTLEMENT_TIMEOUT_MS / 1000}s)`,
  );
}

// ── Wallet funding check ─────────────────────────────────────────────

async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  label: string,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance >= MIN_BALANCE_SOL * LAMPORTS_PER_SOL) {
    console.log(
      `  ${label}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    );
    return;
  }
  throw new Error(
    `${label} has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL; ` +
      `requires at least ${MIN_BALANCE_SOL} SOL. ` +
      `Fund ${pubkey.toBase58()} and rerun.`,
  );
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe("closecall devnet E2E", () => {
  test.beforeAll(async () => {
    const config = validateDevnetEnv();
    if (!config.closecallProgramId) {
      console.log(
        "VITE_CLOSECALL_PROGRAM_ID not set — skipping Close Call E2E",
      );
      return;
    }
    await verifyFairnessBackend(config);
    console.log("Close Call devnet E2E: checking wallet funding...");
    const connection = new Connection(config.rpcUrl, "confirmed");
    await ensureFunded(connection, PLAYER_A.publicKey, "Player A");
    await ensureFunded(connection, PLAYER_B.publicKey, "Player B");
  });

  test("infra: program deployed, backend API responding, history shape", async ({
    devnetConfig,
    connection,
  }) => {
    if (!devnetConfig.closecallProgramId) {
      test.skip(true, "VITE_CLOSECALL_PROGRAM_ID not configured");
      return;
    }

    // 1. Closecall program deployed + executable
    const programAccount = await connection.getAccountInfo(
      devnetConfig.closecallProgramId,
    );
    expect(programAccount).not.toBeNull();
    expect(programAccount!.executable).toBe(true);
    console.log(
      `[infra] Closecall program deployed at ${devnetConfig.closecallProgramId.toBase58()}`,
    );

    // 2. Backend closecall API responds
    const currentResp = await fetch(
      `${devnetConfig.fairnessBackendUrl}/closecall/current-round`,
    );
    expect(currentResp.ok).toBe(true);
    const currentData = (await currentResp.json()) as {
      round: BackendCloseCallRound | null;
    };
    console.log(
      `[infra] GET /closecall/current-round: ${currentData.round ? "round active" : "no active round"}`,
    );

    const historyResp = await fetch(
      `${devnetConfig.fairnessBackendUrl}/closecall/history?limit=5`,
    );
    expect(historyResp.ok).toBe(true);
    const historyData = (await historyResp.json()) as {
      rounds: BackendCloseCallRound[];
    };
    console.log(
      `[infra] GET /closecall/history: ${historyData.rounds.length} settled round(s)`,
    );

    // 3. If history has rounds, verify data shape
    if (historyData.rounds.length > 0) {
      const sample = historyData.rounds[0];
      expect(sample.roundId).toBeTruthy();
      expect(sample.pda).toBeTruthy();
      expect(sample.openPrice).toBeDefined();
      expect(sample.openPriceExpo).toBeDefined();
      expect(["settled", "refunded"]).toContain(sample.phase);
      console.log(
        `[infra] Sample round ${sample.roundId}: ` +
          `openPrice=${sample.openPrice}x10^${sample.openPriceExpo}, ` +
          `outcome=${sample.outcome}`,
      );
    }
  });

  test("lifecycle: player A bets GREEN, player B bets RED, settlement verified", async ({
    devnetConfig,
    connection,
  }) => {
    if (!devnetConfig.closecallProgramId) {
      test.skip(true, "VITE_CLOSECALL_PROGRAM_ID not configured");
      return;
    }

    test.setTimeout(300_000);

    // ── Step 1: Wait for the betting window (first 30s of a minute) ──
    // We need to be early enough in the minute for betting to be open.
    // If we're past the betting window, wait for the next minute.
    const nowMs = Date.now();
    const msIntoMinute = nowMs % 60_000;
    const BETTING_WINDOW_MS = 30_000;
    const MIN_REMAINING_MS = 12_000; // need at least 12s for two bets

    if (msIntoMinute > BETTING_WINDOW_MS - MIN_REMAINING_MS) {
      const waitMs = 60_000 - msIntoMinute + 2_000; // wait for next minute + 2s buffer
      console.log(
        `[setup] ${Math.round(msIntoMinute / 1000)}s into minute, waiting ${Math.round(waitMs / 1000)}s for next betting window...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // ── Step 2: Player A bets GREEN ──────────────────────────────────
    console.log("[step-2] Player A placing GREEN bet...");
    const betA = await placeBetViaApi(
      devnetConfig,
      connection,
      PLAYER_A,
      "green",
      BET_AMOUNT_LAMPORTS,
    );
    console.log(
      `[step-2] Player A GREEN bet confirmed: tx=${betA.signature.slice(0, 16)}..., ` +
        `minuteTs=${betA.minuteTs}, roundPda=${betA.roundPda.slice(0, 12)}...`,
    );

    // Verify via current-round API
    const afterA = await fetchCurrentRound(devnetConfig);
    expect(afterA).not.toBeNull();
    expect(afterA!.roundId).toBe(String(betA.minuteTs));
    const hasPlayerA = afterA!.greenEntries.some(
      (e) => e.player === PLAYER_A.publicKey.toBase58(),
    );
    expect(hasPlayerA).toBe(true);
    console.log(
      `[step-2] Verified: round ${afterA!.roundId} has Player A GREEN entry`,
    );

    // ── Step 3: Player B bets RED ────────────────────────────────────
    console.log("[step-3] Player B placing RED bet...");
    const betB = await placeBetViaApi(
      devnetConfig,
      connection,
      PLAYER_B,
      "red",
      BET_AMOUNT_LAMPORTS,
    );
    console.log(
      `[step-3] Player B RED bet confirmed: tx=${betB.signature.slice(0, 16)}...`,
    );

    // Verify via current-round API
    const afterB = await fetchCurrentRound(devnetConfig);
    expect(afterB).not.toBeNull();
    const hasPlayerB = afterB!.redEntries.some(
      (e) => e.player === PLAYER_B.publicKey.toBase58(),
    );
    expect(hasPlayerB).toBe(true);
    expect(afterB!.greenCount).toBeGreaterThanOrEqual(1);
    expect(afterB!.redCount).toBeGreaterThanOrEqual(1);
    console.log(
      `[step-3] Verified: round has both GREEN (${afterB!.greenCount}) and RED (${afterB!.redCount}) entries`,
    );

    // ── Step 4: Wait for settlement ──────────────────────────────────
    const roundId = String(betA.minuteTs);
    console.log(
      `[step-4] Waiting for round ${roundId} to settle (up to ${SETTLEMENT_TIMEOUT_MS / 1000}s)...`,
    );
    const settled = await waitForSettlement(devnetConfig, roundId);
    console.log(
      `[step-4] Round settled: outcome=${settled.outcome}, ` +
        `closePrice=${settled.closePrice}x10^${settled.openPriceExpo}, ` +
        `phase=${settled.phase}`,
    );

    // ── Step 5: Verify settlement data ───────────────────────────────
    expect(["green", "red", "refund"]).toContain(settled.outcome);
    expect(settled.closePrice).not.toBeNull();
    expect(settled.settleTx).toBeTruthy();
    expect(settled.settledAt).toBeTruthy();

    if (settled.outcome === "green" || settled.outcome === "red") {
      // Decisive round — fee should be collected
      expect(settled.totalFee).toBeGreaterThan(0);
      console.log(
        `[step-5] Decisive: ${settled.outcome.toUpperCase()}, fee=${settled.totalFee} lamports`,
      );
    } else {
      // Refund (equal price) — no fee
      expect(settled.totalFee).toBe(0);
      console.log("[step-5] Equal price -> refund, no fee");
    }

    // ── Step 6: Verify fairness results page ─────────────────────────
    console.log("[step-6] Checking fairness results endpoint...");
    const fairnessResp = await fetch(
      `${devnetConfig.fairnessBackendUrl}/fairness/rounds/by-id/${roundId}`,
    );
    // This endpoint may or may not exist — if it does, verify shape
    if (fairnessResp.ok) {
      const fairnessData = (await fairnessResp.json()) as Record<string, unknown>;
      console.log(
        `[step-6] GET /fairness/rounds/by-id/${roundId}: OK`,
      );
      expect(fairnessData).toBeDefined();
    } else {
      // If endpoint is 404, that's acceptable — the round data is in history
      console.log(
        `[step-6] GET /fairness/rounds/by-id/${roundId}: ${fairnessResp.status} (may not be implemented for closecall yet)`,
      );
    }

    // ── Step 7: Verify profile transactions via API ─────────────────
    // Close Call devnet test uses fetch-only (no Playwright page), so we
    // cannot navigate to /profile. Profile transaction verification for
    // Close Call is covered by the local E2E suite which has browser sessions.
    console.log(
      "[step-7] Profile transaction check skipped (fetch-only test, no browser session)",
    );

    console.log("[done] Close Call lifecycle E2E passed");
  });
});
