# Specification: 202 Component Tests

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Phase | 2 |
| NR_OF_TRIES | 0 |

---

## Overview

Add React component and hook tests using vitest + @testing-library/react. These tests validate that contexts, hooks, and UI components behave correctly given mocked chain inputs. They run in JSDOM — no real validator, no browser, no Playwright.

## User Stories

- As a developer, I want tests for CoinflipContext so that I know state transitions (idle → creating → waiting → locked → settled → claimed) work correctly when chain functions return expected data.
- As a developer, I want tests for wallet hooks so that connect/disconnect/balance flows are verified.
- As a developer, I want tests for UI components so that custom-amount input, match cards, and betting panels render correctly for all input combinations.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 9 (Quality & Testing)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 2 — after wallet integration is stable

## Required Context Files

- `apps/platform/src/features/coinflip/context/CoinflipContext.tsx`
- `apps/platform/src/features/coinflip/components/`
- `apps/platform/src/features/player-profile/context/PlayerProfileContext.tsx`
- `packages/wallet/src/useWallet.ts`
- `packages/wallet/src/useBalance.ts`
- `packages/ui/src/` — WagerInput, BettingPanel, MatchCard, GameLayout

## Contract Files

- `apps/platform/src/features/coinflip/types.ts` — UIMatch, CoinSide, CoinflipPhase
- `packages/wallet/src/types.ts` — WalletContextValue

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: CoinflipContext State Transitions

Test the context's state machine by mocking the backend-backed create flow plus the direct on-chain follow-up helpers.

**Acceptance Criteria:**
- [ ] Creating a match: context signs the canonical payload, calls the fairness backend client / `POST /fairness/coinflip/create`, co-signs the returned partial transaction, transitions to waiting phase, and adds the match to openMatches
- [ ] Joining a match: context calls buildJoinMatchTx, match transitions to locked phase
- [ ] Claiming payout: context calls buildClaimPayoutTx, match transitions to claimed, balance updated
- [ ] Canceling a match: context calls buildCancelMatchTx, match removed from openMatches
- [ ] Error handling: wallet rejection shows error state, RPC failure shows error state
- [ ] Polling: open matches refresh on interval

### FR-2: Wallet Hooks

Test useWallet and useBalance behavior in isolation.

**Acceptance Criteria:**
- [ ] useWallet returns disconnected state initially
- [ ] After connect(), returns connected state with address and publicKey
- [ ] After disconnect(), returns disconnected state
- [ ] useBalance returns formatted balance from mock RPC
- [ ] useBalance handles RPC errors gracefully (loading state, error state)

### FR-3: UI Component Rendering

Test that key UI components render correctly for various inputs.

**Acceptance Criteria:**
- [ ] Custom amount input renders the minimum amount rules, quick-adjust controls, and change callbacks correctly
- [ ] MatchCard renders waiting/locked/settled states with correct labels and player info
- [ ] BettingPanel disables actions when wallet is disconnected
- [ ] BettingPanel shows the correct entry amount for the selected custom amount
- [ ] GameLayout renders sidebar, main content, and history panel
- [ ] WalletButton shows "Connect" when disconnected, address when connected

### FR-4: PlayerProfileContext

Test profile creation and stat updates.

**Acceptance Criteria:**
- [ ] Profile is created when wallet connects for the first time
- [ ] Game result events update totalGames, wins, totalWagered, totalWon
- [ ] Profile persists across page navigation (context stays mounted)

---

## Success Criteria

- Component tests pass with `pnpm test` in the platform app
- All contexts have at least happy-path + error-path coverage
- No real chain or RPC calls are made during component tests
- Tests run in under 30 seconds

---

## Dependencies

- Spec 205 (Real Wallet) — hook interfaces must be finalized before testing them
- Spec 201 (Unit Tests) — game-engine logic verified before testing contexts that depend on it
- @testing-library/react added as dev dependency

## Assumptions

- vitest + jsdom is the test environment
- Backend client calls and `chain.ts` follow-up helpers are mocked at the module level (`vi.mock`)
- MockWalletProvider is used for wallet context in component tests

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Context state transitions | Test assertions on context state after each action | Test output |
| 2 | No real chain calls | Verify all chain.ts imports are mocked | Mock call counts in tests |
| 3 | UI renders correctly | @testing-library queries (getByText, getByRole) | Test assertions |
| 4 | Fast execution | Time the test run | Under 30s |

---

## Completion Signal

### Implementation Checklist
- [ ] @testing-library/react installed
- [ ] CoinflipContext test file with state transition tests
- [ ] Wallet hook test files
- [ ] UI component test files (custom amount input, MatchCard, BettingPanel, WalletButton)
- [ ] PlayerProfileContext test file
- [ ] vitest config updated for jsdom environment

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests pass
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Mock boundaries are clean (no real network calls)

#### Visual Verification (if UI)
- [ ] N/A (component tests are structural, not visual)

#### Console/Network Check (if web)
- [ ] N/A (JSDOM environment)

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
