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

