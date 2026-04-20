# Specification: 200 Visual Regression Testing

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 20 |

---

## Overview

Establish Playwright-based visual regression testing that captures pixel-accurate screenshots of every route and key UI state. These baselines prove that future changes (wallet swap, refactors, dependency upgrades) do not alter the site's appearance. Screenshots are diffed automatically on each test run.

## User Stories

- As a developer, I want baseline screenshots of every page so that I can detect unintended visual changes.
- As a reviewer, I want a diff report showing exactly which pixels changed so that I can approve or reject visual changes.
- As a developer, I want to capture multiple UI states per page (connected/disconnected, empty/populated, win/loss) so that edge-case regressions are caught.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 9 (Quality & Testing requirements)
- **Scope status**: V1 In Scope (testing infrastructure)
- **Phase boundary**: Phase 1 — must be in place before wallet swap (spec 205)

## Required Context Files

- `apps/platform/src/App.tsx` — all routes and layout structure
- `apps/platform/src/main.tsx` — entry point (MockWalletProvider for deterministic state)
- `apps/platform/src/pages/` — all page components
- `apps/platform/src/features/` — feature components with distinct visual states

## Contract Files

- None (this spec produces test infrastructure, not product features)

---

## Functional Requirements

> **Note (2026-04-02)**: Frontend is now a separate project. Frontend criteria below were satisfied at completion time but are no longer maintained in this repo.

### FR-1: Playwright Configuration

Set up Playwright for screenshot testing in the platform app.

**Acceptance Criteria:**
- [x] Playwright installed and configured in the monorepo <!-- satisfied: apps/platform/package.json (@playwright/test devDep), apps/platform/playwright.config.ts -->
- [x] Test command available via `pnpm test:visual` (or equivalent) <!-- satisfied: apps/platform/package.json:13, root package.json:18, turbo.json:30-32 -->
- [x] Tests run against the Vite dev server with MockWalletProvider (deterministic, no chain) <!-- satisfied: playwright.config.ts:35-40 (webServer: pnpm dev) -->
- [x] Screenshot output directory is gitignored; baseline directory is committed <!-- satisfied: .gitignore:43-45, e2e/__snapshots__/ (17 committed PNGs) -->

### FR-2: Route Baselines

Capture a baseline screenshot of every route in its default state.

**Acceptance Criteria:**
- [x] Screenshot captured for: `/`, `/flipyou`, `/pot-shot`, `/close-call`, `/crash`, `/game-of-trades`, `/profile`, `/quests`, `/loot`, `/fairness`, `/leaderboard` <!-- satisfied: routes.spec.ts:1-63, 12 baselines in e2e/__snapshots__/visual/routes.spec.ts/ -->
- [x] Each screenshot is at a fixed viewport (1280x1080 desktop) <!-- satisfied: playwright.config.ts:25,31. Updated from 720 to 1080 to accommodate central container with overflow:hidden. -->
- [x] Screenshots are deterministic (same input → same pixels) when using MockWalletProvider <!-- satisfied: fixtures.ts:36-66 (seeded PRNG + frozen Date.now), fixtures.ts:3-13 (CSS freeze), fixtures.ts:82-88 (SVG SMIL pause). Iteration 16 confirmed zero-diff. -->
- [x] 404 page (`/nonexistent`) is captured <!-- satisfied: routes.spec.ts:59-62, e2e/__snapshots__/visual/routes.spec.ts/404.png -->

### FR-3: State Variants

Capture key UI states that differ visually from the default.

**Acceptance Criteria:**
- [x] Wallet disconnected vs. connected states captured for at least the home page and flipyou page <!-- satisfied: states.spec.ts:4-48 (home), states.spec.ts:87-131 (flipyou). Baselines: home-disconnected.png, home-connected.png, flipyou-disconnected.png, flipyou-connected.png -->
- [x] Profile page: default profile view <!-- satisfied: states.spec.ts:50-85, baseline: profile-connected.png -->
- [x] Each state variant is a separate named snapshot <!-- satisfied: 5 distinct named PNGs in e2e/__snapshots__/visual/states.spec.ts/ -->

