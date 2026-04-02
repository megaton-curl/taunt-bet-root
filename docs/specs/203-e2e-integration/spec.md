# Specification: 203 E2E Integration Tests

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Phase | 2 |
| NR_OF_TRIES | 24 |

---

## Overview

End-to-end tests using Playwright that prove real transactions flow from the browser UI through the backend-assisted fairness stack, on-chain programs, and back. This spec defines two suites:

1. **Local deterministic suite (`pnpm test:e2e`)** using `solana-test-validator` for fast CI gating.
2. **Devnet backend suite (`pnpm test:e2e:devnet`)** using deployed contracts and the live backend-backed fairness flow.

Both suites use the TestWalletProvider (from spec 205) to inject test keypairs and sign real transactions without a browser extension.

## User Stories

- As a developer, I want an E2E test that runs the full coinflip lifecycle (auth payload → backend create → join → auto-settle → verify) through the real UI so that I know the frontend, backend, and on-chain programs work together.
- As a developer, I want E2E tests to catch regressions in the chain integration layer (chain.ts, CoinflipContext) that unit and component tests cannot.
- As a CI system, I want deterministic headless local E2E tests so that pull requests are gated on integration correctness.
- As a release system, I want real devnet backend E2E tests so that deployed contracts and the live backend-assisted fairness flow are validated before release.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 9 (Quality & Testing)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 2 — after wallet integration and component tests are stable

## Required Context Files

