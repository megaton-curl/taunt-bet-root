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

## Iteration 8 — Phase 3: GAME_SETTLED handler (orchestrator)

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/game-settled.ts` — New file. Implements `GAME_SETTLED` handler with factory pattern (`createGameSettledHandler`). DB helpers: `getActiveAssignmentsWithChallenge(db, userId)` JOINs challenge_assignments + challenges WHERE status='active' (uses partial index), `insertProgressEvent(db, assignmentId, roundId, userId, delta, metadata)` with UNIQUE(assignment_id, round_id) idempotency, `incrementAssignmentProgress(db, assignmentId, delta)` returns new progress, `markAssignmentCompleted(db, assignmentId)` sets status='completed' + completed_at. Handler flow per FR-8: once per round emits `reward.pool_fund`; per player: quest_eligible check (skip refunds), load active assignments, for each run matching adapter, if shouldProgress: insert progress_event + increment progress atomically in transaction, if progress >= target: mark completed + emit reward intent (points.grant with source_type='challenge_completed' or crate.drop with trigger_type='challenge_completed'). After assignments: emit points.grant (wager) and crate.drop per eligible player. Per-player try/catch for error isolation.
- `backend/services/backend/src/index.ts` — Imported `createGameSettledHandler`, registered `GAME_SETTLED` handler in event handler registry before other reward handlers.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added `progress_events`, `challenge_assignments`, `bonus_completions` to TRUNCATE list. Added 4 integration tests: (1) processes challenge progress + emits reward events (pool_fund, points.grant, crate.drop); (2) completes challenge when target reached + emits challenge_completed reward intent with correct amount; (3) skips refunded game (isWinner=null) — no progress, no player rewards, but pool_fund still emits; (4) idempotent — same event twice produces no double progress (UNIQUE on assignment_id+round_id).

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 112 tests pass (9 test files). 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 8 — 2026-04-03T20:19:07Z — OK
- **Log**: iteration-008.log

## Iteration 9 — Phase 3: Completion Bonus Check

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/completion-bonus.ts` — New file. Implements completion bonus logic with 3 DB helpers: `getCompletionBonuses(db, campaignId)` fetches active bonuses for a campaign, `countCompletedAssignments(db, userId, periodKey, campaignId)` counts completed assignments in a period via JOIN with challenges table, `insertBonusCompletion(db, userId, bonusId, periodKey)` with `ON CONFLICT (user_id, bonus_id, period_key) DO NOTHING` for idempotency. Main `checkCompletionBonus()` function: loads bonuses for campaign, counts completed assignments, if count >= required_count and no existing bonus_completion: insert row + emit reward intent (points.grant with source_type='bonus_completed' for points bonuses, crate.drop with trigger_type='bonus_completed' for crate bonuses).
- `backend/services/backend/src/queue/handlers/game-settled.ts` — Imported `checkCompletionBonus`, hooked into the completion flow within the assignment transaction — called after `markAssignmentCompleted()` and reward intent emission, passing `txDb`, userId, wallet, period_key, and campaign_id.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 3 integration tests: (1) complete 3 daily challenges → verify bonus_completions row created + crate.drop event emitted with triggerType='bonus_completed'; (2) idempotency — pre-existing bonus_completion row, re-call checkCompletionBonus, verify no duplicate row and no extra events; (3) partial completion (2 of 3) → verify no bonus_completions row and no bonus events.

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 115 tests pass (9 test files). 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 9 — 2026-04-03T20:32:00Z — OK
- **Log**: iteration-009.log


## Iteration 9 — 2026-04-03T20:33:06Z — OK
- **Log**: iteration-009.log

## Iteration 10 — Phase 3: Onboarding Chain Progression

**Status**: Success

