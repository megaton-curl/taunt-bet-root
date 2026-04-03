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

