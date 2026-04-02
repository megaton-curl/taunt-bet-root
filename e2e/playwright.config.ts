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
  ],
});
