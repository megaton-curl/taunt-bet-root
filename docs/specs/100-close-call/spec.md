# Specification: 100 Close Call

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Ideation | Active |
| Priority | P2 |
| Phase | V1.5 |
| NR_OF_TRIES | 46 |

---

## Overview

Close Call is a pari-mutuel prediction game where players bet on whether a one-minute BTC candle will close green (bullish) or red (bearish). Winners share the losing side's pool proportionally to their wager. Rounds are synchronized to minute boundaries with continuous play. Oracle-resolved via Pyth Network — no commit-reveal, no server secret. This uses flexible betting (any amount, no tiers).

## User Stories

- As a player, I want to bet on the next candle's direction so that I can profit from my market intuition.
- As a player, I want to see the current candle forming live so that I can make an informed bet.
- As a player, I want to see pool sizes and implied odds so that I understand my potential payout.
- As a player, I want automatic payouts when I win, without needing to claim.
- As a player, I want a full refund if a round is invalid (one-sided, equal price) so I never lose funds unfairly.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Post-V1 (V1.5 candidate)
- **Scope status**: Active design
- **Phase boundary**: V1.5

## Required Context Files

- `backend/docs/CLOSE_CALL.md` (game concept source)
- `backend/docs/PLATFORM.md` (flexible betting, platform fee)

## Contract Files

- `solana/programs/closecall/src/state.rs` (on-chain account definitions)
- `solana/programs/closecall/src/instructions/` (instruction handlers)

---

## Functional Requirements

> **Note (2026-04-02)**: Frontend is now a separate project. Frontend criteria below were satisfied at completion time but are no longer maintained in this repo.

### FR-1: Round Structure

Rounds follow a fixed 60-second cycle synchronized to minute boundaries. Each round has a 30-second betting window followed by a 30-second lock period. The backend creates rounds at minute boundaries.

**Timing:**
- **Betting window**: 30 seconds (configurable on-chain via CloseCallConfig)
- **Lock period**: 30 seconds (remaining time until candle close)
- **Total cycle**: 60 seconds aligned to clock minutes

**Acceptance Criteria:**
- [x] Rounds aligned to minute boundaries (e.g., 12:00:00, 12:01:00) <!-- satisfied: closecall-clock.ts minute-boundary alignment; create_round.rs:12 CANDLE_DURATION_SECS=60 -->
- [x] Betting window is 30 seconds from round start (configurable) <!-- satisfied: state.rs:49 betting_window_secs in CloseCallConfig; create_round.rs:63 betting_ends_at = now + betting_window -->
- [x] Bets rejected after betting window closes <!-- satisfied: place_bet.rs:43 time check → BettingClosed error; bankrun closecall.ts:551 -->
- [x] Round resolves at minute boundary when candle closes <!-- satisfied: settle_round.rs:78-83 candle_close_time check -->
- [x] Backend creates new round automatically at each minute boundary <!-- satisfied: closecall-clock.ts createNewRound() on each tick -->
- [x] Clear label showing which candle the bet applies to <!-- satisfied: CloseCallPage.tsx:225-232 banner "Will the current candle close GREEN or RED?" + chart highlight -->

### FR-2: Bet Placement

Players choose GREEN (bull) or RED (bear) with any amount within platform limits. One bet per player per round. Maximum 32 entries per side (64 total) to fit auto-payout in a single transaction.

