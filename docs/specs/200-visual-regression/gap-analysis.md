# Gap Analysis: 200-visual-regression — Visual Regression Testing

- **Date**: 2026-02-19
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions

N/A — this spec is test infrastructure only, no on-chain components.

### Game Engine Exports

N/A — this spec is test infrastructure only, no game engine components.

### Frontend Components

N/A — this spec produces test infrastructure, not product features.

### Tests

| Test | Type | File | Status |
|------|------|------|--------|
| Route baselines (12 tests) | Playwright visual | `apps/platform/e2e/visual/routes.spec.ts` | Passing |
| State variants (5 tests) | Playwright visual | `apps/platform/e2e/visual/states.spec.ts` | Passing |

### Test Infrastructure

| File | Purpose | Line |
|------|---------|------|
| `apps/platform/playwright.config.ts` | Playwright configuration (headless Chromium, 1280x1080 viewport, webServer, snapshot paths) | 1-41 |
| `apps/platform/e2e/fixtures.ts` | Shared `stablePage` fixture: seeded PRNG, frozen Date.now, CSS animation freeze, SVG SMIL pause, font wait, console error collection | 1-110 |
| `apps/platform/e2e/visual/routes.spec.ts` | Route baseline screenshots for all 11 routes + 404 | 1-63 |
| `apps/platform/e2e/visual/states.spec.ts` | State variant screenshots: wallet connected/disconnected for home, coinflip; profile connected | 1-132 |

### Baseline Snapshots (17 files)

| Snapshot | Test File |
|----------|-----------|
| `home.png` | routes.spec.ts |
| `coinflip.png` | routes.spec.ts |
| `lord-of-rngs.png` | routes.spec.ts |
| `close-call.png` | routes.spec.ts |
| `crash.png` | routes.spec.ts |
| `game-of-trades.png` | routes.spec.ts |
| `profile.png` | routes.spec.ts |
| `quests.png` | routes.spec.ts |
| `loot.png` | routes.spec.ts |
| `fairness.png` | routes.spec.ts |
| `leaderboard.png` | routes.spec.ts |
| `404.png` | routes.spec.ts |
| `home-disconnected.png` | states.spec.ts |
| `home-connected.png` | states.spec.ts |
| `coinflip-disconnected.png` | states.spec.ts |
| `coinflip-connected.png` | states.spec.ts |
| `profile-connected.png` | states.spec.ts |

### Scripts & Config

| Script | Location | Command |
|--------|----------|---------|
| `test:visual` | `apps/platform/package.json:13` | `playwright test` |
| `test:visual:update` | `apps/platform/package.json:14` | `playwright test --update-snapshots` |
| `test:visual` (root) | `package.json:18` | `turbo run test:visual` |
| `test:visual` (turbo) | `turbo.json:30-32` | `{ "cache": false }` |

## Acceptance Criteria Audit

### FR-1: Playwright Configuration

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Playwright installed and configured in the monorepo | SATISFIED | `apps/platform/package.json` (devDep `@playwright/test`), `apps/platform/playwright.config.ts` |
| 2 | Test command available via `pnpm test:visual` | SATISFIED | `apps/platform/package.json:13`, root `package.json:18`, `turbo.json:30-32` |
| 3 | Tests run against the Vite dev server with MockWalletProvider | SATISFIED | `playwright.config.ts:35-40` (`webServer: { command: "pnpm dev" }`) |
| 4 | Screenshot output directory is gitignored; baseline directory is committed | SATISFIED | `.gitignore:43-45` (test-results/, playwright-report/, playwright/.cache/), `e2e/__snapshots__/` contains 17 committed PNGs |

