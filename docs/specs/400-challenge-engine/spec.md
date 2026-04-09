# Specification: [400] Challenge Engine & Reward System

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 18 |

---

## Overview

A backend service that gives players daily and weekly gameplay objectives, tracks progress automatically via game settlement events, awards points for wagering, drops loot crates with configurable probability, and runs scheduled Dogpile events with boosted multipliers. Every challenge drives lobby activity — no social media chores, no off-platform actions.

The system introduces three new primitives:
1. **Points** — earned passively per $ wagered (configurable rate). Pre-TGE allocation signal. Free to mint.
2. **Loot Crates** — random drops after settled games. Two types: points crates (free) and SOL crates (capped by reward-pool accounting).
3. **Reward Pool** — a configurable share of collected platform fees, tracked as an accounting ledger that caps and records SOL crate payouts.

The challenge engine is event-driven, plugging into the existing async event queue (spec 301). It receives `game.settled` events from the settlement workers, evaluates progress against active challenges, and emits reward-intent events for downstream handlers. Challenge evaluation stays separate from reward side-effects: `game.settled` advances progress and emits `reward.pool_fund`, `points.grant`, and `crate.drop`, while dedicated handlers perform pool accounting, point grants, crate recording, and SOL payouts.

### Design Principles (from reference spec)

1. **Every challenge must fill a lobby or make the platform more alive.** No off-platform actions.
2. **One progression number: points.** No XP, no levels, no badges, no cosmetics.
3. **Rewards are crates and points. That's it.** No shops, no catalogs.

## User Stories

- As a player, I want to see daily and weekly challenges so that I have concrete goals beyond individual games
- As a player, I want my challenge progress to update automatically when I play so that I don't need to claim or submit proof
- As a player, I want to earn points proportional to my wagered volume so that every game feels rewarding
- As a player, I want a chance at loot crates after each game so that settlements have an extra moment of excitement
- As a player, I want a bonus reward for completing all my daily challenges so that I'm motivated to finish the set
- As a new player, I want guided onboarding challenges so that I learn the platform's game types and mechanics
- As a player, I want Dogpile events to boost my point earnings so that I'm motivated to play during peak hours
- As an operator, I want to configure point rates, crate drop rates, and reward pool share without redeploying so that I can tune economics live
- As an operator, I want lightweight anti-abuse signals so that obviously suspicious reward activity can be reviewed without over-engineering M1

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section 2 "Not Implemented" -> "Reward loops and progression expansion"; Section 8 Workstream A (core game reliability provides the settlement events this consumes)
- **Current baseline fit**: Not Implemented
- **Planning bucket**: Core (extends the game loop)
- **Reference doc**: `docs/archive/references/challenge-engine-spec.md` (full design research)

## Required Context Files

- `docs/specs/301-async-event-queue/spec.md` — event queue we plug into
- `docs/specs/300-referral-system/spec.md` — pattern for event handlers, DB conventions
- `backend/services/backend/src/queue/` — event queue implementation
- `backend/services/backend/src/worker/settle-tx.ts` — settlement hot path (emits new events)
- `backend/services/backend/src/db.ts` — DB client and query patterns
- `backend/services/backend/migrations/007_game_entries.sql` — game_entries schema (data source for adapters)
- `docs/DESIGN_REFERENCE.md` — trust model, fee structure (500 bps)

## Contract Files

- No existing mocks — new system
- API contract defined in FR-14 below
- Event contracts defined in FR-1

---

## System Invariants

1. **Points are free to mint.** No budget constraint. Points never come from the reward pool.
2. **Reward pool is accounting-only in M1.** All on-chain fees still settle to the single treasury; `reward_pool` is an off-chain ledger that tracks how much of that fee flow is reserved for crate economics.
3. **Reward pool balance cannot go negative.** If pool < `sol_crate_min_value`, SOL crate drops are suppressed until the pool recovers.
4. **Challenge progress is idempotent.** Processing the same `game.settled` event twice produces the same progress state.
5. **Reward side-effects are idempotent.** Pool funding, point grants, crate creation, and SOL payouts must dedupe on domain keys from the payload, never `event_queue.id`.
6. **Settlement must never block on challenge processing.** Challenge evaluation is async (via event queue). Settlement latency is unaffected.
7. **All monetary values in lamports (BIGINT).** SOL conversion only at display boundaries.
8. **Operator config changes take effect immediately.** No redeploy, no restart. Read from `reward_config` table on each evaluation.

---

## Functional Requirements

### FR-1: Game Settlement Event Emission

Extend the settlement workers to emit a `game.settled` event into the async event queue for every settled game. This is the foundation all downstream processing depends on.

**Event payload:**

```typescript
{
  roundId: string;          // match_id (hex)
  roundPda: string;         // on-chain PDA
  game: "flipyou" | "lord" | "closecall";
  players: Array<{
    userId: string;
    wallet: string;
    amountLamports: string; // bigint as string
    isWinner: boolean | null; // null = refund
    payoutLamports: string;
    isCreator: boolean;
  }>;
  feeLamports: string;
  settledAt: string;        // ISO 8601
}
```

The event MUST be emitted within the same DB transaction as the settlement write (same pattern as referral earnings recording).

**Acceptance Criteria:**
- [x] `game.settled` event type added to `EventTypes` in `event-types.ts` <!-- satisfied: event-types.ts:11 -->
- [x] `settle-tx.ts` emits `game.settled` within the settlement transaction for flipyou rounds <!-- satisfied: settle-tx.ts:442 inside withTransaction (lines 354-467) -->
- [x] `settle-tx.ts` emits `game.settled` within the settlement transaction for lord (jackpot) rounds <!-- satisfied: settle-tx.ts:729 inside withTransaction (lines 620-744) -->
- [x] `closecall-clock.ts` emits `game.settled` within the settlement transaction for closecall rounds <!-- satisfied: closecall-clock.ts:611 inside withTransaction (lines 444-621) -->
- [x] Event payload matches the schema above (all fields present, amounts as string-encoded lamports) <!-- satisfied: integration tests verify payload shape (iterations 1, 2) -->
- [x] Existing settlement latency is not measurably affected (event is a single INSERT, no blocking) <!-- satisfied: single INSERT within existing transaction -->
- [x] Duplicate settlement retries may enqueue duplicate `game.settled` rows safely because downstream handlers dedupe on domain keys, not `event_queue.id` <!-- satisfied: all handlers use domain-key idempotency -->

---

### FR-2: Challenge Engine Data Model

Database schema for challenges, assignments, and progress tracking.

**Tables:**