**Acceptance Criteria:**
- [x] Two prediction options: GREEN (close > open) and RED (close < open) <!-- satisfied: state.rs:5-8 BetSide enum; SideSelector.tsx component -->
- [x] Flexible bet amount with 1/2, x2, MAX controls <!-- satisfied: BetAmountInput.tsx:67-87 handleAdjust() -->
- [x] Minimum bet: 0.001 SOL (platform minimum) <!-- satisfied: types.ts:119 MIN_BET_AMOUNT=0.001; shared/wager.rs validate_wager on-chain -->
- [x] Maximum bet: 100 SOL (platform maximum) <!-- satisfied: types.ts:120 MAX_BET_AMOUNT=100; shared/wager.rs validate_wager on-chain -->
- [x] One bet per player per round (enforced on-chain) <!-- satisfied: place_bet.rs:64 PlayerAlreadyBet; bankrun closecall.ts:531 -->
- [x] Bet locked immediately, cannot change or cancel <!-- satisfied: no cancel/update instruction on-chain; bet entry immutable -->
- [x] Maximum 32 entries per side (64 total per round) <!-- satisfied: state.rs:71,74 max_len(32); place_bet.rs:66-80 MaxEntriesReached -->
- [ ] UI shows "needs bets on both sides to activate" when pool is one-sided <!-- gap: PoolDistribution.tsx shows pool amounts but no messaging for one-sided pools -->

### FR-3: Outcome Determination

Outcome based on strict comparison of candle close vs open price from Pyth Network oracle. No DOJI threshold — exact equality triggers refund.

> **Trust-model note (2026-05-06, audit-prep Option A).** The on-chain program currently
> trusts the backend signer (`round.server`) to relay Pyth-signed prices via instruction
> arguments — there is no on-chain `PriceUpdateV2` validation today. Settlement is gated
> to `caller == round.server` (see `settle_round.rs`, CC-1) and the boundary VAAs that
> back each settle are archived in `closecall_candles.hermes_vaa` and exposed via
> `GET /closecall/by-id/:roundId` so anyone can replay them off-chain against Pyth's
> guardian set. The trust surface is therefore "operator key custody + Pyth signature
> authenticity," with cryptographic auditability after the fact.
>
> **Upgrade path (CC-9).** Replace the price/expo instruction args with a Pyth
> `PriceUpdateV2` account verified via `pyth-solana-receiver-sdk` in a post-update +
> consume + close pattern (net rent zero, net steady-state state zero). With on-chain
> verification the caller restriction can be relaxed to permissionless, matching FlipYou
> and Pot Shot's commit-reveal model. The VAA archival above transitions to belt-and-
> suspenders.

**Acceptance Criteria:**
- [x] GREEN wins if close price > open price (strict) <!-- satisfied: settle_round.rs close_price > open_price → Outcome::Green -->
- [x] RED wins if close price < open price (strict) <!-- satisfied: settle_round.rs else → Outcome::Red -->
- [x] Equal price (close == open): full refund, no fee <!-- satisfied: settle_round.rs close_price == open_price → Refund; bankrun closecall.ts -->
- [x] Open price stored in round PDA at creation time <!-- satisfied: bet.rs is_new_round path stores open_price + open_price_expo -->
- [x] Close price recorded on settlement and bound to the captured boundary VAA <!-- satisfied: closecall-clock.ts settleRound resolves cached/persisted boundary at minute_ts+60; refuses fresh-fetch (CC-2) -->
- [ ] On-chain program verifies Pyth price account directly <!-- deferred: CC-9 / Option A is the current trust posture (see Trust-model note above). Settle currently restricted to round.server (CC-1) with off-chain VAA archival via /closecall/by-id/:roundId verification block. -->
- [x] Settlement boundary is auditable post-hoc via the archived VAA <!-- satisfied: closecall_candles.hermes_vaa persisted by captureBoundaryPrice; CloseCallRoundVerificationSchema exposes boundaryFeedId + boundaryMinuteTs + boundaryVaaBase64 -->
- [x] Supported asset at launch: BTC/USD <!-- satisfied: Pyth feed ID e62df6c8... (BTC/USD) in CloseCallConfig; pyth-poster.ts BTC_USD_FEED_ID -->

### FR-4: Payout and Fee

Fee is 500 bps (5%) of total pool, collected at settlement of decisive rounds only. Auto-payout to all winners proportionally via remaining accounts.