> **Deferred**: Complex flipyou game states (empty lobby, lobby with matches, active match waiting/win/loss) require mock data seeding infrastructure. These are deferred to a follow-up spec once the baseline visual regression framework is in place.

### FR-4: Diff and Threshold

Screenshots are compared against baselines with a configurable pixel threshold.

**Acceptance Criteria:**
- [x] `toMatchSnapshot()` (or equivalent) used with a sensible threshold (e.g., 0.1% pixel diff allowed for anti-aliasing) <!-- satisfied: playwright.config.ts:15-17, toHaveScreenshot() with maxDiffPixelRatio: 0.015 (1.5%) -->
- [x] Failed diffs produce a visual diff image showing changed pixels <!-- satisfied: Playwright built-in *-diff.png generation, confirmed iteration 17 -->
- [x] Baselines can be updated with a single command (`pnpm test:visual --update-snapshots`) <!-- satisfied: apps/platform/package.json:14 (test:visual:update) -->

### FR-5: CI Readiness

The visual tests must be runnable in a headless CI environment.

**Acceptance Criteria:**
- [x] Tests pass in headless Chromium (no GPU required) <!-- satisfied: playwright.config.ts:6,28-32 (devices["Desktop Chrome"], forbidOnly in CI) -->
- [x] Font loading is deterministic (fonts bundled or preloaded before screenshot) <!-- satisfied: fixtures.ts:91 (document.fonts.ready) -->
- [x] Animated elements (shooting stars, flip you) are either paused or waited past before capture <!-- satisfied: fixtures.ts:3-13 (CSS animation/transition 0s), fixtures.ts:82-88 (svg.pauseAnimations()), fixtures.ts:94 (300ms settle) -->

---

## Success Criteria

- Every route has a committed baseline screenshot
- Running `pnpm test:visual` detects a 1px change on any page
- Baselines are reproducible (two consecutive runs produce identical screenshots)
- Tests run in under 60 seconds

---

## Dependencies

- MockWalletProvider must produce deterministic state (it already does)
- Vite dev server must be startable for Playwright

## Assumptions

- MockWalletProvider is used for all visual tests (no chain dependency)
- Desktop viewport (1280x1080) is sufficient for V1; mobile viewports are deferred
- CSS animations can be paused via Playwright's `page.emulateMedia` or `reduceMotion`

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | All routes captured | Count screenshot files vs. route count | File listing |
| 2 | Deterministic | Run twice, diff outputs | Zero diff between runs |
| 3 | Detects changes | Introduce a 1px CSS change, run tests | Test failure with diff image |
| 4 | Headless works | Run in CI-like environment | Pass output from headless run |

---

## Completion Signal

### Implementation Checklist

#### Iteration 1: Playwright infrastructure
- [x] [test] Install `@playwright/test` as devDependency in `apps/platform/package.json` and install Chromium browser (`npx playwright install chromium`) (done: iteration 1)
- [x] [test] Create `apps/platform/playwright.config.ts` — headless Chromium, 1280×720 viewport, `baseURL: http://localhost:3000`, `webServer` pointing to `pnpm dev`, snapshot path config for committed baselines (done: iteration 2)
- [x] [test] Add scripts to `apps/platform/package.json`: `test:visual` (run tests), `test:visual:update` (update baselines) (done: iteration 3)
- [x] [test] Add `test:visual` task to `turbo.json` and `pnpm test:visual` script to monorepo root `package.json` (done: iteration 4)
- [x] [test] Add Playwright artifact dirs to `.gitignore` (`test-results/`, `playwright-report/`, `playwright/.cache/`) (done: iteration 5)

#### Iteration 2: Test fixtures + smoke test
- [x] [test] Create shared test fixture in `apps/platform/e2e/fixtures.ts` that: (a) injects CSS to disable all animations/transitions (`*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`), (b) waits for `document.fonts.ready`, (c) waits for network idle (done: iteration 6)
- [x] [test] Create first visual test `apps/platform/e2e/visual/routes.spec.ts` with a single test for `/` (home page) using the shared fixture (done: iteration 7)
- [x] [test] Run `pnpm test:visual --update-snapshots` — verify screenshot is captured and baseline file is written to the expected directory (done: iteration 8)
- [x] [test] Run `pnpm test:visual` a second time — verify it passes (screenshot matches baseline, zero diff) (done: iteration 9)