```sql
-- Operator-tunable reward/economy parameters
CREATE TABLE reward_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,           -- JSON-encoded value
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player point balances and lifetime stats
CREATE TABLE player_points (
  user_id             TEXT PRIMARY KEY,
  wallet              TEXT NOT NULL UNIQUE,
  balance             BIGINT NOT NULL DEFAULT 0,        -- current spendable
  lifetime_earned     BIGINT NOT NULL DEFAULT 0,        -- monotonic, never decreases
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable point grant ledger (source of truth for history + idempotency)
CREATE TABLE point_grants (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             TEXT NOT NULL,
  wallet              TEXT NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN ('wager', 'challenge_completed', 'bonus_completed', 'crate_points')),
  source_id           TEXT NOT NULL,                    -- round_id, assignment_id, bonus_completion_id, crate_drop_id
  amount              BIGINT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX idx_point_grants_user_created ON point_grants (user_id, created_at DESC);

-- Reward pool accounting (single row, updated atomically)
CREATE TABLE reward_pool (
  id                  INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton, accounting-only ledger
  balance_lamports    BIGINT NOT NULL DEFAULT 0,
  lifetime_funded     BIGINT NOT NULL DEFAULT 0,    -- total fees -> pool
  lifetime_paid       BIGINT NOT NULL DEFAULT 0,    -- total crate payouts
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only pool funding ledger for idempotent reward_pool_fund handling
CREATE TABLE reward_pool_fundings (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id            TEXT NOT NULL UNIQUE,         -- one funding record per settled round
  fee_lamports        BIGINT NOT NULL,
  funded_lamports     BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaign container (Daily, Weekly, Onboarding, Dogpile)
CREATE TABLE campaigns (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  campaign_type   TEXT NOT NULL CHECK (campaign_type IN ('daily', 'weekly', 'onboarding', 'dogpile')),
  starts_at       TIMESTAMPTZ,                  -- NULL = always active
  ends_at         TIMESTAMPTZ,                  -- NULL = no end
  is_active       BOOLEAN NOT NULL DEFAULT true,
  config          JSONB NOT NULL DEFAULT '{}',  -- type-specific config (e.g., dogpile multiplier)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Challenge template definitions (data, not code)
CREATE TABLE challenges (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns(id),
  title           TEXT NOT NULL,
  description     TEXT,
  action          TEXT NOT NULL,                 -- M1 adapter type: game_won, game_completed, lobby_filled
  scope           TEXT NOT NULL DEFAULT 'any' CHECK (scope IN ('any', 'flipyou', 'lord', 'closecall')),
  condition       TEXT NOT NULL DEFAULT 'count', -- M1: count, unique_game_types
  threshold       INT NOT NULL,                  -- target value
  reward_type     TEXT NOT NULL CHECK (reward_type IN ('points', 'crate')),
  reward_amount   INT,                           -- points amount (if reward_type = points)
  prerequisite_id BIGINT REFERENCES challenges(id),  -- for chains (onboarding)
  eligible_if     JSONB NOT NULL DEFAULT '{}',   -- M1: unused. M2+: eligibility rules (e.g., {"min_games_played": 10})
  sort_order      INT NOT NULL DEFAULT 0,        -- display ordering within campaign
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-player challenge assignments for a specific period
CREATE TABLE challenge_assignments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         TEXT NOT NULL,
  challenge_id    BIGINT NOT NULL REFERENCES challenges(id),
  period_key      TEXT NOT NULL,                 -- e.g., "daily:2026-04-03", "weekly:2026-W14", "onboarding"
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  progress        INT NOT NULL DEFAULT 0,
  target          INT NOT NULL,                  -- copied from challenge.threshold at assignment time
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,                   -- NULL for one_time (onboarding)
  completed_at    TIMESTAMPTZ,
  UNIQUE (user_id, challenge_id, period_key)
);

CREATE INDEX idx_assignments_active ON challenge_assignments (user_id, status) WHERE status = 'active';
CREATE INDEX idx_assignments_period ON challenge_assignments (period_key, status);

-- Tracks which game sessions contributed to progress (for anti-gaming audit + idempotency)
CREATE TABLE progress_events (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id       BIGINT NOT NULL REFERENCES challenge_assignments(id),
  round_id            TEXT NOT NULL,             -- match_id from game.settled event
  user_id             TEXT NOT NULL,
  progress_delta      INT NOT NULL DEFAULT 1,    -- how much this event advanced progress
  metadata            JSONB NOT NULL DEFAULT '{}', -- adapter context (e.g., {"game":"flipyou"} for unique_game_types)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, round_id)               -- idempotency: same round can't count twice
);

-- Completion bonus definitions (meta-quest: complete all dailies -> bonus)
CREATE TABLE completion_bonuses (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns(id),
  title           TEXT NOT NULL,
  description     TEXT,
  required_count  INT NOT NULL,                  -- how many challenges must be completed
  reward_type     TEXT NOT NULL CHECK (reward_type IN ('points', 'crate')),
  reward_amount   INT,                           -- points amount (if reward_type = points)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks bonus completion per player per period
CREATE TABLE bonus_completions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         TEXT NOT NULL,
  bonus_id        BIGINT NOT NULL REFERENCES completion_bonuses(id),
  period_key      TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bonus_id, period_key)
);

-- Loot crate drops
CREATE TABLE crate_drops (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('game_settled', 'challenge_completed', 'bonus_completed')),
  trigger_id      TEXT NOT NULL,                 -- round_id, assignment_id, or bonus_completion_id
  crate_type      TEXT NOT NULL CHECK (crate_type IN ('points', 'sol')),
  contents_amount TEXT NOT NULL,                 -- lamports (sol) or points amount, as string
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_at      TIMESTAMPTZ,
  UNIQUE (user_id, trigger_type, trigger_id)
);

CREATE INDEX idx_crate_drops_user ON crate_drops (user_id, created_at DESC);
CREATE INDEX idx_crate_drops_pending ON crate_drops (status) WHERE status = 'pending';

-- Fraud flags
CREATE TABLE fraud_flags (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         TEXT NOT NULL,
  flag_type       TEXT NOT NULL,                 -- velocity, repeated_opponent, etc.
  details         JSONB NOT NULL DEFAULT '{}',
  related_id      TEXT,                          -- crate_drop id, assignment id, etc.
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

-- Dogpile event schedule and state
CREATE TABLE dogpile_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     BIGINT REFERENCES campaigns(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  multiplier      NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dogpile_active ON dogpile_events (status, starts_at, ends_at) WHERE status IN ('scheduled', 'active');
```

**Acceptance Criteria:**
- [x] Migration file `0XX_challenge_engine.sql` creates all tables above <!-- satisfied: 011_challenge_engine.sql, 14 tables (lines 4-174) -->
- [x] All tables follow project conventions: BIGINT IDENTITY, CHECK constraints on TEXT enums, TIMESTAMPTZ, snake_case <!-- satisfied: all tables use BIGINT GENERATED ALWAYS AS IDENTITY, CHECK constraints, TIMESTAMPTZ -->
- [x] `reward_config` seeded with default values on migration (see FR-13) <!-- satisfied: 011_challenge_engine.sql:183-194, all 11 keys -->
- [x] `reward_pool` seeded with single row (balance 0) <!-- satisfied: 011_challenge_engine.sql:197 -->
- [x] `reward_pool_fundings` provides idempotent, append-only pool funding records keyed by `round_id` <!-- satisfied: UNIQUE(round_id) constraint -->
- [x] `point_grants` provides ledger-grade history for every points award path <!-- satisfied: 4 source_types, UNIQUE(user_id, source_type, source_id) -->
- [x] Foreign key constraints enforced (challenges -> campaigns, assignments -> challenges, etc.) <!-- satisfied: all FK constraints present in migration -->
- [x] Unique constraints prevent duplicate assignments, duplicate progress events, duplicate bonus completions, duplicate point grants, and duplicate crate drops <!-- satisfied: all UNIQUE constraints present -->
- [x] Indexes support the hot queries: active assignments by user, points history by user, pending crate drops, active dogpile events <!-- satisfied: idx_assignments_active, idx_point_grants_user_created, idx_crate_drops_pending, idx_dogpile_active -->

---

### FR-3: Points Earning System

Players earn points proportional to their wagered volume on settled games. Points are free to mint (no budget constraint). Wager points are not applied inline in the `game.settled` handler; instead, eligible player processing emits a `points.grant` event and the dedicated handler writes an immutable `point_grants` ledger row before updating aggregates.

**Formula:**
```
base_points = floor(wager_usd * points_per_dollar)
multiplier  = is_dogpile_active ? dogpile_multiplier : 1.0
earned      = floor(base_points * multiplier)
```

Where `wager_usd = amount_lamports * sol_price_usd / 1e9`. SOL/USD price is fetched from the existing `/price/sol-usd` endpoint (already used by Close Call).

Points are awarded to ALL players in a settled game (winners and losers), because points reward engagement, not outcomes.

**Acceptance Criteria:**
- [x] Eligible settled-game processing emits one `points.grant` event per eligible player with a domain key derived from `(user_id, round_id, source_type='wager')` <!-- satisfied: game-settled.ts:277 -->
- [x] `points.grant` handler calculates points for each player using `points_per_dollar` from `reward_config` <!-- satisfied: points-grant.ts reads config -->
- [x] SOL/USD conversion uses the existing price service (cached, not per-event RPC) <!-- satisfied: points-grant.ts uses injected getSolPrice wrapping fetchSolPrice -->
- [x] Points awarded to both winners and losers in a settled game <!-- satisfied: game-settled.ts emits for all eligible players -->
- [x] Dogpile multiplier applied when a `dogpile_events` row is active at `settledAt` time <!-- satisfied: points-grant.ts:66 getActiveDogpileMultiplier, integration test confirms 2x -->
- [x] `point_grants` row inserted before `player_points.balance` and `lifetime_earned` are incremented atomically <!-- satisfied: points-grant.ts: insertPointGrant then upsertPlayerPoints -->
- [x] `player_points` row created on first earn (upsert pattern) <!-- satisfied: upsertPlayerPoints uses INSERT ON CONFLICT DO UPDATE -->
- [x] Points calculation is deterministic and idempotent via `point_grants UNIQUE (user_id, source_type, source_id)`, not `progress_events` <!-- satisfied: UNIQUE constraint + ON CONFLICT DO NOTHING -->

---

### FR-4: Reward Pool & SOL Crate Economics

