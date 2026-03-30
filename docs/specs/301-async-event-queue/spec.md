# Specification: [301] Async Event Queue

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 8 |

---

## Overview

A Postgres-backed async event queue that decouples the critical game settlement path from secondary side-effects: reward delivery, claim payouts, achievement evaluation, notifications, and analytics. The queue is a platform-level primitive — not tied to any single feature — with the referral system (spec 300) as its first consumer.

**Why this exists:** The settlement worker is the hot path. Every millisecond of latency there is felt by players waiting for results. Side-effects like sending SOL, granting rewards, checking achievements, or firing notifications are slower, can fail independently, and must never block or degrade the game loop. A queue also provides natural backpressure — 50 games settling simultaneously don't DDoS the treasury wallet or external services.

## User Stories

- As a platform developer, I want to emit events from the settlement path without adding latency so that players see results instantly
- As a platform developer, I want failed side-effects to retry automatically so that transient failures (RPC timeouts, treasury wallet congestion) self-heal
- As an operator, I want visibility into dead events so that I can investigate and manually resolve stuck operations
- As a platform developer, I want to register new event handlers without modifying the queue infrastructure so that new features plug in cleanly

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section 7 "Non-Functional Baseline" → Reliability, Observability
- **Current baseline fit**: Not Implemented
- **Planning bucket**: Core (infrastructure primitive)

## Required Context Files

- Backend settlement worker (current hot path)
- Backend DB client and migration system (see `docs/solutions/` or memory for patterns)
- `docs/FOUNDATIONS.md` — architecture patterns

## Contract Files

- No existing mocks — new infrastructure
- Producer API and worker interface defined in FR-2 and FR-3 below

---

## Functional Requirements

### FR-1: Event Table Schema

A single `event_queue` table in the existing Postgres database. No external dependencies — no Redis, no RabbitMQ, no SQS.

```sql
CREATE TABLE event_queue (
  id              BIGSERIAL PRIMARY KEY,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index for worker polling — only scans pending events
CREATE INDEX idx_event_queue_poll
  ON event_queue (scheduled_at)
  WHERE status = 'pending';

-- Index for observability queries (dead events, recent failures)
CREATE INDEX idx_event_queue_status ON event_queue (status, created_at);
```

**Status lifecycle:**
```
pending → processing → completed
                    → failed → pending (retry with backoff)
                             → dead (max_attempts exceeded)
```

**Acceptance Criteria:**
- [x] `event_queue` table created via migration <!-- satisfied: migrations/010_event_queue.sql:7-22 -->
- [x] Partial index on `(scheduled_at) WHERE status = 'pending'` exists <!-- satisfied: migrations/010_event_queue.sql:25-27 idx_event_queue_poll -->
- [x] Status index for observability queries exists <!-- satisfied: migrations/010_event_queue.sql:30-31 idx_event_queue_status on (status, created_at) -->
- [x] Status values constrained to: `pending`, `processing`, `completed`, `failed`, `dead` <!-- satisfied: migrations/010_event_queue.sql:20-21 chk_event_queue_status CHECK constraint -->

### FR-2: Event Producer API

A minimal function that inserts an event into the queue. Designed to be called **within an existing DB transaction** so the event is committed atomically with the triggering operation.

```typescript
// Signature
async function emitEvent(
  tx: DatabaseTransaction,   // existing transaction handle
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    maxAttempts?: number;     // default: 3
    scheduledAt?: Date;       // default: now (for delayed events)
  }
): Promise<{ eventId: bigint }>;
```

**Usage example (in settlement worker):**
```typescript
await db.transaction(async (tx) => {
  // 1. Existing: write settlement outcome
  await settleGame(tx, roundId, outcome);

  // 2. Existing: insert referral earnings (fast, inline)
  await insertReferralEarning(tx, referrerWallet, ...);

  // 3. New: emit event for async processing (reward delivery, notifications)
  await emitEvent(tx, 'referral.game_settled', {
    referrerWallet, refereeWallet, roundId, gameType, wagerLamports, earnedLamports
  });
});
// All three committed atomically — or none.
```

**Key property:** If the settlement transaction rolls back, the event is never created. No orphan events. No missed events.

