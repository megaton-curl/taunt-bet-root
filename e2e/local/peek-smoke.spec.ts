/**
 * Local E2E: peek operations admin smoke test (spec 305 FR-1 → FR-14).
 *
 * Exercises the primary operator flow against a locally-running peek dev
 * server with the dev Cloudflare Access bypass:
 *   1. Home renders the admin shell with brand, role badge, and nav items
 *      (admin actor sees every nav group: Users / Growth / Games / Economy
 *      / Operations / Audit / Access).
 *   2. Global search submits as a URL-addressable GET so investigations are
 *      shareable.
 *   3. Games overview, growth/referrals, operations/queue, and audit all
 *      render their primary heading without crashing the page.
 *
 * Determinism note: the assertions target shell/page chrome that is
 * present regardless of database content, so the spec is stable on an
 * empty Postgres or against seeded fixtures.
 *
 * Prerequisites:
 * - Postgres reachable via DATABASE_URL.
 * - peek dev server running, started with:
 *     NODE_ENV=development \
 *     PEEK_DEV_ACCESS_EMAIL=dev@example.com \
 *     PEEK_ACCESS_POLICY='[{"match":"dev@example.com","role":"admin"}]' \
 *     pnpm --filter @taunt-bet/peek dev
 *   (default port 3000; override with PEEK_URL for a different host/port).
 *
 * Run: cd e2e && pnpm exec playwright test local/peek-smoke.spec.ts
 */
import { test, expect } from "@playwright/test";

const PEEK_URL = process.env.PEEK_URL ?? "http://127.0.0.1:3000";

test.describe("peek operations admin smoke", () => {
  test("home renders the admin shell and command center sections", async ({
    page,
  }) => {
    await page.goto(PEEK_URL);

    // FR-3 admin shell: brand always present.
    await expect(
      page.locator('header[aria-label="Peek admin shell"]').getByText("Peek", {
        exact: true,
      }),
    ).toBeVisible();

    // FR-3 command center: page heading + the four operator sections.
    await expect(
      page.getByRole("heading", { level: 1, name: "Command center" }),
    ).toBeVisible();
    for (const sectionHeading of [
      "Global search",
      "Attention queue",
      "Platform summary",
      "Recent activity",
      "Users",
    ]) {
      await expect(
        page.getByRole("heading", { level: 2, name: sectionHeading }),
      ).toBeVisible();
    }

    // FR-3: shell exposes the verified actor email + resolved role badge for
    // an admin actor configured via PEEK_DEV_ACCESS_EMAIL/PEEK_ACCESS_POLICY.
    const identityStrip = page.locator('[aria-label="Verified actor"]');
    await expect(identityStrip).toBeVisible();
    await expect(identityStrip.locator('[data-role="admin"]')).toBeVisible();
  });

  test("admin actor sees every primary navigation group", async ({ page }) => {
    await page.goto(PEEK_URL);

    const primaryNav = page.locator('nav[aria-label="Primary"]');
    await expect(primaryNav).toBeVisible();

    for (const navLabel of [
      "Users",
      "Growth",
      "Games",
      "Economy",
      "Operations",
      "Audit",
      "Access",
    ]) {
      await expect(
        primaryNav.getByRole("link", { name: navLabel }),
      ).toBeVisible();
    }
  });

  test("global search is URL-addressable so investigations are shareable", async ({
    page,
  }) => {
    await page.goto(PEEK_URL);

    const searchInput = page.getByRole("searchbox", { name: "Global search" });
    await expect(searchInput).toBeVisible();

    await searchInput.fill("smoke-test-no-match");
    await searchInput.press("Enter");

    await expect(page).toHaveURL(/\?.*query=smoke-test-no-match/);
    await expect(searchInput).toHaveValue("smoke-test-no-match");
  });

  test("operator routes render their primary headings", async ({ page }) => {
    const routes: Array<{ path: string; heading: string }> = [
      { path: "/games", heading: "Games" },
      { path: "/growth/referrals", heading: "Growth · Referrals" },
      { path: "/operations/queue", heading: "Operations · Event queue" },
      { path: "/audit", heading: "Audit · operator_events" },
    ];

    for (const { path, heading } of routes) {
      await page.goto(`${PEEK_URL}${path}`);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
    }
  });
});
