# Specification: 103 Chart the Course

## Meta

| Field | Value |
|-------|-------|
| Status | Deferred |
| Ideation | On Hold — not yet properly defined |
| Priority | P3 |
| Phase | Deferred |
| NR_OF_TRIES | 0 |

---

## Overview

A prediction game where players draw expected price trajectories on historical charts. Players see a mystery asset's chart and sketch their prediction of future price movement. Points are awarded based on proximity to actual price action, with leaderboard-based payouts. Uses custom-amount betting (minimum 0.0026 SOL).

## User Stories

- As a player, I want to draw my price prediction on a chart so that I can test my market intuition in a fun way.
- As a player, I want to see how my prediction compared to reality so that I can learn and improve.
- As a player, I want the mystery asset revealed at the end so that the experience has a satisfying conclusion.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Not listed in V1 In Scope
- **Scope status**: Deferred (Post-V1)
- **Phase boundary**: Post-V1

## Required Context Files

- `backend/docs/CHART_THE_COURSE.md` (game concept source - minimal)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee)

## Contract Files

- [NEEDS CLARIFICATION] No contracts exist yet

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Chart Presentation

Players see a historical chart with the asset identity hidden.

**Acceptance Criteria:**
- [ ] Historical chart data displayed
- [ ] Asset name and ticker hidden
- [ ] [NEEDS CLARIFICATION] How much historical data is shown
- [ ] [NEEDS CLARIFICATION] Chart timeframe (1min, 5min, 1hr candles?)
- [ ] [NEEDS CLARIFICATION] What real-time market events are shown alongside

### FR-2: Drawing Interface

Players sketch their predicted price path on the chart.

**Acceptance Criteria:**
- [ ] Drawing tool for sketching price prediction on the chart
- [ ] Player can submit/lock their prediction
- [ ] [NEEDS CLARIFICATION] Drawing mechanics (freehand? point-to-point? fixed time intervals?)
- [ ] [NEEDS CLARIFICATION] Can players redraw before submitting?
- [ ] [NEEDS CLARIFICATION] Time limit for drawing

### FR-3: Scoring

Points awarded based on how close the prediction matches actual price action.

**Acceptance Criteria:**
- [ ] Scoring based on directional and magnitude accuracy
- [ ] [NEEDS CLARIFICATION] Scoring formula (how directional vs magnitude are weighted)
- [ ] [NEEDS CLARIFICATION] Scoring granularity (per-candle? per-interval? overall?)
- [ ] Multiple rounds per session with accumulating scores

### FR-4: Results and Asset Reveal

After all rounds, actual price plays out, scores are shown, and the asset is revealed.

**Acceptance Criteria:**
- [ ] Actual price movement shown overlaid on player prediction
- [ ] Score calculated and displayed
- [ ] Asset identity revealed after final round
- [ ] Top performers share the pool (minus 500 bps / 5% fee)
- [ ] [NEEDS CLARIFICATION] Number of rounds per session
- [ ] [NEEDS CLARIFICATION] Payout distribution among top performers

---

## Success Criteria

- Players can draw predictions, see scoring, and receive payouts
- Scoring is fair and consistent for all players
- The mystery and reveal mechanic creates an engaging experience

---

## Dependencies

- Historical price data source
- Drawing/canvas UI component
- Custom-amount betting system
- On-chain settlement infrastructure

## Assumptions

- This is a deferred feature with minimal source specification
- Price data is from real historical markets (not synthetic)
- Players enter any custom amount (minimum 0.0026 SOL)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Chart displays with hidden asset | View chart, verify no asset identification | Screenshot |
| 2 | Drawing tool works | Draw prediction, verify submission | Drawing + confirmation |
| 3 | Scoring matches formula | Compare prediction vs actual, verify score | Calculation proof |
| 4 | Asset revealed at end | Complete session, verify reveal | Screenshot |

---

## Completion Signal

### Implementation Checklist
- [ ] Historical chart presentation (hidden asset)
- [ ] Drawing interface
- [ ] Scoring engine
- [ ] Multi-round session management
- [ ] Results overlay and asset reveal
- [ ] Leaderboard and payout
- [ ] Session UI
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for scoring calculations
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: identical predictions, zero-movement chart

#### Visual Verification
- [ ] Chart and drawing UI correct on desktop
- [ ] Mobile responsive layout works

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
| 1 | Historical data amount and timeframe undefined | FR-1 | Yes |
| 2 | Real-time market events display undefined | FR-1 | Yes |
| 3 | Drawing mechanics undefined (freehand vs structured) | FR-2 | Yes |
| 4 | Redraw/undo rules undefined | FR-2 | Yes |
| 5 | Time limit for drawing undefined | FR-2 | Yes |
| 6 | Scoring formula undefined (directional vs magnitude weighting) | FR-3 | Yes |
| 7 | Scoring granularity undefined | FR-3 | Yes |
| 8 | Number of rounds per session undefined | FR-4 | Yes |
| 9 | Payout distribution among top performers undefined | FR-4 | Yes |
| 10 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes |
| 11 | Historical data source undefined | Dependency | No |
| 12 | No contract files | Contract | No (deferred) |

### Refinement Carry-Forward (Pivot)

- [ ] Define Chart the Course proof contract fields for scoring output and commit-reveal verification.
- [ ] Lock determinism boundary for what scoring inputs are canonical and what must be verifiable on-chain.
- [ ] Specify timeout/refund behavior for missing reveal, disputed scoring, and unresolved rounds.
- [ ] Define replay/idempotency protections for prediction submission and settlement.
- [ ] Add failure-mode acceptance checks for scoring disputes, tie handling, and late/invalid reveals.

### Checklist Notes

- **Most underspecified game** - source (CHART_THE_COURSE.md) says "Specifications to be defined"
- 10 blocking items - virtually all core mechanics need design from scratch
- The concept is interesting (mystery chart + drawing prediction) but nothing is defined
- Scoring formula is the most critical design decision - determines entire game balance
- Requires a full product design session before spec can advance
- 4 functional requirements extracted, almost all with incomplete acceptance criteria
- Open question from STORIES.md: "How should scoring weight directional accuracy vs magnitude accuracy?"