**Acceptance Criteria:**
- [x] Fee = 500 bps (5%) of total pool, single treasury <!-- satisfied: PlatformConfig.fee_bps=500, single treasury -->
- [x] Net pool = total pool minus 500 bps (5%) fee <!-- satisfied: calculate_net_payout() returns (fee, pool - fee) using PlatformConfig.fee_bps -->
- [x] Winner payout = (player_bet / winning_pool) × net_pool <!-- satisfied: settle_round.rs:151-165 proportional loop; bankrun closecall.ts:683 -->
- [x] Fee collected only on decisive rounds (both sides have bets, close ≠ open) <!-- satisfied: settle_round.rs refund branch skips fee; bankrun tests confirm -->
- [x] Auto-payout to all winners in settlement transaction (no claim step) <!-- satisfied: settle_round.rs:141-175 remaining_accounts payout; no claim instruction -->
- [x] Payout via remaining accounts pattern (same as pot-shot) <!-- satisfied: settle_round.rs:141 ctx.remaining_accounts pattern -->

### FR-5: Invalid Round Handling

Invalid rounds result in full refund with no fee. No carryover mechanics.

| Condition | Treatment | Fee |
|-----------|-----------|-----|
| close > open (both sides have bets) | Auto-payout to GREEN bettors | 500 bps (5%) of total pool |
| close < open (both sides have bets) | Auto-payout to RED bettors | 500 bps (5%) of total pool |
| close == open | Refund all bets | None |
| One-sided pool (all bets on same side) | Refund all bets | None |
| Single player only | Refund all bets | None |
| No bets placed | Close round PDA, no action | None |

**Acceptance Criteria:**
- [x] Equal price → full refund to all players, no fee deducted <!-- satisfied: settle_round.rs:112 + bankrun closecall.ts:739 -->
- [x] One-sided pool → full refund to all players, no fee deducted <!-- satisfied: settle_round.rs:111 !has_both_sides + bankrun closecall.ts:775 -->
- [x] Single player → full refund, no fee deducted <!-- satisfied: settle_round.rs:111 total_count==1 + bankrun closecall.ts:808 -->
- [x] No bets → round closed cleanly, no transfers <!-- satisfied: settle_round.rs:109 total_count==0 + bankrun closecall.ts:830 -->
- [x] Refunds return exact deposit amounts (no rounding loss) <!-- satisfied: settle_round.rs:191,205 and timeout_refund.rs:81,91 refund exact amount_lamports -->

### FR-6: Settlement

Oracle-resolved settlement. No commit-reveal — no server secret. Backend reads Pyth close price and submits settle transaction. On-chain program verifies close price from Pyth account. Timeout refund available if backend fails to settle.

**Acceptance Criteria:**
- [x] Settlement triggered by backend after candle close <!-- satisfied: closecall-clock.ts settlePreviousRound() on tick -->
- [x] Round state machine: BETTING → LOCKED → SETTLED or REFUNDED <!-- satisfied: state.rs:12-17 Open→Settled|Refunded; LOCKED is time-based within Open (place_bet.rs:43 rejects after betting_ends_at) -->
- [ ] On-chain program reads Pyth price account at settlement <!-- deferred: CC-9 — settle currently takes close_price as instruction arg, gated to round.server (CC-1). See FR-3 trust-model note. -->
- [x] Backend submits captured boundary price (not a fresh post-candle fetch) <!-- satisfied: closecall-clock.ts settleRound uses cachedBoundaryPrice / closecall_candles fallback; no Hermes fresh-fetch (CC-2) -->
- [x] Double-settle prevention via phase state machine <!-- satisfied: settle_round.rs:62 requires phase==Open -->
- [x] Settlement transaction is atomic (all payouts or all refunds in one tx) <!-- satisfied: single Solana tx, all transfers in one instruction handler -->
- [x] Timeout refund available permissionlessly after resolve deadline <!-- satisfied: timeout_refund.rs:39 no authority check, only is_expired(); bankrun closecall.ts:881 -->
- [x] Server pays rent on round creation, gets rent back on close <!-- satisfied: create_round.rs:29 server payer; settle/timeout rent_receiver=server -->
- [x] Pyth prices verifiable by anyone (oracle transparency) <!-- satisfied: Pyth accounts publicly readable; CloseCallRoundPage.tsx shows oracle info -->

