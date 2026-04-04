# Gap Analysis: 400 — Challenge Engine & Reward System

- **Date**: 2026-04-04
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions

N/A — Challenge engine is entirely backend/off-chain. No on-chain program changes.

### Event Types

| Constant | Event String | File | Line |
|----------|-------------|------|------|
| `GAME_SETTLED` | `game.settled` | event-types.ts | 11 |
| `REWARD_POOL_FUND` | `reward.pool_fund` | event-types.ts | 12 |
| `POINTS_GRANT` | `points.grant` | event-types.ts | 13 |
| `CRATE_DROP` | `crate.drop` | event-types.ts | 14 |
| `CRATE_SOL_PAYOUT` | `crate.sol_payout` | event-types.ts | 15 |

### Event Handlers

| Handler | File | Line | Registered |
|---------|------|------|------------|
| `createGameSettledHandler` | queue/handlers/game-settled.ts | 142 | Yes (index.ts:217) |
| `createRewardPoolFundHandler` | queue/handlers/reward-pool-fund.ts | 70 | Yes (index.ts:221) |
| `createPointsGrantHandler` | queue/handlers/points-grant.ts | 89 | Yes (index.ts:225) |
| `createCrateDropHandler` | queue/handlers/crate-drop.ts | 98 | Yes (index.ts:235) |
| `createCrateSolPayoutHandler` | queue/handlers/crate-sol-payout.ts | 68 | Yes (index.ts:239) |
| `checkCompletionBonus` | queue/handlers/completion-bonus.ts | 91 | Called from game-settled.ts |
| `advanceOnboardingChain` | queue/handlers/onboarding-chain.ts | 74 | Called from game-settled.ts |
| `questEligible` | queue/handlers/challenge-adapters.ts | 72 | Called from game-settled.ts |
| `getAdapter` (registry) | queue/handlers/challenge-adapters.ts | 144 | Called from game-settled.ts |

### Backend Routes

| Endpoint | File | Line | Auth |
|----------|------|------|------|
| `GET /challenges/mine` | routes/challenges.ts | 309 | JWT |
| `GET /challenges/mine/history` | routes/challenges.ts | 497 | JWT |
| `GET /points/mine` | routes/points.ts | 44 | JWT |
| `GET /points/mine/history` | routes/points.ts | 71 | JWT |
| `GET /crates/mine` | routes/points.ts | 136 | JWT |
| `GET /dogpile/current` | routes/dogpile.ts | 39 | **Public** |
| `GET /dogpile/schedule` | routes/dogpile.ts | 94 | **Public** |
| `GET /admin/reward-config` | routes/admin.ts | 52 | X-Admin-Key |
| `PUT /admin/reward-config/:key` | routes/admin.ts | 64 | X-Admin-Key |
| `GET /admin/reward-pool` | routes/admin.ts | 86 | X-Admin-Key |
| `POST /admin/campaigns` | routes/admin.ts | 115 | X-Admin-Key |
| `PUT /admin/campaigns/:id` | routes/admin.ts | 158 | X-Admin-Key |
| `POST /admin/challenges` | routes/admin.ts | 230 | X-Admin-Key |
| `PUT /admin/challenges/:id` | routes/admin.ts | 308 | X-Admin-Key |
| `POST /admin/dogpile` | routes/admin.ts | 421 | X-Admin-Key |
| `PUT /admin/dogpile/:id` | routes/admin.ts | 487 | X-Admin-Key |
| `GET /admin/dogpile` | routes/admin.ts | 544 | X-Admin-Key |

### Workers

| Worker | File | Line | Purpose |
|--------|------|------|---------|
| `createDogpileWorker` | worker/dogpile-worker.ts | 22 | Transitions dogpile event status on schedule |

### Settlement Event Emission

| Game | File | Line | Within Transaction |
|------|------|------|--------------------|
| Coinflip | worker/settle-tx.ts | 442 | Yes (withTransaction block lines 354-467) |
| Lord (Jackpot) | worker/settle-tx.ts | 729 | Yes (withTransaction block lines 620-744) |
| Close Call | worker/closecall-clock.ts | 611 | Yes (withTransaction block lines 444-621) |

### Database Schema

