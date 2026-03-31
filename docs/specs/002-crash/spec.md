# Specification: 002 Crash (Crypto Crash Simulator)

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Ideation | Active |
| Priority | P1 |
| Phase | Deferred (Phase 2 — formally deferred 2026-03-30) |
| NR_OF_TRIES | 0 |

---

## Overview

Crash is a competitive P2P multiplayer game where players watch a multiplier climb from 1.00x and must cash out before it crashes. Within each amount-scoped pool, the player with the highest valid cashout wins that pool's entire prize. Rounds run in a continuous loop of betting, running, crashed, and winner reveal phases. This game is planned after the first two V1 games (Coinflip and Lord of the RNGs).

## User Stories

- As a player, I want to enter a custom amount and place a bet during the betting phase so that I can enter the next crash round at stakes I choose.
- As a player, I want to watch a multiplier climb in real-time so that I can decide when to cash out.
- As a player, I want to cash out at the right moment so that I can beat other players at my amount and win the pool.
- As a player, I want to see who won each amount-scoped pool after a crash so that I know the results and my payout.
- As a player, I want to verify that the crash point was determined fairly before the round began so that I trust the game.
- As a player, I want to see jackpot carryovers from previous rounds so that I'm attracted to amounts with larger pools.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 12 (Post-Launch Expansion - Additional game(s))
- **Scope status**: Deferred (P2P multiplayer mode only; Classic house mode deferred)
- **Phase boundary**: Post-V1

## Required Context Files

- `backend/docs/CRASH.md` (game concept source)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee, provably fair system)
- `docs/SCOPE.md` (scope boundary, shared game requirements)

## Contract Files

- [NEEDS CLARIFICATION] Frontend mock/component files for Crash UI
- [NEEDS CLARIFICATION] On-chain program interface for round manager + fairness fields
- `docs/specs/005-hybrid-fairness/spec.md` — shared fairness contract for backend-assisted commit-reveal
- `docs/specs/006-fairness-backend/spec.md` — backend service contract to mirror where applicable

---

## Functional Requirements

### FR-1: Betting Phase

Players have a 20-second window to enter a custom amount and place their wager. One bet per player per round.

**Acceptance Criteria:**
- [ ] 20-second countdown timer displayed with audio cues at 3, 2, 1 seconds
- [ ] Player can enter a custom SOL amount with a minimum of `0.0026 SOL`
- [ ] Live player count and pool size shown per amount-scoped pool
- [ ] Amount selection is locked once bet is placed
- [ ] One bet per player per round
- [ ] Bet requires connected wallet with sufficient balance

### FR-2: Running Phase (Multiplier Climb)

The multiplier starts at 1.00x and climbs. Players can cash out at any moment. The visual shows green candles rising.

**Acceptance Criteria:**
- [ ] Multiplier starts at 1.00x and climbs using formula: multiplier = 1.12 ^ elapsed_seconds
- [ ] Multiplier rounded down to 2 decimal places for display
- [ ] Maximum multiplier capped at 100.00x
- [ ] Player can click "CASH OUT" at any moment during this phase
- [ ] Cash out is irreversible; multiplier is locked in immediately
- [ ] Current potential payout displayed to player
- [ ] List of recent cashouts from other players visible
- [ ] Smooth animation targeting 60fps

### FR-3: Crash Point Determination

Crash points use the backend-assisted hybrid fairness model. The backend commits a secret before the round becomes knowable, betting close captures a future entropy slot on-chain, and the backend later derives and reveals the crash point from the revealed secret plus public slot-hash entropy. The off-chain engine must match that deterministic result exactly.

**Acceptance Criteria:**
- [ ] Backend commits `SHA256(server_seed)` before the round becomes knowable
- [ ] Betting close captures `target_slot` for future public entropy
- [ ] Crash point derived deterministically from `server_seed + slot-hash entropy + round identifier + algorithm version`
- [ ] Server reveals `server_seed` at settlement; contract verifies `SHA256(server_seed) == stored_hash`
- [ ] Same secret + entropy inputs always produce the same crash point (deterministic)
- [ ] Crash distribution balanced for P2P mode (frequent high multipliers)
- [ ] Small percentage of instant crashes (1.00x) for tension
- [ ] 20% of rounds receive a boost (1.5x to 3.0x multiplier on base crash point)
- [ ] Boost factor deterministically derived from the same fairness result bytes