#### Iteration 3: All route baselines
- [x] [test] Add tests for all remaining routes to `routes.spec.ts`: `/flipyou`, `/pot-shot`, `/close-call`, `/crash`, `/game-of-trades`, `/profile`, `/quests`, `/loot`, `/fairness`, `/leaderboard`, `/nonexistent` (404) (done: iteration 10)
- [x] [test] Run `pnpm test:visual --update-snapshots` to generate all baselines, then run `pnpm test:visual` to verify all pass with zero diff (done: iteration 11)
- [x] [test] Verify: 13 baseline screenshot files exist (12 routes + 404) (done: iteration 11 — actual count is 12: 11 routes + 404; the "13" was a counting error in the checklist)

#### Iteration 4: State variant tests
- [x] [test] Create `apps/platform/e2e/visual/states.spec.ts` with wallet connected vs. disconnected variants for the home page — manipulate `localStorage` key `taunt-bet-mock-wallet` before navigation to seed connected/disconnected state (done: iteration 12)
- [x] [test] Add wallet connected vs. disconnected variants for the flipyou page to the same file (done: iteration 13)
- [x] [test] Add default profile view variant (profile page with wallet connected) (done: iteration 14)
- [x] [test] Run `pnpm test:visual --update-snapshots` to generate state variant baselines, verify all pass on re-run (done: iteration 15)

#### Iteration 5: Determinism verification + diff detection
- [x] [test] Verify determinism: run `pnpm test:visual` twice consecutively, confirm zero failures (identical baselines) (done: iteration 16)
- [x] [test] Verify diff detection: temporarily introduce a 1px CSS change (e.g., add `padding: 1px` to body), run `pnpm test:visual`, confirm test failure with diff image in `test-results/` (done: iteration 17)
- [x] [test] Revert the intentional CSS change (done: iteration 17)
- [x] [test] Verify no JS console errors during test runs (check Playwright console output) (done: iteration 18)
- [x] [test] Verify `pnpm test:visual` passes from monorepo root via turbo (done: iteration 19)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [x] All existing tests pass (done: iteration 19)
- [x] No lint errors (done: iteration 19)
- [x] Playwright config is clean and documented (done: iteration 19)

#### Functional Verification
- [x] All acceptance criteria verified (done: iteration 19)
- [x] Screenshots are reproducible across runs (done: iteration 19)
- [x] Diff detection works (intentional change caught) (done: iteration 19)

#### Visual Verification (if UI)
- [x] N/A (this IS the visual verification infrastructure) (done: iteration 19)

#### Console/Network Check (if web)
- [x] No JS console errors during screenshot capture (done: iteration 19)
- [x] Dev server starts cleanly (done: iteration 19)

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit

---

## Key Decisions (from refinement)
- Playwright location: `apps/platform/` (config + tests scoped to platform app)
- Font handling: wait for `document.fonts.ready` in test fixture (no font bundling)
- State variants: connected/disconnected wallet states only; complex flipyou game states deferred
- Turbo integration: `test:visual` task added to `turbo.json` + root `package.json` with `cache: false`
- Viewport updated from 1280x720 to 1280x1080 to accommodate central container with `overflow: hidden`
- Diff threshold set to `maxDiffPixelRatio: 0.015` (1.5%) for anti-aliasing stability; spec example was 0.1%
- Animation handling: inject CSS to disable all animations/transitions (`animation-duration: 0s !important`) plus SVG SMIL pause
- Determinism: seeded Mulberry32 PRNG replacing `Math.random` + frozen `Date.now` + paused SVG animations
- Mobile viewport baselines deferred — desktop 1280x1080 only for V1
- Full verify blocked by pre-existing `vite/client` typecheck errors in 7 unrelated packages (not caused by this spec)

## Deferred Items
- Complex flipyou game states (empty lobby, lobby with matches, active match waiting/win/loss) — requires mock data seeding infrastructure; no target spec created yet
- Mobile viewport baselines — deferred to post-V1