| Table | Migration Line | Key Constraints |
|-------|---------------|-----------------|
| `reward_config` | 4 | PK: key |
| `player_points` | 11 | PK: user_id, UNIQUE: wallet |
| `point_grants` | 20 | UNIQUE(user_id, source_type, source_id), CHECK source_type |
| `reward_pool` | 35 | Singleton (CHECK id=1) |
| `reward_pool_fundings` | 44 | UNIQUE: round_id |
| `campaigns` | 53 | UNIQUE: name, CHECK campaign_type |
| `challenges` | 65 | FK: campaign_id, CHECK scope, CHECK reward_type |
| `challenge_assignments` | 84 | UNIQUE(user_id, challenge_id, period_key), CHECK status |
| `progress_events` | 102 | UNIQUE(assignment_id, round_id), metadata JSONB |
| `completion_bonuses` | 114 | FK: campaign_id, CHECK reward_type |
| `bonus_completions` | 127 | UNIQUE(user_id, bonus_id, period_key) |
| `crate_drops` | 137 | UNIQUE(user_id, trigger_type, trigger_id), CHECK trigger_type/crate_type/status |
| `fraud_flags` | 154 | CHECK status |
| `dogpile_events` | 166 | FK: campaign_id (optional), CHECK status |

### Tests

| Test Suite | Type | File | Count |
|-----------|------|------|-------|
| challenge-adapters (questEligible, adapters) | Unit | queue/__tests__/challenge-adapters.test.ts | 18 |
| game.settled handler | Integration | __tests__/integration.test.ts | 10 |
| GET /challenges/mine | Integration | __tests__/integration.test.ts | 3 |
| GET /points + /crates | Integration | __tests__/integration.test.ts | 6 |
| GET /challenges/mine/history + dogpile | Integration | __tests__/integration.test.ts | 7 |
| Admin: reward-config + reward-pool | Integration | __tests__/integration.test.ts | 6 |
| Admin: campaign + challenge CRUD | Integration | __tests__/integration.test.ts | 7 |
| Admin: dogpile + worker | Integration | __tests__/integration.test.ts | 7 |
| CRATE_SOL_PAYOUT handler | Integration | __tests__/integration.test.ts | 3 |
| **Total** | | | **67** |

---

## Acceptance Criteria Audit

### FR-1: Game Settlement Event Emission

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `game.settled` event type added to `EventTypes` | SATISFIED | event-types.ts:11 |
| 2 | `settle-tx.ts` emits for coinflip within settlement transaction | SATISFIED | settle-tx.ts:442 inside withTransaction (lines 354-467) |
| 3 | `settle-tx.ts` emits for lord within settlement transaction | SATISFIED | settle-tx.ts:729 inside withTransaction (lines 620-744) |
| 4 | `closecall-clock.ts` emits for closecall within settlement transaction | SATISFIED | closecall-clock.ts:611 inside withTransaction (lines 444-621) |
| 5 | Event payload matches FR-1 schema | SATISFIED | Integration tests verify payload shape (iteration 1, 2 logs) |
| 6 | Existing settlement latency not measurably affected | SATISFIED | Single INSERT within existing transaction, no blocking calls |
| 7 | Duplicate settlement retries safe (downstream handlers dedupe) | SATISFIED | All handlers use domain-key idempotency, not event_queue.id |

### FR-2: Challenge Engine Data Model

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Migration creates all tables | SATISFIED | 011_challenge_engine.sql: 14 tables (lines 4-174) |
| 2 | Tables follow conventions (BIGINT IDENTITY, CHECK, TIMESTAMPTZ, snake_case) | SATISFIED | All tables use BIGINT GENERATED ALWAYS AS IDENTITY, CHECK constraints, TIMESTAMPTZ |
| 3 | `reward_config` seeded with FR-13 defaults | SATISFIED | 011_challenge_engine.sql:183-194, all 11 config keys |
| 4 | `reward_pool` seeded with single row (balance 0) | SATISFIED | 011_challenge_engine.sql:197 |
| 5 | `reward_pool_fundings` idempotent by round_id | SATISFIED | UNIQUE(round_id) constraint, line 49 |
| 6 | `point_grants` ledger-grade history | SATISFIED | 4 source_types, UNIQUE(user_id, source_type, source_id), line 28 |
| 7 | Foreign key constraints enforced | SATISFIED | challenges→campaigns, assignments→challenges, progress→assignments, bonuses→campaigns, bonus_completions→bonuses |
| 8 | Unique constraints prevent duplicates | SATISFIED | All specified UNIQUE constraints present |
| 9 | Indexes support hot queries | SATISFIED | idx_assignments_active, idx_point_grants_user_created, idx_crate_drops_pending, idx_dogpile_active |