### FR-4: Crashed Phase

When the multiplier reaches the crash point, the game crashes. Players who did not cash out lose their bets to the amount-scoped pool.

**Acceptance Criteria:**
- [ ] Crash visual: large red dump candle (crypto pump-and-dump aesthetic)
- [ ] Final crash multiplier displayed prominently in red
- [ ] "CRASHED" text displayed
- [ ] Crash sound effect plays
- [ ] Bets from players who didn't cash out go into winner's prize pool
- [ ] Phase lasts approximately 3 seconds

### FR-5: Winner Reveal Phase

Per-amount-pool winners are announced. The winner is the player with the highest valid cashout multiplier in each amount-scoped pool.

**Acceptance Criteria:**
- [ ] Winner = player with highest cashout multiplier that is <= crash point
- [ ] One winner per active amount-scoped pool
- [ ] Winner card shows: avatar, name, cashout multiplier, payout amount
- [ ] "You Won!" celebration if current player won
- [ ] "No Winner" displayed if nobody in an amount-scoped pool cashed out
- [ ] Countdown to next round shown
- [ ] Phase lasts approximately 3 seconds

### FR-6: Settlement and Payout

Winner of each amount-scoped pool receives that pool minus the platform fee.

**Acceptance Criteria:**
- [ ] Winner payout = amount_pool x 0.97 (3% platform fee)
- [ ] Platform fee collected to treasury PDA
- [ ] Settlement recorded on-chain
- [ ] Settlement is idempotent
- [ ] Replay protection for signed actions

### FR-7: Prize Pool Carryover

If no player in an amount-scoped pool cashes out successfully, the pool carries over to the next round.

**Acceptance Criteria:**
- [ ] Carryover = amount_pool x 0.97 (fee still deducted)
- [ ] Carryover pools accumulate until someone wins
- [ ] Carryover amount displayed prominently: "JACKPOT: X SOL"
- [ ] Pulsing/glowing effect on amount controls for carryover amounts

### FR-8: Fairness Verification

Players can verify crash points and commit-reveal proofs for any completed round.

**Acceptance Criteria:**
- [ ] Public verification payload includes commitment, revealed `server_seed`, target/actual entropy slot, derived result bytes, crash point, and settlement tx
- [ ] Revealed `server_seed` and stored commitment hash are publicly viewable after settlement
- [ ] Players can verify `SHA256(server_seed) == commitment_hash`
- [ ] Players can recalculate crash point from the revealed secret plus public entropy inputs
- [ ] Verification accessible from round history and result screen
- [ ] Boost factor verifiable from the fairness result bytes

### FR-9: Betting Phase UI

**Acceptance Criteria:**
- [ ] Prominent 20-second countdown timer
- [ ] Amount input controls with quick-adjust actions
- [ ] Live player count and pool size per amount-scoped pool
- [ ] Clear "Place Bet" button with entered amount
- [ ] Disable amount entry after bet placed

### FR-10: Running Phase UI

**Acceptance Criteria:**
- [ ] Large animated multiplier display (center screen)
- [ ] Green candles rising to represent growth
- [ ] Prominent "CASH OUT" button
- [ ] Current potential payout displayed
- [ ] Recent cashouts from other players listed

### FR-11: Audio Feedback

**Acceptance Criteria:**
- [ ] Countdown beeps at 3, 2, 1 seconds during betting phase
- [ ] Rising tension audio during running phase
- [ ] Crash/dump sound effect on crash
- [ ] Cash-out confirmation sound on successful cashout
- [ ] Victory fanfare for winners

---

## Success Criteria