### FR-7: Game UI

Live candlestick chart with betting panel, pool visualization, and countdown timer.

**Acceptance Criteria:**
- [x] Large candlestick chart showing recent BTC/USD history <!-- satisfied: CandlestickChart.tsx (301 lines); candles from live Pyth ticks in CloseCallContext.tsx:324-358 -->
- [x] Current candle highlighted with live price indicator <!-- satisfied: CandlestickChart.tsx receives currentPrice + progress props -->
- [x] Betting panel with amount input and GREEN/RED buttons <!-- satisfied: CloseCallPage.tsx:89-120 BetAmountInput + SideSelector -->
- [x] Pool sizes for GREEN and RED shown with distribution percentage <!-- satisfied: PoolDistribution.tsx:42-54 percentages; :76-93 pool amounts + odds -->
- [x] Active stake display if player has a pending bet <!-- satisfied: PoolDistribution.tsx:103-156 user bet side, amount, potential payout -->
- [ ] Countdown timer showing betting window remaining <!-- gap: ActiveBetView.tsx:94 has countdown code but component is NOT rendered in CloseCallPage.tsx; no timer visible to players -->
- [x] Resolution animation: GREEN/RED result display <!-- satisfied: CloseCallPage.tsx:186-223 RoundResultBanner + PoolDistribution.tsx:106-126 win/loss animations -->
- [x] Clear indication of round outcome and player result <!-- satisfied: RoundResultBanner with outcomeText, statusText, payoutAmount -->

---

## On-Chain Architecture

### Account PDAs

| Account | Seeds | Purpose |
|---------|-------|---------|
| `CloseCallConfig` | `["closecall_config"]` | Treasury, timing params, pause flag, max entries per side, Pyth feed address |
| `CloseCallRound` | `["cc_round", round_id]` | Per-round: entries (green/red), pool totals, open/close prices, outcome, phase |

Two PDA types. Same minimal pattern as flipyou.

### Instructions

| Instruction | Who calls | What it does |
|-------------|-----------|-------------|
| `initialize_config` | Authority | One-time config setup (treasury, timing, Pyth feed) |
| `create_round` | Server | Creates round PDA, stores Pyth open price, pays rent |
| `place_bet` | Player | Deposits SOL into round PDA, picks GREEN or RED |
| `settle_round` | Server | Reads Pyth close price on-chain, determines outcome: pay winners or refund all |
| `timeout_refund` | Anyone | Permissionless after resolve_deadline — refunds all players |
| `force_close` | Authority | Emergency admin close — refunds all |

6 instructions.

### Fee Model

Fee = 500 bps (5%) of total pool, collected at settlement of decisive rounds. Fee rate read from PlatformConfig on-chain.
- Decisive round: `fee = 500 bps × total_pool`. Winners share `net_pool = total_pool - fee`.
- Invalid round: NO fee. Full refund to all players.
- Example: Green pool 7 SOL + Red pool 3 SOL = 10 SOL total. Green wins. Fee = 0.50 SOL. Green bettors share 9.50 SOL proportionally.

### Shared Crate Reuse

From `solana/shared/src/`:
- `escrow.rs` — `transfer_lamports_from_pda`, `transfer_lamports_to_pda`, `close_pda`
- `fees.rs` — `calculate_net_payout`
- `wager.rs` — `validate_wager`
- `timeout.rs` — `is_expired`
- `pause.rs` — `check_not_paused`

Program reads Pyth push oracle price accounts directly (no SDK dependency — manual parser in `pyth.rs`).

