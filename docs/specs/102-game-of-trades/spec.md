# Specification: 102 Game of Trades

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Ideation | Active |
| Priority | P3 |
| Phase | Deferred |
| NR_OF_TRIES | 0 |

---

## Overview

A multiplayer trading competition where players pay an entry fee and compete on the same live price chart by opening and closing virtual positions. Top performers on the leaderboard share the prize pool. Uses custom-amount betting (minimum 0.0026 SOL) with the standard platform fee.

## User Stories

- As a player, I want to compete in virtual trading competitions so that I can test my trading skills against others for real stakes.
- As a player, I want to see my PnL and ranking in real-time so that I can adjust my strategy during the round.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Not listed in V1 In Scope
- **Scope status**: Deferred (Post-V1)
- **Phase boundary**: Post-V1

## Required Context Files

- `sources/rng-utopia/docs/GAME_OF_TRADES.md` (game concept source - minimal)
- `sources/rng-utopia/docs/PLATFORM.md` (custom-amount betting, platform fee)

## Contract Files

- [NEEDS CLARIFICATION] No contracts exist yet

---

## Functional Requirements

### FR-1: Round Entry

Players pay a custom-amount entry fee to join a trading competition round.

**Acceptance Criteria:**
- [ ] Players enter any custom amount (minimum 0.0026 SOL)
- [ ] Entry fee adds to prize pool
- [ ] [NEEDS CLARIFICATION] Round duration undefined (source says "one-minute rounds" but needs confirmation)
- [ ] [NEEDS CLARIFICATION] Minimum/maximum players per round undefined

### FR-2: Virtual Trading

Players open and close virtual positions on a live price chart during the round.

**Acceptance Criteria:**
- [ ] Buy and Sell actions to open/close virtual positions
- [ ] No slippage or commission on virtual trades
- [ ] Real-time PnL percentage displayed per player
- [ ] [NEEDS CLARIFICATION] Which assets are tradeable
- [ ] [NEEDS CLARIFICATION] Position sizing rules (fixed virtual balance? unlimited?)
- [ ] [NEEDS CLARIFICATION] Can players hold multiple positions simultaneously?
- [ ] [NEEDS CLARIFICATION] Long and short positions, or long only?

### FR-3: Leaderboard and Results

Real-time leaderboard ranks players by PnL. Top performers share the pool.

**Acceptance Criteria:**
- [ ] Live leaderboard showing all participants ranked by PnL percentage
- [ ] [NEEDS CLARIFICATION] How many top players share the pool (Top N - N undefined)
- [ ] [NEEDS CLARIFICATION] Payout distribution curve (equal split? weighted? winner-takes-most?)
- [ ] 3% platform fee deducted from pool

### FR-4: Price Feed

Live price data for the trading competition.

**Acceptance Criteria:**
- [ ] Real-time price chart visible to all players
- [ ] [NEEDS CLARIFICATION] Price data source (Pyth? same as Close Call?)
- [ ] [NEEDS CLARIFICATION] Which asset(s) are used for the competition

---

## Success Criteria

- Players can enter, trade, and see results with correct leaderboard rankings
- Payout distribution is correct for top performers
- Virtual trading is fair (all players see the same price at the same time)

---

## Dependencies

- Real-time price feed integration
- Custom-amount betting system
- On-chain settlement infrastructure
- Real-time state sync for live leaderboard

## Assumptions

- Virtual trading only (no real asset exposure)
- All players compete on the same price chart simultaneously
- This is a deferred feature with minimal source specification

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Entry fee contributes to pool | Pay entry, verify pool size | Pool balance |
| 2 | PnL calculated correctly | Open/close positions, verify PnL | Trade log + calculation |
| 3 | Leaderboard ranks correctly | Multi-player round, verify rankings | Leaderboard screenshot |
| 4 | Top N payout correct | Complete round, verify payouts | Settlement proof |

---

## Completion Signal

### Implementation Checklist
- [ ] Round entry and pool collection
- [ ] Virtual trading engine (buy/sell positions)
- [ ] PnL calculation
- [ ] Real-time leaderboard
- [ ] Price feed integration
- [ ] Settlement and payout to top performers
- [ ] Trading UI (chart, order buttons, PnL display)
- [ ] Results and payout display
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for PnL calculations
- [ ] New tests for leaderboard ranking
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: tied PnL, all players lose, single player round

#### Visual Verification
- [ ] Trading UI correct on desktop
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