A configurable share of platform fees funds the reward pool. The reward pool is accounting-only in M1: all on-chain fees still land in the single treasury, and the challenge system records an off-chain allocation ledger used to cap SOL crate economics. No second wallet movement or second on-chain fee transfer happens during settlement.

**Fee flow:**
```
Game settles -> 5% fee (500 bps) -> treasury
                                  \-> reward_pool_fee_share (e.g., 20%) -> reward_pool
```

Implementation: settled-round processing emits a `reward.pool_fund` event once per round. The handler first inserts `reward_pool_fundings(round_id, fee_lamports, funded_lamports)` as its idempotency guard, then atomically increments `reward_pool.balance_lamports` and `reward_pool.lifetime_funded`.

**SOL crate payout:**
```
payout = floor(reward_pool.balance_lamports * sol_crate_pool_pct)
```

If `payout < sol_crate_min_value` (config), the SOL crate is suppressed (not dropped). Player doesn't know they "missed" it — the roll simply doesn't happen when the pool is too low.

After payout: `reward_pool.balance_lamports -= payout`, `reward_pool.lifetime_paid += payout`. The `crate.drop` handler MUST acquire a row lock (`SELECT ... FOR UPDATE`) on the `reward_pool` singleton before reading balance, to prevent concurrent crate handlers from double-spending the same balance. Operationally, actual SOL still comes from the treasury-managed payout wallet; `reward_pool` is the accounting cap and audit trail.

**Acceptance Criteria:**
- [x] Settled-round processing emits one `reward.pool_fund` event per round <!-- satisfied: game-settled.ts:161-165, outside player loop -->
- [x] `reward.pool_fund` handler calculates `floor(feeLamports * reward_pool_fee_share)` from config <!-- satisfied: reward-pool-fund.ts reads config -->
- [x] `reward.pool_fund` handler dedupes on `round_id` via `reward_pool_fundings` before mutating `reward_pool` <!-- satisfied: insertPoolFunding ON CONFLICT DO NOTHING -->
- [x] `reward_pool.balance_lamports` incremented atomically within the handler's transaction <!-- satisfied: incrementRewardPool in withTransaction -->
- [x] SOL crate payout calculated as `floor(balance * sol_crate_pool_pct)` <!-- satisfied: crate-drop.ts -->
- [x] SOL crate suppressed (not created) when calculated payout < `sol_crate_min_value` <!-- satisfied: integration test confirms suppression -->
- [x] Reward pool remains accounting-only: no second on-chain fee split, no separate settlement-time wallet transfer <!-- satisfied: design — all fees go to treasury -->
- [x] Pool balance never goes negative (payout subtracted only after validation) <!-- satisfied: SELECT FOR UPDATE + validate before decrement -->
- [x] `reward_pool.lifetime_funded` and `lifetime_paid` updated for audit/analytics <!-- satisfied: incrementRewardPool + decrementRewardPool update counters -->
- [x] All pool operations happen within a serializable or row-locked transaction (no race conditions on balance) <!-- satisfied: lockAndReadRewardPool uses SELECT ... FOR UPDATE (crate-drop.ts:38-42) -->

---

### FR-5: Loot Crate Drops

After each settled game, each eligible player has a random chance of receiving a loot crate. Two types: points crate (free) and SOL crate (pool-funded by the accounting-only reward pool).

**Drop logic (per player per settled game):**
```
roll = random()
if roll < sol_crate_drop_rate AND pool can fund:
    drop SOL crate (payout = floor(pool.balance * sol_crate_pool_pct))
elif roll < sol_crate_drop_rate + points_crate_drop_rate:
    drop points crate (amount = random in [points_crate_min, points_crate_max])
else:
    no drop
```

SOL crate is checked first (higher value, lower probability). If pool can't fund it, the roll is wasted (no fallback to points crate — keeps the economics clean).

Crate drops are recorded in `crate_drops` table by a dedicated `crate.drop` handler. SOL crate grants are processed via a new event (`crate.sol_payout`) through the async queue, following the same pattern as `referral.claim_requested` — the handler sends SOL from the treasury-managed payout wallet to the player's wallet.

Points crate grants do not mutate balances inline. The `crate.drop` handler records the crate, then emits `points.grant` with `source_type = 'crate_points'`.

**Acceptance Criteria:**
- [x] Eligible settled-game processing emits one `crate.drop` event per eligible player after a `game.settled` event <!-- satisfied: game-settled.ts:287 -->
- [x] Drop rates read from `reward_config` (`sol_crate_drop_rate`, `points_crate_drop_rate`) <!-- satisfied: crate-drop.ts reads config -->
- [x] SOL crate: `reward_pool` row locked (`SELECT ... FOR UPDATE`), balance checked, payout calculated, pool decremented, `crate_drops` row created — all in one transaction <!-- satisfied: crate-drop.ts:38-42 FOR UPDATE, withTransaction -->
- [x] SOL crate payout emits `crate.sol_payout` event for async SOL transfer <!-- satisfied: crate-drop.ts:186 emits CRATE_SOL_PAYOUT -->
- [x] SOL crate suppressed when pool can't fund `sol_crate_min_value` <!-- satisfied: integration test: pool below min → suppressed -->
- [x] Points crate: random amount in configured range, `crate_drops` row created, `points.grant` emitted with `source_type = 'crate_points'` <!-- satisfied: crate-drop.ts points path -->
- [x] `crate_drops` records trigger_type, trigger_id (round_id), crate_type, contents_amount <!-- satisfied: insertCrateDrop params -->
- [x] No crate drop for games that fail `quest_eligible()` check (FR-10) <!-- satisfied: game-settled.ts:171 gates on questEligible -->
- [x] Crate drop is idempotent per `(user_id, trigger_type, trigger_id)` and enforced with a DB UNIQUE constraint <!-- satisfied: ON CONFLICT DO NOTHING, integration test confirms -->

---

### FR-6: Dogpile Scheduled Events

Time-windowed events (e.g., daily 8-9 PM UTC) that boost the points multiplier for all players. Dogpile creates urgency and concentrates lobby activity.

**Mechanics:**
- Operator creates a `dogpile_events` row with `starts_at`, `ends_at`, `multiplier` (default 2.0)
- A scheduler (cron job or worker) transitions events from `scheduled` -> `active` at `starts_at` and `active` -> `ended` at `ends_at`
- The points calculation (FR-3) checks for an active Dogpile event and applies the multiplier
- Dogpile can optionally be linked to a campaign with ephemeral challenges (future — not M1)

**Recurring Dogpile:** Operator can schedule repeating events via admin API (creates multiple `dogpile_events` rows). The scheduler pattern is simple: one row per occurrence, no RRULE complexity.

**Acceptance Criteria:**
- [x] `dogpile_events` table supports scheduling events with start/end times and multiplier <!-- satisfied: 011_challenge_engine.sql:166-174 -->
- [x] Worker or cron transitions event status: scheduled -> active -> ended at the correct times <!-- satisfied: dogpile-worker.ts:26 tick(), integration test confirms -->
- [x] Points calculation in FR-3 reads active Dogpile event and applies multiplier <!-- satisfied: points-grant.ts:66 getActiveDogpileMultiplier -->
- [x] Active Dogpile check is a simple query: `SELECT multiplier FROM dogpile_events WHERE status = 'active' AND now() BETWEEN starts_at AND ends_at LIMIT 1` <!-- satisfied: getActiveDogpileMultiplier matches pattern -->
- [x] Multiple Dogpile events cannot overlap; enforce via admin validation in M1 (DB exclusion constraint not required) <!-- satisfied: admin.ts POST /admin/dogpile validates overlap, returns 409 -->
- [x] Dogpile events can be cancelled (status -> cancelled) before or during the window <!-- satisfied: admin.ts PUT /admin/dogpile/:id -->
- [x] `dogpile_active` and `dogpile_multiplier` are computed in handler context for analytics; they are not required fields on the `game.settled` payload <!-- satisfied: computed in points-grant handler, not on payload -->

---

### FR-7: Verification Adapters

Pluggable workers that evaluate whether a settled game advances a player's challenge progress. Each adapter type handles one kind of action. The core engine delegates to the appropriate adapter based on the challenge's `action` field.

**M1 Adapters:**

| Adapter | Action field | What it checks | Data source |
|---|---|---|---|
| `game_completed` | `game_completed` | Player participated in a settled game (optionally filtered by `scope` game type) | `game.settled` event payload |
| `game_won` | `game_won` | Player won a settled game (optionally filtered by scope) | `game.settled` event `isWinner` |
| `lobby_filled` | `lobby_filled` | A game the player created was filled and settled (they attracted an opponent) | `game.settled` event `isCreator` + settled |

