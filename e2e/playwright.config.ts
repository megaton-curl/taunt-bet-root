import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
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
      name: "local",
      testDir: "./local",
      testMatch: "**/*.spec.ts",
    },
    {
      name: "devnet",
      testDir: "./devnet",
      testMatch: "**/*.spec.ts",
    },
    {
      name: "visual",
      testDir: "./visual",
      testMatch: "**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 1080 },
      },
      expect: {
        toHaveScreenshot: {
          // Tolerate sub-pixel anti-aliasing differences across hosts while
          // still failing on real visual regressions. Mirrors spec 200's
          // 0.015 (1.5%) tolerance.
          maxDiffPixelRatio: 0.015,
          animations: "disabled",
          caret: "hide",
        },
      },
    },
  ],
});