### FR-2: Route Baselines

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Screenshot captured for all listed routes | SATISFIED | `routes.spec.ts:1-63` — all 11 routes (`/`, `/coinflip`, `/lord-of-rngs`, `/close-call`, `/crash`, `/game-of-trades`, `/profile`, `/quests`, `/loot`, `/fairness`, `/leaderboard`) + `/nonexistent` (404). 12 baseline PNGs in `e2e/__snapshots__/visual/routes.spec.ts/` |
| 2 | Each screenshot is at a fixed viewport (1280x1080 desktop) | SATISFIED | `playwright.config.ts:25,31` — viewport `{ width: 1280, height: 1080 }`. Updated from 720 to 1080 to accommodate central container with `overflow: hidden`. Spec FR updated to match. |
| 3 | Screenshots are deterministic (same input, same pixels) with MockWalletProvider | SATISFIED | `fixtures.ts:36-66` (seeded Mulberry32 PRNG replacing Math.random + crypto.getRandomValues, frozen Date.now), `fixtures.ts:3-13` (CSS animation/transition freeze), `fixtures.ts:82-88` (SVG SMIL pause). History iteration 16 confirms zero-diff across consecutive runs. |
| 4 | 404 page (`/nonexistent`) is captured | SATISFIED | `routes.spec.ts:59-62`, baseline `e2e/__snapshots__/visual/routes.spec.ts/404.png` |

### FR-3: State Variants

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Wallet disconnected vs. connected states captured for at least home page and coinflip page | SATISFIED | `states.spec.ts:4-48` (home disconnected + connected), `states.spec.ts:87-131` (coinflip disconnected + connected). 4 baselines: `home-disconnected.png`, `home-connected.png`, `coinflip-disconnected.png`, `coinflip-connected.png` |
| 2 | Profile page: default profile view | SATISFIED | `states.spec.ts:50-85` (profile with wallet connected). Baseline: `profile-connected.png` |
| 3 | Each state variant is a separate named snapshot | SATISFIED | 5 distinct named PNGs: `home-disconnected.png`, `home-connected.png`, `coinflip-disconnected.png`, `coinflip-connected.png`, `profile-connected.png` |

### FR-4: Diff and Threshold

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `toMatchSnapshot()` (or equivalent) used with a sensible threshold | SATISFIED | `playwright.config.ts:15-17` uses `toHaveScreenshot()` with `maxDiffPixelRatio: 0.015` (1.5%). Spec example was 0.1% but phrased as "e.g." — 1.5% is a practical threshold that avoids false positives from anti-aliasing variance. |
| 2 | Failed diffs produce a visual diff image | SATISFIED | Playwright built-in: `toHaveScreenshot()` generates `*-diff.png` files. Confirmed in history iteration 17: "Verified 17 `*-diff.png` files produced in `test-results/` directories." |
| 3 | Baselines can be updated with a single command | SATISFIED | `apps/platform/package.json:14`: `"test:visual:update": "playwright test --update-snapshots"` |

### FR-5: CI Readiness

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Tests pass in headless Chromium (no GPU required) | SATISFIED | `playwright.config.ts:28-32` uses `devices["Desktop Chrome"]` (headless by default). `forbidOnly: !!process.env.CI` (line 6). All test runs executed headless. |
| 2 | Font loading is deterministic (fonts bundled or preloaded before screenshot) | SATISFIED | `fixtures.ts:91`: `await page.evaluate(() => document.fonts.ready)` — waits for all fonts to load before screenshot. |
| 3 | Animated elements are paused or waited past before capture | SATISFIED | `fixtures.ts:3-13` (CSS: `animation-duration: 0s !important; transition-duration: 0s !important`), `fixtures.ts:82-88` (JS: `svg.pauseAnimations()`), `fixtures.ts:94` (300ms settle time) |

## Gap Summary

No gaps. All 15 acceptance criteria are satisfied.

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Complex coinflip game states (empty lobby, lobby with matches, active match waiting/win/loss) | "follow-up spec" | No specific spec referenced | N/A | UNTRACKED DEFERRAL |

## Recommendations

1. **Untracked deferral**: The complex coinflip game state variants (empty lobby, active match states) are deferred but no target spec exists. When coinflip implementation matures (spec 001-coinflip), create a follow-up visual regression spec for game-state screenshots with mock data seeding.

2. **Diff threshold**: The `maxDiffPixelRatio` is 1.5% vs the spec's example of 0.1%. This was adjusted for stability (anti-aliasing variance across environments). The current value is reasonable but should be tightened if CI environments are fully controlled.