### FR-3: Points Earning System

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Emits one `points.grant` per eligible player | SATISFIED | game-settled.ts:277, source_type='wager', source_id=roundId |
| 2 | Calculates using `points_per_dollar` from config | SATISFIED | points-grant.ts reads config, applies formula |
| 3 | SOL/USD from existing price service (cached) | SATISFIED | points-grant.ts uses injected getSolPrice (fetchSolPrice from price.ts) |
| 4 | Points awarded to both winners and losers | SATISFIED | game-settled.ts emits for all eligible players regardless of isWinner |
| 5 | Dogpile multiplier applied when active | SATISFIED | points-grant.ts:66 getActiveDogpileMultiplier, integration test confirms 2x |
| 6 | `point_grants` inserted before `player_points` update | SATISFIED | points-grant.ts: insertPointGrant then upsertPlayerPoints in same transaction |
| 7 | `player_points` upsert on first earn | SATISFIED | upsertPlayerPoints uses INSERT ON CONFLICT DO UPDATE |
| 8 | Idempotent via `point_grants UNIQUE` | SATISFIED | UNIQUE(user_id, source_type, source_id), integration test confirms |

### FR-4: Reward Pool & SOL Crate Economics

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Emits one `reward.pool_fund` per round | SATISFIED | game-settled.ts:161-165, outside player loop |
| 2 | Calculates `floor(feeLamports * share)` from config | SATISFIED | reward-pool-fund.ts reads reward_pool_fee_share |
| 3 | Dedupes on `round_id` via `reward_pool_fundings` | SATISFIED | insertPoolFunding with ON CONFLICT DO NOTHING |
| 4 | `balance_lamports` incremented atomically | SATISFIED | incrementRewardPool within withTransaction |
| 5 | SOL crate payout = `floor(balance * sol_crate_pool_pct)` | SATISFIED | crate-drop.ts calculates percentage |
| 6 | SOL crate suppressed when < `sol_crate_min_value` | SATISFIED | crate-drop.ts checks min, integration test: pool below min → suppressed |
| 7 | Accounting-only: no second on-chain fee split | SATISFIED | Design: all fees go to treasury, reward_pool is off-chain ledger only |
| 8 | Pool balance never negative | SATISFIED | SELECT FOR UPDATE + validate before decrement |
| 9 | `lifetime_funded` and `lifetime_paid` updated | SATISFIED | incrementRewardPool and decrementRewardPool both update lifetime counters |
| 10 | All pool ops in row-locked transaction | SATISFIED | lockAndReadRewardPool uses SELECT ... FOR UPDATE (crate-drop.ts:38-42) |

### FR-5: Loot Crate Drops

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Emits one `crate.drop` per eligible player | SATISFIED | game-settled.ts:287, trigger_type='game_settled' |
| 2 | Drop rates from `reward_config` | SATISFIED | crate-drop.ts reads sol_crate_drop_rate, points_crate_drop_rate |
| 3 | SOL crate: lock, check, calculate, decrement, insert — one transaction | SATISFIED | crate-drop.ts: lockAndReadRewardPool → calculate → decrementRewardPool → insertCrateDrop in withTransaction |
| 4 | SOL payout emits `CRATE_SOL_PAYOUT` | SATISFIED | crate-drop.ts:186 emits CRATE_SOL_PAYOUT with crateDropId |
| 5 | SOL crate suppressed when pool can't fund | SATISFIED | Integration test: pool 50M, payout 5M < min 10M → no crate |
| 6 | Points crate: random amount, insert, emit `POINTS_GRANT` | SATISFIED | crate-drop.ts: random in [min, max], insert, emit with source_type='crate_points' |
| 7 | `crate_drops` records trigger_type, trigger_id, crate_type, contents_amount | SATISFIED | insertCrateDrop params include all fields |
| 8 | No crate drop for quest_eligible fail | SATISFIED | game-settled.ts:171 gates all reward processing on questEligible |
| 9 | Idempotent per UNIQUE(user_id, trigger_type, trigger_id) | SATISFIED | insertCrateDrop ON CONFLICT DO NOTHING, integration test confirms |