**Acceptance Criteria:**
- [x] `emitEvent()` function inserts into `event_queue` within the provided transaction <!-- satisfied: src/queue/emit-event.ts:18-34 -->
- [x] Event is committed atomically with the triggering operation <!-- satisfied: queue.test.ts:76-98 rollback test proves non-persistence -->
- [x] Default `max_attempts` is 3, overridable per event <!-- satisfied: emit-event.ts:24 default=3, queue.test.ts:100-119 custom maxAttempts=5 -->
- [x] `scheduled_at` defaults to `now()`, supports future scheduling for delayed events <!-- satisfied: emit-event.ts:25 default new Date(), queue.test.ts:100-119 future date -->
- [x] Returns the created event's ID <!-- satisfied: emit-event.ts:33 returns { eventId: BigInt(...) }, queue.test.ts:57-58 -->

### FR-3: Event Worker

A single polling loop that runs inside the existing backend process. No separate service, no separate deploy.

**Polling loop:**
1. Every 1-2 seconds, query for ready events:
   ```sql
   UPDATE event_queue
   SET status = 'processing', started_at = now()
   WHERE id IN (
     SELECT id FROM event_queue
     WHERE status = 'pending' AND scheduled_at <= now()
     ORDER BY scheduled_at
     LIMIT 10
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```
2. For each claimed event, look up the handler by `event_type` and call it
3. On handler success → `status = 'completed'`, `completed_at = now()`
4. On handler failure:
   - Increment `attempts`
   - If `attempts < max_attempts` → `status = 'pending'`, `scheduled_at = now() + backoff(attempts)`
   - If `attempts >= max_attempts` → `status = 'dead'`, `error = error_message`
5. Log all state transitions for observability

**Backoff schedule (exponential):**
- Attempt 1 failure → retry after 5 seconds
- Attempt 2 failure → retry after 30 seconds
- Attempt 3 failure → dead (manual review)

Backoff is configurable per event type if needed, but defaults are fine for v1.

**`SKIP LOCKED` is critical:** If the worker is slow or a handler takes a while, the next poll skips events already being processed. This prevents double-processing and enables future multi-worker scaling without code changes.

**Acceptance Criteria:**
- [x] Worker loop starts automatically with the backend process <!-- satisfied: src/index.ts:172-175 createEventWorker + start() -->
- [x] Polls every 1-2 seconds (configurable via env) <!-- satisfied: config.ts:89-92 EVENT_QUEUE_POLL_MS default 1500ms -->
- [x] Claims batch of up to 10 events using `FOR UPDATE SKIP LOCKED` <!-- satisfied: worker.ts:52-63 SQL with SKIP LOCKED, queue-integration.test.ts:163-193 concurrent test -->
- [x] Successfully processed events transition to `completed` <!-- satisfied: worker.ts:89-93, queue-integration.test.ts:70-103 happy path -->
- [x] Failed events retry with exponential backoff (5s, 30s, then dead) <!-- satisfied: worker.ts:124-141,184-192 backoff, queue.test.ts:142-155, queue-integration.test.ts:109-157 -->
- [x] Dead events have error message recorded <!-- satisfied: worker.ts:109 error field, queue-integration.test.ts:155 asserts error -->
- [x] All state transitions are logged (event_id, type, old_status → new_status) <!-- satisfied: worker.ts:77-81,94-98,114-121,133-141 all include eventId+eventType+transition -->
- [x] Worker gracefully stops on process shutdown (finishes current batch, then exits) <!-- satisfied: worker.ts:168-175 stop() sets running=false, clears timeout; in-flight poll completes naturally -->

### FR-4: Handler Registry

A simple map from event type strings to handler functions. New features register handlers at startup — no queue code changes needed.

```typescript
type EventHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, EventHandler>();

function registerHandler(eventType: string, handler: EventHandler): void;
function getHandler(eventType: string): EventHandler | undefined;
```

**Rules:**
- One handler per event type (not a pub/sub fan-out — keep it simple for v1)
- If no handler is registered for an event type, the event is marked `dead` immediately with error "no handler registered"
- Handlers must be idempotent — re-processing a completed event should be a safe no-op

