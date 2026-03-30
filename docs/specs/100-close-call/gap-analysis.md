# Gap Analysis: 100-close-call — Close Call

- **Date**: 2026-03-18
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions
| Instruction | Program | File | Line |
|------------|---------|------|------|
| `initialize_config` | closecall | `solana/programs/closecall/src/instructions/initialize_config.rs` | 22 |
| `create_round` | closecall | `solana/programs/closecall/src/instructions/create_round.rs` | 47 |
| `place_bet` | closecall | `solana/programs/closecall/src/instructions/place_bet.rs` | 31 |
| `settle_round` | closecall | `solana/programs/closecall/src/instructions/settle_round.rs` | 56 |
| `timeout_refund` | closecall | `solana/programs/closecall/src/instructions/timeout_refund.rs` | 39 |
| `force_close` | closecall | `solana/programs/closecall/src/instructions/force_close.rs` | 38 |

### Account State
| Account | File | Line |
|---------|------|------|
| `CloseCallConfig` | `solana/programs/closecall/src/state.rs` | 41 |
| `CloseCallRound` | `solana/programs/closecall/src/state.rs` | 62 |
| `BetEntry` | `solana/programs/closecall/src/state.rs` | 32 |
| `BetSide` (enum) | `solana/programs/closecall/src/state.rs` | 5 |
| `CloseCallPhase` (enum) | `solana/programs/closecall/src/state.rs` | 12 |
| `Outcome` (enum) | `solana/programs/closecall/src/state.rs` | 23 |

### Shared Crate Usage
| Module | Usage | File |
|--------|-------|------|
| `escrow::transfer_lamports_to_pda` | Deposit wager | place_bet.rs:83 |
| `escrow::transfer_lamports_from_pda` | Pay winners/refund | settle_round.rs:167,174,191,205; timeout_refund.rs:81,91; force_close.rs:74,84 |
| `fees::calculate_net_payout` | 500 bps fee calc | settle_round.rs:129 |
| `wager::validate_wager` | Min/max wager | place_bet.rs:45 |
| `timeout::is_expired` | Deadline check | timeout_refund.rs:57 |
| `pause::check_not_paused` | Pause guard | create_round.rs:48, place_bet.rs:37 |

### Pyth Oracle Parser
| Export | File | Line |
|--------|------|------|
| `PythPrice` (struct) | `solana/programs/closecall/src/pyth.rs` | 5 |
| `parse_price_update()` | `solana/programs/closecall/src/pyth.rs` | 54 |

### Game Engine Exports
| Export | Package | File | Line |
|--------|---------|------|------|
| `ClosecallIDL` | anchor-client | `packages/anchor-client/src/index.ts` | 3, 14 |
| `Closecall` type | anchor-client | `packages/anchor-client/src/index.ts` | 8 |
| `CLOSECALL_PROGRAM_ID` | game-engine | `packages/game-engine/src/closecall.ts` | 6 |
| `getCloseCallRoundPda()` | game-engine | `packages/game-engine/src/closecall.ts` | 16 |
| `getCloseCallConfigPda()` | game-engine | `packages/game-engine/src/closecall.ts` | 29 |

### Backend Components
| Component | File | Line |
|-----------|------|------|
| `DecodedCloseCallRound` interface | `services/backend/src/worker/account-decoder.ts` | 125 |
| `DecodedCloseCallConfig` interface | `services/backend/src/worker/account-decoder.ts` | 144 |
| `decodeCloseCallRound()` | `services/backend/src/worker/account-decoder.ts` | 239 |
| `decodeCloseCallConfig()` | `services/backend/src/worker/account-decoder.ts` | 261 |
| `buildCloseCallCreateRoundTx()` | `services/backend/src/worker/settle-tx.ts` | 554 |
| `buildCloseCallSettleRoundTx()` | `services/backend/src/worker/settle-tx.ts` | 591 |
| `buildCloseCallTimeoutRefundTx()` | `services/backend/src/worker/settle-tx.ts` | 634 |
| `createCloseCallClockWorker()` | `services/backend/src/worker/closecall-clock.ts` | 70 |
| `GET /closecall/current-round` | `services/backend/src/routes/closecall.ts` | 43 |
| `GET /closecall/history` | `services/backend/src/routes/closecall.ts` | 51 |
| `GET /fairness/rounds/by-id/:matchId` (closecall fallback) | `services/backend/src/routes/rounds.ts` | 131 |
| `closecall_rounds` table | `services/backend/migrations/005_closecall_rounds.sql` | 1 |

