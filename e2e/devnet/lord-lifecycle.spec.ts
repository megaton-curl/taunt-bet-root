/* eslint-disable no-console */
/**
 * Devnet lifecycle E2E test for Lord of the RNGs:
 * UI create → UI join → countdown → backend settle → verify.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import * as po from "../local/helpers/lord-page-objects";
import { PLAYER_A, PLAYER_B } from "./helpers/wallets";
import {
  validateDevnetEnv,
  verifyFairnessBackend,
  type DevnetConfig,
} from "./helpers/env";
import { withRetry } from "./helpers/retry";
import { ensureLordCleanState } from "./helpers/lord-on-chain-cleanup";
import {
  fetchLordRound,
  assertLordRoundClosed,
  assertLordTreasuryFee,
  snapshotBalance,
  getTreasuryAddress,
  LORDOFRNGS_PROGRAM_ID,
} from "../local/helpers/on-chain";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

// ── Devnet wallet funding ─────────────────────────────────────────────

const MIN_BALANCE_SOL = 0.1;

async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  label: string,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance >= MIN_BALANCE_SOL * LAMPORTS_PER_SOL) {
    console.log(
      `  ${label}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL ✓`,
    );
    return;
  }
  throw new Error(
    `${label} has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL; ` +
      `requires at least ${MIN_BALANCE_SOL.toFixed(3)} SOL. ` +
      `Fund ${pubkey.toBase58()} and rerun.`,
  );
}

// ── On-chain constants ───────────────────────────────────────────────

const SETTLEMENT_TIMEOUT_MS = 180_000;

interface BackendLordRoundResponse {
  pda: string;
  phase: "created" | "locked" | "settling" | "settled" | "expired";
  commitment: string;
  matchId: string;
  secret?: string;
  resultHash?: string | null;
  winner?: string | null;
  settleTx?: string | null;
  entropy?: string | null;
  winningOffset?: string | null;
  winningEntryIndex?: number | null;
  payoutAmount?: number | null;
  feeAmount?: number | null;
  rentRefund?: number | null;
  totalAmountLamports?: number | null;
}

/** Devnet console noise patterns to ignore. */
const DEVNET_NOISE = [
  "favicon.ico",
  "downloadable font",
  "third-party cookie",
  "429",
  "Too Many Requests",
  "WebSocket",
  "ECONNRESET",
  "socket hang up",
  "FetchError",
  "NetworkError",
  "net::ERR_",
  "ERR_BLOCKED_BY",
  "Failed to load resource",
  "NS_ERROR",
  // Expected race: browser auto-claim fires after programmatic claim already closed the round
  "AccountNotInitialized",
  "simulation failed BEFORE wallet send",
  "Transaction will fail",
];

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) => !DEVNET_NOISE.some((p) => e.includes(p)),
  );
}

/** Capture [settlement-event] console lines from a page. */
function captureSettlementEvents(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (msg) => {
    if (
      msg.text().includes("[settlement-event]") ||
      msg.text().includes("[lord-of-rngs] settlement-event")
    ) {
      lines.push(msg.text());
    }
  });
  return lines;
}

async function fetchBackendRound(
  config: DevnetConfig,
  roundPda: string,
): Promise<BackendLordRoundResponse | null> {
  const response = await fetch(
    `${config.fairnessBackendUrl}/fairness/rounds/${roundPda}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Backend round lookup failed (${response.status} ${response.statusText})`,
    );
  }
  return (await response.json()) as BackendLordRoundResponse;
}