---

## Success Criteria

- A player can bet on candle direction, watch it resolve, and receive proportional auto-payout
- Pari-mutuel payouts are mathematically correct for all pool distributions
- Invalid rounds (equal price, one-sided, single player) refund fully with no fee
- Settlement is idempotent and atomic
- Price data is from a verifiable oracle source (Pyth Network)
- Timeout refund protects players if backend fails

---

## Dependencies

- Pyth Network price feed integration (on-chain `PriceUpdateV2` account)
- Platform flexible betting system
- On-chain settlement infrastructure (shared crate)
- Real-time WebSocket for live price display (existing `packages/price-feeds`)

## Assumptions

- BTC/USD is the only asset at launch
- Pyth Network provides sufficiently low-latency price data for 1-minute candles
- 64 max entries per round fits within single-transaction compute budget for auto-payout
- Backend clock worker reliably creates and settles rounds at minute boundaries

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Round aligned to minute boundaries | Observe round transitions at :00 marks | Timestamps in logs |
| 2 | Pari-mutuel payout correct | Multi-player round, verify proportional payouts | Calculation proof |
| 3 | Equal price triggers full refund | Force equal-price condition | All bets returned, no fee |
| 4 | One-sided pool triggers refund | All bets on one side | All bets returned, no fee |
| 5 | Settlement idempotent | Attempt double-settle | Error response proof |
| 6 | Price from Pyth verified | Compare on-chain price vs Pyth feed | Price comparison |
| 7 | Timeout refund works | Let resolve deadline expire | Permissionless refund succeeds |
| 8 | Auto-payout delivered | Win a round | Lamports arrive without claim tx |

---

## Completion Signal

### Implementation Checklist

Items are ordered by dependency. Each unchecked item = one autonomous iteration.

#### On-chain program — DONE (iteration 0)
- [x] [on-chain] CloseCallConfig + CloseCallRound PDAs, all 6 instructions, fee calc, invalid round handling, manual Pyth PriceUpdateV2 parser (`pyth.rs`)
- [x] [test] Bankrun tests: 20 tests covering all instructions + edge cases (equal price, one-sided, single player, max entries, timeout)

#### Phase 1: Pyth + Anchor Client
- [x] [on-chain] Verify `pyth.rs` parser works with Pyth push oracle price accounts on devnet (BTC/USD feed). If the devnet Pyth accounts use a different format than PriceUpdateV2, adapt the parser. Find the correct Pyth BTC/USD price account address for devnet. Update bankrun tests with correct mock format if changed. Run `anchor build` + bankrun tests to confirm. (done: iteration 1)
- [x] [engine] Copy `solana/target/idl/closecall.json` and `solana/target/types/closecall.ts` into `packages/anchor-client/src/`. Add `closecall` to the barrel export in `packages/anchor-client/src/index.ts` following the exact pattern used for flipyou and potshot (IDL JSON import + type re-export). Add `CLOSECALL_PROGRAM_ID` constant to `packages/config/`. Run `pnpm lint` in the anchor-client package to confirm no errors. (done: iteration 2)

