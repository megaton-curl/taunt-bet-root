# Implementation History — 200-visual-regression

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1
**Item**: Install `@playwright/test` as devDependency + install Chromium browser
**Result**: ✅ Success
**Notes**: `@playwright/test` v1.58.2 was already present in `apps/platform/package.json` devDependencies. Ran `npx playwright install chromium` to install Chromium browser (v145.0.7632.6, playwright chromium v1208) at `/home/vscode/.cache/ms-playwright/chromium-1208/`. No code changes needed — dependency was pre-existing.

## Iteration 1 — 2026-02-18T14:01:40Z — OK
- **Log**: iteration-001.log

## Iteration 2
**Item**: Create `apps/platform/playwright.config.ts` with headless Chromium, 1280×720 viewport, baseURL, webServer, and snapshot path config
**Result**: ✅ Success
**Notes**: Created `apps/platform/playwright.config.ts` with: headless Chromium via `devices["Desktop Chrome"]`, 1280×720 viewport, `baseURL: http://localhost:3000`, `webServer` running `pnpm dev` on port 3000, snapshot path template `{testDir}/__snapshots__/{testFilePath}/{arg}{ext}` for committed baselines, `maxDiffPixelRatio: 0.001` (0.1% threshold). Config validated by `npx playwright test --list` (parsed successfully), `pnpm lint` (0 errors), and `pnpm typecheck` for platform (pass).

## Iteration 2 — 2026-02-18T14:03:45Z — OK
- **Log**: iteration-002.log

## Iteration 3
**Item**: Add `test:visual` and `test:visual:update` scripts to `apps/platform/package.json`
**Result**: ✅ Success
**Notes**: Added two scripts: `"test:visual": "playwright test"` and `"test:visual:update": "playwright test --update-snapshots"` to `apps/platform/package.json`. Lint passes (17/17 tasks successful). Platform typecheck passes. Pre-existing typecheck failures in `slots-utopia` and `tug-of-earn` are unrelated.

## Iteration 3 — 2026-02-18T14:05:20Z — OK
- **Log**: iteration-003.log

## Iteration 4
**Item**: Add `test:visual` task to `turbo.json` and `pnpm test:visual` script to monorepo root `package.json`
**Result**: ✅ Success
**Notes**: Added `test:visual` task to `turbo.json` with `cache: false` (visual tests should never be cached since screenshots depend on environment). Added `"test:visual": "turbo run test:visual"` script to root `package.json`. Verified turbo discovers and runs the task correctly in the platform package (fails with "No tests found" which is expected — test files come in Iteration 2). Lint passes (17/17 tasks).

## Iteration 4 — 2026-02-18T14:06:32Z — OK
- **Log**: iteration-004.log

## Iteration 5
**Item**: Add Playwright artifact dirs to `.gitignore` (`test-results/`, `playwright-report/`, `playwright/.cache/`)
**Result**: ✅ Success
**Notes**: Added three Playwright artifact patterns (`test-results/`, `playwright-report/`, `playwright/.cache/`) to `sources/rng-utopia/.gitignore` under a new `# Playwright` section. Verified with `git check-ignore -v` that all three patterns match paths under `apps/platform/`. Note: `playwright/.cache/` was already implicitly covered by the existing `.cache/` pattern, but explicit Playwright entries are clearer. Lint passes (17/17 tasks).

## Iteration 5 — 2026-02-18T14:07:59Z — OK
- **Log**: iteration-005.log

## Iteration 6
**Item**: Create shared test fixture in `apps/platform/e2e/fixtures.ts`
**Result**: ✅ Success
**Notes**: Created `apps/platform/e2e/fixtures.ts` with a `stablePage` fixture that extends Playwright's `test`. The fixture: (a) injects CSS to disable all animations/transitions/scroll-behavior via `!important` rules on `*, *::before, *::after`, (b) wraps `page.goto()` to use `waitUntil: "networkidle"`, re-inject animation CSS after navigation, and `await document.fonts.ready`, (c) adds a 200ms settle time for remaining paints. Exports `test` and `expect` for use in visual test files. `npx playwright test --list` parses without errors. Lint passes (0 errors).

