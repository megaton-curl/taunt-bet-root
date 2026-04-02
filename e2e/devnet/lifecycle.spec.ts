/* eslint-disable no-console */
/**
 * Devnet lifecycle E2E test: create → join → backend auto-settle → verify.
 *
 * Uses two isolated browser contexts (Player A and Player B) with deterministic
 * keypairs. The frontend talks to a live fairness backend for create + round
 * verification, while the backend settles against deployed devnet programs.
 */
import { test, expect } from "./fixtures";
import type { ConsoleMessage, Page } from "@playwright/test";
import * as po from "../local/helpers/page-objects";
import { PLAYER_A, PLAYER_B } from "./helpers/wallets";
import {
  validateDevnetEnv,
  verifyFairnessBackend,
  type DevnetConfig,
} from "./helpers/env";
import { withRetry } from "./helpers/retry";
import { ensureCleanState } from "./helpers/on-chain-cleanup";
import {
  assertMatchCreated,
  assertMatchClosed,
  assertTreasuryFee,
  getTreasuryAddress,
  snapshotBalance,
} from "../local/helpers/on-chain";
import { Connection, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";

const MIN_BALANCE_SOL = 0.1;
const SIDE_HEADS = 0;
const ENTRY_AMOUNT = 5_000_000;
const SETTLEMENT_TIMEOUT_MS = 120_000;

const DEVNET_NOISE_PATTERNS = [
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
  "/auth/",
];

/** Capture [settlement-event] console lines from a page. */
function captureSettlementEvents(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("[settlement-event]")) {
      lines.push(msg.text());
    }
  });
  return lines;
}

interface BackendRoundResponse {
  pda: string;
  phase: "created" | "locked" | "settling" | "settled" | "expired";
  commitment: string;
  secret?: string;
  resultHash?: string | null;
  resultSide?: number | null;
  winner?: string | null;
  settleTx?: string | null;
}

function filterDevnetNoise(errors: string[]): string[] {
  return errors.filter(
    (e) => !DEVNET_NOISE_PATTERNS.some((pattern) => e.includes(pattern)),
  );
}

async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  label: string,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance >= MIN_BALANCE_SOL * LAMPORTS_PER_SOL) {
    console.log(
      `  ${label}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL (sufficient)`,
    );
    return;
  }
  throw new Error(
    `${label} has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL; ` +
      `requires at least ${MIN_BALANCE_SOL.toFixed(3)} SOL. ` +
      `Manually fund ${pubkey.toBase58()} and rerun.`,
  );
}

async function fetchBackendRound(
  config: DevnetConfig,
  matchPda: string,
): Promise<BackendRoundResponse | null> {
  const response = await fetch(
    `${config.fairnessBackendUrl}/fairness/rounds/${matchPda}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Backend round lookup failed (${response.status} ${response.statusText})`,
    );
  }
  return (await response.json()) as BackendRoundResponse;
}

