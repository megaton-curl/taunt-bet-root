/**
 * Dual-browser-context fixture for devnet E2E tests.
 *
 * Same isolated dual-player pattern as local fixtures, but connects
 * to the devnet RPC instead of a local validator. The RPC URL comes
 * from the validated devnet env config.
 *
 * Usage in tests:
 * ```ts
 * import { test, expect } from "./fixtures";
 *
 * test("devnet lifecycle", async ({ playerAPage, playerBPage, connection }) => {
 *   // playerAPage and playerBPage target devnet via real RPC
 * });
 * ```
 */
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { Keypair, Connection } from "@solana/web3.js";
import { PLAYER_A, PLAYER_B } from "./helpers/wallets";
import { type DevnetConfig, validateDevnetEnv } from "./helpers/env";

export interface DevnetDualPlayerFixtures {
  /** Validated devnet configuration (RPC URL, program IDs). */
  devnetConfig: DevnetConfig;
  /** Isolated browser context for player A (keypair injected). */
  playerAContext: BrowserContext;
  /** Isolated browser context for player B (keypair injected). */
  playerBContext: BrowserContext;
  /** Page within player A's context. */
  playerAPage: Page;
  /** Page within player B's context. */
  playerBPage: Page;
  /** Player A's deterministic keypair. */
  playerAKeypair: Keypair;
  /** Player B's deterministic keypair. */
  playerBKeypair: Keypair;
  /** Shared RPC connection to the devnet cluster. */
  connection: Connection;
}

/**
 * Inject a 32-byte keypair seed into a new browser context via addInitScript.
 */
async function createPlayerContext(
  browser: BrowserContext["browser"],
  keypair: Keypair,
): Promise<BrowserContext> {
  const context = await browser!.newContext();
  const seedArray = Array.from(keypair.secretKey.slice(0, 32));
  await context.addInitScript((seed: number[]) => {
    (window as unknown as Record<string, unknown>).__TEST_WALLET_SEED__ =
      new Uint8Array(seed);
  }, seedArray);
  return context;
}

export const test = base.extend<DevnetDualPlayerFixtures>({
  // Validate devnet env once per test (sync, cached by Playwright)
  // eslint-disable-next-line no-empty-pattern
  devnetConfig: async ({}, use) => {
    const config = validateDevnetEnv();
    await use(config);
  },

  // Expose keypairs as fixtures
  playerAKeypair: [PLAYER_A, { option: true }],
  playerBKeypair: [PLAYER_B, { option: true }],

  // Shared connection to devnet
  connection: async ({ devnetConfig }, use) => {
    const conn = new Connection(devnetConfig.rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 120_000,
    });
    await use(conn);
  },

  // --- Player A context + page ---
  playerAContext: async ({ browser, playerAKeypair }, use) => {
    const context = await createPlayerContext(browser, playerAKeypair);
    await use(context);
    await context.close();
  },

  playerAPage: async ({ playerAContext }, use) => {
    const page = await playerAContext.newPage();
    await use(page);
  },

  // --- Player B context + page ---
  playerBContext: async ({ browser, playerBKeypair }, use) => {
    const context = await createPlayerContext(browser, playerBKeypair);
    await use(context);
    await context.close();
  },

  playerBPage: async ({ playerBContext }, use) => {
    const page = await playerBContext.newPage();
    await use(page);
  },
});

export { expect } from "@playwright/test";
