# Implementation History — 301-async-event-queue

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Migration: `010_event_queue.sql`

- Created `services/backend/migrations/010_event_queue.sql`
- Table: `event_queue` with all FR-1 columns (id, event_type, payload, status, attempts, max_attempts, scheduled_at, started_at, completed_at, error, created_at)
- Partial index `idx_event_queue_poll` on `(scheduled_at) WHERE status = 'pending'`
- Index `idx_event_queue_status` on `(status, created_at)`
- CHECK constraint `chk_event_queue_status` restricts status to: pending, processing, completed, failed, dead
- Verified: SQL executed successfully via psql, constraint tested with invalid status (correctly rejected)
- Lint: all 18 tasks passed
- Note: `pnpm migrate` requires TCP connection but dev Postgres only listens on Unix socket; SQL verified directly via psql instead

## Iteration 1 — 2026-03-21T13:06:48Z — OK
- **Log**: iteration-001.log

## Iteration 2 — Event types, handler registry, and emit-event

- Created `services/backend/src/queue/event-types.ts`:
  - `EventTypes` const object with `REFERRAL_CODE_APPLIED`, `REFERRAL_GAME_SETTLED`, `REFERRAL_CLAIM_REQUESTED`
  - `EventType` union type derived via `typeof EventTypes[keyof typeof EventTypes]`
- Created `services/backend/src/queue/handler-registry.ts`:
  - `registerHandler(eventType: EventType, handler)` — registers into a `Map`
  - `getHandler(eventType: string)` — returns handler or undefined
  - `EventHandler` type: `(payload: Record<string, unknown>) => Promise<void>`
- Created `services/backend/src/queue/emit-event.ts`:
  - `emitEvent(tx, eventType, payload, options?)` — inserts into `event_queue` within transaction
  - Uses `postgres.Sql` as tx type (TransactionSql loses call signatures through Omit in TS)
  - Casts payload via `as postgres.JSONValue` (same pattern as `db.ts:408`)
  - Default `max_attempts = 3`, `scheduled_at = now()`, returns `{ eventId: bigint }`
- Verified: backend lint + typecheck pass cleanly

## Iteration 2 — 2026-03-21T13:15:57Z — OK
- **Log**: iteration-002.log

## Iteration 3 — Event queue worker (`worker.ts`)

- Created `services/backend/src/queue/worker.ts`
- `createEventWorker(sql, options?)` returns `{ start(), stop(), isRunning, poll() }`
- Follows settlement worker pattern: `setTimeout(loop, interval)` with `running` flag
- Poll cycle: claims up to 10 events via `UPDATE ... FOR UPDATE SKIP LOCKED RETURNING *`
- Dispatches each event to handler via `getHandler(event.event_type)`
- Success → `status = 'completed'`, logged at INFO
- No handler → `status = 'dead'` with `"no handler registered for: {type}"`, logged at WARN with MANUAL REVIEW prefix
- Handler failure → retry with exponential backoff (5s, 30s, 300s) or `dead` if max_attempts reached
- Exported `getBackoffSeconds()` for testability
- Verified: lint (18/18) + typecheck (18/18) pass cleanly
- Note: Also implemented failure handling (checklist item 4 scope) since it's integral to the worker loop

## Iteration 3 — 2026-03-21T13:21:06Z — OK
- **Log**: iteration-003.log

## Iteration 4 — Failure handling verification + graceful shutdown, health, barrel

- Verified checklist item 4 (failure handling) was already fully implemented in iteration 3:
  - Handler errors increment attempts, retry with backoff (5s, 30s, 300s) or mark dead
  - ERROR logging for handler failures with payload context
  - WARN logging with "MANUAL REVIEW NEEDED" prefix for dead events
  - Checked off item 4
- Created `services/backend/src/queue/health.ts`:
  - `getQueueDepth(sql)` returns `{ pending, processing, dead, completed }` counts via GROUP BY query
- Created `services/backend/src/queue/index.ts` barrel file:
  - Re-exports: `emitEvent`, `EventTypes`, `EventType`, `registerHandler`, `getHandler`, `EventHandler`, `createEventWorker`, `getBackoffSeconds`, `EventWorker`, `EventWorkerOptions`, `getQueueDepth`, `QueueDepth`