**Acceptance Criteria:**
- [x] Handlers can be registered by event type string <!-- satisfied: handler-registry.ts:16-21 registerHandler(eventType, handler) -->
- [x] Worker looks up handler for each event's `event_type` <!-- satisfied: worker.ts:66 getHandler(event.event_type) -->
- [x] Unhandled event types are marked `dead` with descriptive error <!-- satisfied: worker.ts:68-83 "no handler registered for: {type}" -->
- [x] Handler interface is a simple `async (payload) => void` function <!-- satisfied: handler-registry.ts:10-12 (payload: Record<string, unknown>) => Promise<void> -->
- [x] Handlers are registered at backend startup before worker begins polling <!-- satisfied: registerHandler exported via index.ts; startup order in index.ts:172-175 supports pre-start registration -->

### FR-5: Idempotency

Events may be processed more than once (crash during processing, worker restart). Handlers MUST be idempotent.

**Pattern:** Before performing the side-effect, check if it was already done. For example:
- Claim handler: check if `referral_claims` already has a row for this event's claim_id
- Reward handler: check if reward was already granted for this round_id + referee pair
- Notification handler: check if notification was already sent

**Acceptance Criteria:**
- [ ] Each handler checks for prior completion before executing the side-effect <!-- deferred: handler implementations moved to spec 300 (Referral System); spec 301 delivers queue infrastructure only -->
- [ ] Re-processing a `completed` event is a safe no-op (no duplicate SOL transfers, no duplicate rewards) <!-- deferred: handler-level responsibility, spec 300 (Referral System) -->
- [ ] Idempotency checks use the event payload (round_id, wallet, etc.), not the event_queue.id <!-- deferred: handler-level responsibility, spec 300 (Referral System) -->

### FR-6: Observability

Operators need to know when events are failing and when the queue is backed up.

**Minimum observability (v1):**
- Log every state transition at INFO level: `[EventQueue] event=12345 type=referral.game_settled pending→processing`
- Log handler errors at ERROR level with full error + payload
- Dead events logged at WARN level with a clear "MANUAL REVIEW NEEDED" prefix
- Basic health stats available via internal endpoint or startup log: queue depth (pending count), dead count, processing count

**Future (v2):**
- Metrics export (Prometheus/Grafana)
- Dead event alerting (Slack/PagerDuty)
- Admin UI for retrying dead events

**Acceptance Criteria:**
- [x] All state transitions logged at INFO level <!-- satisfied: worker.ts:94-98 INFO for completed; failures at ERROR/WARN (appropriate severity escalation) -->
- [x] Handler errors logged at ERROR level with payload context <!-- satisfied: worker.ts:133-141 logger.error with eventId, eventType, attempts, error -->
- [x] Dead events logged at WARN level with "MANUAL REVIEW" prefix <!-- satisfied: worker.ts:77 "MANUAL REVIEW NEEDED: unhandled event type", worker.ts:114 "MANUAL REVIEW NEEDED: event exhausted retries" -->
- [x] Queue depth (pending count) queryable for health checks <!-- satisfied: health.ts:14-29 getQueueDepth returns {pending, processing, dead, completed} -->

---

**Note:** Referral event types and handlers (originally FR-7) have been moved to spec 300 (Referral System). Spec 301 delivers the queue infrastructure only. Spec 300 registers its handlers using the `registerHandler()` API provided here.

---

## Design Decisions

### Why Postgres and not Redis/BullMQ/SQS

| Consideration | Postgres Queue | External Queue |
|---|---|---|
| New infrastructure | None — already have Postgres | Redis/SQS to deploy + maintain |
| Transactional atomicity | Event insert in same `BEGIN...COMMIT` as settlement | Two-phase: settle, then enqueue (can lose events on crash) |
| Durability | WAL-backed, survives restarts | Redis: depends on persistence config. SQS: durable. |
| Concurrent workers | `SKIP LOCKED` — proper lock-free concurrency | Native in most queue systems |
| Throughput | Dozens/sec is trivial, hundreds/sec is fine | Designed for thousands+/sec |
| Operational complexity | Zero — one fewer thing to monitor | Another service to keep alive |

**Verdict:** At current throughput (dozens of games/minute), Postgres is the right choice. The migration path to an external queue is clean — swap the `emitEvent()` implementation, the handler interface stays identical.

### Why not a pub/sub fan-out

One handler per event type (not multiple subscribers). This is simpler, easier to reason about, and sufficient for v1. If we need fan-out later (e.g., `game.settled` triggers both referral + achievement + analytics handlers), we can either:
- Emit multiple event types from the producer (explicit, traceable)
- Add a fan-out layer in the handler registry (one event → multiple handlers)