### Frontend Components
| Component | File | Line |
|-----------|------|------|
| `CloseCallProvider` / `useCloseCall` | `apps/platform/src/features/close-call/context/CloseCallContext.tsx` | 281, 720 |
| `CandlestickChart` | `apps/platform/src/features/close-call/components/CandlestickChart.tsx` | 25 |
| `BetAmountInput` | `apps/platform/src/features/close-call/components/BetAmountInput.tsx` | 12 |
| `SideSelector` | `apps/platform/src/features/close-call/components/SideSelector.tsx` | 11 |
| `PoolDistribution` | `apps/platform/src/features/close-call/components/PoolDistribution.tsx` | 12 |
| `ActiveBetView` | `apps/platform/src/features/close-call/components/ActiveBetView.tsx` | 9 |
| `RoundResultOverlay` | `apps/platform/src/features/close-call/components/RoundResultOverlay.tsx` | 11 |
| `CloseCallPage` | `apps/platform/src/pages/CloseCallPage.tsx` | 364 |
| `CloseCallRoundPage` | `apps/platform/src/pages/CloseCallRoundPage.tsx` | — |
| Route `/close-call` | `apps/platform/src/App.tsx` | route registration |
| Route `/close-call/:roundId` | `apps/platform/src/App.tsx` | route registration |

### Tests
| Test | Type | File | Status |
|------|------|------|--------|
| `initialize_config` — creates config with correct fields | bankrun | `solana/tests/closecall.ts:432` | Pass |
| `create_round` — creates round with Pyth open price | bankrun | `solana/tests/closecall.ts:452` | Pass |
| `place_bet` — places green bet correctly | bankrun | `solana/tests/closecall.ts:490` | Pass |
| `place_bet` — places red bet correctly | bankrun | `solana/tests/closecall.ts:512` | Pass |
| `place_bet` — rejects duplicate bet | bankrun | `solana/tests/closecall.ts:531` | Pass |
| `place_bet` — rejects bet after window closes | bankrun | `solana/tests/closecall.ts:551` | Pass |
| `place_bet` — rejects wager below minimum | bankrun | `solana/tests/closecall.ts:573` | Pass |
| `place_bet` — rejects invalid side | bankrun | `solana/tests/closecall.ts:592` | Pass |
| `settle_round` — green wins auto-payout with fee | bankrun | `solana/tests/closecall.ts:616` | Pass |
| `settle_round` — red wins auto-payout with fee | bankrun | `solana/tests/closecall.ts:654` | Pass |
| `settle_round` — multi-winner proportional payout | bankrun | `solana/tests/closecall.ts:683` | Pass |
| `settle_round` — equal price full refund no fee | bankrun | `solana/tests/closecall.ts:739` | Pass |
| `settle_round` — one-sided pool full refund no fee | bankrun | `solana/tests/closecall.ts:775` | Pass |
| `settle_round` — single player full refund | bankrun | `solana/tests/closecall.ts:808` | Pass |
| `settle_round` — no bets clean close | bankrun | `solana/tests/closecall.ts:830` | Pass |
| `settle_round` — rejects settlement before candle close | bankrun | `solana/tests/closecall.ts:854` | Pass |
| `timeout_refund` — refunds after resolve deadline | bankrun | `solana/tests/closecall.ts:881` | Pass |
| `timeout_refund` — rejects before deadline | bankrun | `solana/tests/closecall.ts:915` | Pass |
| `force_close` — admin force-closes and refunds | bankrun | `solana/tests/closecall.ts:941` | Pass |
| `force_close` — rejects non-admin | bankrun | `solana/tests/closecall.ts:965` | Pass |
| closecall infra: program deployed, Pyth readable, backend API | devnet E2E | `apps/platform/e2e/devnet/closecall-lifecycle.spec.ts:222` | Pass |
| closecall lifecycle: bet both sides → settlement → verify | devnet E2E | `apps/platform/e2e/devnet/closecall-lifecycle.spec.ts:288` | Conditional |
| close call page (route baseline) | visual | `apps/platform/e2e/visual/routes.spec.ts:19` | Pass |
| close call round page (route baseline) | visual | `apps/platform/e2e/visual/routes.spec.ts:24` | Pass |
| Close Call wallet disconnected | visual state | `apps/platform/e2e/visual/states.spec.ts:199` | Pass |
| Close Call wallet connected | visual state | `apps/platform/e2e/visual/states.spec.ts:207` | Pass |