**Adapter interface:**
```typescript
interface AdapterResult {
  shouldProgress: boolean;
  progressDelta: number;    // usually 1, but could be more for volume-based
}

type VerificationAdapter = (
  event: GameSettledPayload,
  assignment: ChallengeAssignment,
  db: Db,
) => Promise<AdapterResult>;
```

**Condition types:**
- `count`: increment by 1 for each qualifying event. Complete when `progress >= target`.
- `unique_game_types`: count distinct game types played. Complete when unique count >= target.
- `unique_opponents`: M2 — deferred for launch.
- `streak`: M2 — deferred for launch.

**Acceptance Criteria:**
- [x] Adapter registry maps `action` string to adapter function <!-- satisfied: challenge-adapters.ts:134-138, Map with 3 entries -->
- [x] `game_completed` adapter: returns `shouldProgress: true` when game matches scope (or scope = 'any') <!-- satisfied: challenge-adapters.ts:93, unit tests confirm -->
- [x] `game_won` adapter: returns `shouldProgress: true` when player `isWinner === true` and game matches scope <!-- satisfied: challenge-adapters.ts:106, unit tests confirm -->
- [x] `lobby_filled` adapter: returns `shouldProgress: true` when `isCreator === true` and game settled normally <!-- satisfied: challenge-adapters.ts:120, unit tests confirm -->
- [x] Each adapter is a pure function of (event, assignment, db) — no side effects beyond the returned result <!-- satisfied: returns AdapterResult only, no DB writes -->
- [x] Unknown adapter types log a warning and return `shouldProgress: false` <!-- satisfied: getAdapter returns no-op adapter, unit test confirms -->

---

### FR-8: Challenge Template Evaluation Engine

The core engine that receives `game.settled` events, loads the player's active assignments, runs the appropriate adapter for each, updates progress, and emits reward-intent events. Reward mutation and payout side-effects are handled in dedicated downstream handlers, not inline in the challenge evaluator.

**Processing flow per `game.settled` event:**
```
1. For each player in the event:
   a. Run quest_eligible() check (FR-10). Skip if disqualified.
   b. Load all active challenge_assignments for this user_id
   c. For each assignment:
      i.   Get the challenge definition (action, scope, condition, threshold)
      ii.  Run the matching verification adapter
      iii. If shouldProgress: insert progress_event (idempotent via UNIQUE), increment assignment.progress
      iv.  If progress >= target: mark assignment completed, set completed_at, and emit challenge reward intent from `challenges.reward_type`
      v.   Check completion bonus eligibility (FR-9)
   d. Emit `points.grant` for wager-based points (FR-3)
   e. Emit `crate.drop` for crate evaluation (FR-5)
2. Once per round, emit `reward.pool_fund` using the settled round fee (FR-4)
```

**Acceptance Criteria:**
- [x] `game.settled` handler registered in the event queue handler registry <!-- satisfied: index.ts:217 registerHandler(EventTypes.GAME_SETTLED) -->
- [x] Handler iterates all players in the event payload <!-- satisfied: game-settled.ts for loop over event.players -->
- [x] Quest eligibility check runs before any progress/points/crate processing <!-- satisfied: game-settled.ts:171 questEligible called first -->
- [x] Active assignments loaded efficiently (indexed query on user_id + status = 'active') <!-- satisfied: getActiveAssignmentsWithChallenge uses idx_assignments_active -->
- [x] Progress updates are atomic: INSERT progress_event + UPDATE assignment.progress in one transaction <!-- satisfied: insertProgressEvent + incrementAssignmentProgress in withTransaction -->
- [x] Assignment status transitions to 'completed' when progress >= target <!-- satisfied: markAssignmentCompleted sets status + completed_at -->
- [x] Challenge completion emits reward intents through the same downstream path as other rewards (`points.grant` with `source_type = 'challenge_completed'`, or `crate.drop` with `trigger_type = 'challenge_completed'`) <!-- satisfied: game-settled.ts emits matching events -->
- [x] Points, crate, and pool-funding side-effects are emitted as separate reward events after challenge evaluation <!-- satisfied: pool_fund, points.grant, crate.drop are independent events -->
- [x] `game.settled` handler is idempotent for progress and reward-event emission; downstream reward handlers are independently idempotent <!-- satisfied: UNIQUE(assignment_id, round_id) on progress_events -->
- [x] Handler errors don't affect other players in the same event (per-player try/catch) <!-- satisfied: game-settled.ts:169-300 per-player isolation -->
- [x] Processing time per event is bounded (< 100ms target for the DB operations) <!-- satisfied: efficient indexed queries; aspirational target -->

---

### FR-9: Completion Bonus

A meta-reward for completing a set of challenges within a period. Primary use case: "Complete all 3 daily challenges -> bonus crate."

**Mechanics:**
- `completion_bonuses` row links to a campaign and specifies `required_count`
- After any assignment is marked completed, the engine counts completed assignments for that user in the same `period_key` and campaign
- If count >= `required_count` and no `bonus_completions` row exists for this user+bonus+period: mark bonus complete, trigger reward

**Acceptance Criteria:**
- [x] Completion bonus check runs immediately after any assignment is marked completed <!-- satisfied: game-settled.ts calls checkCompletionBonus after markAssignmentCompleted -->
- [x] Count query: `SELECT COUNT(*) FROM challenge_assignments WHERE user_id = ? AND period_key = ? AND status = 'completed' AND challenge_id IN (SELECT id FROM challenges WHERE campaign_id = ?)` <!-- satisfied: completion-bonus.ts:43 countCompletedAssignments -->
- [x] Bonus completion is idempotent (UNIQUE on user_id, bonus_id, period_key) <!-- satisfied: insertBonusCompletion ON CONFLICT DO NOTHING -->
- [x] Bonus reward (crate or points) is triggered via the same reward path as challenge rewards <!-- satisfied: emits points.grant or crate.drop -->
- [x] Multiple bonuses can exist per campaign (future-proofing, but M1 has one per daily campaign) <!-- satisfied: getCompletionBonuses returns array -->

---

### FR-10: Anti-Gaming & Quest Eligibility

Every game session is evaluated before counting toward challenge progress, points earning, or crate drops. In M1 this is intentionally lightweight: the only hard gate is refunded-game exclusion. We are explicitly not trying to ship a strong anti-abuse system until real usage gives us better signal.

**`quest_eligible(event, player)` checks:**
1. Game settled normally (not refunded — `isWinner !== null`)

If the check fails, the game session is skipped for challenge progress, points, AND crate drops. The game still counts for normal gameplay (leaderboard, referral earnings, etc.) — only the reward system is gated.

**Advisory fraud flags (optional, async, non-blocking):**
| Signal | Action |
|---|---|
| 5+ challenge completions in < 10 minutes | Create `fraud_flags` row, type: `velocity`, review only |
| Same repeated opponent pattern across a recent sample | Create `fraud_flags` row, type: `repeated_opponent`, review only |
| SOL crate drop for already-flagged user | Optional hold for manual review if ops decides to turn it on |

Fraud flags are draft-level operator signals in M1. They should not block normal progress or payouts unless an explicit operator policy is added later.

**Acceptance Criteria:**
- [x] `quest_eligible()` function implemented and called before all reward processing <!-- satisfied: challenge-adapters.ts:72, called at game-settled.ts:171 -->
- [x] Refunded games (`isWinner === null`) are excluded from challenge progress, points, and crate drops <!-- satisfied: questEligible returns false; unit + integration tests confirm -->
- [x] Non-refund games continue through normal challenge/reward flow with no additional M1 gating <!-- satisfied: questEligible returns true for winners and losers -->
- [x] Ineligible games still settle normally (no impact on core game loop) <!-- satisfied: quest_eligible is downstream of settlement -->
- [x] Any fraud flags implemented in M1 are advisory-only and do not silently change reward behavior <!-- satisfied: no fraud flag logic implemented; vacuously true (spec says "optional") -->

---

### FR-11: Daily & Weekly Challenge Assignment

Players receive a set of challenges at each reset. Challenges are drawn from the pool of active challenge templates in the relevant campaign.

**Daily (00:00 UTC):**
- 3 challenges drawn from the "Daily" campaign's active challenge pool
- Fixed for M1: all players get the same 3 — selected as the top N active challenges by `sort_order ASC` (deterministic, operator-controlled via admin API). Rotation is M2.
- Assignments expire at next daily reset (24h)

