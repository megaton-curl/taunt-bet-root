import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3003";

export default defineConfig({
  testDir: "./devnet",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: "list",
  timeout: 120_000,

  use: {
    baseURL: baseUrl,
    screenshot: "off",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },

  projects: [
    {
      name: "devnet",
      testMatch: "**/*.spec.ts",
    },
  ],

  // No webServer block — frontend must be started externally.
  // Start the platform frontend before running: PLAYWRIGHT_BASE_URL=http://localhost:3003 pnpm exec playwright test
});