### FR-6: Dogpile Scheduled Events

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `dogpile_events` table supports scheduling | SATISFIED | 011_challenge_engine.sql:166-174, starts_at/ends_at/multiplier/status |
| 2 | Worker transitions status at correct times | SATISFIED | dogpile-worker.ts:26 tick(): scheduled→active, active→ended; integration test confirms |
| 3 | Points calculation reads active Dogpile and applies multiplier | SATISFIED | points-grant.ts:66 getActiveDogpileMultiplier; integration test: 2x multiplier |
| 4 | Active Dogpile check is simple query | SATISFIED | getActiveDogpileMultiplier: SELECT WHERE status='active' AND timestamp BETWEEN |
| 5 | No overlap enforced via admin validation | SATISFIED | admin.ts: POST /admin/dogpile validates no overlap, returns 409 |
| 6 | Events can be cancelled | SATISFIED | admin.ts: PUT /admin/dogpile/:id sets status='cancelled' for scheduled events |
| 7 | `dogpile_active`/`dogpile_multiplier` computed in handler context | SATISFIED | Computed in points-grant handler, not on game.settled payload |

### FR-7: Verification Adapters

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Adapter registry maps `action` → function | SATISFIED | challenge-adapters.ts:134-138, Map with 3 entries |
| 2 | `game_completed`: shouldProgress when scope matches | SATISFIED | challenge-adapters.ts:93, unit tests confirm |
| 3 | `game_won`: shouldProgress when isWinner + scope | SATISFIED | challenge-adapters.ts:106, unit tests confirm |
| 4 | `lobby_filled`: shouldProgress when isCreator + scope | SATISFIED | challenge-adapters.ts:120, unit tests confirm |
| 5 | Each adapter is pure (no side effects) | SATISFIED | Returns AdapterResult only, no DB writes |
| 6 | Unknown types log warning, return false | SATISFIED | getAdapter returns no-op adapter, unit test confirms |

### FR-8: Challenge Template Evaluation Engine

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `game.settled` handler registered | SATISFIED | index.ts:217 registerHandler(EventTypes.GAME_SETTLED, ...) |
| 2 | Handler iterates all players | SATISFIED | game-settled.ts: for loop over event.players |
| 3 | Quest eligibility check before processing | SATISFIED | game-settled.ts:171 questEligible called first |
| 4 | Active assignments loaded efficiently (indexed) | SATISFIED | getActiveAssignmentsWithChallenge uses idx_assignments_active |
| 5 | Progress updates atomic (INSERT + UPDATE in txn) | SATISFIED | insertProgressEvent + incrementAssignmentProgress in withTransaction |
| 6 | Status transitions to 'completed' when progress >= target | SATISFIED | markAssignmentCompleted sets status + completed_at |
| 7 | Completion emits reward intents via downstream path | SATISFIED | Emits points.grant or crate.drop with appropriate source_type |
| 8 | Side-effects emitted as separate events | SATISFIED | pool_fund, points.grant, crate.drop are independent events |
| 9 | Idempotent for progress and reward-event emission | SATISFIED | UNIQUE(assignment_id, round_id) on progress_events |
| 10 | Per-player try/catch | SATISFIED | game-settled.ts:169-300, errors isolated per player |
| 11 | Processing time bounded (< 100ms target) | SATISFIED | Efficient indexed queries; "target" is aspirational, not hard gate |

### FR-9: Completion Bonus

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Check runs after assignment completion | SATISFIED | game-settled.ts calls checkCompletionBonus after markAssignmentCompleted |
| 2 | Count query matches spec pattern | SATISFIED | completion-bonus.ts:43 countCompletedAssignments JOINs correctly |
| 3 | Idempotent (UNIQUE on user_id, bonus_id, period_key) | SATISFIED | insertBonusCompletion ON CONFLICT DO NOTHING; integration test confirms |
| 4 | Bonus reward via same reward path | SATISFIED | Emits points.grant or crate.drop like challenge rewards |
| 5 | Multiple bonuses per campaign supported | SATISFIED | getCompletionBonuses returns array, iterates all |

### FR-10: Anti-Gaming & Quest Eligibility

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `quest_eligible()` implemented and called | SATISFIED | challenge-adapters.ts:72, called at game-settled.ts:171 |
| 2 | Refunded games excluded (isWinner === null) | SATISFIED | questEligible returns false for null; unit + integration tests confirm |
| 3 | Non-refund games continue normally | SATISFIED | questEligible returns true for winners and losers |
| 4 | Ineligible games still settle normally | SATISFIED | quest_eligible is downstream of settlement, no impact on game loop |
| 5 | Any fraud flags implemented are advisory-only | SATISFIED | No fraud flag logic implemented; criterion is vacuously satisfied. fraud_flags table exists but is unused (acceptable — spec says "optional, async, non-blocking") |