**Weekly (Monday 00:00 UTC):**
- 2 challenges drawn from the "Weekly" campaign's active challenge pool
- Fixed for M1: all players get the same 2 — selected as the top N active challenges by `sort_order ASC`
- Assignments expire at next weekly reset (7d)

**Assignment mechanics:**
- M1 uses lazy assignment only: on first `GET /challenges/mine` call after reset, if no assignments exist for the current period, generate them for that user
- No bulk reset-time assignment worker in M1
- Expired assignments (past `expires_at`, still `active`) are transitioned to `expired` at query time or by a lightweight cleanup worker
- Deactivating a challenge template does not affect existing assignments — players keep their in-progress work for the current period

**Acceptance Criteria:**
- [x] Daily challenges assigned lazily on first `GET /challenges/mine` call after 00:00 UTC <!-- satisfied: routes/challenges.ts:309, checks period + creates -->
- [x] Weekly challenges assigned lazily on first call after Monday 00:00 UTC <!-- satisfied: same endpoint handles weekly lazy assignment -->
- [x] `period_key` format: `daily:YYYY-MM-DD` for dailies, `weekly:YYYY-WNN` for weeklies <!-- satisfied: challenges.ts:71 dailyPeriodKey, :77 weeklyPeriodKey -->
- [x] Assignment count matches campaign config (3 daily, 2 weekly for M1) <!-- satisfied: reads daily_challenge_count/weekly_challenge_count from config -->
- [x] Challenges drawn from active challenges in the appropriate campaign <!-- satisfied: getActiveChallengesBySort queries by sort_order ASC -->
- [x] UNIQUE constraint prevents duplicate assignments for same user+challenge+period <!-- satisfied: UNIQUE(user_id, challenge_id, period_key) -->
- [x] Expired assignments are marked `expired` (either at query time or by cleanup worker) <!-- satisfied: expireStaleAssignments at start of GET /challenges/mine -->
- [x] Completion bonus for the daily campaign is checked when 3rd daily is completed <!-- satisfied: checkCompletionBonus called after each completion -->

---

### FR-12: Onboarding Quest Chain

A one-time sequential challenge flow for new players. Uses `prerequisite_id` to enforce ordering.

**Steps:**
1. "Play your first game" — `{action: game_completed, scope: any, threshold: 1, reward: 1000 points}`
2. "Win a game" — `{action: game_won, scope: any, threshold: 1, reward: 1500 points, prerequisite: step 1}`
3. "Try all 3 game types" — `{action: game_completed, scope: any, condition: unique_game_types, threshold: 3, reward: 2500 points + crate, prerequisite: step 2}`

**Mechanics:**
- Onboarding campaign with `campaign_type = 'onboarding'`
- Assignments created lazily on first `GET /challenges/mine` call (if user has no onboarding assignments)
- Only the first step (no prerequisite) is assigned initially
- When a step completes, the next step (whose `prerequisite_id` matches the completed challenge) is automatically assigned
- Onboarding challenges never expire
- Once all steps are completed, onboarding is done — no repeat

**Acceptance Criteria:**
- [x] Onboarding campaign and 3 challenge templates seeded in migration or seed script <!-- satisfied: 011_challenge_engine.sql:200-234, 3-step chain -->
- [x] First onboarding step assigned on first `GET /challenges/mine` call for new users <!-- satisfied: challenges.ts assigns first step if none -->
- [x] Completing a step auto-assigns the next step (by `prerequisite_id`) <!-- satisfied: onboarding-chain.ts:29 getNextOnboardingStep; integration test confirms -->
- [x] Onboarding assignments have `period_key = 'onboarding'` and no `expires_at` <!-- satisfied: createAssignment sets period_key='onboarding', expires_at=NULL -->
- [x] Onboarding is one-time: once all steps completed, no further assignments <!-- satisfied: UNIQUE constraint + existing assignment check -->
- [x] Onboarding challenges appear in `GET /challenges/mine` alongside daily/weekly <!-- satisfied: challenges.ts returns onboarding section in response -->

---

### FR-13: Reward Configuration

All economy parameters stored in `reward_config` table, readable by the engine at evaluation time, updatable via admin API.

**Default seed values:**

| Key | Default | Description |
|---|---|---|
| `points_per_dollar` | `500` | Base points per $1 USD wagered |
| `dogpile_default_multiplier` | `2.0` | Default multiplier for new Dogpile events |
| `reward_pool_fee_share` | `0.20` | Fraction of fees routed to reward pool |
| `points_crate_drop_rate` | `0.05` | 5% chance per player per settled game |
| `sol_crate_drop_rate` | `0.01` | 1% chance per player per settled game |
| `sol_crate_pool_pct` | `0.10` | SOL crate pays 10% of pool balance |
| `sol_crate_min_value` | `10000000` | 0.01 SOL minimum (below = suppress) |
| `points_crate_min` | `500` | Minimum points in a points crate |
| `points_crate_max` | `5000` | Maximum points in a points crate |
| `daily_challenge_count` | `3` | Challenges assigned per daily reset |
| `weekly_challenge_count` | `2` | Challenges assigned per weekly reset |

**Acceptance Criteria:**
- [x] `reward_config` table seeded with all defaults above in the migration <!-- satisfied: 011_challenge_engine.sql:183-194, all 11 keys -->
- [x] Config values read by the engine at evaluation time (not cached beyond a single handler invocation) <!-- satisfied: readRewardConfig called per handler invocation -->
- [x] Admin API endpoint `PUT /admin/reward-config/:key` updates a config value <!-- satisfied: admin.ts:64, integration test confirms -->
- [x] Admin API endpoint `GET /admin/reward-config` returns all config values <!-- satisfied: admin.ts:52, integration test confirms 11 entries -->
- [x] Admin endpoints require operator auth (existing auth middleware or admin-only check) <!-- satisfied: admin.ts:43-48, X-Admin-Key middleware -->
- [x] Invalid config keys rejected (400) <!-- satisfied: admin.ts validates against VALID_CONFIG_KEYS set -->
- [x] Config change takes effect on next `game.settled` event (no restart needed) <!-- satisfied: no caching — reads from DB each handler invocation -->

---

### FR-14: Player-Facing API Endpoints

API for the frontend to display challenges, progress, points, and crate history.

Player-facing note: all challenge and reward updates are async from `game.settled`. Progress, points, and crate history should appear within seconds after settlement, but are not guaranteed to be visible in the same request path that triggered settlement.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/challenges/mine` | Returns active + recently completed challenges for the authenticated user. Triggers lazy assignment if needed. |
| `GET` | `/challenges/mine/history` | Paginated list of past challenge completions |
| `GET` | `/points/mine` | Returns current point balance and lifetime earned |
| `GET` | `/points/mine/history` | Paginated points ledger history from `point_grants` |
| `GET` | `/crates/mine` | Paginated crate drop history with `status` (`pending`, `granted`, `failed`) |
| `GET` | `/dogpile/current` | Returns current/next Dogpile event (if any) with countdown to start or end |
| `GET` | `/dogpile/schedule` | Returns upcoming Dogpile events |

**`GET /challenges/mine` response shape:**
```typescript
{
  daily: {
    challenges: Array<{
      id: number;
      title: string;
      description: string;
      progress: number;
      target: number;
      status: "active" | "completed" | "expired";
      reward: { type: "points" | "crate"; amount?: number };
      completedAt: string | null;
    }>;
    bonus: {
      title: string;
      required: number;
      completed: number;
      status: "active" | "completed";
      reward: { type: "points" | "crate"; amount?: number };
    } | null;
    resetsAt: string;  // ISO 8601
  };
  weekly: {
    /* same shape; `bonus` is `null` in M1 unless a weekly completion bonus is explicitly configured */
  };
  onboarding: {
    steps: Array<{ /* same shape + locked: boolean */ }>;
    completed: boolean;
  } | null;  // null after onboarding complete
}
```

**Acceptance Criteria:**
- [x] `GET /challenges/mine` returns daily, weekly, and onboarding sections <!-- satisfied: challenges.ts:309, response includes all 3 sections -->
- [x] Lazy assignment triggered on first call after daily/weekly reset <!-- satisfied: challenges.ts checks for existing assignments per period_key -->
- [x] Response includes progress, target, status, reward, and reset countdown <!-- satisfied: integration test validates shape -->
- [x] Onboarding section shows locked steps (prerequisite not yet met) with `locked: true` <!-- satisfied: challenges.ts:439, locked = !isAssigned -->
- [x] Onboarding section is `null` for players who completed all onboarding steps <!-- satisfied: challenges.ts:434, returns null when allCompleted -->
- [x] `GET /points/mine` returns `{ balance, lifetimeEarned }` <!-- satisfied: points.ts:44, returns zeros if no row -->
- [x] `GET /points/mine/history` returns paginated point grant rows with source metadata and timestamps from `point_grants` <!-- satisfied: points.ts:71, cursor-based DESC -->
- [x] `GET /challenges/mine/history` returns paginated past completions <!-- satisfied: challenges.ts:497, cursor-based DESC -->
- [x] `GET /crates/mine` returns paginated crate drops with type, amount, timestamp, and payout status semantics (`pending` queued, `granted` applied, `failed` needs retry/manual review) <!-- satisfied: points.ts:136, includes crateType, contentsAmount, status -->
- [x] `GET /dogpile/current` returns active event with countdown to `ends_at`, or next scheduled event with countdown to `starts_at` <!-- satisfied: dogpile.ts:39, endsIn/startsIn countdown fields -->
- [x] All endpoints require JWT auth (existing middleware) <!-- satisfied: /dogpile/* now uses JWT auth (index.ts:312-315, fixed in gap analysis) -->
- [x] All endpoints use standard error format (existing `errorResponse` helper) <!-- satisfied: consistent errorResponse pattern across all route files -->

---

### FR-15: Admin API Endpoints

Internal endpoints for operators to manage campaigns, challenges, Dogpile events, and reward tuning. Fraud review and richer analytics are deferred until the lightweight M1 loop proves useful.

| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/campaigns` | Create a campaign |
| `PUT` | `/admin/campaigns/:id` | Update campaign (toggle active, change dates) |
| `POST` | `/admin/challenges` | Create a challenge template in a campaign |
| `PUT` | `/admin/challenges/:id` | Update challenge (toggle active, change threshold/reward) |
| `POST` | `/admin/dogpile` | Schedule a Dogpile event |
| `PUT` | `/admin/dogpile/:id` | Update/cancel a Dogpile event |
| `GET` | `/admin/dogpile` | List all Dogpile events |
| `PUT` | `/admin/reward-config/:key` | Update a reward config value |
| `GET` | `/admin/reward-config` | List all reward config values |
| `GET` | `/admin/reward-pool` | Reward pool balance and lifetime stats |