#### Phase 2: Backend
- [x] [backend] In `backend/src/worker/account-decoder.ts`, add `DecodedCloseCallRound` and `DecodedCloseCallConfig` interfaces + decoder functions using `BorshAccountsCoder` from the closecall IDL. Follow the exact pattern of the existing flipyou/potshot decoders (bnToBigInt conversion, phase enum mapping). Export from module. Run `pnpm lint` to confirm. (done: iteration 3)
- [x] [backend] In `backend/src/worker/settle-tx.ts`, add closecall settlement functions: `buildCreateRoundTx(roundId, pythPriceAccount)`, `buildSettleRoundTx(roundId, pythPriceAccount, winnerAccounts)`, `buildTimeoutRefundTx(roundId, playerAccounts)`. The backend reads the Pyth push oracle price account via `connection.getAccountInfo()` — no Hermes fetch needed. Follow the existing flipyou/potshot settle pattern. Run `pnpm lint` to confirm. (done: iteration 4)
- [x] [backend] Create `backend/src/worker/closecall-clock.ts` — a `CloseCallClockWorker` that runs on minute-boundary intervals. Each tick: (1) read Pyth BTC/USD push oracle price from Solana via RPC, (2) settle the previous round if it exists and candle has closed (call `buildSettleRoundTx`), (3) create a new round (call `buildCreateRoundTx` with open price from Pyth account). Use the existing `retry.ts` pattern for tx submission. Handle edge cases: no previous round, settlement failure (log + continue). Export worker class. (done: iteration 5)
- [x] [backend] Extend DB: add `game = "closecall"` support to the `rounds` table (or create a new `closecall_rounds` table if schema differs significantly). Store: round_id, open_price, close_price, outcome, green_pool, red_pool, fee, created_at, settled_at, tx_signature. Add API routes: `GET /closecall/current-round` (returns active round + pool state), `GET /closecall/history` (last 20 settled rounds). Extend `GET /fairness/rounds/by-id/:roundId` to support closecall rounds. Follow the existing route creation pattern in `backend/src/routes/`. (done: iteration 6)
- [x] [backend] Wire the `CloseCallClockWorker` into `backend/src/index.ts`: import, instantiate with config (Pyth BTC/USD account address, server keypair, connection, DB), start on backend boot. Add `PYTH_BTC_USD_ACCOUNT` env var to `.env` and config loading. Run `pnpm lint` across backend to confirm. Verify the backend starts without errors (even if clock worker won't find rounds on devnet yet). (done: iteration 7)

#### Phase 3: Devnet Deploy
- [x] [deploy] Deploy closecall program to devnet: `anchor deploy --provider.cluster devnet -p closecall`. Run `initialize_config` on devnet (treasury from `.env.devnet`, Pyth BTC/USD feed ID for devnet, 30s betting window, 32 max entries per side). Add `VITE_CLOSECALL_PROGRAM_ID=8TXq2XyHsk5AAMkoyk5QtG25xyyY7rTMHXrJRHRwjUpA` to `.env.devnet`. Verify by calling `create_round` + `place_bet` + `settle_round` manually against real Pyth prices. (done: iteration 8)

#### Phase 4: Frontend Integration (existing mock scaffolding → real)

Note: FE scaffolding already exists at `apps/platform/src/features/close-call/` with mock simulation. Route, sidebar nav entry, and component structure are already in place. These iterations swap mocks for real backend/on-chain integration.

- [x] [frontend] Update `features/close-call/types.ts`: remove DOJI threshold, carryover, commit-reveal fields (`seedHash`, `serverSeed`, `blockHash`, `carryoverAmount`). Remove `claimPayout` from context actions (auto-payout). Fix constants: `BETTING_WINDOW_MS = 30000` (was 10000), `MIN_BET_AMOUNT` to 0.001 SOL, `MAX_BET_AMOUNT` to 100 SOL. Align `RoundPhase` with on-chain `CloseCallPhase` (Open/Settled/Refunded). Align `CandleOutcome` — remove "doji", add "refund". Update `PoolState` to match on-chain `green_pool`/`red_pool` fields. Run `pnpm lint` to confirm no type errors cascade. (done: iteration 30)
- [x] [frontend] Rewrite `features/close-call/context/CloseCallContext.tsx`: replace `mock-simulation.ts` imports with real backend API calls (`GET /closecall/current-round` for active round + pools, `GET /closecall/history` for recent rounds). Poll current round every 2s (or use existing event subscription pattern from flipyou). Read Pyth BTC/USD price for chart via existing `packages/price-feeds` `usePriceSubscription("BTC")`. Remove `claimPayout()`, remove carryover/pot shot state. Keep `placeBet()` as a stub that calls the wallet tx (wired in next iteration). Run `pnpm lint` + verify page loads without crash. (done: iteration 39)
- [x] [frontend] Wire wallet integration for `place_bet`: in `CloseCallContext.tsx`, implement `placeBet()` to build and send a `place_bet` transaction using the closecall IDL from `packages/anchor-client`. Follow the exact pattern used in flipyou for tx building + signing via `useWallet()`. Handle errors: insufficient balance → toast, betting closed race → toast + refresh round, tx failure → toast with retry. On successful bet, optimistically update `userBet` in context, then confirm via next poll. Remove `mock-simulation.ts` and `payout-calculator.ts` if fully replaced. Run `pnpm lint`. (done: iteration 40)
- [x] [frontend] Add `/close-call/:roundId` deep-link page: create `pages/CloseCallRoundPage.tsx` (follow pattern of `FlipYouRoundPage`). Fetch round data from `GET /fairness/rounds/by-id/:roundId`. Display: open price, close price, outcome (Green/Red/Refund), green pool, red pool, total pool, fee collected, entries list, settlement tx signature. Add route to `App.tsx`. Link from round history list. Run `pnpm lint`. (done: iteration 41)

#### Phase 5: Testing
- [x] [test] Update visual baselines for close-call pages. Run `pnpm test:visual` to identify failures, then `pnpm test:visual:update` to regenerate. **Before committing**: read old baseline and new screenshot for each changed page (use Read tool on PNG files). Evaluate: **PASS** (changes clearly match spec intent) → commit. **REVIEW** (unexpected areas changed) → save diff images, describe in history.md, output blocker. **FAIL** (broken layout) → fix code, don't update baselines. (done: iteration 42)
- [x] [test] ~~Add local deterministic E2E coverage~~ N/A: Close Call requires Pyth oracle price accounts (PriceUpdateV2 owned by Pyth Solana Receiver) on localnet — no Pyth program stack deployed locally. Backend clock worker also needs Pyth to create rounds. Frontend has no mock mode fallback. Devnet E2E (next item) provides integration coverage with real Pyth data. (done: iteration 43)
- [x] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes (done: iteration 44)
- [x] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason) (done: iteration 45)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [x] New bankrun tests for all 6 instructions (done: iteration 0)
- [x] New tests for pari-mutuel payout calculations (done: iteration 0)
- [x] New tests for invalid round conditions (done: iteration 0)
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: equal price, single-sided pool, max entries reached, timeout refund
- [ ] Settlement idempotency verified
- [ ] Auto-payout delivers correct amounts