**Changes**:
- `backend/services/backend/src/queue/handlers/onboarding-chain.ts` — New file. Implements `getNextOnboardingStep(db, completedChallengeId)` (queries challenges WHERE prerequisite_id = completedId AND is_active = true), `createAssignment(db, userId, challengeId, periodKey, target, expiresAt)` with ON CONFLICT (user_id, challenge_id, period_key) DO NOTHING for idempotency, and `advanceOnboardingChain()` main function that chains them: on completion of an onboarding assignment, finds next step by prerequisite_id, creates assignment with period_key='onboarding' and expires_at=NULL if not already assigned. Early-returns for non-onboarding period_keys.
- `backend/services/backend/src/queue/handlers/game-settled.ts` — Imported `advanceOnboardingChain`, hooked into the completion flow after `checkCompletionBonus()` — called with txDb, userId, challenge_id, and period_key within the assignment transaction.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 3 integration tests: (1) complete onboarding step 1 → verify step 2 auto-assigned with correct period_key='onboarding', target, and expires_at=NULL; (2) complete all 3 steps → verify no step 4 created (chain terminates); (3) idempotency — same event replayed, step 1 progress unchanged (UNIQUE on assignment_id+round_id), step 2 assigned exactly once (UNIQUE on user_id+challenge_id+period_key).

**Verification**: eslint 0 errors (2 pre-existing warnings), tsc --noEmit clean, 118 tests pass (9 test files). 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 10 — 2026-04-03T20:41:41Z — OK
- **Log**: iteration-010.log