**Acceptance Criteria:**
- [x] All admin endpoints require operator-level auth <!-- satisfied: admin.ts:43-48, X-Admin-Key header check -->
- [x] Campaign CRUD: create, update, toggle active. Cannot delete (soft-disable only). <!-- satisfied: POST/PUT /admin/campaigns, no DELETE endpoint -->
- [x] Challenge CRUD: create, update, toggle active within a campaign <!-- satisfied: POST/PUT /admin/challenges, validates campaign_id -->
- [x] Dogpile scheduling: create events, cancel future events, cannot modify active events <!-- satisfied: POST/PUT /admin/dogpile, rejects active with 409 -->
- [x] Reward config: read all, update by key <!-- satisfied: GET/PUT /admin/reward-config -->
- [x] Reward pool: read current balance, lifetime funded, lifetime paid <!-- satisfied: GET /admin/reward-pool returns all 3 fields -->

---

## Success Criteria

1. A player who plays 5 flipyou games in a day sees their "Play 5 games" daily challenge progress from 0/5 to 5/5 and transition to completed — without any manual action.
2. A player who completes all 3 daily challenges receives a bonus crate.
3. A new player who has never played sees onboarding challenges guiding them through their first games.
4. Points accumulate proportionally to wagered volume across all games.
5. SOL crate payouts are capped and recorded by reward-pool accounting and never exceed the pool balance.
6. During a Dogpile event, points earned per game are doubled (or per configured multiplier).
7. A refunded round does not advance challenges, points, or crate drops.
8. An operator can change the points-per-dollar rate and see it take effect on the next settled game.

---

## Dependencies & Assumptions

**Dependencies:**
- Async event queue (spec 301) — operational, used for event routing
- Settlement workers — operational for all 3 games, need `game.settled` event emission added
- Existing `/price/sol` endpoint — used for USD conversion in points calculation
- JWT auth — used for player-facing endpoints
- Treasury-managed payout wallet — used for SOL crate payouts (same pattern as referral claims)

**Assumptions:**
- SOL/USD price is reasonably fresh (Close Call already depends on this)
- Game volume is sufficient to fund the reward pool meaningfully (if not, seed the pool manually)
- Frontend team will consume the API contract defined in FR-14 (we don't build the UI)
- M1 uses fixed daily/weekly challenge selection (same for all players). Pool rotation is M2.

---

## Validation Plan

| Criterion | Method | Evidence |
|---|---|---|
| Points awarded correctly | Integration test: settle game, check `point_grants` + `player_points` | Test output |
| SOL crate accounting debits pool correctly | Integration test: settle game with mock RNG, verify `reward_pool_fundings` + pool decrement | Test output |
| Dogpile multiplier applies | Integration test: settle game during active Dogpile, verify 2x points | Test output |
| Refunded rounds are excluded | Integration test: process refunded settlement, verify no progress, no points, no crates | Test output |
| Challenge progress automatic | Integration test: settle game, verify assignment.progress incremented | Test output |
| Completion bonus triggers | Integration test: complete 3 dailies, verify bonus_completions row | Test output |
| Onboarding chain sequential | Integration test: complete step 1, verify step 2 assigned | Test output |
| Idempotency | Integration test: process same logical round twice (duplicate enqueue / replay), verify no duplicate progress, grants, crates, or pool funding | Test output |
| Config changes live | Integration test: update config, settle game, verify new config applied | Test output |
| Pool can't go negative | Integration test: drain pool, verify SOL crate suppressed | Test output |
| API returns correct shape | Integration test: call `/challenges/mine`, verify response schema | Test output |
| Points history is auditable | Integration test: award points from wager + crate + challenge completion, verify `/points/mine/history` ledger rows | Test output |

---

## Design Decisions & Review Notes

Tightenings applied during spec review (2026-04-03). Rationale for each:

### 1. `progress_events.metadata` JSONB column added (FR-2)
The `unique_game_types` condition requires knowing which game types have already been counted for an assignment. Without metadata, the adapter would need to join back to round data via `round_id` on every evaluation — fragile and slow. Storing `{"game":"flipyou"}` in the progress event lets the adapter query `SELECT DISTINCT metadata->>'game' FROM progress_events WHERE assignment_id = ?` directly. This is in the M1 critical path (onboarding step 3 and weekly "play every game type" both use `unique_game_types`).

### 2. `challenges.scope` CHECK constraint added (FR-2)
Without validation, a typo like `'coinflp'` in seed data or admin API would silently create a challenge that never matches any settled game. The CHECK constraint (`scope IN ('any', 'flipyou', 'lord', 'closecall')`) catches this at insert time. When new game types ship, the constraint must be extended via migration — an acceptable cost vs silent misconfiguration.

### 3. `challenges.eligible_if` JSONB column added (FR-2)
The reference spec defined `EligibilityRule` (min_heat_tier, min_games_played) as a first-class entity. M1 doesn't need eligibility gating, but adding a JSONB column now is zero runtime cost and avoids a schema migration once targeted challenges are needed in M2. The engine ignores it in M1 (empty object = no rules). When eligibility logic is implemented, it reads this field — no DDL change required.

### 4. Deterministic challenge selection rule specified (FR-11)
"All players get the same 3" was underspecified — without a defined selection rule, two players calling `/challenges/mine` at different times could get different assignments if the active pool changed between requests. Selection is now explicitly `ORDER BY sort_order ASC LIMIT N` from active challenges. This is deterministic, operator-controllable via the admin API (reorder to rotate which challenges are live), and trivially replaceable with a seed-based random draw when pool rotation ships in M2.

### 5. Template deactivation policy documented (FR-11)
Admin could deactivate a challenge template while players have live assignments for it. Without a stated policy, implementations might auto-expire those assignments (losing player progress) or leave them in a broken state. Policy: deactivating a template does not affect existing assignments. Players finish their current period; the deactivated template simply won't be selected for future periods.

### 6. Pool row-lock requirement made explicit (FR-4, FR-5)
SOL crate payout reads the pool balance, calculates a percentage, and decrements. If two `crate.drop` events are processed concurrently (the event queue claims batches of 10), both could read the same balance and overspend. While the current queue processes events serially per worker, this is an implementation detail — the spec should not assume it. Requiring `SELECT ... FOR UPDATE` on the `reward_pool` singleton before balance reads makes the invariant (pool never goes negative) hold regardless of concurrency model.

### 7. Event naming convention note
The spec uses dot-notation in prose (`game.settled`, `reward.pool_fund`) and SCREAMING_SNAKE in the implementation checklist (`GAME_SETTLED`, `REWARD_POOL_FUND`). Reviewed and confirmed consistent: SCREAMING_SNAKE is the TypeScript constant name, dot-notation is the logical event type string stored in the queue. This matches the existing codebase pattern (`REFERRAL_CODE_APPLIED` constant → `referral.code_applied` type string). No change needed.

### Known M2 migration points
These are deliberate M1 scoping decisions, not oversights:

| Future need | M1 state | Migration path |
|---|---|---|
| Multi-condition challenges | Single action per challenge | Add `challenge_steps` table, update evaluation engine |
| Pool rotation (per-player dailies) | `sort_order`-based fixed selection | Swap selection function to seed-based random draw |
| Streak / volume conditions | Only `count` + `unique_game_types` | New adapter + condition evaluator branch |
| KOL-triggered challenges | No attribution scoping | Campaign-level scoping + KOL dashboard |
| Flash quests / ephemeral | No real-time push | Push notification infra + ephemeral campaign type |

---

## Completion Signal

### Implementation Checklist

Each item is one autonomous iteration (one `claude -p` invocation). Tests are bundled with the feature they verify. Items are ordered by dependency — execute top to bottom.

**Phase 0: Event Plumbing**

- [x] [backend] Add `GAME_SETTLED`, `REWARD_POOL_FUND`, `POINTS_GRANT`, `CRATE_DROP`, `CRATE_SOL_PAYOUT` event types to `event-types.ts`. Emit `game.settled` event in `settle-tx.ts` within the existing settlement DB transaction for both flipyou and lord (jackpot) rounds — payload must match FR-1 schema (roundId, roundPda, game, players[], feeLamports, settledAt). Integration test: settle a flipyou round, verify `game.settled` event row in `event_queue` with correct payload shape; duplicate settlement retry produces duplicate event rows safely. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-1) (done: iteration 1)