- A player can place a bet, watch the multiplier climb, cash out, and receive payout in a continuous round loop
- Settlement correctness: pool winner always receives exactly (amount_pool x 0.97), fee always reaches treasury
- Carryover pools accumulate correctly and pay out when a winner exists
- Any round's crash point can be independently verified
- Round loop runs continuously without manual intervention
- Cash-out timing is fair: server is authoritative for cash-out registration

---

## Dependencies

- Wallet connection (PLAT-004) must be functional
- Shared infrastructure spec (`docs/specs/004-shared-infrastructure/spec.md`) — lifecycle, escrow, commit-reveal, fees
- Shared fairness spec (`docs/specs/005-hybrid-fairness/spec.md`) — slot-hash entropy, reveal verification, timeout contract
- Backend fairness service pattern (`docs/specs/006-fairness-backend/spec.md`) — create/auth/settle/verify flow reference
- Shared UI components (PLAT-003)
- Game engine package (PLAT-005) for round state machine
- Real-time state sync infrastructure [NEEDS CLARIFICATION - WebSocket vs polling decision pending]
- Coinflip (001) validates core settlement + fairness flows first

## Assumptions

- P2P multiplayer mode only for V1 (Classic house mode deferred)
- Platform fee is 500 bps (5%). Read from `PlatformConfig.fee_bps` on-chain. Single treasury, no split buckets.
- Crash uses backend-assisted hybrid fairness, not HMAC-only and not standalone VRF.
- Real-time sync approach will be decided before implementation
- Boost mechanic (20% of rounds) is included in V1

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Betting phase accepts bets within timer | Place bet, verify acceptance | Screenshot of bet confirmation |
| 2 | Multiplier climbs per formula | Record multiplier over time, verify formula | Time-series data or video |
| 3 | Cash out locks in multiplier | Cash out, verify locked value | Screenshot of locked multiplier |
| 4 | Crash point is deterministic | Run same round number twice, verify same result | Two results with matching crash points |
| 5 | Winner = highest valid cashout | Multi-player round, verify winner selection | Round results showing all cashouts |
| 6 | Carryover works on no-winner round | Trigger no-cashout round, verify carryover | Next round showing accumulated pool |
| 7 | Payout = amount_pool x 0.97 | Check on-chain settlement | Explorer link showing amounts |
| 8 | Fairness verification | Recalculate crash point from public inputs | Verification payload / UI screenshot |
| 9 | Boost mechanic applies correctly | Verify boosted round vs base crash point | Result bytes + boost factor calculation |
| 10 | Continuous round loop | Observe 5+ consecutive rounds | Video or log of round transitions |

---

## Completion Signal

### Implementation Checklist
- [ ] Betting phase (timer, amount entry, bet placement)
- [ ] Running phase (multiplier engine, cash-out handling)
- [ ] Crash point generation (backend-assisted hybrid fairness + boost mechanic)
- [ ] Crashed phase (visual, state transition)
- [ ] Winner determination (per-amount-pool highest valid cashout)
- [ ] Settlement flow (on-chain payout recording)
- [ ] Carryover logic (no-winner pool accumulation)
- [ ] Fairness verification UI
- [ ] All phase UI components (betting, running, crashed, winner reveal)
- [ ] Audio integration
- [ ] Real-time state sync
- [ ] Continuous round loop
- [ ] Error states and recovery paths
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for multiplier formula and crash point generation from revealed secret + entropy inputs
- [ ] New tests for winner determination logic
- [ ] New tests for carryover calculations
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: all players crash out, single player at an amount, max multiplier reached, boost boundary
- [ ] Idempotency verified for settlement
- [ ] Replay protection verified

#### Visual Verification
- [ ] All four phase UIs render correctly on desktop
- [ ] Multiplier animation smooth at target framerate
- [ ] Mobile responsive layout works