## Iteration 6 — 2026-02-18T14:09:52Z — OK
- **Log**: iteration-006.log

## Iteration 7
**Item**: Create first visual test `apps/platform/e2e/visual/routes.spec.ts` with a single test for `/` (home page) using the shared fixture
**Result**: ✅ Success
**Notes**: Created `apps/platform/e2e/visual/routes.spec.ts` with a single `test("home page")` that uses `stablePage.goto("/")` and `toHaveScreenshot("home.png")`. Had to install Chromium system dependencies (`npx playwright install-deps chromium`) since `libglib-2.0.so.0` was missing. After installing deps: `--update-snapshots` generated `home.png` baseline (937KB) at `e2e/__snapshots__/visual/routes.spec.ts/home.png`. Second run passed with zero diff. Lint passes (0 errors, 17/17 tasks).

## Iteration 7 — 2026-02-18T14:12:47Z — OK
- **Log**: iteration-007.log

## Iteration 8
**Item**: Run `pnpm test:visual --update-snapshots` — verify screenshot is captured and baseline file is written to the expected directory
**Result**: ✅ Success
**Notes**: Ran `pnpm test:visual --update-snapshots` from `apps/platform/` — test passed (1/1, 12.4s). Baseline file confirmed at `e2e/__snapshots__/visual/routes.spec.ts/home.png` (944KB). Note: running `--update-snapshots` from monorepo root requires turbo passthrough syntax (`-- --update-snapshots`); the platform-level `test:visual:update` script works directly. This turbo passthrough concern will be addressed in iteration 5's monorepo root verification item.

## Iteration 8 — 2026-02-18T14:14:22Z — OK
- **Log**: iteration-008.log

## Iteration 9
**Item**: Run `pnpm test:visual` a second time — verify it passes (screenshot matches baseline, zero diff)
**Result**: ✅ Success
**Notes**: Initial run failed with 6060 pixels different (1% ratio) — caused by non-deterministic elements: shooting stars CSS animation timing, campfire sprite animation, SVG SMIL `<animate>` elements (dragon avatar), `Math.random()` in mock profile generation, and `Date.now()` in boss raid timers. Fixed by upgrading `e2e/fixtures.ts` to: (a) inject a seeded Mulberry32 PRNG replacing `Math.random()` via `addInitScript`, (b) freeze `Date.now()` to a fixed timestamp (2026-01-01T00:00:00Z), (c) pause SVG SMIL animations via `svg.pauseAnimations()`, (d) increase settle time to 300ms. Regenerated baseline, then verified 3 consecutive runs all pass with zero diff. Lint passes (17/17 tasks).

## Iteration 9 — 2026-02-18T14:19:05Z — OK
- **Log**: iteration-009.log

## Iteration 10
**Item**: Add tests for all remaining routes to `routes.spec.ts`: `/coinflip`, `/lord-of-rngs`, `/close-call`, `/crash`, `/game-of-trades`, `/profile`, `/quests`, `/loot`, `/fairness`, `/leaderboard`, `/nonexistent` (404)
**Result**: ✅ Success
**Notes**: Added 11 new tests to `routes.spec.ts` (total now 12 tests: home + 10 game/utility routes + 404). Ran `pnpm test:visual:update` — all 12 passed in 55.3s, generating 11 new baseline PNGs in `e2e/__snapshots__/visual/routes.spec.ts/`. Second run without `--update-snapshots` passed with zero diff (53.3s). Lint passes (0 errors, 17/17 tasks).

## Iteration 10 — 2026-02-18T14:22:30Z — OK
- **Log**: iteration-010.log