- Graceful shutdown already correct in worker.ts: `stop()` sets `running = false`, current poll batch finishes via async completion, `if (running)` check prevents new polls
- Verified: lint (18/18) + typecheck (18/18) pass

## Iteration 4 — 2026-03-21T13:24:02Z — OK
- **Log**: iteration-004.log

## Iteration 5 — Wire event worker into backend startup

- Added `eventQueuePollMs` to `Config` interface and `loadConfig()` in `src/config.ts`
  - Reads from `EVENT_QUEUE_POLL_MS` env var, defaults to 1500ms
- Wired event worker into `src/index.ts`:
  - Imported `createEventWorker` from `./queue/index.js`
  - Created worker with `sql` connection and `config.eventQueuePollMs`
  - Called `eventWorker.start()` after closeCallClock, before route registration
  - Logged `"Event queue worker started"` at INFO level with pollIntervalMs field
- Verified: lint (18/18) + typecheck (18/18) pass


## Iteration 5 — 2026-03-21T13:26:12Z — OK
- **Log**: iteration-005.log

## Iteration 6 — Queue unit tests

- Created `services/backend/src/queue/__tests__/queue.test.ts` with 8 tests:
  - `emitEvent` inserts a row with correct fields (event_type, payload, status, attempts, max_attempts, scheduled_at, created_at) and returns eventId as bigint
  - `emitEvent` within a rolled-back `sql.begin()` does NOT persist the event (transactional atomicity)
  - `emitEvent` respects custom `maxAttempts` and `scheduledAt` options
  - Handler registry: `registerHandler` → `getHandler` returns the registered handler
  - Handler registry: `getHandler` for unknown type returns `undefined`
  - Backoff: attempt 1 → 5s, attempt 2 → 30s, attempt 3+ → 300s
- Applied `010_event_queue.sql` migration to test database (table didn't exist yet)
- Used Unix socket connection (`/var/run/postgresql`) because Postgres only listens on Unix socket (TCP `localhost:5432` refused)
- Verified: all 8 tests pass, lint (18/18) + typecheck (18/18) pass
- Pre-existing test failures (3 files: endpoints, integration, auth-routes) are unrelated — they use hardcoded TCP URL


## Iteration 6 — 2026-03-21T13:33:17Z — OK
- **Log**: iteration-006.log

## Iteration 7 — Queue integration tests

- Created `services/backend/src/queue/__tests__/queue-integration.test.ts` with 3 tests:
  - Happy path: register handler, emit event, start worker with 100ms poll, assert handler called + event status = `completed` within 3s
  - Failure → retry → dead: handler always throws, poll 3 times (resetting `scheduled_at` between attempts), verify attempts increment 1→2→3 and final status = `dead` with error recorded
  - Concurrent safety: emit 5 events, create two workers, `Promise.all([poll(), poll()])`, verify `callCount = 5` and all events `completed` (SKIP LOCKED prevents double-processing)
- Added `clearHandlers()` to `handler-registry.ts` for test isolation between test cases
- Re-exported `clearHandlers` from barrel `index.ts`
- Verified: all 3 integration tests pass, all 8 unit tests still pass, lint + typecheck clean

## Iteration 7 (completion) — Full verification

- All 9 implementation checklist items completed across iterations 1-7
- Full verification results:
  - Lint: 18/18 packages pass
  - Typecheck: 18/18 packages pass
  - Build: platform builds successfully
  - Backend tests: 8 files, 60 tests pass (including 8 queue unit + 3 queue integration tests)
  - Game-engine tests: 65 tests pass (pre-existing turbo+sandbox TMPDIR issue causes failure only when run via turbo in Claude sandbox — not a code issue)
- Spec status updated to `Done`

## Iteration 7 — 2026-03-21T21:24:25Z — OK
- **Log**: iteration-007.log

## Iteration 8 — 2026-03-21T21:29:29Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-008.log

## Gap Analysis (backfill) — 2026-03-21T21:34:33Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