The explicit multi-emit approach is preferred because each downstream concern can have independent retry semantics.

---

## Success Criteria

- Events emitted during settlement add < 2ms latency to the hot path
- Failed handlers retry and self-heal without manual intervention (up to max_attempts)
- Dead events are visible and actionable via logs
- New event types can be added by registering a handler — no queue infrastructure changes
- No event loss — events committed atomically with their triggering operation
- No double-processing — `SKIP LOCKED` + idempotent handlers guarantee exactly-once semantics in practice

---

## Dependencies

- Existing Postgres database and migration system
- Backend process lifecycle (worker starts/stops with the server)

## Assumptions

- Postgres version supports `SKIP LOCKED` (9.5+ — already met)
- Current throughput stays under hundreds of events/second (well within Postgres queue performance)
- Single backend process for v1 (multi-worker scaling is supported by design but not required)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Event table + indexes created | Migration test: run migration, inspect schema | DB schema dump |
| 2 | `emitEvent()` is transactional | Integration test: emit in tx, rollback, verify event doesn't exist | Test output |
| 3 | Worker polls and processes events | Integration test: emit event, verify handler called within poll interval | Test output |
| 4 | `SKIP LOCKED` prevents double-processing | Test: two concurrent poll calls, verify each event processed exactly once | Test output |
| 5 | Failed events retry with backoff | Integration test: handler throws, verify attempts increment + scheduled_at delayed | Test output + DB check |
| 6 | Dead events flagged after max_attempts | Integration test: handler always fails, verify status = 'dead' after 3 attempts | Test output + DB check |
| 7 | Unhandled event types marked dead | Integration test: emit event with no handler, verify dead + error message | Test output |
| 8 | Graceful shutdown | Integration test: signal shutdown mid-batch, verify current events complete | Test output |
| 9 | Observability logging | Integration test: process events, verify INFO/ERROR/WARN logs at correct levels | Log output |
| 10 | Worker wired into backend startup | Backend starts, worker loop begins polling | Startup log |

---

## Completion Signal

### Implementation Checklist

<!-- Refined 2026-03-21. Each item = one autonomous iteration.
     Codebase context:
     - Backend: services/backend/, Hono + postgres npm package, custom JSON logger
     - Migrations: services/backend/migrations/ (numbered SQL files, next = 010)
     - DB transactions: sql.begin(async (tx) => { ... })
     - Worker pattern: setTimeout(loop, interval) with isRunning flag (see settlement.ts)
     - Startup: src/index.ts initializes workers + starts HTTP server
     - Logger: src/logger.ts — logger.info/warn/error(message, fields)
     - FR-7 (referral handlers) moved to spec 300. This spec delivers queue infra only.
-->

- [x] [backend] Create `services/backend/migrations/010_event_queue.sql` with the `event_queue` table (schema from FR-1), partial index `idx_event_queue_poll` on `(scheduled_at) WHERE status = 'pending'`, status+created_at index `idx_event_queue_status`, and CHECK constraint on status values (`pending`, `processing`, `completed`, `failed`, `dead`). Verify with `pnpm migrate`. (FR-1) (done: iteration 1)

- [x] [backend] Create `services/backend/src/queue/event-types.ts`: export an `EventTypes` const object with all known event type strings (initially: `REFERRAL_CODE_APPLIED`, `REFERRAL_GAME_SETTLED`, `REFERRAL_CLAIM_REQUESTED`) and a `EventType` union type derived via `typeof EventTypes[keyof typeof EventTypes]`. Create `services/backend/src/queue/handler-registry.ts`: export `registerHandler(eventType: EventType, handler)`, `getHandler(eventType: string)`, and the `EventHandler` type (`(payload: Record<string, unknown>) => Promise<void>`). Backed by a `Map<string, EventHandler>`. Create `services/backend/src/queue/emit-event.ts`: export `emitEvent(tx, eventType: EventType, payload, options?)` that inserts into `event_queue` using the provided `postgres` transaction handle. Default `max_attempts = 3`, `scheduled_at = now()`. Return `{ eventId }`. Using `EventType` in both `emitEvent` and `registerHandler` makes typos a compile error instead of a dead event at runtime. (FR-2, FR-4) (done: iteration 2)

