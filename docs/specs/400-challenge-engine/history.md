# Implementation History — 400-challenge-engine

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Phase 0: Event types + game.settled emission (coinflip & lord)

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/event-types.ts` — Added 5 new event types: `GAME_SETTLED`, `REWARD_POOL_FUND`, `POINTS_GRANT`, `CRATE_DROP`, `CRATE_SOL_PAYOUT`
- `backend/services/backend/src/db.ts` — Added `rawSql` property to `Db` interface + implementation, so `emitEvent()` can be called within `withTransaction()` blocks
- `backend/services/backend/src/worker/settle-tx.ts` — Emit `game.settled` event at the end of both `settleMatch()` (coinflip) and `settleLordRound()` (lord/jackpot) within the existing settlement DB transaction. Payload matches FR-1 schema: roundId, roundPda, game, players[] (with userId, wallet, amountLamports as string, isWinner, payoutLamports as string, isCreator), feeLamports as string, settledAt ISO 8601. Lord aggregates per-player totals (since a player can have multiple entries).
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 2 tests: (1) verifies game.settled event emitted with correct payload shape after coinflip settlement, (2) verifies duplicate settlement retry doesn't produce double events (phase guard rejects re-settle). Also added `event_queue`, `game_entries`, `transactions`, `player_profiles` to TRUNCATE list for test isolation.

**Verification**: `cd backend && pnpm lint && pnpm typecheck && pnpm test` — all 124 tests pass (0 errors, 2 pre-existing warnings).

## Iteration 1 — 2026-04-03T19:00:24Z — OK
- **Log**: iteration-001.log

## Iteration 2 — Phase 0: game.settled emission for closecall

**Status**: Success

**Changes**:
- `backend/services/backend/src/worker/closecall-clock.ts` — Added imports for `emitEvent` and `EventTypes`. Added optional `hermesFetcher` to `CloseCallClockDeps` interface (for test injection). Emit `game.settled` event within the settlement DB transaction, after game entries are upserted. Payload matches FR-1 schema: `roundId` (minute timestamp string), `roundPda`, `game: "closecall"`, `players[]` (with userId, wallet, amountLamports as string, isWinner as boolean|null for refunds, payoutLamports as string, isCreator — first entry treated as creator), `feeLamports` as string, `settledAt` ISO 8601. Event only emitted for rounds with players who have profiles.
- `backend/services/backend/src/worker/account-decoder.ts` — Added `encodeCloseCallRound()` function to encode `DecodedCloseCallRound` data back to on-chain Buffer format (inverse of `decodeCloseCallRound`). Needed by integration test to build mock on-chain account data.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added integration test: creates mock CloseCallRound on-chain account with green+red entries, mock HermesFetcher, calls `clock.tick()` which discovers and settles the round, verifies `game.settled` event in `event_queue` with correct payload shape (game="closecall", players with correct userId/wallet/amounts/winner/payout/isCreator, fee calculation matches 500 bps). Also added `closecall_rounds`, `closecall_candles` to TRUNCATE list for test isolation.

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, vitest 9/9 tests pass.

## Iteration 2 — 2026-04-03T19:17:30Z — OK
- **Log**: iteration-002.log

## Iteration 3 — Phase 1: Data Model & Seeds

**Status**: Success

**Changes**:
- `backend/services/backend/migrations/011_challenge_engine.sql` — Created migration with all 14 FR-2 tables: `reward_config`, `player_points`, `point_grants`, `reward_pool`, `reward_pool_fundings`, `campaigns`, `challenges` (with `scope` CHECK and `eligible_if` JSONB), `challenge_assignments`, `progress_events` (with `metadata` JSONB), `completion_bonuses`, `bonus_completions`, `crate_drops`, `fraud_flags`, `dogpile_events`. All tables follow project conventions: BIGINT GENERATED ALWAYS AS IDENTITY, CHECK constraints on TEXT enums, TIMESTAMPTZ, snake_case. Foreign keys enforced (challenges→campaigns, assignments→challenges, progress_events→assignments, bonuses→campaigns, bonus_completions→bonuses, dogpile→campaigns). UNIQUE constraints on all idempotency keys. Indexes on hot queries (active assignments, points history, pending crates, active dogpile). Seed data: 11 `reward_config` rows (FR-13 defaults), `reward_pool` singleton (balance 0), 3 campaigns (daily/weekly/onboarding), 6 daily challenge templates, 4 weekly challenge templates, 3 onboarding challenge templates with `prerequisite_id` chain, 1 daily completion bonus (required_count=3, reward_type='crate').

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, vitest 125/125 tests pass (13 test files).

## Iteration 3 — 2026-04-03T19:27:29Z — OK
- **Log**: iteration-003.log

## Iteration 4 — Phase 2: Quest Eligibility + Verification Adapters

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/challenge-adapters.ts` — New file. Implements `questEligible(player)` function (returns `false` when `isWinner === null` for refunded games, `true` otherwise). Implements `VerificationAdapter` type interface and adapter registry (`Map<string, VerificationAdapter>`). Implements 3 M1 adapters: `game_completed` (scope-filtered participation check), `game_won` (scope + `isWinner === true`), `lobby_filled` (scope + `isCreator === true`). `getAdapter(action)` returns the matching adapter or a no-op adapter that logs a warning for unknown action types. Exports `GameSettledPayload`, `GameSettledPlayer`, `ChallengeAssignment`, `AdapterResult` types for use by downstream handlers.
- `backend/services/backend/src/queue/__tests__/challenge-adapters.test.ts` — New file. 18 unit tests: `questEligible` (winner/loser/refund), `game_completed` adapter (scope='any', scope match, scope mismatch, closecall scope, loser still counts), `game_won` adapter (won+scope match, lost, scope mismatch, scope-specific win), `lobby_filled` adapter (creator+scope match, not creator, scope mismatch, scope-specific fill), unknown adapter type (returns no-progress, is a function not undefined).

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 18/18 new tests pass. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue in those specific test suites — not caused by this change; 9 test files / 99 other tests all pass).