## Iteration 11
**Item**: Run `pnpm test:visual --update-snapshots` to generate all baselines, then run `pnpm test:visual` to verify all pass with zero diff + Verify baseline screenshot file count
**Result**: ✅ Success
**Notes**: Combined two checklist items since the second is a pure verification of the first. Ran `pnpm test:visual:update` — all 12 tests passed (53.1s), baselines generated. Ran `pnpm test:visual` — all 12 passed with zero diff (51.5s). Verified 12 baseline PNG files in `e2e/__snapshots__/visual/routes.spec.ts/` (11 routes + 404). The checklist said "13" but the actual FR-2 route list has 11 routes + 1 404 page = 12 files — minor counting error in the checklist, corrected in annotation.

## Iteration 11 — 2026-02-18T14:25:35Z — OK
- **Log**: iteration-011.log

## Iteration 12
**Item**: Create `apps/platform/e2e/visual/states.spec.ts` with wallet connected vs. disconnected variants for the home page
**Result**: ✅ Success
**Notes**: Created `apps/platform/e2e/visual/states.spec.ts` with two tests: "wallet disconnected" (clears localStorage, navigates, screenshots) and "wallet connected" (clears localStorage, navigates, clicks `.rpg-wallet-icon` to trigger connect, waits for `.rpg-wallet-icon--connected`, re-injects freeze CSS, screenshots). Note: the UI uses an inline `rpg-wallet-icon` div (not the `WalletButton` component from `@rng-utopia/ui`), so the connect trigger is clicking the wallet bag icon. Both baselines generated (`home-disconnected.png` 939KB, `home-connected.png` 942KB). Verified determinism: 2 consecutive runs pass with zero diff. Existing 12 route tests still pass. Lint passes (17/17 tasks).

## Iteration 12 — 2026-02-18T14:32:56Z — OK
- **Log**: iteration-012.log

## Iteration 13
**Item**: Add wallet connected vs. disconnected variants for the coinflip page to `states.spec.ts`
**Result**: ✅ Success
**Notes**: Added a `Coinflip page` describe block to `states.spec.ts` with two tests: "wallet disconnected" (clears localStorage, navigates to `/coinflip`, screenshots) and "wallet connected" (clears localStorage, navigates to `/coinflip`, clicks `.rpg-wallet-icon` to connect, waits for `.rpg-wallet-icon--connected`, re-injects freeze CSS, screenshots). New baselines generated: `coinflip-disconnected.png` and `coinflip-connected.png`. All 16 tests (12 routes + 4 state variants) pass with zero diff on re-run. Lint passes (0 errors, 17/17 tasks).

## Iteration 13 — 2026-02-18T14:36:40Z — OK
- **Log**: iteration-013.log

## Iteration 14
**Item**: Add default profile view variant (profile page with wallet connected)
**Result**: ✅ Success
**Notes**: Added a `Profile page` describe block to `states.spec.ts` with a "wallet connected" test that navigates to `/profile`, clicks `.rpg-wallet-icon` to connect, waits for `.rpg-wallet-icon--connected`, re-injects freeze CSS, and screenshots as `profile-connected.png`. New baseline generated (848KB). All 17 tests (12 routes + 5 state variants) pass with zero diff on re-run. Lint passes (0 errors, 17/17 tasks).

## Iteration 14 — 2026-02-18T14:40:47Z — OK
- **Log**: iteration-014.log

## Iteration 15
**Item**: Run `pnpm test:visual --update-snapshots` to generate state variant baselines, verify all pass on re-run
**Result**: ✅ Success
**Notes**: Ran `pnpm test:visual:update` — all 17 tests passed (1.3m), baselines generated/refreshed for all 12 route screenshots and 5 state variant screenshots. Ran `pnpm test:visual` without `--update-snapshots` — all 17 tests passed with zero diff (1.2m). State variant baselines confirmed: `home-disconnected.png`, `home-connected.png`, `coinflip-disconnected.png`, `coinflip-connected.png`, `profile-connected.png`.

## Iteration 15 — 2026-02-18T14:44:06Z — OK
- **Log**: iteration-015.log

