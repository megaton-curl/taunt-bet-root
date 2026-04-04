# Specification: 204 Multi-Page Flow Tests

## Meta

| Field | Value |
|-------|-------|
| Status | Out of Scope |
| Priority | P2 |
| Phase | 2 |
| NR_OF_TRIES | 0 |

---

## Overview

Playwright E2E tests that verify state consistency across multiple pages. After a game action on one page, the result must be reflected correctly on other pages (profile stats, fairness verification, leaderboard). These tests extend spec 203 by adding cross-route navigation assertions.

## User Stories

- As a player, I want my profile stats to update after winning a coinflip so that my record is accurate.
- As a player, I want to verify a completed match on the fairness page so that I can confirm it was fair.
- As a player, I want my position on the leaderboard to reflect my winnings so that rankings are trustworthy.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 2 (Player profiles, Provably fair, Leaderboard)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 2 — after single-page E2E (spec 203) is stable

## Required Context Files

- `apps/platform/src/features/player-profile/context/PlayerProfileContext.tsx`
- `apps/platform/src/features/player-profile/components/ProfilePage.tsx`
- `apps/platform/src/App.tsx` — fairness page, leaderboard page routes
- `apps/platform/src/features/coinflip/context/CoinflipContext.tsx`

## Contract Files

- `apps/platform/src/features/player-profile/types.ts` — PlayerProfile (totalGames, wins, totalWagered, totalWon)
- `solana/programs/platform/` — on-chain player profile accounts

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Game Result → Profile Stats

After completing a coinflip match, the player's profile page must reflect the outcome.

**Acceptance Criteria:**
- [ ] After winning a coinflip: navigate to /profile, totalGames incremented, wins incremented, totalWon shows correct payout
- [ ] After losing a coinflip: navigate to /profile, totalGames incremented, wins unchanged, totalWon unchanged
- [ ] Profile data reads from on-chain player profile PDA (not mock simulation)

### FR-2: Game Result → Fairness Verification

After a completed match, the fairness page must allow verification of the result.

**Acceptance Criteria:**
- [ ] Completed match appears in recent rounds on /fairness
- [ ] Match data includes round ID, result, commitment, verification payload fields, and secret only after settlement
- [ ] Verification tool confirms the result matches the backend-served public payload and on-chain settlement evidence

### FR-3: Game Result → Leaderboard

After completing matches, the leaderboard reflects updated rankings.

**Acceptance Criteria:**
- [ ] Player with wins appears on /leaderboard
- [ ] Ranking order reflects total winnings
- [ ] Leaderboard data reads from on-chain state (not mock addresses)

### FR-4: Wallet State Across Pages

Wallet connection persists across all page transitions.

**Acceptance Criteria:**
- [ ] Connect wallet on /coinflip, navigate to /profile — wallet stays connected
- [ ] Navigate to /fairness, /leaderboard, /quests — wallet stays connected
- [ ] Balance display is consistent across all pages
- [ ] Disconnect on any page disconnects everywhere

### FR-5: Navigation After Actions

Game actions followed by navigation must not corrupt state.

**Acceptance Criteria:**
- [ ] Create a match on /coinflip, navigate to /profile, navigate back to /coinflip — match is still visible
- [ ] Complete a match, navigate away mid-animation, navigate back — final state is shown (not stuck in animation)
- [ ] Browser back/forward buttons work correctly through game flows

---

## Success Criteria

- All cross-page flow tests pass against a local backend-backed stack
- Profile stats match on-chain player profile data after game actions
- No stale data shown on any page after navigation
- Tests are deterministic and run in under 90 seconds

---

## Dependencies

- Spec 203 (E2E Integration) — single-page E2E must work first
- Spec 205 (Real Wallet) — wallet connection must persist across routes
- On-chain player profile CPI must be functional (platform program)

## Assumptions

- Profile, fairness, and leaderboard pages read from on-chain state (not mock simulation)
- If mock simulations are still in use for some features, those tests are skipped until real integration lands
- Fairness verification reads from the backend verification payload contract for applicable RNG games

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Profile updates after game | Navigate and assert stats | Playwright screenshot + assertions |
| 2 | Wallet persists across pages | Navigate 5 routes, check connected | Boolean assertions on each page |
| 3 | No stale data | Compare UI values with on-chain RPC query | Matching values |
| 4 | Back/forward works | Playwright browser navigation | No crashes or stale state |

---

## Completion Signal

### Implementation Checklist
- [ ] Game result → profile test
- [ ] Game result → fairness test
- [ ] Game result → leaderboard test
- [ ] Wallet persistence test
- [ ] Navigation after actions test
- [ ] Back/forward navigation test
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] Multi-page flow tests pass
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] On-chain state matches UI state on every page

#### Visual Verification (if UI)
- [ ] N/A (behavioral tests, visual regression is spec 200)

#### Console/Network Check (if web)
- [ ] No JS console errors during navigation
- [ ] No failed RPC requests

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
