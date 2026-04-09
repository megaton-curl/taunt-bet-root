/* eslint-disable no-console */
/**
 * Devnet E2E: Verify deep-link URL updates when creating/joining matches.
 */
import { test, expect } from "./fixtures";
import * as po from "../local/helpers/page-objects";
import { PLAYER_A } from "./helpers/wallets";
import { validateDevnetEnv, verifyFairnessBackend } from "./helpers/env";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

test.beforeAll(async () => {
  const config = validateDevnetEnv();
  await verifyFairnessBackend(config);
  const connection = new Connection(config.rpcUrl, "confirmed");
  const balance = await connection.getBalance(PLAYER_A.publicKey);
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error(`Player A needs at least 0.05 SOL, has ${balance / LAMPORTS_PER_SOL}`);
  }
});

// Skipped: requires frontend app (separate project, not yet available)
test.skip("flipyou: URL updates to /flipyou/:matchId after creating a match", async ({
  playerAPage,
}) => {
  test.setTimeout(120_000);

  // Capture browser console for debugging
  playerAPage.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[flipyou]") || text.includes("matchId") || text.includes("replaceState")) {
      console.log(`[browser] ${text}`);
    }
  });

  // Navigate to flipyou
  await po.navigateToFlipYou(playerAPage);
  console.log("[deeplink] URL before create:", playerAPage.url());

  // Create a match
  await po.createMatch(playerAPage, 0.005, "heads", { timeout: 60_000 });
  console.log("[deeplink] URL immediately after create:", playerAPage.url());

  // Give React a moment to process the state update + effect
  await playerAPage.waitForTimeout(3_000);
  console.log("[deeplink] URL after 3s:", playerAPage.url());

  // Check if activeMatch exists in the page by evaluating
  const debugInfo = await playerAPage.evaluate(() => {
    return {
      pathname: window.location.pathname,
      href: window.location.href,
    };
  });
  console.log("[deeplink] window.location:", JSON.stringify(debugInfo));

  // Poll for URL change
  await expect(async () => {
    const url = playerAPage.url();
    expect(url).toMatch(/\/flipyou\/[0-9a-f]{16}/i);
  }).toPass({ timeout: 15_000, intervals: [1_000] });

  console.log("[deeplink] Final URL:", playerAPage.url());
});