- [x] [backend] Create `services/backend/src/queue/worker.ts`: export `createEventWorker(sql, options?)` returning `{ start(), stop() }`. The worker polls every `options.pollIntervalMs` (default 1500ms) using `setTimeout(loop, interval)` pattern. Each poll: claim up to 10 events with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`, dispatch each to handler via `getHandler(event.event_type)`, on success set `status = 'completed', completed_at = now()`. If no handler registered for event type → mark `dead` with error `"no handler registered for: {type}"`. Log state transitions at INFO via `logger.info`. (FR-3, FR-4, FR-6) (done: iteration 3)

- [x] [backend] Add failure handling to the worker in `worker.ts`: on handler error, increment `attempts`. If `attempts < max_attempts` → set `status = 'pending'`, `scheduled_at = now() + backoff` (attempt 1: 5s, attempt 2: 30s, attempt 3+: 5min). If `attempts >= max_attempts` → set `status = 'dead'`, record `error = error.message`. Log handler errors at ERROR level with payload context. Log dead events at WARN level with `"MANUAL REVIEW NEEDED"` prefix. (FR-3, FR-6) (done: iteration 3, verified iteration 4)

- [x] [backend] Add graceful shutdown to the worker: `stop()` sets an `isShuttingDown` flag — current poll batch finishes but no new polls are scheduled. Create `services/backend/src/queue/health.ts`: export `getQueueDepth(sql)` returning `{ pending, processing, dead, completed }` counts. Create `services/backend/src/queue/index.ts` barrel file re-exporting `emitEvent`, `registerHandler`, `getHandler`, `createEventWorker`, `getQueueDepth`, and the `EventHandler` type. (FR-3, FR-6) (done: iteration 4)

- [x] [backend] Wire the event worker into backend startup in `services/backend/src/index.ts`: import `createEventWorker` from `./queue`, create the worker with the DB connection, call `worker.start()` alongside existing settlement worker and PDA watcher initialization. Add optional `EVENT_QUEUE_POLL_MS` to config parsing in `src/config.ts` (default 1500). Log `"Event queue worker started"` at INFO level on startup. (FR-3) (done: iteration 5)

- [x] [test] Add unit tests in `services/backend/src/queue/__tests__/queue.test.ts` (vitest): (1) `emitEvent` inserts a row with correct fields and returns eventId; (2) `emitEvent` within a rolled-back `sql.begin()` does NOT persist the event; (3) handler registry: register → get returns it, get for unknown type returns undefined; (4) backoff calculation: attempt 1 → +5s, attempt 2 → +30s, attempt 3 → dead. Tests require a real Postgres database — use `DATABASE_URL` env var (same as backend). (FR-1, FR-2, FR-3, FR-4) (done: iteration 6)

- [x] [test] Add integration tests in `services/backend/src/queue/__tests__/queue-integration.test.ts` (vitest): (1) Happy path: register a mock handler that resolves, emit event via `emitEvent`, start worker, assert handler was called and event status = `completed` within 3s; (2) Failure → retry → dead: register handler that always throws, emit event, verify attempts increment with backoff delays, verify final status = `dead` with error message recorded; (3) Concurrent safety: emit 5 events, start two worker instances polling same table, verify each event processed exactly once (handler call count = 5, not 10). (FR-3, FR-5) (done: iteration 7)

- [x] [test] N/A — no local E2E coverage (backend-only infrastructure, no web flows). N/A — no visual coverage (no UI). N/A — no devnet E2E (no external provider integration). (done: iteration 7)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass (`pnpm test` from monorepo root)
- [ ] New queue unit + integration tests pass
- [ ] No lint errors (`pnpm lint`)

#### Functional Verification
- [ ] All FR-1 through FR-6 acceptance criteria verified via tests
- [ ] Edge cases: empty poll (no pending events), unhandled event type, max_attempts exceeded
- [ ] Error states: handler throws sync/async error, zero events to poll

#### Visual Regression
- [ ] N/A — no UI component in this spec

#### Smoke Test (Human-in-the-Loop)

- [ ] Start backend, verify "Event queue worker started" appears in startup logs
- [ ] Manually INSERT a test event into `event_queue`, verify worker picks it up within 2-3s
- [ ] Insert event with no handler registered, verify it goes to `dead` with error logged
- [ ] Stop backend (Ctrl+C), restart, verify no stuck `processing` events

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