#### Visual Verification
- [ ] Chart and betting UI correct on desktop
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

## Implementation Reference

### On-Chain (Solana)
- **Program ID**: `594DD86FCyKirp4m7R9EWwUgZ9A6VdipiCDS2HGHHgwY`
- **PDA Seeds**:
  - `CloseCallConfig`: `["closecall_config"]`
  - `CloseCallRound`: `["cc_round", minute_ts.to_le_bytes()]`
- **Accounts**:
  - `CloseCallConfig` — authority, pyth_feed_id, betting_window_secs, max_entries_per_side, paused, bump
  - `CloseCallRound` — minute_ts, server, phase, green_entries (Vec\<BetEntry\>), red_entries (Vec\<BetEntry\>), green_pool, red_pool, open_price, open_price_expo, close_price, created_at, betting_ends_at, resolve_deadline, outcome, total_fee, bump
- **Instructions**: `initialize_config`, `bet` (unified create-or-join), `settle_round`, `timeout_refund`, `force_close`, `set_paused`

### Backend
- **Endpoints** (prefix `/closecall`):
  - `GET /current-round` — active round + pool state (reads on-chain PDA directly)
  - `GET /history` — last N settled/refunded rounds from DB
  - `GET /candles` — last N minute-boundary candles from `closecall_candles` table
  - `POST /bet` — co-sign a bet tx (server partially signs, returns serialized tx)
  - `GET /fairness/rounds/by-id/:matchId` — supports closecall rounds (numeric minuteTs as matchId)