## Acceptance Criteria Audit

### FR-1: Round Structure
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Rounds aligned to minute boundaries | SATISFIED | `closecall-clock.ts` tick aligns to minute boundary + 2s offset; `create_round.rs:12` `CANDLE_DURATION_SECS=60` |
| 2 | Betting window is 30 seconds from round start (configurable) | SATISFIED | `state.rs:49` `betting_window_secs: u8` in CloseCallConfig; `create_round.rs:63` `betting_ends_at = now + betting_window`; devnet init: 30s |
| 3 | Bets rejected after betting window closes | SATISFIED | `place_bet.rs:43` time check vs `betting_ends_at` → `BettingClosed` error; bankrun test `closecall.ts:551` |
| 4 | Round resolves at minute boundary when candle closes | SATISFIED | `settle_round.rs:78-83` `candle_close_time = created_at + CANDLE_DURATION_SECS`; rejects if `now < candle_close_time` |
| 5 | Backend creates new round automatically at each minute boundary | SATISFIED | `closecall-clock.ts` `createNewRound()` called every tick; tick aligns to minute boundaries |
| 6 | Clear label showing which candle the bet applies to | SATISFIED | `CloseCallPage.tsx:225-232` banner: "Will the current candle close GREEN or RED?" + highlighted current candle in chart |

### FR-2: Bet Placement
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Two prediction options: GREEN and RED | SATISFIED | `state.rs:5-8` `BetSide { Green, Red }`; `SideSelector.tsx` UI component |
| 2 | Flexible bet amount with 1/2, x2, MAX controls | SATISFIED | `BetAmountInput.tsx:67-87` `handleAdjust()` with adjustment controls |
| 3 | Minimum bet: 0.001 SOL | SATISFIED | `types.ts:119` `MIN_BET_AMOUNT=0.001`; `shared/wager.rs` `validate_wager` on-chain |
| 4 | Maximum bet: 100 SOL | SATISFIED | `types.ts:120` `MAX_BET_AMOUNT=100`; `shared/wager.rs` `validate_wager` on-chain |
| 5 | One bet per player per round (enforced on-chain) | SATISFIED | `place_bet.rs:64` duplicate check → `PlayerAlreadyBet` error; bankrun test `closecall.ts:531` |
| 6 | Bet locked immediately, cannot change or cancel | SATISFIED | No cancel/update instruction exists on-chain; bet entry immutable once placed |
| 7 | Maximum 32 entries per side (64 total per round) | SATISFIED | `state.rs:71,74` `#[max_len(32)]`; `place_bet.rs:66-80` runtime check → `MaxEntriesReached` |
| 8 | UI shows "needs bets on both sides to activate" when pool is one-sided | **GAP** | `PoolDistribution.tsx` shows pool percentages and amounts but has no messaging for one-sided pools. No component renders this message. |