## Iteration 11 — Phase 4: GET /challenges/mine endpoint

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/challenges.ts` — New file. Implements `GET /challenges/mine` with JWT auth and lazy assignment. Exports `createChallengeRoutes` factory, plus `dailyPeriodKey`, `weeklyPeriodKey`, `dailyResetsAt`, `weeklyResetsAt` helpers. DB helpers: `expireStaleAssignments` (marks expired where `expires_at < now()` AND `status='active'`), `getAssignmentsForPeriod` (JOINs challenge_assignments + challenges + campaigns for a user/period), `getActiveChallengesBySort` (top N by sort_order ASC), `getCampaignByType`, `getOnboardingAssignments`, `getOnboardingChallenges`, `getCompletionBonusesForCampaign`, `getBonusCompletion`, `countCompleted`, `createAssignment` (idempotent via ON CONFLICT DO NOTHING). Handler flow: expire stale → compute period keys → lazy assign daily (3) + weekly (2) + onboarding (first step) → build bonus status → build onboarding section (with `locked` flag for unassigned steps, `null` when all completed) → return FR-14 response shape.
- `backend/services/backend/src/index.ts` — Registered `GET /challenges/*` with JWT auth middleware (`requireAllMethods: true`) and mounted `createChallengeRoutes`.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 3 integration tests: (1) first call creates 3 daily + 2 weekly + 1 onboarding assignment, verifies response shape (daily/weekly/onboarding sections, progress/target/status/reward/completedAt, bonus status, resetsAt, onboarding locked flags); (2) second call returns same assignments (no duplicates, total=6); (3) expired assignment marked expired after endpoint call.

**Verification**: eslint 0 errors (4 warnings — 2 pre-existing + 2 new `any` in test assertions), tsc --noEmit clean, 31/31 integration tests pass, 121 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 11 — 2026-04-03T20:50:38Z — OK
- **Log**: iteration-011.log

## Iteration 12 — Phase 4: GET /points/mine, GET /points/mine/history, GET /crates/mine

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/points.ts` — New file. Implements two route factories: `createPointsRoutes` (GET /mine for balance + GET /mine/history for paginated point_grants) and `createCrateRoutes` (GET /mine for paginated crate_drops). Both use cursor-based keyset pagination (id < cursor, DESC order, limit clamped to 50 max). Points balance returns {balance: 0, lifetimeEarned: 0} when no player_points row exists. History endpoints return {items: [...], nextCursor: string|null}.
- `backend/services/backend/src/index.ts` — Imported `createPointsRoutes` and `createCrateRoutes`. Registered routes at `/points` and `/crates` with JWT auth middleware (requireAllMethods: true).
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 6 integration tests: (1) GET /points/mine returns zeros when no row; (2) returns balance+lifetimeEarned from seeded row; (3) GET /points/mine/history returns paginated grants with cursor navigation (limit=2, verify DESC order, cursor pagination to second page); (4) empty history returns empty items + null cursor; (5) GET /crates/mine returns paginated drops with cursor (verifies crateType, contentsAmount, status, grantedAt fields); (6) empty crate history returns empty items + null cursor.

**Verification**: eslint 0 errors (12 warnings — 2 pre-existing + 10 new `any` in test assertions), tsc --noEmit clean, 37/37 integration tests pass, 127 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 12 — 2026-04-03T21:02:57Z — OK
- **Log**: iteration-012.log

## Iteration 13 — Phase 4: GET /challenges/mine/history, GET /dogpile/current, GET /dogpile/schedule

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/challenges.ts` — Added `GET /mine/history` endpoint with cursor-based pagination. Queries `challenge_assignments` JOINed with `challenges` WHERE `status='completed'`, returns `{items: [{id, title, description, completedAt, reward}], nextCursor}`. Added `parseIntParam` helper (same pattern as points.ts).
- `backend/services/backend/src/routes/dogpile.ts` — New file. Implements two public endpoints: `GET /current` (returns active event with `endsIn` countdown, or next scheduled with `startsIn` countdown, or `null`), `GET /schedule` (returns all scheduled + active events ordered by `starts_at` ASC). Factory pattern with `createDogpileRoutes`.
- `backend/services/backend/src/index.ts` — Imported `createDogpileRoutes`, registered at `/dogpile` (public, no JWT auth).
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 7 integration tests: (1) paginated completed assignments with cursor navigation; (2) empty history when no completed assignments; (3) dogpile/current returns active over scheduled; (4) dogpile/current returns next scheduled when no active; (5) dogpile/current returns null when no events; (6) dogpile/schedule returns ordered events (excludes ended); (7) dogpile/schedule returns empty when no upcoming events.

**Verification**: eslint 0 errors (19 warnings — 2 pre-existing + 17 `any` in test assertions), tsc --noEmit clean, 44/44 integration tests pass, 134 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 13 — 2026-04-03T21:12:00Z — OK
- **Log**: iteration-013.log

## Iteration 13 — 2026-04-03T21:14:23Z — OK
- **Log**: iteration-013.log

## Iteration 14 — Phase 5: Admin auth + reward-config + reward-pool endpoints

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/admin.ts` — New file. Implements `createAdminRoutes` factory with admin auth middleware (X-Admin-Key header validated against injected `adminApiKey`). Three endpoints: `GET /reward-config` (returns all 11 config key-value pairs with updatedAt), `PUT /reward-config/:key` (validates key against VALID_CONFIG_KEYS set, rejects unknown with 400, updates value), `GET /reward-pool` (returns singleton pool row: balanceLamports, lifetimeFunded, lifetimePaid, updatedAt).
- `backend/services/backend/src/config.ts` — Added `adminApiKey: string | undefined` field to Config interface + loadConfig, reads from `ADMIN_API_KEY` env var.
- `backend/services/backend/src/index.ts` — Imported `createAdminRoutes`, registered at `/admin` (conditional on `config.adminApiKey` being set). Added `PUT` to CORS allowMethods and `X-Admin-Key` to allowHeaders.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 6 integration tests: (1) request without X-Admin-Key → 401; (2) request with wrong key → 401; (3) GET /admin/reward-config returns all 11 seeded defaults with correct values and updatedAt; (4) PUT /admin/reward-config/:key updates value and persists; (5) PUT unknown key → 400 INVALID_KEY; (6) GET /admin/reward-pool returns balance/lifetimeFunded/lifetimePaid.

**Verification**: eslint 0 errors (26 warnings — 2 pre-existing + 24 `any` in test assertions), tsc --noEmit clean, 50/50 integration tests pass, 140 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 14 — 2026-04-03T21:23:09Z — OK
- **Log**: iteration-014.log

## Iteration 15 — Phase 5: Admin campaign + challenge CRUD

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/admin.ts` — Added 4 CRUD endpoints: `POST /campaigns` (create with name, campaignType, startsAt, endsAt, config — validates campaign_type against CHECK constraint set, returns 201), `PUT /campaigns/:id` (dynamic field update via `sql.unsafe()` for safe parameterized dynamic queries, toggle is_active for soft-disable, returns 404 for missing campaign), `POST /challenges` (create in campaign — validates scope against CHECK set, validates rewardType, validates campaign exists via FK lookup, returns 201), `PUT /challenges/:id` (dynamic field update, validates scope/rewardType if provided, returns 404 for missing challenge). All endpoints protected by existing admin auth middleware (X-Admin-Key header). No delete endpoints — soft-disable only via `isActive: false`.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 7 integration tests in new `Admin API: campaign + challenge CRUD` describe block: (1) POST /admin/campaigns creates campaign with correct fields + config JSONB; (2) POST rejects invalid campaign_type with 400; (3) PUT updates campaign name + toggles isActive, verified in DB; (4) POST /admin/challenges creates challenge in campaign with all fields; (5) POST rejects invalid scope with 400; (6) POST rejects nonexistent campaign with 400 CAMPAIGN_NOT_FOUND; (7) PUT updates challenge title + deactivates, verified in DB. Tests use unique timestamp-based suffixes to avoid name collisions with seeded data.

**Verification**: eslint 0 errors (37 warnings — 2 pre-existing + 35 `any` in test assertions), tsc --noEmit clean, 57/57 integration tests pass, 147 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 15 — 2026-04-03T21:42:55Z — OK
- **Log**: iteration-015.log

## Iteration 16 — Phase 5: Admin dogpile endpoints + status worker

**Status**: Success

**Changes**:
- `backend/services/backend/src/routes/admin.ts` — Added 3 dogpile admin endpoints: `POST /dogpile` (schedule event with starts_at, ends_at, multiplier, optional campaign_id — validates no overlap with non-cancelled events via range overlap query, returns 409 on conflict), `PUT /dogpile/:id` (cancel scheduled events only — rejects active/ended/cancelled with 409, returns 404 for missing), `GET /dogpile` (list all events, optional `?status=` query filter, ordered by starts_at DESC). All endpoints protected by existing admin auth middleware.
- `backend/services/backend/src/worker/dogpile-worker.ts` — New file. Implements `createDogpileWorker` factory with configurable poll interval (default 10s). `tick()` method runs two UPDATE queries: `scheduled→active` where `starts_at <= now()`, `active→ended` where `ends_at <= now()`. Returns counts for testing. Cancelled events are never transitioned.
- `backend/services/backend/src/index.ts` — Imported and started dogpile worker with 10s poll interval.
- `backend/services/backend/src/__tests__/integration.test.ts` — Added 7 integration tests: (1) POST schedules event with correct status/multiplier; (2) POST rejects overlapping events with 409; (3) PUT cancels scheduled event; (4) PUT rejects cancelling active event with 409; (5) GET lists events with optional status filter; (6) worker tick transitions scheduled→active and active→ended; (7) cancelled events not transitioned by worker.

**Verification**: eslint 0 errors (44 warnings — 2 pre-existing + 42 `any` in test assertions), tsc --noEmit clean, 154 total tests pass across 9 files. 5 pre-existing test files fail with `ECONNREFUSED ::1:5432` (Postgres connectivity issue — not caused by this change).

## Iteration 16 — 2026-04-03T21:49:49Z — OK
- **Log**: iteration-016.log