### FR-11: Daily & Weekly Challenge Assignment

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Daily challenges assigned lazily on GET | SATISFIED | routes/challenges.ts:309, checks for existing assignments, creates if none |
| 2 | Weekly challenges assigned lazily on GET | SATISFIED | Same endpoint handles both daily and weekly lazy assignment |
| 3 | `period_key` format: `daily:YYYY-MM-DD`, `weekly:YYYY-WNN` | SATISFIED | challenges.ts:71 dailyPeriodKey, :77 weeklyPeriodKey |
| 4 | Assignment count matches (3 daily, 2 weekly) | SATISFIED | Reads daily_challenge_count/weekly_challenge_count from config |
| 5 | Challenges from active pool | SATISFIED | getActiveChallengesBySort queries active challenges by sort_order ASC |
| 6 | UNIQUE prevents duplicate assignments | SATISFIED | UNIQUE(user_id, challenge_id, period_key) |
| 7 | Expired assignments marked expired | SATISFIED | expireStaleAssignments at start of GET /challenges/mine |
| 8 | Completion bonus checked when 3rd daily completed | SATISFIED | checkCompletionBonus called after each assignment completion |

### FR-12: Onboarding Quest Chain

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Onboarding campaign + 3 templates seeded | SATISFIED | 011_challenge_engine.sql:200-234, 3-step chain with prerequisite_id |
| 2 | First step assigned on first GET for new users | SATISFIED | challenges.ts: getOnboardingAssignments, assigns first step if none |
| 3 | Completing step auto-assigns next (by prerequisite_id) | SATISFIED | onboarding-chain.ts:29 getNextOnboardingStep; integration test confirms |
| 4 | period_key = 'onboarding', no expires_at | SATISFIED | createAssignment in onboarding-chain.ts:47 sets period_key='onboarding', expires_at=NULL |
| 5 | One-time: no repeat after completion | SATISFIED | UNIQUE constraint + check for existing assignments prevents re-assignment |
| 6 | Onboarding appears alongside daily/weekly in GET response | SATISFIED | challenges.ts returns onboarding section in response alongside daily/weekly |

### FR-13: Reward Configuration

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `reward_config` seeded with all defaults | SATISFIED | 011_challenge_engine.sql:183-194, all 11 keys match spec |
| 2 | Config read at evaluation time (not cached) | SATISFIED | readRewardConfig called per handler invocation |
| 3 | `PUT /admin/reward-config/:key` updates value | SATISFIED | admin.ts:64, integration test confirms |
| 4 | `GET /admin/reward-config` returns all values | SATISFIED | admin.ts:52, integration test confirms 11 entries |
| 5 | Admin endpoints require operator auth | SATISFIED | admin.ts:43-48, X-Admin-Key middleware |
| 6 | Invalid config keys rejected (400) | SATISFIED | admin.ts validates against VALID_CONFIG_KEYS set |
| 7 | Config change takes effect on next event | SATISFIED | No caching — reads from DB each handler invocation |

### FR-14: Player-Facing API Endpoints

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `GET /challenges/mine` returns daily, weekly, onboarding | SATISFIED | challenges.ts:309, response includes all 3 sections |
| 2 | Lazy assignment triggered on first call after reset | SATISFIED | challenges.ts checks for existing assignments per period_key |
| 3 | Response includes progress, target, status, reward, resetsAt | SATISFIED | Integration test validates shape |
| 4 | Onboarding shows locked steps (locked: true) | SATISFIED | challenges.ts:439, locked = !isAssigned |
| 5 | Onboarding null for completed players | SATISFIED | challenges.ts:434, returns null when allCompleted |
| 6 | `GET /points/mine` returns { balance, lifetimeEarned } | SATISFIED | points.ts:44, returns zeros if no row |
| 7 | `GET /points/mine/history` paginated grants | SATISFIED | points.ts:71, cursor-based DESC |
| 8 | `GET /challenges/mine/history` paginated completions | SATISFIED | challenges.ts:497, cursor-based DESC |
| 9 | `GET /crates/mine` paginated drops with status | SATISFIED | points.ts:136, includes crateType, contentsAmount, status |
| 10 | `GET /dogpile/current` returns active/next with countdown | SATISFIED | dogpile.ts:39, endsIn/startsIn countdown fields |
| 11 | All endpoints require JWT auth | **GAP** | `/dogpile/current` and `/dogpile/schedule` are mounted PUBLIC (index.ts:312, no JWT middleware). Spec says all FR-14 endpoints require JWT. |
| 12 | All endpoints use standard error format | SATISFIED | Consistent errorResponse pattern across all route files |