- [x] [backend] Emit `game.settled` event in `closecall-clock.ts` within the closecall settlement transaction — same payload schema as FR-1 with `game: "closecall"`. Integration test: settle a closecall round, verify event row in queue with correct payload. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-1) (done: iteration 2)

**Phase 1: Data Model & Seeds**

- [x] [backend] Create migration `011_challenge_engine.sql` with all tables from FR-2: `reward_config`, `player_points`, `point_grants`, `reward_pool`, `reward_pool_fundings`, `campaigns`, `challenges` (with `scope` CHECK constraint and `eligible_if` JSONB column), `challenge_assignments`, `progress_events` (with `metadata` JSONB column), `completion_bonuses`, `bonus_completions`, `crate_drops`, `fraud_flags`, `dogpile_events`. Seed `reward_config` with all FR-13 defaults. Seed `reward_pool` singleton (balance 0). Seed campaigns: daily, weekly, onboarding. Seed ~6 daily challenge templates + ~4 weekly challenge templates (from FR-11 examples, ordered by `sort_order`). Seed 3 onboarding challenge templates with `prerequisite_id` chain (FR-12). Seed daily completion bonus (required_count=3, reward_type='crate'). Test: migration runs cleanly on fresh DB, all seeds present, foreign keys enforced, UNIQUE constraints verified. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-2, FR-9, FR-11, FR-12, FR-13) (done: iteration 3)

**Phase 2: Reward Handlers**

- [x] [backend] Implement `quest_eligible(event, player)` function: returns `false` when `isWinner === null` (refunded game), `true` otherwise. Implement adapter registry (Map from action string to adapter function). Implement 3 M1 adapters matching the `VerificationAdapter` interface from FR-7: `game_completed` (returns `shouldProgress: true` when game matches `scope` or scope='any'), `game_won` (additionally requires `isWinner === true`), `lobby_filled` (requires `isCreator === true`). Unknown action types log warning and return `shouldProgress: false`. Unit tests: each adapter with scope='any' and scope-specific cases; refund exclusion via quest_eligible; unknown adapter type. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-7, FR-10) (done: iteration 4)

- [x] [backend] Implement `REWARD_POOL_FUND` handler and register in handler registry. DB helpers needed: `readRewardConfig(db, key)` to read from `reward_config`, `insertPoolFunding(db, roundId, feeLamports, fundedLamports)` with UNIQUE(round_id) idempotency, `incrementRewardPool(db, deltaLamports)` to atomically update `balance_lamports` + `lifetime_funded`. Handler logic: read `reward_pool_fee_share` from config, calculate `floor(feeLamports * share)`, insert funding record (if duplicate, return early), increment pool. Integration test: emit event, verify pool balance incremented + funding ledger row; re-emit same round_id, verify no duplicate funding + balance unchanged. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-4) (done: iteration 5)

- [x] [backend] Implement `POINTS_GRANT` handler and register. DB helpers needed: `insertPointGrant(db, userId, wallet, sourceType, sourceId, amount, metadata)` with UNIQUE(user_id, source_type, source_id) idempotency, `upsertPlayerPoints(db, userId, wallet, amount)` to create-or-increment balance + lifetime_earned, `getActiveDogpileEvent(db, timestamp)` to check for active dogpile event. Handler logic: read `points_per_dollar` from config, fetch SOL/USD price from existing price service (`GET /price/sol-usd`, cached), calculate `floor(wagerUsd * pointsPerDollar * multiplier)`, insert ledger row (if duplicate, return early), upsert player_points. Integration test: emit event, verify point_grants row + player_points updated; test with active dogpile_events row for 2x multiplier; test idempotency. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-3, FR-6) (done: iteration 6)

- [x] [backend] Implement `CRATE_DROP` handler and register. DB helpers needed: `lockAndReadRewardPool(db)` (`SELECT ... FOR UPDATE` on singleton), `decrementRewardPool(db, payoutLamports)` to atomically decrement balance + increment lifetime_paid, `insertCrateDrop(db, userId, triggerType, triggerId, crateType, contentsAmount)` with UNIQUE(user_id, trigger_type, trigger_id) idempotency. Handler logic: read drop rates + sol_crate_pool_pct + sol_crate_min_value + points_crate_min/max from config, roll RNG. SOL path: lock pool, calculate `floor(balance * sol_crate_pool_pct)`, suppress if < min_value, decrement pool, insert crate_drops, emit `CRATE_SOL_PAYOUT`. Points path: random amount in [min, max], insert crate_drops, emit `POINTS_GRANT` with source_type='crate_points'. Miss: return without side-effects. Integration test with deterministic seeded RNG: SOL hit → verify pool decremented + crate row + sol_payout event emitted; points hit → verify crate row + points.grant event emitted; miss → verify no crate row; pool below min → verify SOL crate suppressed. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-5) (done: iteration 7)

**Phase 3: Challenge Evaluation Engine**

- [x] [backend] Implement `GAME_SETTLED` handler (the orchestrator) and register. DB helpers needed: `getActiveAssignmentsWithChallenge(db, userId)` (JOIN challenge_assignments + challenges WHERE status='active'), `insertProgressEvent(db, assignmentId, roundId, userId, delta, metadata)` with UNIQUE(assignment_id, round_id) idempotency, `incrementAssignmentProgress(db, assignmentId, delta)`, `markAssignmentCompleted(db, assignmentId)`. Handler flow per FR-8: for each player in event → quest_eligible check → load active assignments → for each: run matching adapter, if shouldProgress: insert progress_event (with `metadata: {game: event.game}`), increment progress, if progress >= target: mark completed + emit reward intent (points.grant with source_type='challenge_completed' or crate.drop with trigger_type='challenge_completed'). After assignments: emit points.grant for wager points (one per eligible player, source_type='wager', source_id=roundId), emit crate.drop (one per eligible player, trigger_type='game_settled', trigger_id=roundId). Once per round: emit reward.pool_fund. Per-player try/catch. Integration test: create assignments for a user, emit game.settled, verify progress incremented; settle enough games to complete a challenge, verify status='completed' + reward intent emitted; verify refunded round skipped; verify idempotency (same event twice = no double progress). Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-8, FR-10) (done: iteration 8)

- [x] [backend] Implement completion bonus check, called from game.settled handler after any assignment is marked completed. DB helpers needed: `getCompletionBonuses(db, campaignId)`, `countCompletedAssignments(db, userId, periodKey, campaignId)`, `insertBonusCompletion(db, userId, bonusId, periodKey)` with UNIQUE(user_id, bonus_id, period_key) idempotency. Logic: after assignment completion, get bonuses for the assignment's campaign, count completed assignments for user+period+campaign, if count >= required_count and no existing bonus_completion: insert row, emit reward intent. Integration test: complete 3 daily assignments, verify bonus_completions row + reward emitted; re-trigger check, verify no duplicate; complete 2 of 3, verify no bonus. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-9) (done: iteration 9)