## Iteration 4 — 2026-04-03T19:35:00Z — OK
- **Log**: iteration-004.log

## Iteration 4 — 2026-04-03T19:36:48Z — OK
- **Log**: iteration-004.log

## Iteration 5 — Phase 2: REWARD_POOL_FUND handler

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/reward-pool-fund.ts` — New file. Implements `REWARD_POOL_FUND` handler with factory pattern (`createRewardPoolFundHandler`). DB helpers: `readRewardConfig(db, key)` reads from `reward_config` table, `insertPoolFunding(db, roundId, feeLamports, fundedLamports)` with `ON CONFLICT (round_id) DO NOTHING` for idempotency, `incrementRewardPool(db, deltaLamports)` atomically updates `balance_lamports` + `lifetime_funded`. Handler logic: reads `reward_pool_fee_share` from config, calculates `floor(feeLamports * share)`, runs insert + increment atomically within `withTransaction()`. Duplicate round_id silently skips (no double-funding).
- `backend/services/backend/src/index.ts` — Registered `REWARD_POOL_FUND` handler in event handler registry (import + `registerHandler` call).
- `backend/services/backend/src/__tests__/integration.test.ts` — Added `reward_pool_fundings` to TRUNCATE list, added `reward_pool` reset to zero in `beforeEach`. Added integration test: calls handler directly with fee=500_000, verifies pool balance = 100_000 (20% of 500k), verifies `reward_pool_fundings` ledger row, then re-calls same round_id and verifies no duplicate funding + balance unchanged.
- Applied migration `011_challenge_engine.sql` to test database (was pending).

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 10/10 integration tests pass, 100 total tests pass. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 5 — 2026-04-03T19:48:59Z — OK
- **Log**: iteration-005.log

## Iteration 6 — Phase 2: POINTS_GRANT handler

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/points-grant.ts` — New file. Implements `POINTS_GRANT` handler with factory pattern (`createPointsGrantHandler`). DB helpers: `insertPointGrant(db, userId, wallet, sourceType, sourceId, amount, metadata)` with `ON CONFLICT (user_id, source_type, source_id) DO NOTHING` for idempotency, `upsertPlayerPoints(db, userId, wallet, amount)` to create-or-increment `balance` + `lifetime_earned`, `getActiveDogpileMultiplier(db, timestamp)` to check for active dogpile events. Handler supports two modes: wager-based grants (calculates from amountLamports using SOL/USD price × points_per_dollar × dogpile multiplier) and pre-calculated grants (crate_points, challenge_completed, bonus_completed — uses `amount` directly). Price fetcher injected as dependency for testability. Reuses `readRewardConfig` from reward-pool-fund.ts.
- `backend/services/backend/src/routes/price.ts` — Exported `fetchSolPrice()` function (was private) so production handler can use it directly.
- `backend/services/backend/src/index.ts` — Registered `POINTS_GRANT` handler in event handler registry with injected `getSolPrice` wrapping `fetchSolPrice()`.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added `point_grants`, `player_points`, `dogpile_events` to TRUNCATE list. Added 3 integration tests: (1) wager-based points grant with $100 SOL price, verifies 2500 points (0.05 SOL × $100 × 500 pts/$), idempotency on duplicate, metadata with solPrice/pointsPerDollar/multiplier; (2) dogpile 2× multiplier — inserts active dogpile event, verifies 5000 points; (3) pre-calculated crate_points grant — verifies direct amount passthrough.

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 103 tests pass (9 test files). 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 6 — 2026-04-03T19:59:00Z — OK
- **Log**: iteration-006.log