#### Console/Network Check
- [ ] No JS console errors during continuous round play
- [ ] No failed network requests
- [ ] Backend-assisted create/settle flows succeed on devnet

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
| 1 | Contract files not identified (frontend mocks, on-chain interfaces) | Contract | Yes |
| 2 | Platform fee inconsistency: game docs use 3%, PLATFORM.md says 2.0-2.2% | Assumption | Yes |
| 3 | Real-time sync approach undecided (WebSocket vs polling) | Dependency | Yes |
| 4 | Client-server sync for cash-out timing fairness | Dependency | Yes |
| 5 | Round synchronization approach undecided (DB-backed vs computed) | Dependency | No |
| 6 | Acceptable latency for cash-out registration | Edge Case | No |
| 7 | Network jitter handling / latency compensation for cash-outs | Edge Case | No |
| 8 | Edge case: all players in a tier disconnect mid-round | Edge Case | No |
| 9 | Edge case: player attempts cash-out at exact crash moment (race condition) | Edge Case | No |
| 10 | HMAC-SHA256 crash point leaks implementation detail (spec says "cryptographic function" is sufficient) | Content Quality | No |

### Refinement Carry-Forward (Pivot)

- [ ] Define Crash fairness proof contract fields (seed/proof envelope, result payload, proof versioning).
- [ ] Lock determinism boundary between on-chain recomputation and off-chain engine reporting.
- [ ] Specify timeout/refund trigger behavior, deadline source, and caller expectations for unresolved rounds.
- [ ] Define replay/idempotency protections for cash-out actions and settle calls.
- [ ] Add failure-mode acceptance checks for late reveals, invalid proofs, and race conditions around crash boundary.

### Checklist Notes

- Source material (CRASH.md) is very detailed for P2P mode; Classic house mode explicitly deferred
- More blocking items than Coinflip due to real-time infrastructure decisions
- 11 functional requirements extracted (most complex game spec)
- Crash point generation uses HMAC-SHA256 (different verification path than Coinflip's VRF)
- Boost mechanic adds complexity: needs separate validation
- The CRASH.md Technical Research Notes section documents several open architecture decisions
- Item #10: spec references HMAC-SHA256 directly - consider abstracting to "deterministic cryptographic function" for purity, but retained for precision since it's specified in source

---

## Open Items (from checklist review)

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Contract files not identified (frontend mocks, on-chain interfaces) | Contract | Yes |
| 2 | Platform fee inconsistency: game docs use 3%, PLATFORM.md says 2.0-2.2% | Assumption | Yes |
| 3 | Real-time sync approach undecided (WebSocket vs polling) | Dependency | Yes |
| 4 | Client-server sync for cash-out timing fairness | Dependency | Yes |
| 5 | Round synchronization approach undecided (DB-backed vs computed) | Dependency | No |
| 6 | Acceptable latency for cash-out registration | Edge Case | No |
| 7 | Network jitter handling / latency compensation for cash-outs | Edge Case | No |
| 8 | Edge case: all players in a tier disconnect mid-round | Edge Case | No |
| 9 | Edge case: player attempts cash-out at exact crash moment (race condition) | Edge Case | No |
| 10 | HMAC-SHA256 crash point leaks implementation detail (spec says "cryptographic function" is sufficient) | Content Quality | No |

### Refinement Carry-Forward (Pivot)

- [ ] Define Crash fairness proof contract fields (seed/proof envelope, result payload, proof versioning).
- [ ] Lock determinism boundary between on-chain recomputation and off-chain engine reporting.
- [ ] Specify timeout/refund trigger behavior, deadline source, and caller expectations for unresolved rounds.
- [ ] Define replay/idempotency protections for cash-out actions and settle calls.
- [ ] Add failure-mode acceptance checks for late reveals, invalid proofs, and race conditions around crash boundary.

### Notes (from checklist)

- Source material (CRASH.md) is very detailed for P2P mode; Classic house mode explicitly deferred
- More blocking items than Coinflip due to real-time infrastructure decisions
- 11 functional requirements extracted (most complex game spec)
- Crash point generation uses HMAC-SHA256 (different verification path than Coinflip's VRF)
- Boost mechanic adds complexity: needs separate validation
- The CRASH.md Technical Research Notes section documents several open architecture decisions
- Item #10: spec references HMAC-SHA256 directly - consider abstracting to "deterministic cryptographic function" for purity, but retained for precision since it's specified in source