async function waitForSettledRound(
  config: DevnetConfig,
  matchPda: string,
): Promise<BackendRoundResponse> {
  const start = Date.now();

  while (Date.now() - start < SETTLEMENT_TIMEOUT_MS) {
    const round = await fetchBackendRound(config, matchPda);
    if (round?.phase === "settled" && round.secret && round.settleTx) {
      return round;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Timed out waiting for backend to settle round ${matchPda}`,
  );
}

async function waitForReadyOrResult(page: Page): Promise<void> {
  await Promise.race([
    po.waitForPhaseLabel(page, "Countdown...", 30_000),
    po.waitForPhaseLabel(page, "Flipping...", 30_000),
    po.waitForResult(page, 30_000).then(() => undefined),
  ]);
}

function capturePageDiagnostics(page: Page, sink: string[]) {
  const handler = (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.text().includes("[coinflip]")) {
      sink.push(`[${msg.type()}] ${msg.text()}`);
    }
  };
  page.on("console", handler);
  page.on("pageerror", (err) => {
    sink.push(`[pageerror] ${err.message}`);
  });
  return () => page.off("console", handler);
}

test.beforeAll(async () => {
  const config = validateDevnetEnv();
  await verifyFairnessBackend(config);

  console.log("Devnet lifecycle: funding test wallets...");
  const connection = new Connection(config.rpcUrl, "confirmed");
  await ensureFunded(connection, PLAYER_A.publicKey, "Player A");
  await ensureFunded(connection, PLAYER_B.publicKey, "Player B");
});

// Skipped: requires frontend app (separate project, not yet available)
test.skip("coinflip devnet lifecycle: create → join → backend settle → verify", async ({
  playerAPage,
  playerBPage,
  connection,
  devnetConfig,
}) => {
  test.setTimeout(300_000);

  const cleanupResults = await Promise.allSettled([
    ensureCleanState(connection, PLAYER_A, "Player A"),
    ensureCleanState(connection, PLAYER_B, "Player B"),
  ]);
  for (const result of cleanupResults) {
    if (result.status === "rejected") {
      const err = result.reason;
      if (
        err instanceof Error &&
        (err.message.includes("VRF in-flight") ||
          err.message.includes("Settlement in-flight"))
      ) {
        test.skip(true, err.message);
      }
      throw err;
    }
  }

  const consoleA = po.trackConsoleErrors(playerAPage);
  const consoleB = po.trackConsoleErrors(playerBPage);

  // Capture settlement event WebSocket logs from both players
  const settlementEventsA = captureSettlementEvents(playerAPage);
  const settlementEventsB = captureSettlementEvents(playerBPage);

  await po.navigateToCoinflip(playerAPage);

  const createDiagnostics: string[] = [];
  const stopCreateCapture = capturePageDiagnostics(
    playerAPage,
    createDiagnostics,
  );
  try {
    await po.createMatch(playerAPage, 0.005, "heads", { timeout: 90_000 });
  } finally {
    stopCreateCapture();
    if (createDiagnostics.length > 0) {
      console.log("[diag] Player A create diagnostics:");
      createDiagnostics.forEach((line) => console.log(`  ${line}`));
    }
  }

  await expect(
    playerAPage.locator(po.sel.activeMatchWaiting),
  ).toBeVisible({ timeout: 15_000 });

  const { matchPda } = await withRetry(
    () =>
      assertMatchCreated(
        connection,
        PLAYER_A.publicKey,
        SIDE_HEADS,
        ENTRY_AMOUNT,
      ),
    { label: "assertMatchCreated" },
  );
  console.log(`[on-chain] Match PDA verified: ${matchPda.toBase58()}`);

  const createdRound = await withRetry(
    async () => {
      const round = await fetchBackendRound(devnetConfig, matchPda.toBase58());
      expect(round).not.toBeNull();
      expect(round?.phase).toBe("created");
      expect(round?.secret).toBeUndefined();
      return round!;
    },
    { label: "backend round created", retries: 10, delayMs: 1_000 },
  );
  console.log(
    `[backend] Round created with commitment ${createdRound.commitment.slice(0, 12)}...`,
  );

  // Snapshot treasury BEFORE join — backend settles very fast after lock,
  // so snapshotting after join risks a post-settlement reading.
  const treasury = await getTreasuryAddress(connection);
  const treasuryBefore = await snapshotBalance(connection, treasury);

  await po.navigateToCoinflip(playerBPage);
  await po.waitForWalletConnected(playerBPage);
  await po.waitForLobbyMatch(playerBPage, 30_000);
  await po.joinMatchById(playerBPage, matchPda.toBase58());
  await waitForReadyOrResult(playerAPage);

  const settledRound = await waitForSettledRound(
    devnetConfig,
    matchPda.toBase58(),
  );
  console.log(`[backend] Round settled via ${settledRound.settleTx}`);

  const creatorWins = settledRound.resultSide === SIDE_HEADS;
  const expectedWinner = creatorWins
    ? PLAYER_A.publicKey.toBase58()
    : PLAYER_B.publicKey.toBase58();
  expect(settledRound.winner).toBe(expectedWinner);

  const [resultA, resultB] = await Promise.all([
    po.waitForResultOrLobby(playerAPage, 90_000),
    po.waitForResultOrLobby(playerBPage, 90_000),
  ]);
  if (resultA !== null) {
    expect(resultA).toBe(creatorWins ? "won" : "lost");
  }
  if (resultB !== null) {
    expect(resultB).toBe(creatorWins ? "lost" : "won");
  }
  expect(settledRound.secret).toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.commitment).toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.resultHash ?? "").toMatch(/^[0-9a-f]{64}$/i);
  expect(settledRound.winner).toBeTruthy();
  expect(settledRound.settleTx).toBeTruthy();

  await withRetry(
    () => assertMatchClosed(connection, matchPda),
    { label: "assertMatchClosed", retries: 8, delayMs: 2_000 },
  );
  console.log("[on-chain] Match PDA closed after backend settlement");

  await withRetry(
    () => assertTreasuryFee(connection, treasury, treasuryBefore, ENTRY_AMOUNT),
    { label: "assertTreasuryFee", retries: 8, delayMs: 2_000 },
  );

  // ── Verify settlement event subscription fired ─────────────────────
  // At least one player should have received the event via WebSocket.
  // The subscription activates when the match is in a non-complete phase,
  // so whoever is viewing the active match will see the event.
  const allSettlementEvents = [...settlementEventsA, ...settlementEventsB];
  console.log(
    `[settlement-event] captured ${allSettlementEvents.length} event log(s):`,
  );
  allSettlementEvents.forEach((line) => console.log(`  ${line}`));

  const subscribed = allSettlementEvents.some((l) => l.includes("subscribed"));
  const matched = allSettlementEvents.some((l) => l.includes("matched"));
  expect(subscribed).toBe(true);
  // The event may or may not fire before polling catches it (depends on WS
  // latency), so we only warn instead of failing on the "matched" assertion.
  if (!matched) {
    console.warn(
      "[settlement-event] WARNING: event subscription was active but " +
        "matchSettled event was not detected — polling won the race. " +
        "This is OK but means the WebSocket was slower than expected.",
    );
  } else {
    console.log("[settlement-event] matchSettled event detected via WebSocket ✓");
  }

  // ── Verify profile transactions ──────────────────────────────────
  console.log("[profile] Checking player A profile transactions...");
  const { assertProfileTransactions } = await import("../helpers/profile-assertions");
  await assertProfileTransactions(playerAPage, {
    gameName: "Flip You",
    gameRoute: "/coinflip/",
    minRows: 2,
  });
  console.log("[profile] Profile transactions verified ✓");

  const realErrorsA = filterDevnetNoise(consoleA.errors);
  const realErrorsB = filterDevnetNoise(consoleB.errors);
  expect(realErrorsA).toEqual([]);
  expect(realErrorsB).toEqual([]);
});