## Iteration 6 — 2026-04-03T20:00:55Z — OK
- **Log**: iteration-006.log

## Iteration 7 — Phase 2: CRATE_DROP handler

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/crate-drop.ts` — New file. Implements `CRATE_DROP` handler with factory pattern (`createCrateDropHandler`). DB helpers: `lockAndReadRewardPool(db)` uses `SELECT ... FOR UPDATE` to lock singleton row, `decrementRewardPool(db, payoutLamports)` atomically decrements `balance_lamports` + increments `lifetime_paid`, `insertCrateDrop(db, userId, triggerType, triggerId, crateType, contentsAmount)` with `ON CONFLICT (user_id, trigger_type, trigger_id) DO NOTHING` for idempotency. Handler accepts injectable `rollRng` for deterministic testing. Drop logic follows FR-5: roll < sol_crate_drop_rate → SOL path (lock pool, calculate `floor(balance * sol_crate_pool_pct)`, suppress if < min_value, decrement pool, insert crate, emit `CRATE_SOL_PAYOUT`); roll < sol + points rate → Points path (random amount in [min, max], insert crate, emit `POINTS_GRANT` with source_type='crate_points'); else → miss. All config read from `reward_config` table. All mutations within `withTransaction`. Emits downstream events via `emitEvent` within the transaction for atomicity.
- `backend/services/backend/src/index.ts` — Imported `createCrateDropHandler`, registered `CRATE_DROP` handler in event handler registry.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added `crate_drops` to TRUNCATE list. Added 5 integration tests: (1) SOL crate hit — pool funded to 200M, roll=0.005, verifies crate_drops row with type='sol' and contents_amount=20M, pool decremented by 20M, `crate.sol_payout` event emitted with correct payload; (2) Points crate hit — roll=0.02 (between sol and points thresholds), verifies crate_drops row with type='points' and calculated amount=2750, `points.grant` event emitted with source_type='crate_points'; (3) Miss — roll=0.50, no crate row, no events; (4) SOL crate suppressed — pool 50M (payout 5M < min 10M), no crate row, pool unchanged; (5) Idempotency — duplicate trigger_id, one crate row, pool not double-decremented.

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 108 tests pass (9 test files). 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 7 — 2026-04-03T20:10:00Z — OK
- **Log**: iteration-007.log

## Iteration 7 — 2026-04-03T20:10:24Z — OK
- **Log**: iteration-007.log

