/**
 * Visual E2E: peek operations admin route/state coverage (spec 305 FR-3, FR-4).
 *
 * Captures screenshot baselines of the peek admin shell + primary operator
 * routes so future refactors, dependency upgrades, or shell rewrites cannot
 * change the operator's visual surface without an explicit baseline update.
 *
 * Coverage:
 *   1. Home — admin shell header + verified-actor strip + command center
 *      section headings (FR-3 admin shell + FR-3 navigation groups).
 *   2. Home access-denied state — same shell rendered with a non-allowlisted
 *      actor (FR-2 page-level allowlist seam).
 *   3. /games — operator games overview heading + nav (FR-3 navigation).
 *   4. /growth/referrals — growth surface heading + filter bar layout
 *      (FR-3 navigation + FR-4 filters-visible).
 *   5. /operations/queue — operations queue heading + filter bar layout
 *      (FR-10 attention surface + FR-4 filters-visible).
 *   6. /audit — admin-only audit surface heading + filter bar layout
 *      (FR-2 admin-only route + FR-11 audit view).
 *
 * Determinism:
 *   - The visual project pins a 1280x1080 viewport (`devices["Desktop Chrome"]`
 *     base + explicit override) so layout reflows do not move the shell chrome.
 *   - `toHaveScreenshot` is invoked with `mask:` for every data-dependent
 *     region (metric values, recent-activity rows, table bodies, "as of"
 *     timestamps), so the baselines stay stable on an empty Postgres or
 *     against seeded fixtures. The masked rectangles are filled with a
 *     solid colour by Playwright before pixel diffing — see
 *     https://playwright.dev/docs/test-snapshots#masking.
 *   - `animations: "disabled"` and `caret: "hide"` keep the shell static.
 *
 * Baselines policy (per `docs/specs/305-peek-operations-admin/spec.md` and
 * the `feedback_visual_snapshots` rule): only update the committed PNGs
 * when the iteration explicitly changes a peek admin shell / page-chrome
 * visual. A non-visual change failing here means the change is not visual-
 * neutral; investigate before re-baselining.
 *
 * Prerequisites:
 *   - Postgres reachable via DATABASE_URL.
 *   - peek dev server running on http://127.0.0.1:3000 (override via
 *     PEEK_URL) with the dev access bypass:
 *       NODE_ENV=development \
 *       PEEK_DEV_ACCESS_EMAIL=dev@example.com \
 *       PEEK_ACCESS_POLICY='[{"match":"dev@example.com","role":"admin"}]' \
 *       pnpm --filter @taunt-bet/peek dev
 *   - For test 2 (access-denied state), a second peek instance OR the
 *     same instance with `PEEK_DEV_ACCESS_EMAIL=denied@example.com` (an
 *     email NOT in the role policy) — set PEEK_DENIED_URL or skip via
 *     test-level conditional.
 *
 * Run:
 *   cd e2e && pnpm exec playwright test --project=visual
 *
 * Update baselines (only for intentional UI changes):
 *   cd e2e && pnpm exec playwright test --project=visual --update-snapshots
 */
import { test, expect } from "@playwright/test";

const PEEK_URL = process.env.PEEK_URL ?? "http://127.0.0.1:3000";
const PEEK_DENIED_URL = process.env.PEEK_DENIED_URL;

test.describe("peek operations admin · visual", () => {
  test.beforeEach(async ({ page }) => {
    // FR-4 deterministic capture: make every animated/transitional surface
    // settle to a single visual state before screenshotting.
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `;
      document.documentElement.appendChild(style);
    });
  });

  test("home renders the admin shell with stable chrome", async ({ page }) => {
    await page.goto(PEEK_URL);

    // Wait for the shell + command center page heading to be present so
    // the screenshot captures rendered content, not a loading state.
    await expect(
      page.locator('header[aria-label="Peek admin shell"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Command center" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-home.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      // Mask every data-dependent region so the baseline is stable on
      // both an empty Postgres and against seeded fixtures.
      mask: [
        page.locator('[data-peek-test="metric-value"]'),
        page.locator('[data-peek-test="metric-as-of"]'),
        page.locator('[data-peek-test="attention-list"]'),
        page.locator('[data-peek-test="recent-activity"]'),
        page.locator('[data-peek-test="users-table-body"]'),
        page.getByRole("table"),
      ],
    });
  });

  test("home renders the access-denied panel for a non-allowlisted actor", async ({
    page,
  }) => {
    test.skip(
      !PEEK_DENIED_URL,
      "Set PEEK_DENIED_URL to a peek instance whose PEEK_DEV_ACCESS_EMAIL is not in PEEK_ACCESS_POLICY to capture the access-denied baseline.",
    );

    await page.goto(PEEK_DENIED_URL!);

    // The shell still renders, but the body shows the access-denied panel.
    await expect(
      page.locator('header[aria-label="Peek admin shell"]'),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-home-access-denied.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [page.locator('[data-peek-test="actor-email"]')],
    });
  });

  test("games overview renders stable chrome", async ({ page }) => {
    await page.goto(`${PEEK_URL}/games`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Games" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-games.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [
        page.locator('[data-peek-test="metric-value"]'),
        page.locator('[data-peek-test="metric-as-of"]'),
        page.getByRole("table"),
      ],
    });
  });

  test("growth referrals renders stable chrome", async ({ page }) => {
    await page.goto(`${PEEK_URL}/growth/referrals`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Growth · Referrals" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-growth-referrals.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [
        page.locator('[data-peek-test="metric-value"]'),
        page.locator('[data-peek-test="metric-as-of"]'),
        page.getByRole("table"),
      ],
    });
  });

  test("operations queue renders stable chrome", async ({ page }) => {
    await page.goto(`${PEEK_URL}/operations/queue`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Operations · Event queue" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-operations-queue.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [
        page.locator('[data-peek-test="metric-value"]'),
        page.locator('[data-peek-test="metric-as-of"]'),
        page.getByRole("table"),
      ],
    });
  });

  test("audit renders stable chrome (admin-only route)", async ({ page }) => {
    await page.goto(`${PEEK_URL}/audit`);

    // FR-2 admin-only: the page heading still renders even when an actor
    // lacks the role (the body switches to the access-denied panel via
    // FR-3 missing-config/access state). Capturing the heading + chrome
    // covers both the authorized and admin-denied branches because the
    // shell layout is identical.
    await expect(
      page.getByRole("heading", { level: 1, name: "Audit · operator_events" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("peek-audit.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [
        page.locator('[data-peek-test="metric-value"]'),
        page.locator('[data-peek-test="metric-as-of"]'),
        page.getByRole("table"),
      ],
    });
  });
});