### FR-3: Outcome Determination
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GREEN wins if close > open (strict) | SATISFIED | `settle_round.rs:114` `close_price > open_price → Outcome::Green` |
| 2 | RED wins if close < open (strict) | SATISFIED | `settle_round.rs:116` `else → Outcome::Red` |
| 3 | Equal price → full refund, no fee | SATISFIED | `settle_round.rs:112` `close_price == open_price → Outcome::Refund`; bankrun test `closecall.ts:739` |
| 4 | Price data from Pyth Network on-chain | SATISFIED | `pyth.rs:54` `parse_price_update()` deserializes PriceUpdateV2; verified on devnet |
| 5 | Open price stored in round PDA at creation | SATISFIED | `create_round.rs:66-67` stores `open_price` and `open_price_expo` from Pyth |
| 6 | Close price read from Pyth at settlement | SATISFIED | `settle_round.rs:87` parses close price from Pyth account at settle time |
| 7 | On-chain program verifies Pyth price account | SATISFIED | `pyth.rs:67-69` feed_id verification; `pyth.rs:73-74` freshness check |
| 8 | Supported asset: BTC/USD | SATISFIED | Pyth feed ID `e62df6c8...` (BTC/USD) configured in CloseCallConfig and `config.ts:86` |

### FR-4: Payout and Fee
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Fee = 500 bps (5%), single treasury | SATISFIED | PlatformConfig.fee_bps=500, single treasury. No split buckets. |
| 2 | Net pool = total pool minus 500 bps fee | SATISFIED | `calculate_net_payout()` returns `(fee, pool - fee)` using PlatformConfig.fee_bps |
| 3 | Winner payout = (player_bet / winning_pool) x net_pool | SATISFIED | `settle_round.rs:151-165` proportional payout loop; bankrun test `closecall.ts:683` (multi-winner) |
| 4 | Fee collected only on decisive rounds | SATISFIED | `settle_round.rs:125-130` fee calc only in decisive branch; refund branch skips fee; bankrun tests confirm |
| 5 | Auto-payout to all winners in settlement tx | SATISFIED | `settle_round.rs:141-175` iterates remaining accounts for payouts; no claim instruction |
| 6 | Payout via remaining accounts pattern | SATISFIED | `settle_round.rs:141` `ctx.remaining_accounts` pattern; same as lord-of-rngs |

### FR-5: Invalid Round Handling
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Equal price → full refund, no fee | SATISFIED | `settle_round.rs:112` + bankrun test `closecall.ts:739` |
| 2 | One-sided pool → full refund, no fee | SATISFIED | `settle_round.rs:111` `!has_both_sides` + bankrun test `closecall.ts:775` |
| 3 | Single player → full refund, no fee | SATISFIED | `settle_round.rs:111` `total_count == 1` + bankrun test `closecall.ts:808` |
| 4 | No bets → round closed cleanly | SATISFIED | `settle_round.rs:109` `total_count == 0 → Outcome::Refund` (no transfers) + bankrun test `closecall.ts:830` |
| 5 | Refunds return exact deposit amounts | SATISFIED | `settle_round.rs:191,205` and `timeout_refund.rs:81,91` refund `entry.amount_lamports` exactly |

