/**
 * Devnet E2E smoke test.
 *
 * Validates the devnet environment contract (env vars + deployed programs)
 * and verifies the app loads against the devnet RPC.
 */
import { test, expect } from "./fixtures";
import { verifyDevnetDeployments } from "./helpers/env";

// Skipped: requires frontend app (separate project, not yet available)
test.describe.skip("devnet smoke", () => {
  test("devnet deployments are reachable and valid", async ({
    devnetConfig,
  }) => {
    // Verifies: RPC health, coinflip/platform/orao programs deployed, VRF initialized
    await verifyDevnetDeployments(devnetConfig);
  });

  test("app loads against devnet", async ({ playerAPage }) => {
    await playerAPage.goto("/");
    // App should render the main layout (not a blank screen or error page)
    await expect(playerAPage.locator("body")).not.toBeEmpty();
    // Navigation should be present (proves React rendered)
    await expect(
      playerAPage.locator("nav, [class*='sidebar'], [class*='nav']").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("wallet connects with test keypair on devnet", async ({
    playerAPage,
    playerAKeypair,
  }) => {
    await playerAPage.goto("/");
    // Wait for wallet to auto-connect via TestWalletProvider
    const pubkeyShort = playerAKeypair.publicKey.toBase58().slice(0, 4);
    // The wallet address (or a truncated version) should appear somewhere in the UI
    await expect(playerAPage.getByText(pubkeyShort).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