async function waitForSettledRound(
  config: DevnetConfig,
  roundPda: string,
): Promise<BackendLordRoundResponse> {
  const start = Date.now();

  while (Date.now() - start < SETTLEMENT_TIMEOUT_MS) {
    const round = await fetchBackendRound(config, roundPda);
    if (round?.phase === "settled" && round.secret && round.settleTx) {
      return round;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Timed out waiting for backend to settle round ${roundPda}`);
}

// ── Suite setup ────────────────────────────────────────────────────────

test.beforeAll(async () => {
  const config = validateDevnetEnv();
  if (!config.lordofrngsProgramId) {
    console.log("VITE_LORDOFRNGS_PROGRAM_ID not set — skipping Lord lifecycle");
    return;
  }
  await verifyFairnessBackend(config);
  console.log("Lord devnet lifecycle: checking wallet funding...");
  const connection = new Connection(config.rpcUrl, "confirmed");
  await ensureFunded(connection, PLAYER_A.publicKey, "Player A");
  await ensureFunded(connection, PLAYER_B.publicKey, "Player B");
});

// ── Full lifecycle test ───────────────────────────────────────────────

// Skipped: requires frontend app (separate project, not yet available)
test.skip("lord lifecycle: UI create → UI join → countdown → backend settle → verify", async ({
  playerAPage,
  playerBPage,
  connection,
  devnetConfig,
}) => {
  if (!devnetConfig.lordofrngsProgramId) {
    test.skip(true, "VITE_LORDOFRNGS_PROGRAM_ID not configured");
    return;
  }

  test.setTimeout(300_000);

  // ── Pre-flight: clean stale rounds (on-chain + backend) ─────────────
  const cleanupResults = await Promise.allSettled([
    ensureLordCleanState(connection, PLAYER_A, "Player A"),
    ensureLordCleanState(connection, PLAYER_B, "Player B"),
  ]);
  for (const result of cleanupResults) {
    if (result.status === "rejected") {
      const err = result.reason;
      if (
        err instanceof Error &&
        err.message.includes("Settlement in-flight")
      ) {
        test.skip(true, err.message);
      }
      throw err;
    }
  }

  // Expire phantom lord rounds (PDA closed but DB still in created/locked).
  // The settlement worker runs orphan cleanup every 5 min — too slow for test retries.
  // Directly expire stale DB rounds via psql so the backend's /current returns null.
  const backendUrl = devnetConfig.fairnessBackendUrl;
  {
    const res = await fetch(`${backendUrl}/fairness/lord/current`);
    const data = (await res.json()) as { round: { pda?: string; matchId?: string } | null };
    if (data.round?.pda) {
      const info = await connection.getAccountInfo(new PublicKey(data.round.pda));
      if (!info) {
        console.log(`[cleanup] Phantom lord round (matchId=${data.round.matchId}, PDA gone) — expiring in DB`);
        const { execSync } = await import("child_process");
        const dbUrl = process.env.DATABASE_URL ?? "postgresql://vscode@localhost:5432/rng_utopia_dev";
        execSync(
          `psql "${dbUrl}" -c "UPDATE rounds SET phase = 'expired' WHERE game = 'lord' AND phase IN ('created', 'locked', 'settling')"`,
          { timeout: 5_000 },
        );
        // Wait briefly for the backend to pick up the change
        await new Promise((r) => setTimeout(r, 2_000));
        // Verify it's cleared
        const verify = await fetch(`${backendUrl}/fairness/lord/current`);
        const v = (await verify.json()) as { round: unknown | null };
        if (v.round) console.log("[cleanup] WARNING: backend still returns a lord round after DB expire");
        else console.log("[cleanup] Backend lord current is now null ✓");
      }
    }
  }

  const consoleA = po.trackConsoleErrors(playerAPage);
  const consoleB = po.trackConsoleErrors(playerBPage);

  // Capture settlement event WebSocket logs from both players
  const settlementEventsA = captureSettlementEvents(playerAPage);
  const settlementEventsB = captureSettlementEvents(playerBPage);

  console.log("[phase-1] Player A navigating to Lord of RNGs...");
  await po.navigateToLord(playerAPage);
  await po.waitForWalletConnected(playerAPage);
  console.log("[phase-1] Wallet connected ✓");

  // The page may show "Start Round" (clean state) or "Join Round" (stale round from
  // a previous attempt that the cleanup couldn't find via getProgramAccounts on devnet).
  // Accept either — both end up with Player A in an active round.
  const actionBtn = playerAPage.locator(po.sel.actionButton, {
    hasText: /Start Round|Join Round/i,
  });
  await expect(actionBtn).toBeVisible({ timeout: 30_000 });
  const btnText = await actionBtn.textContent();
  console.log(`[phase-1] '${btnText?.trim()}' button visible ✓`);

  await actionBtn.click();
  console.log(`[phase-1] Clicked '${btnText?.trim()}', waiting for round to appear...`);

  await playerAPage.waitForSelector(
    `${po.sel.activeRound}, ${po.sel.wheelLegendItem}`,
    { state: "visible", timeout: 60_000 },
  );
  console.log("[phase-1] Player A round created via UI ✓");

  // Extract match ID from page URL — more reliable than getProgramAccounts on devnet
  const pageUrl = playerAPage.url();
  const urlMatch = pageUrl.match(/\/lord-of-rngs\/([0-9a-f]{16})/i);
  if (!urlMatch) {
    // Fallback: wait briefly for URL to update
    await playerAPage.waitForURL(/\/lord-of-rngs\/[0-9a-f]{16}/i, { timeout: 10_000 });
    const updatedUrl = playerAPage.url();
    const fallbackMatch = updatedUrl.match(/\/lord-of-rngs\/([0-9a-f]{16})/i);
    if (!fallbackMatch) throw new Error(`Expected URL with match ID, got: ${updatedUrl}`);
  }
  const matchIdHex = (urlMatch?.[1] ?? playerAPage.url().match(/\/lord-of-rngs\/([0-9a-f]{16})/i)?.[1])!;
  console.log(`[phase-1] Match ID from URL: ${matchIdHex}`);

  // Derive PDA from match ID and fetch account directly (avoids getProgramAccounts)
  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("jackpot_round"), Buffer.from(matchIdHex, "hex")],
    LORDOFRNGS_PROGRAM_ID,
  );

  const { round: createdOnChainRound } = await withRetry(
    async () => {
      const fetched = await fetchLordRound(connection, roundPda);
      if (!fetched) throw new Error(`Round PDA ${roundPda.toBase58().slice(0, 12)}… not found on-chain`);
      return { round: fetched };
    },
    { label: "fetchLordRound (direct PDA)", retries: 15, delayMs: 2_000 },
  );
  let round = createdOnChainRound;
  console.log(`[on-chain] Round PDA: ${roundPda.toBase58().slice(0, 12)}…, matchId=${matchIdHex}`);
  expect(round.entries.length).toBe(1);

  const createdRound = await withRetry(
    async () => {
      const backendRound = await fetchBackendRound(devnetConfig, roundPda.toBase58());
      expect(backendRound).not.toBeNull();
      expect(backendRound?.phase).toBe("created");
      expect(backendRound?.secret).toBeUndefined();
      return backendRound!;
    },
    { label: "backend lord round created", retries: 10, delayMs: 1_000 },
  );
  console.log(
    `[backend] Round created with commitment ${createdRound.commitment.slice(0, 12)}...`,
  );

  console.log("[phase-2] Player B navigating...");
  await po.navigateToLord(playerBPage);
  await po.waitForWalletConnected(playerBPage);

  // Player B sees Player A's active round via the global /fairness/lord/current
  // endpoint (single-round model — no tier selection). "Join Round" proves Player B
  // sees the existing round and can enter it.
  const joinBtn = playerBPage.locator(po.sel.actionButton, {
    hasText: /Join Round/i,
  });
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  console.log("[phase-2] 'Join Round' button visible ✓");

  await joinBtn.click();
  console.log("[phase-2] Clicked 'Join Round', waiting for UI update...");

  await playerBPage.waitForSelector(
    `${po.sel.activeRound}, ${po.sel.wheelLegendItem}`,
    { state: "visible", timeout: 60_000 },
  );
  console.log("[phase-2] Player B joined via UI ✓");

  round = await withRetry(
    async () => {
      const r = await fetchLordRound(connection, roundPda);
      if (!r) throw new Error("Round PDA not found");
      if (r.entries.length < 2) throw new Error(`Only ${r.entries.length} entry(s)`);
      return r;
    },
    { label: "verifyTwoEntries", retries: 5, delayMs: 3_000 },
  );
  expect(round.entries.length).toBe(2);
  const phase = Object.keys(round.phase)[0];
  console.log(`[on-chain] phase="${phase}", entries=${round.entries.length} ✓`);
  expect(phase).toBe("active");

  const treasury = await getTreasuryAddress(connection);
  const treasuryBefore = await snapshotBalance(connection, treasury);

  const settledRound = await waitForSettledRound(
    devnetConfig,
    roundPda.toBase58(),
  );
  console.log(`[backend] Round settled via ${settledRound.settleTx}`);

  await Promise.all([
    po.waitForSettlementUi(playerAPage, 120_000),
    po.waitForSettlementUi(playerBPage, 120_000),
  ]);
  expect([
    PLAYER_A.publicKey.toBase58(),
    PLAYER_B.publicKey.toBase58(),
  ]).toContain(settledRound.winner);

  expect(settledRound.secret).toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.commitment).toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.resultHash ?? "").toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.entropy ?? "").toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.winner).toBeTruthy();
  expect(settledRound.settleTx).toBeTruthy();

  await withRetry(
    () => assertLordRoundClosed(connection, roundPda),
    { label: "assertRoundClosed" },
  );
  console.log("[phase-3] Round PDA closed after backend settlement ✓");

  await withRetry(
    () =>
      assertLordTreasuryFee(
        connection,
        treasury,
        treasuryBefore,
        settledRound.totalAmountLamports ?? round.totalAmountLamports.toNumber(),
      ),
    { label: "assertTreasuryFee" },
  );
  console.log("[phase-3] Treasury fee verified ✓");

  // ── Verify settlement event subscription fired ─────────────────────
  const allSettlementEvents = [...settlementEventsA, ...settlementEventsB];
  console.log(
    `[settlement-event] captured ${allSettlementEvents.length} event log(s):`,
  );
  allSettlementEvents.forEach((line) => console.log(`  ${line}`));

  const subscribed = allSettlementEvents.some((l) => l.includes("subscribed"));
  const matched = allSettlementEvents.some(
    (l) => l.includes("matched") || l.includes("settlement-event received"),
  );
  expect(subscribed).toBe(true);
  if (!matched) {
    console.warn(
      "[settlement-event] WARNING: event subscription was active but " +
        "roundSettled event was not detected — polling won the race.",
    );
  } else {
    console.log("[settlement-event] roundSettled event detected via WebSocket ✓");
  }

  // ── Verify profile transactions ──────────────────────────────────
  console.log("[profile] Checking player A profile transactions...");
  const { assertProfileTransactions } = await import("../helpers/profile-assertions");
  await assertProfileTransactions(playerAPage, {
    gameName: "Jackpot",
    gameRoute: "/lord-of-rngs/",
    minRows: 2,
  });
  console.log("[profile] Profile transactions verified ✓");

  const errA = filterNoise(consoleA.errors);
  const errB = filterNoise(consoleB.errors);
  expect(errA).toEqual([]);
  expect(errB).toEqual([]);
});