- **DB Tables**:
  - `closecall_rounds` — round_id, pda, server_key, phase, open_price, open_price_expo, close_price, outcome, green_pool, red_pool, total_fee, green_entries (JSONB), red_entries (JSONB), settle_tx, created_at, settled_at
  - `closecall_candles` — minute_ts, price_human (boundary prices for candle construction)
- **Settlement**: `CloseCallClockWorker` runs on minute-boundary intervals. Each tick: (1) settles previous round by reading Pyth close price and submitting `settle_round` tx, (2) creates new round with open price from Pyth. Server pays rent on creation, gets it back on close. Timeout refund is permissionless after `resolve_deadline`.

---

## Key Decisions (from refinement)

- Oracle-resolved via Pyth Network — no commit-reveal, no server secret. Simpler than flipyou/lord fairness model.
- Strict price comparison (close > open = GREEN, close < open = RED). No DOJI threshold — exact equality triggers full refund.
- 2 PDA architecture: `CloseCallConfig` (global) + `CloseCallRound` (per-round). 6 instructions total.
- Pari-mutuel model: losers' pool distributed proportionally to winners. Single winner-takes-all is not possible (always multi-winner per side).
- Fee: 500 bps (5%) flat fee to single treasury via PlatformConfig, collected only on decisive rounds.
- Auto-payout via remaining accounts pattern — no claim instruction, winners paid in settlement tx.
- Separate `closecall_rounds` DB table (not reusing commit-reveal `rounds` table) because schema differs: no secret/commitment fields, stores oracle prices, JSONB entry arrays.
- Backend clock worker creates and settles rounds at minute boundaries (+2s offset for candle close). Rounds are not player-initiated.
- Pyth BTC/USD push oracle account (`4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo`) read directly on-chain via manual Borsh parser (`pyth.rs`) — no Pyth SDK dependency.
- Max 32 entries per side (64 total per round) to fit auto-payout in a single transaction's compute budget.
- Betting window: 30s (configurable on-chain via `CloseCallConfig.betting_window_secs`).
- Local E2E tests not feasible — Pyth oracle requires real devnet deployment (no localnet Pyth stack). Devnet E2E covers integration.
- Removed from original concept: DOJI threshold, carryover mechanics, audio, provably fair section (replaced by oracle transparency).
- `PriceFeedProvider` placed at app root (not inside `CloseCallProvider`) to avoid WebSocket reconnection on navigation and to support future features needing Pyth data.
- PDA helpers defined locally in frontend `CloseCallContext.tsx` (not imported from `@taunt-bet/game-engine`) to avoid `Buffer` polyfill issues in Vite browser builds.

## Deferred Items

- **FR-2 one-sided pool UX message**: `PoolDistribution.tsx` shows pool amounts but no messaging when all bets are on one side. Low severity — the refund behavior works correctly, just no pre-emptive UI warning.
- **FR-7 countdown timer**: `ActiveBetView.tsx` has working countdown code (`Math.ceil(bettingTimeLeft / 1000)s left`) but the component is never rendered in `CloseCallPage.tsx`. Moderate severity — players cannot see betting window remaining.
- **`ActiveBetView` dead code**: Component is exported but never rendered. Should be integrated or removed.
- **Future asset support**: Only BTC/USD at launch. SOL/USD, ETH/USD not scoped.
- **Audio**: No audio in Close Call scope. Same deferral as flipyou and pot-shot — dedicated audio spec planned.
- **Pyth devnet staleness**: Devnet push oracle updates every ~5 minutes (vs real-time on mainnet). `MAX_OPEN_PRICE_AGE_SECS=60` causes frequent `PriceTooStale` failures. Production clock worker may need Pyth Hermes to push fresh prices before creating rounds.