- [x] [backend] Implement onboarding chain progression, called from game.settled handler after any onboarding assignment is marked completed. DB helpers needed: `getNextOnboardingStep(db, completedChallengeId)` (query challenges WHERE prerequisite_id = completedId), `createAssignment(db, userId, challengeId, periodKey, target, expiresAt)`. Logic: on onboarding step completion, find next step by prerequisite_id, if found and no existing assignment for user+challenge+'onboarding': create assignment with period_key='onboarding' and expires_at=NULL. Integration test: complete onboarding step 1, verify step 2 auto-assigned; complete all 3 steps, verify no further assignment created; verify idempotent. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-12) (done: iteration 10)

**Phase 4: Player-Facing API**

- [x] [backend] Implement `GET /challenges/mine` with JWT auth and lazy assignment. DB helpers needed: `getAssignmentsForPeriod(db, userId, periodKey)`, `getActiveChallengesBySort(db, campaignId, limit)` (top N by sort_order ASC from active challenges), `getOnboardingState(db, userId)` (completed steps + active step), `expireStaleAssignments(db, userId)` (mark expired where expires_at < now() AND status='active'). Logic: compute current period keys (daily:YYYY-MM-DD, weekly:YYYY-WNN), expire stale assignments, check for existing assignments per period, if none: select top N challenges by sort_order, create assignments with target + expires_at. Onboarding: if no onboarding assignments exist and user hasn't completed all steps, assign first step (prerequisite_id IS NULL). Return response shape from FR-14 (daily/weekly/onboarding sections with progress, bonus status, resetsAt). Integration test: first call creates 3 daily + 2 weekly + 1 onboarding assignment, returns correct shape; second call returns same; expired assignments marked. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-11, FR-14) (done: iteration 11)

- [x] [backend] Implement `GET /points/mine` (JWT auth, returns `{balance, lifetimeEarned}` from player_points — return zeros if no row), `GET /points/mine/history` (JWT auth, paginated point_grants rows DESC by created_at with source_type, source_id, amount, metadata, created_at), `GET /crates/mine` (JWT auth, paginated crate_drops rows DESC by created_at with crate_type, contents_amount, status, created_at, granted_at). Use standard pagination pattern (cursor or offset+limit). Integration test: seed test data, verify response shapes; verify pagination; verify empty state returns correctly. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-14) (done: iteration 12)

- [x] [backend] Implement `GET /challenges/mine/history` (JWT auth, paginated completed challenge_assignments with challenge title, description, completed_at, reward — JOIN challenges for metadata). Implement `GET /dogpile/current` (active dogpile_events row with countdown to ends_at, or next scheduled with countdown to starts_at, or null), `GET /dogpile/schedule` (upcoming dogpile_events ordered by starts_at). Integration test: verify response shapes; dogpile/current returns active > next-scheduled > null priority. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-14) (done: iteration 13)

**Phase 5: Admin API**

- [x] [backend] Implement admin auth middleware: check `X-Admin-Key` header against `ADMIN_API_KEY` env var, reject with 401 if missing or mismatched. Implement `GET /admin/reward-config` (all config key-value pairs), `PUT /admin/reward-config/:key` (update value — reject unknown keys with 400), `GET /admin/reward-pool` (balance_lamports, lifetime_funded, lifetime_paid from singleton row). Apply admin middleware to all `/admin/*` routes. Integration test: request without key → 401; request with wrong key → 401; GET config returns seeded defaults; PUT updates value; GET pool returns balance. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-13, FR-15) (done: iteration 14)

- [x] [backend] Implement admin campaign + challenge CRUD: `POST /admin/campaigns` (create with name, campaign_type, starts_at, ends_at, config), `PUT /admin/campaigns/:id` (update fields, toggle is_active — no delete, soft-disable only), `POST /admin/challenges` (create in campaign — validate scope against CHECK constraint, validate campaign exists), `PUT /admin/challenges/:id` (update fields, toggle is_active). All require admin auth. Integration test: create campaign, create challenge in it, update both, verify DB state; invalid scope rejected; deactivated challenge not selected for new assignments. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-15) (done: iteration 15)

- [x] [backend] Implement admin dogpile endpoints: `POST /admin/dogpile` (schedule event with starts_at, ends_at, multiplier, optional campaign_id — validate no overlap with existing non-cancelled events), `PUT /admin/dogpile/:id` (cancel future/scheduled events — cannot modify active events), `GET /admin/dogpile` (list all events with status filter). Implement Dogpile status worker: periodic check (poll interval or lightweight cron) that transitions `scheduled→active` when `now() >= starts_at` and `active→ended` when `now() >= ends_at`. Integration test: schedule event, verify worker transitions status at correct times; cancel scheduled event; overlap rejected; cannot modify active event. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-6, FR-15) (done: iteration 16)

**Phase 6: SOL Payout**

- [x] [backend] Implement `CRATE_SOL_PAYOUT` handler and register. Follow the exact pattern from the referral claim handler (`referral-claim.ts`): load crate_drops row by ID from payload, verify status='pending', send SOL from treasury-managed payout wallet (server keypair) to player wallet via `@solana/web3.js` transfer, on success: update crate status to 'granted' + set granted_at, on transfer failure: update status to 'failed'. Integration test with mock keypair: emit event, verify transfer instruction built correctly + crate status updated to 'granted'; test failure path → status='failed'. Add entry to `docs/TECH_DEBT.md`: "SOL crate payout handler (`CRATE_SOL_PAYOUT`) needs manual review before production enablement — verify transfer amounts, error handling, retry behavior, and rate limiting against real treasury wallet." Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-5) (done: iteration 17)

### Testing Requirements

- All DB operations tested against real Postgres (no mocks)
- Settlement event emission tested end-to-end (settle game → event in queue)
- Challenge lifecycle tested end-to-end (assign → settle games → progress → complete → bonus)
- Points calculation tested with known SOL/USD price
- Point ledger tested with multiple source types (`wager`, `challenge_completed`, `bonus_completed`, `crate_points`)
- Crate drop tested with deterministic RNG (seeded for tests)
- Refunded-round exclusion tested explicitly
- Idempotency tested by replaying the same logical round and verifying no duplicate side-effects
- API response shapes validated against TypeScript types
- Admin auth tested (missing key, wrong key, valid key)

### Iteration Instructions

- Execute items strictly top-to-bottom — each depends on prior items
- Each iteration: implement feature + write its integration test + verify with `cd backend && pnpm lint && pnpm typecheck && pnpm test`
- Run full `./scripts/verify` after Phase 6 (final iteration) before declaring complete
- Admin endpoints use `X-Admin-Key` header checked against `ADMIN_API_KEY` env var
- Fraud flags (Phase 1d from original spec) are **deferred entirely** — not in scope for this checklist
- The `eligible_if` JSONB column on challenges is seeded as `'{}'` and ignored by M1 engine logic — reserved for M2 eligibility rules

---

## Deferred to M2

| Feature | Why deferred |
|---|---|
| Pool rotation with dynamic lobby weighting | Fixed dailies work fine for launch. Rotation adds engagement depth but is an optimization. |
| Event-triggered ephemeral quests | Requires Dogpile to be fully operational with its own incentive structure first. |
| Quest completion leaderboard | Volume leaderboard already serves the competitive function. |
| Game-specific quest chains | Onboarding chain (M1) proves the mechanic. Deep chains matter at M2 when novelty wears off. |
| KOL-triggered custom challenges | Requires KOL dashboard and per-KOL scoping. Better after KOL feedback. |
| Flash quests | Requires real-time push notifications to be effective. |
| Quest history UI | Backend already stores records. Pure frontend feature. |
| `unique_opponents` adapter | Requires heavier time-window queries and edge-case handling than the initial M1 loop needs. |
| `referral_converted` adapter | Couples challenge progress to referral-system semantics; better after the core loop is stable. |
| Win streak adapter | More complex state tracking (must reset on loss). Not needed for initial challenge variety. |
| Wager volume adapter | Useful but not critical when points already reward volume directly. |
| Fraud review admin APIs and challenge analytics dashboards | Useful after real usage reveals what operators need; not required for the first lightweight loop. |
| Clawback execution | Fraud signals are draft-level in M1; automated reward reversal is M2. |
| Crate opening animation/UX | Frontend concern. Backend grants instantly. |