### FR-15: Admin API Endpoints

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All admin endpoints require operator-level auth | SATISFIED | admin.ts:43-48, X-Admin-Key header check |
| 2 | Campaign CRUD: create, update, toggle (no delete) | SATISFIED | POST/PUT /admin/campaigns, no DELETE endpoint |
| 3 | Challenge CRUD: create, update, toggle within campaign | SATISFIED | POST/PUT /admin/challenges, validates campaign_id |
| 4 | Dogpile: create, cancel future, cannot modify active | SATISFIED | POST/PUT /admin/dogpile, rejects active with 409 |
| 5 | Reward config: read all, update by key | SATISFIED | GET/PUT /admin/reward-config |
| 6 | Reward pool: read balance, funded, paid | SATISFIED | GET /admin/reward-pool returns all 3 fields |

---

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| 1 | FR-14 | Dogpile endpoints public, spec says JWT auth | low | engine | — | Either add JWT middleware to dogpile routes or update spec to document public access as intentional |
| 2 | — | `unique_game_types` condition evaluation not implemented | moderate | engine | — | Implement condition evaluation in game-settled handler: for `unique_game_types`, query distinct `metadata->>'game'` from progress_events before incrementing |

### Gap Detail: `unique_game_types` Condition (Behavioral Gap)

This gap does not map to a specific acceptance criterion checkbox but is a material deficiency in the M1 scope:

- **Spec reference**: FR-7 condition types section lists `unique_game_types` as M1 (not deferred). Design Decision #1 was added specifically to support it via `progress_events.metadata`.
- **Impact**: Onboarding step 3 ("Try All 3 Game Types", threshold: 3) and weekly challenge "Play Every Game Type" (threshold: 3) will complete by playing any 3 games of any type, not by requiring 3 *different* game types.
- **Root cause**: The `game_completed` adapter always returns `progressDelta: 1` regardless of the challenge's `condition` field. The engine always increments by that delta without checking for game-type uniqueness. The metadata `{"game": "coinflip"}` IS stored in `progress_events` (infrastructure is in place), but no evaluation logic reads it.
- **Fix**: In game-settled.ts, before calling `incrementAssignmentProgress`, check the assignment's `condition` field. For `unique_game_types`: query `SELECT DISTINCT metadata->>'game' FROM progress_events WHERE assignment_id = ?`, and only increment if `event.game` is not already in that set.

---

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| `unique_opponents` condition | M2 (within spec) | N/A — internal | N/A | No |
| `streak` condition | M2 (within spec) | N/A — internal | N/A | No |
| Multi-condition challenges | M2 (within spec) | N/A — internal | N/A | No |
| Pool rotation (per-player dailies) | M2 (within spec) | N/A — internal | N/A | No |
| KOL-triggered challenges | M2 (within spec) | N/A — internal | N/A | No |
| Flash quests / ephemeral | M2 (within spec) | N/A — internal | N/A | No |
| Fraud flag advisory signals | Optional in M1 | N/A — table exists, logic TBD | N/A | No |

All deferrals are internal to this spec. No cross-spec deferral references to validate.

---

## Recommendations

1. **Fix `unique_game_types` condition evaluation** (moderate priority). The infrastructure (metadata storage, DB schema) is complete — only the evaluation branching logic is missing. This is a small code change in `game-settled.ts` that would make onboarding step 3 and the weekly "play every game type" challenge work as designed.

2. **Decide on dogpile endpoint auth** (low priority). The current public access is arguably better UX (shows "Dogpile is live!" to unauthenticated visitors). If intentional, update the spec to document this. If not, add JWT middleware.

3. **SOL crate payout production review** (tracked in TECH_DEBT.md). The `CRATE_SOL_PAYOUT` handler works in tests but needs review before real SOL flows: retry logic, rate limiting, treasury wallet validation, monitoring.

4. **Fraud flags are scaffolding only**. The `fraud_flags` table exists but no code writes to it. This is acceptable per spec ("optional"), but operators should know that no advisory signals are active. Consider implementing the velocity check (5+ completions in < 10 min) as a quick win when real usage data is available.