## Iteration 16
**Item**: Verify determinism: run `pnpm test:visual` twice consecutively, confirm zero failures (identical baselines)
**Result**: ✅ Success
**Notes**: Ran `pnpm test:visual` twice consecutively from `apps/platform/`. First run: 17 passed (1.3m). Second run: 17 passed (1.3m). Zero failures on both runs — screenshots are deterministic (same input produces identical pixels). The seeded PRNG, frozen `Date.now()`, disabled CSS animations/transitions, and paused SVG SMIL animations from the fixture ensure full reproducibility.

## Iteration 16 — 2026-02-18T14:47:30Z — OK
- **Log**: iteration-016.log

## Iteration 17
**Item**: Verify diff detection (introduce 1px CSS change, confirm failure + diff images) + Revert intentional CSS change
**Result**: ✅ Success
**Notes**: Added `body { padding: 1px; }` to `index.css`. Ran `pnpm test:visual` — all 17 tests failed as expected with pixel diff ratio ~0.03 (23,924 pixels different). Verified 17 `*-diff.png` files produced in `test-results/` directories. Reverted the CSS change, ran tests again — all 17 passed with zero diff. Combined both checklist items (diff detection + revert) since the revert is a direct continuation of the detection test.

## Iteration 17 — 2026-02-18T14:52:58Z — OK
- **Log**: iteration-017.log

## Iteration 18
**Item**: Verify no JS console errors during test runs (check Playwright console output)
**Result**: ✅ Success
**Notes**: Enhanced `e2e/fixtures.ts` to collect console errors via `page.on("console", ...)` listener that filters for `msg.type() === "error"`. After each test's `use(page)` completes, the fixture asserts `consoleErrors.length === 0`, throwing with all collected error messages if any exist. Ran all 17 visual tests — all passed with zero console errors detected. Lint passes (17/17 tasks). This provides ongoing protection: any future JS error during visual test capture will fail the test.

## Iteration 18 — 2026-02-18T14:55:41Z — OK
- **Log**: iteration-018.log

## Iteration 19
**Item**: Verify `pnpm test:visual` passes from monorepo root via turbo
**Result**: ✅ Success
**Notes**: Ran `pnpm test:visual` from monorepo root (`sources/rng-utopia/`). Turbo discovered and executed the `test:visual` task in `@rng-utopia/platform`. All 17 tests passed (1.3m, 1 worker). Turbo output: "Tasks: 1 successful, 1 total". No issues with turbo passthrough — the `test:visual` script in root `package.json` maps to `turbo run test:visual`, which correctly delegates to `apps/platform`'s `playwright test` command.

Also checked off all Testing Requirements items (Code Quality, Functional Verification, Visual Verification, Console/Network Check) — all verified through work done in iterations 1-18 plus this iteration's monorepo root verification.

Ran `./scripts/verify` (full verification). Lint passes (0 errors). Platform typecheck passes. Verify fails at `pnpm typecheck` step due to **pre-existing** `Cannot find type definition file for 'vite/client'` errors in 7 unrelated packages (crash-simulator, ui, wallet, price-feeds, slots-utopia, close-call, lord-of-rngs, game-of-trades). These are NOT caused by this spec — no source code was changed in this iteration. All visual regression infrastructure is complete and working.

Updated spec Meta Status to `Done`.

## Iteration 19 — 2026-02-18T15:06:18Z — BLOCKED
- **Blocker**: Full verification failed: `./scripts/verify` exits with code 2 at the `pnpm typecheck` step. The failures are pre-existing `Cannot find type definition file for 'vite/client'` errors in 7+ packages (crash-simulator, ui, wallet, price-feeds, slots-utopia, close-call, lord-of-rngs, game-of-trades). These are NOT caused by spec 200 — no source code was modified in this iteration (only spec.md and history.md). The platform package (our target) passes lint, typecheck, build, and all 17 visual tests. The verify script has `set -e` so it aborts on the first typecheck failure. Either these packages need their vite/client types fixed (separate concern) or the verify script needs to be scoped to only check relevant packages.
- **Log**: iteration-019.log

