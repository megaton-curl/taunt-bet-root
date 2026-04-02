# Specification: 105 Tug of Earn

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Ideation | On Hold — not yet properly defined |
| Priority | P3 |
| Phase | Deferred |
| NR_OF_TRIES | 0 |

---

## Overview

A team-based tap game where players are assigned to either Surfers (bulls) or Anchors (bears). Teams tap to influence a chart's movement relative to a ghost reference line. If the chart ends above the ghost line after 60 seconds, Surfers win; below, Anchors win. Winners share losers' stakes minus the platform fee. Uses custom-amount betting (minimum 0.0026 SOL).

## User Stories

- As a player, I want to be assigned to a team and tap to help my team win so that I can enjoy a collaborative competitive experience.
- As a player, I want to see the chart move in response to team taps so that I feel my contribution matters.
- As a player, I want to see team meters so that I understand the current state of the competition.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Not listed in V1 In Scope
- **Scope status**: Deferred (Post-V1)
- **Phase boundary**: Post-V1

## Required Context Files

- `backend/docs/TUG_OF_EARN.md` (game concept source - minimal)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee)

## Contract Files

- [NEEDS CLARIFICATION] No contracts exist yet

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Team Assignment

Players are automatically assigned to Surfers or Anchors upon joining.

**Acceptance Criteria:**
- [ ] Automatic team assignment on join
- [ ] Team prominently displayed to player
- [ ] [NEEDS CLARIFICATION] Assignment algorithm (random? balancing? player choice?)
- [ ] [NEEDS CLARIFICATION] Minimum players per team / total to start

### FR-2: Tapping Mechanic

Players tap a button to contribute pressure to their team's direction.

**Acceptance Criteria:**
- [ ] Tap actions register and contribute to team pressure
- [ ] Aggregate tap counts for both teams visible via meters
- [ ] [NEEDS CLARIFICATION] Tap rate limits (anti-bot / fair play)
- [ ] [NEEDS CLARIFICATION] Does each tap have equal weight? Or does it vary?
- [ ] [NEEDS CLARIFICATION] How do taps translate to chart movement (formula)

### FR-3: Chart and Ghost Line

A chart moves based on team pressure relative to a reference ghost line.

**Acceptance Criteria:**
- [ ] Chart shows price movement influenced by team taps
- [ ] Ghost line shown as reference point
- [ ] [NEEDS CLARIFICATION] How is the ghost line determined (random? fixed? from real market data?)
- [ ] [NEEDS CLARIFICATION] What "price" does the chart represent (synthetic? real asset?)

### FR-4: Round Resolution (60 seconds)

After 60 seconds, the chart position vs ghost line determines the winner.

**Acceptance Criteria:**
- [ ] Round lasts exactly 60 seconds
- [ ] Chart above ghost line at end: Surfers win
- [ ] Chart below ghost line at end: Anchors win
- [ ] Winners share losers' stakes minus 3% platform fee
- [ ] [NEEDS CLARIFICATION] What happens if chart is exactly on ghost line?
- [ ] [NEEDS CLARIFICATION] Payout distribution among winning team (equal? proportional to taps?)

---

## Success Criteria

- Teams are balanced enough for competitive rounds
- Tapping feels responsive and impactful
- Chart movement clearly reflects team effort
- Payouts are correct: winners split losers' stakes minus fee

---

## Dependencies

- Real-time state sync for tap aggregation and chart updates
- Custom-amount betting system
- On-chain settlement infrastructure

## Assumptions

- 60-second fixed rounds
- Team-based wagering (losers' stakes go to winners)
- Players enter any custom amount (minimum 0.0026 SOL)
- This is a deferred feature with minimal source specification

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Team assignment works | Join round, verify team assigned | Screenshot |
| 2 | Taps register | Tap, verify counter updates | Before/after tap count |
| 3 | Chart reflects taps | Both teams tap, verify chart moves | Video or screenshots |
| 4 | Winner determined correctly | Complete round, verify vs ghost line | Final chart position |
| 5 | Payout correct | Verify winners receive losers' stakes - fee | Settlement proof |

---

## Completion Signal

### Implementation Checklist
- [ ] Team assignment on join
- [ ] Tap mechanic with rate tracking
- [ ] Chart visualization with ghost line
- [ ] Real-time tap aggregation and chart movement
- [ ] 60-second round timer
- [ ] Winner determination (chart vs ghost line)
- [ ] Settlement (winning team splits losers' stakes)
- [ ] Team meters and tap feedback UI
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for team assignment balance
- [ ] New tests for chart movement logic
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: one team has no players, exact ghost line tie

#### Visual Verification
- [ ] Chart and tap UI correct on desktop
- [ ] Mobile responsive (tap-friendly) layout works

#### Console/Network Check
- [ ] No JS console errors
- [ ] No failed network requests

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

---

## Open Items (from checklist review)

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Team assignment algorithm undefined | FR-1 | Yes |
| 2 | Minimum players per team/round undefined | FR-1 | Yes |
| 3 | Tap rate limits/anti-bot rules undefined | FR-2 | Yes |
| 4 | Tap weight rules undefined (equal or variable) | FR-2 | Yes |
| 5 | Tap-to-chart-movement formula undefined | FR-2 | Yes |
| 6 | Ghost line determination method undefined | FR-3 | Yes |
| 7 | Chart data source undefined (synthetic or real) | FR-3 | Yes |
| 8 | Exact ghost line tie handling undefined | FR-4 | Yes |
| 9 | Payout distribution among winning team undefined | FR-4 | Yes |
| 10 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes |
| 11 | No contract files | Contract | No (deferred) |

### Refinement Carry-Forward (Pivot)

- [ ] Define Tug of Earn proof contract fields for team assignment, tap aggregation output, and commit-reveal verification.
- [ ] Lock determinism boundary between verifiable on-chain facts and off-chain aggregation outputs.
- [ ] Specify timeout/refund behavior for missing final aggregates, invalid reveal, and unresolved rounds.
- [ ] Define replay/idempotency protections for tap/event ingestion and settlement calls.
- [ ] Add failure-mode acceptance checks for tie outcomes, anti-bot enforcement failures, and late/invalid reveals.

### Checklist Notes

- Source (TUG_OF_EARN.md) is minimal - "Specifications to be defined"
- 10 blocking items - nearly all mechanics need design from scratch
- The concept is clear (team tap game, chart vs ghost line) but no formulas or rules defined
- Key design challenge: making taps feel impactful while preventing bot abuse
- Ghost line determination is critical to game balance (too easy/hard for either side)
- Payout distribution within winning team is an important fairness decision (equal split vs proportional to taps)
- Unique among games: requires real-time tap aggregation infrastructure
- 4 functional requirements extracted, most with incomplete acceptance criteria