- `apps/platform/src/features/coinflip/utils/chain.ts` — transaction builders
- `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — game state
- `solana/programs/coinflip/` — on-chain program
- `solana/programs/platform/` — on-chain program
- `packages/wallet/src/` — TestWalletProvider (from spec 205)

## Contract Files

- `solana/tests/coinflip.ts` — bankrun tests define expected on-chain behavior
- `apps/platform/src/features/coinflip/types.ts` — UIMatch shape

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Local Deterministic Infrastructure

Set up the deterministic local E2E environment with Playwright, a local Solana validator, Postgres, and the fairness backend.

**Acceptance Criteria:**
- [x] Playwright configured for E2E tests (separate from visual regression config) <!-- satisfied: playwright.local.config.ts — separate file, testMatch "local/**/*.spec.ts", port 3002 -->
- [x] Test setup script starts solana-test-validator with coinflip + platform programs deployed <!-- satisfied: scripts/localnet-bootstrap.sh:70-79 — --bpf-program for coinflip + platform -->
- [x] Local suite deploys programs as part of setup (blank chain; no pre-deployed assumption) <!-- satisfied: scripts/localnet-bootstrap.sh:66 — rm -rf ledger + --reset flag, programs via --bpf-program at genesis -->
- [x] Test setup airdrops SOL to test wallets <!-- satisfied: e2e/local/helpers/wallets.ts:57-87 — fundTestWallets() airdrops 10 SOL + balance sanity check -->
- [x] App starts with VITE_RPC_URL pointing to local validator <!-- satisfied: playwright.local.config.ts:43 — VITE_RPC_URL: "http://127.0.0.1:8899" -->
- [x] Test teardown stops the validator and cleans up <!-- satisfied: scripts/localnet-teardown.sh — PID kill + port cleanup + ledger removal; run-e2e-local.sh:24 always runs teardown -->
- [x] E2E test command: `pnpm test:e2e` <!-- satisfied: apps/platform/package.json "test:e2e": "bash scripts/run-e2e-local.sh"; root package.json delegates via --filter -->
- [ ] Local suite also boots the fairness backend and its DB/migration prerequisites before the app flow begins

### FR-2: Coinflip Full Lifecycle

Test the complete coinflip flow through the UI.

**Acceptance Criteria:**
- [ ] Test wallet A connects, navigates to /coinflip, enters a custom amount, picks Heads, creates a match <!-- out of scope: frontend is a separate project -->
- [ ] Create path signs the canonical payload and calls `POST /fairness/coinflip/create` before wallet submission <!-- out of scope: frontend is a separate project -->
- [x] Match appears in the open lobby <!-- satisfied: e2e/local/03-lifecycle.spec.ts:72 — waitForLobbyMatch(playerBPage) confirms match visible to Player B -->
- [x] Test wallet B connects (second browser context), sees the match, joins it <!-- satisfied: e2e/local/03-lifecycle.spec.ts:71-75 — Player B navigates, sees match, joinMatch(playerBPage) -->
- [x] Match transitions to locked phase in both contexts <!-- satisfied: e2e/local/03-lifecycle.spec.ts:87-90 — Promise.all([waitForResult(playerAPage), waitForResult(playerBPage)]) — both contexts transition through locked to result -->
- [ ] Backend worker settles the match automatically after join/lock; the test does not resolve the result via a VRF shortcut
- [x] Winner sees "You won" result, loser sees "You lost" <!-- satisfied: e2e/local/03-lifecycle.spec.ts:93-94 — expect(resultA).toBe("won"); expect(resultB).toBe("lost") -->
- [ ] Public verification endpoint / fairness page confirms the settled result from backend-served payloads <!-- out of scope: frontend is a separate project; backend verification endpoint is in scope -->
- [ ] Match disappears from lobby after automatic settlement <!-- out of scope: frontend is a separate project -->

### FR-3: Cancel Flow

Test match cancellation.

**Acceptance Criteria:**
- [x] Creator creates a match, then cancels before anyone joins <!-- satisfied: e2e/local/02-cancel-flow.spec.ts:46-69 — creates match, verifies waiting state, cancels -->
- [x] Creator's balance is refunded (entry amount + rent) <!-- satisfied: e2e/local/02-cancel-flow.spec.ts:79-88 — balance after cancel > after create, net cost < 10M lamports (tx fees only) -->
- [x] Match disappears from the lobby <!-- satisfied: e2e/local/02-cancel-flow.spec.ts:72-73 — waitForLobby + assertLobbyEmpty -->
- [ ] Creator can create a new match after cancellation using a custom amount <!-- out of scope: frontend is a separate project -->

### FR-4: Error Scenarios

Test that error states surface correctly in the UI.

**Acceptance Criteria:**
- [ ] Creating a match below the minimum amount or above wallet balance shows an error message <!-- out of scope: frontend is a separate project -->
- [x] Joining an already-locked match shows an error message <!-- satisfied: e2e/local/01-error-flow.spec.ts:65-99 — Player B clicks stale join on cancelled match, error toast visible -->
- [x] Claiming as the loser shows an error message <!-- satisfied: e2e/local/01-error-flow.spec.ts:103-143 — A wins + claims, B clicks settle on closed PDA, error toast visible -->

### FR-5: On-Chain State Verification

Local deterministic tests must verify on-chain state, not just UI state.

**Acceptance Criteria:**
- [ ] After match creation, test queries the match PDA and verifies account data, including the stored wager amount
- [x] After claim, test verifies the match account is closed <!-- satisfied: e2e/local/03-lifecycle.spec.ts:105 — assertMatchClosed(connection, matchPda) -->
- [x] After claim, test verifies treasury received the fee <!-- satisfied: e2e/local/03-lifecycle.spec.ts:108 — assertTreasuryFee verifies exact delta = floor(pool * 300 / 10000) -->
- [x] After claim, test verifies player profiles are updated (totalGames, wins) <!-- satisfied: e2e/local/03-lifecycle.spec.ts:114-127 — assertPlayerProfileDelta for winner (+1 game, +1 win) and loser (+1 game, +0 wins) -->

### FR-6: Devnet Backend Integration

Run E2E tests against deployed devnet contracts and the live backend-assisted fairness stack.

**Acceptance Criteria:**
- [x] Separate Playwright project/config for devnet suite (not sharing local validator setup) <!-- satisfied: playwright.devnet.config.ts — separate file, port 3003, testMatch "devnet/**/*.spec.ts", no bootstrap/teardown -->
- [x] App runs against devnet RPC with deployed coinflip/platform program IDs <!-- satisfied: playwright.devnet.config.ts:52-58 env inherited from process; e2e/devnet/helpers/env.ts validates VITE_RPC_URL + program IDs -->
- [x] Devnet suite does not deploy contracts; it fails fast if required deployed IDs/env are missing <!-- satisfied: e2e/devnet/helpers/env.ts:87-93 consolidated error + scripts/run-e2e-devnet.sh:11-20 shell fast-fail + verifyDevnetDeployments checks executable -->
- [x] Devnet suite validates the live fairness backend base URL / env contract before starting <!-- satisfied: apps/platform/e2e/devnet/helpers/env.ts validates `VITE_FAIRNESS_BACKEND_URL`; apps/platform/scripts/run-e2e-devnet.sh health-checks `/health` before Playwright -->
- [x] Test triggers the live backend-assisted create path and waits for backend settlement rather than VRF fulfillment <!-- satisfied: apps/platform/e2e/devnet/lifecycle.spec.ts uses backend create + `waitForSettledRound()` against `/fairness/rounds/:pda` -->
- [x] Settled result and verification payload are asserted on devnet <!-- satisfied: apps/platform/e2e/devnet/lifecycle.spec.ts asserts `secret`, `commitment`, `resultHash`, `winner`, and `settleTx` from backend round payload -->
- [x] Test command: `pnpm test:e2e:devnet` <!-- satisfied: apps/platform/package.json "test:e2e:devnet": "bash scripts/run-e2e-devnet.sh"; root package.json delegates via --filter -->
- [x] Suite includes retry/poll strategy and explicit timeout budget for backend settlement and verification availability <!-- satisfied: apps/platform/e2e/devnet/lifecycle.spec.ts `withRetry()` + `waitForSettledRound()`; devnet cleanup helper repairs stale deterministic-wallet state before rerun -->

---

## Success Criteria

- Local lifecycle suite passes end-to-end in under 60 seconds
- Local suite is deterministic (same result on every run)
- Devnet suite passes against deployed contracts and live backend settlement
- No browser extension required (TestWalletProvider handles signing)
- On-chain state matches expected values after each step in both suites

---

## Dependencies

- Spec 205 (Real Wallet) — TestWalletProvider must exist
- Spec 200 (Visual Regression) — Playwright already installed
- solana-test-validator available in CI environment
- Programs compiled and deployable (`anchor build`)
- Devnet contracts deployed and environment variables documented for program IDs
- Fairness backend available in local/devnet test environments, including DB and health-checked startup

## Assumptions

- Two browser contexts simulate two different players
- Local suite exercises backend create and automatic backend settlement rather than resolving results programmatically in tests
- Devnet suite uses the live backend-assisted create / settle / verify path
- Test validator starts fresh for each local test suite (clean state)
- Airdrop is available on test validator (not rate-limited)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Local lifecycle passes | `pnpm test:e2e` output | Green local run |
| 2 | Local on-chain state correct | Local RPC queries in test assertions | Account data matches |
| 3 | Local deterministic | Run local suite 3 times consecutively | All pass |
| 4 | Local under 60 seconds | Time local test run | Timing output |
| 5 | Devnet backend path passes | `pnpm test:e2e:devnet` output | Green devnet run |
| 6 | Devnet settlement observed | Poll + assertion logs in test output | Backend settle / verification evidence |

---

## Completion Signal

### Implementation Checklist

The checked items below record the original VRF-era E2E delivery. The active carry-forward for this spec is to realign local and devnet suites around the backend-assisted fairness flow now used by current V1 planning.
- [x] [test] Baseline Playwright real-mode config and smoke spec exist (`playwright.real.config.ts`, `e2e/real/startup.spec.ts`) (done: prior specs)
- [x] [test] Add dedicated local E2E Playwright project/config (`e2e/local/**`) separated from visual and real-wallet smoke tests (done: iteration 1)
- [x] [test] Create localnet bootstrap script: start fresh `solana-test-validator`, deploy coinflip + platform programs, wait for RPC readiness (done: iteration 2)
- [x] [test] Create localnet teardown script: stop validator process, clean temp ledger/logs, and guarantee cleanup on test failure (done: iteration 3)
- [x] [test] Add deterministic wallet-funding helper (airdrop + confirm) for both test players before each local suite run (done: iteration 4)
- [x] [test] Add shared E2E helpers: selectors/page-object methods for create, join, claim, cancel, and reusable wait/assert primitives (done: iteration 5)
- [x] [test] Add shared on-chain assertion helpers for match PDA state, treasury fee delta, and player profile stat updates (done: iteration 6)
- [x] [test] Add dual-browser-context fixture with isolated storage/session for player A and player B (done: iteration 7)
- [x] [test] Implement local lifecycle test (create -> join -> resolve programmatically -> claim) with UI assertions in both contexts (done: iteration 8)
- [x] [test] Implement local lifecycle on-chain assertions (match state after create, closed after claim, fee + profile invariants) (done: iteration 9)
- [x] [test] Implement local cancel-flow test (create -> cancel -> refund verified -> lobby clears -> recreate works) (done: iteration 10)
- [x] [test] Implement local error-flow tests (insufficient balance, join locked match, loser claim attempt) (done: iteration 11)
- [x] [test] Add local suite command `pnpm test:e2e` that runs bootstrap -> tests -> teardown in one entrypoint (done: iteration 12)
- [x] [test] Add devnet env contract (required vars + validation): RPC URL, coinflip/platform program IDs, VRF config; fail fast if missing (done: iteration 13)
- [x] [test] Add dedicated devnet E2E Playwright project/config (`e2e/devnet/**`) that does not run local bootstrap/deploy (done: iteration 14)
- [x] [test] Implement devnet lifecycle test using deployed contracts + real VRF request/fulfillment path (no mock resolve shortcut) (done: iteration 15)
- [x] [test] Add robust fulfillment polling/backoff + timeout budget in devnet test, with tx signature logging for failures (done: iteration 16)
- [x] [test] Add devnet on-chain assertions for payout, fee transfer, and final match/account state (done: iteration 17)
- [x] [test] Add devnet suite command `pnpm test:e2e:devnet` wired to the devnet project/config (done: iteration 18)
- [x] [test] Prove local determinism by running `pnpm test:e2e` three consecutive times (all pass, stable assertions) (done: iteration 22)
- [x] [test] Record local runtime evidence (<60s target) and devnet real-VRF pass evidence in test output artifacts/logs (done: iteration 22)
- [x] [test] Visual regression baseline updates are not required for this spec (test infra + assertions only; no intended UI redesign)

#### Active Carry-Forward

- [ ] [test] Boot the fairness backend and its DB dependencies as part of the local `pnpm test:e2e` stack.
- [ ] [test] Replace the local VRF-resolution shortcut with backend-backed create -> join -> auto-settle -> verify coverage.
- [x] [test] Replace devnet VRF assumptions with live backend-assisted create / settle / verification checks. <!-- satisfied: devnet lifecycle now proves backend create -> join -> backend settle -> verification payload -->
- [x] [docs] Update helper/env contracts so local and devnet suites document backend URLs, health checks, and verification assertions as first-class requirements. <!-- satisfied: FR-1/FR-6 + env/run-mode docs now treat backend URL, `/health`, and verification payload assertions as required contracts -->

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [x] All existing tests pass
- [x] Local E2E tests pass (`pnpm test:e2e`)
- [x] Devnet E2E tests pass (`pnpm test:e2e:devnet`) in designated environment
- [x] No lint errors

#### Functional Verification
- [x] All acceptance criteria verified
- [x] Local tests are deterministic (3 consecutive runs pass)
- [x] Devnet test demonstrates the live backend-assisted create / settle / verification path

#### Visual Verification (if UI)
- [x] N/A (E2E tests verify behavior, not appearance)

#### Console/Network Check (if web)
- [x] No unhandled JS console errors during E2E runs
- [x] All RPC requests succeed

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
- Two distinct suites: local deterministic (`pnpm test:e2e`) and devnet real backend (`pnpm test:e2e:devnet`)
- Local suite uses `solana-test-validator` with programs preloaded via `--bpf-program` at genesis (faster than post-start deploy)
- Deterministic keypairs from fixed seeds (`0xaa` and `0xbb` x32) for reproducibility
- Dual-browser-context fixture for two-player simulation with isolated storage/session
- Mock VRF resolution via pre-loaded Orao accounts at genesis (`--account` in bootstrap)
- Devnet suite uses separate Playwright config (port 3003, 120s timeout for real VRF latency)
- Devnet env validated in two phases: sync env var check + async deployment verification
- `io_uring` required by Solana 3.x test-validator; devcontainer uses `seccomp=unconfined`
- CSS-class selectors used (no data-testid needed) matching existing component markup
- Local suite also needs to boot the fairness backend + DB (carry-forward, not yet done)
- Local VRF shortcut needs replacement with backend-backed create/settle flow (carry-forward)
- CI trigger policy for devnet suite (nightly vs pre-release vs manual) left as open process decision

## Deferred Items
- Local fairness backend boot as part of `pnpm test:e2e` stack (active carry-forward)
- Replace local VRF-resolution shortcut with backend-backed create -> join -> auto-settle -> verify coverage (active carry-forward)
- CI trigger policy for devnet suite needs to be decided and documented