### FR-6: Settlement
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Settlement triggered by backend after candle close | SATISFIED | `closecall-clock.ts` `settlePreviousRound()` called on tick after minute boundary |
| 2 | State machine: BETTING → LOCKED → SETTLED or REFUNDED | SATISFIED | `state.rs:12-17` `Open → Settled \| Refunded`; LOCKED is time-based within Open (`place_bet.rs:43` rejects after `betting_ends_at`, `ActiveBetView.tsx:24` `isLocked` detection) |
| 3 | On-chain program reads Pyth price at settlement | SATISFIED | `settle_round.rs:87` `parse_price_update()` on Pyth account |
| 4 | Double-settle prevention via phase state machine | SATISFIED | `settle_round.rs:62` requires `phase == Open`; bankrun test confirms |
| 5 | Settlement tx is atomic (all payouts or all refunds) | SATISFIED | Single Solana tx — all transfers in one instruction handler |
| 6 | Timeout refund available permissionlessly after deadline | SATISFIED | `timeout_refund.rs:39` no authority signer check, only `is_expired()` check; bankrun test `closecall.ts:881` |
| 7 | Server pays rent, gets rent back on close | SATISFIED | `create_round.rs:29` server is `#[account(mut)]` payer; settle/timeout use `rent_receiver` = server |
| 8 | Pyth prices verifiable by anyone | SATISFIED | Pyth push oracle accounts are publicly readable on Solana; `CloseCallRoundPage.tsx` shows oracle info |

### FR-7: Game UI
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Large candlestick chart showing BTC/USD history | SATISFIED | `CandlestickChart.tsx` (301 lines); candles built from live Pyth price ticks in `CloseCallContext.tsx:324-358` |
| 2 | Current candle highlighted with live price indicator | SATISFIED | `CandlestickChart.tsx` receives `currentPrice` + `progress` props; updates in real-time |
| 3 | Betting panel with amount input and GREEN/RED buttons | SATISFIED | `CloseCallPage.tsx:89-120` — `BetAmountInput` + `SideSelector` in sidebar |
| 4 | Pool sizes for GREEN and RED with distribution percentage | SATISFIED | `PoolDistribution.tsx:42-54` green/red percentages; `:76-93` pool amounts + odds multipliers |
| 5 | Active stake display if player has a pending bet | SATISFIED | `PoolDistribution.tsx:103-156` shows user bet side, amount, and potential payout when `userBet` exists |
| 6 | Countdown timer showing betting window remaining | **GAP** | `ActiveBetView.tsx:94` has countdown code (`{Math.ceil(bettingTimeLeft / 1000)}s left`) but `ActiveBetView` is NOT rendered in `CloseCallPage.tsx`. No countdown timer is visible to players before or after betting. |
| 7 | Resolution animation: GREEN/RED result display | SATISFIED | `CloseCallPage.tsx:186-223` `RoundResultBanner` with outcome color + text; `PoolDistribution.tsx:106-126` win/loss animations |
| 8 | Clear indication of round outcome and player result | SATISFIED | `RoundResultBanner` shows outcomeText, statusText (You Won!/You Lost/Bet refunded), payoutAmount |

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| 1 | FR-2 | UI shows "needs bets on both sides to activate" | low | frontend | — | Add conditional message to `PoolDistribution.tsx` when only one side has bets |
| 2 | FR-7 | Countdown timer showing betting window remaining | moderate | frontend | — | Either render `ActiveBetView` in `CloseCallPage.tsx`, or add a standalone countdown timer to the sidebar/main area |

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| — | — | — | — | — |

No items were explicitly deferred in this spec.

## Recommendations

1. **FR-7 countdown timer (moderate)**: The `ActiveBetView` component already has a working countdown implementation at line 94, but the component is not rendered anywhere in `CloseCallPage.tsx`. The simplest fix is to render `ActiveBetView` when `userBet` exists, or extract the countdown timer into the sidebar for all players (not just those who've already bet). A pre-bet countdown is more valuable since it helps players decide when to bet.

2. **FR-2 one-sided pool message (low)**: Add a conditional message in `PoolDistribution.tsx` when `pool.greenPool === 0 || pool.redPool === 0` (but `pool.totalPool > 0`), showing text like "Needs bets on both sides to pay out" to set expectations about the refund condition.

3. **ActiveBetView dead code**: The `ActiveBetView` component is exported but never rendered. It should either be integrated into the page layout or removed to avoid code bloat.
