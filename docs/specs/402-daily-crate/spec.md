# Specification: [402] Daily Crate

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Economy |
| Replaces | Per-game `crate.drop` flow in spec 400 |
| Authors | (assigned at refine time) |

---

## Overview

Replace the per-game random crate drop (spec 400) with a single **Daily Crate** per player per UTC day. As a player wagers throughout the day, their crate "tier" upgrades through stepped daily-wager-volume thresholds. At 00:00 UTC the tier locks; from the next day onward the player can claim the crate and receive a randomly-rolled prize (Points or SOL) drawn from that tier's prize table. Claims have no expiry; backlog of past-day crates is allowed.

Randomness is provably fair without any pre-published commitment: the entropy is the **Solana slot hash at the deterministic boundary slot of the day** (first finalized slot whose `block_time >= 00:00 UTC` of the next day). Anyone can recompute every player's roll from public chain data and the committed configuration file.

**Replaces**, not supplements, the spec-400 per-round random crate drop. Specifically: the `CRATE_DROP` event emit in `game.settled` is removed and the trigger type `'game_settled'` is removed from `crate_drops.trigger_type`. The shared `crate-drop.ts` handler continues to serve the **challenge-completion** (`'challenge_completed'`) and **bonus-completion** (`'bonus_completed'`) paths from spec 400 unchanged, including their probabilistic roll mechanics and the `points_crate_drop_rate` / `sol_crate_drop_rate` / etc. config keys those paths depend on. Re-tuning the challenge/bonus crate paths is out of scope for this spec.

### Design Principles

1. **Deterministic, publicly verifiable.** No server secret. The slot hash is the seed; a future verifier page can recompute outcomes from chain + git.
2. **No DB-resident probability tables.** Tier thresholds and prize distributions live in committed TS files, validated at backend boot. The `reward_config` table is not extended.
3. **Lazy roll, lazy volume calculation.** The per-day cron does the minimum (record the boundary slot). Volume and outcome are computed at claim time from existing `game_entries` rows.
4. **Crate point grants are unmultiplied.** Consistent with spec 401's launch decision.

---

## User Stories

- As a player, I want my daily wagering activity to upgrade a crate I can open tomorrow so that volume across the day feels rewarded as a whole, not just per-round.
- As a player, I want to see my current daily volume and which tier I'm in so that I can decide whether to push for a higher tier before the day rolls over.
- As a player, I want backlog crates from days I missed to still be claimable so that being offline doesn't burn rewards.
- As a player, I want to verify any crate's outcome was rolled fairly from public Solana data so that I don't have to trust the operator.
- As an operator, I want crate probabilities and tier thresholds in committed code so that economy changes are reviewed and version-controlled.
- As an operator, I want unfilled SOL outcomes to queue and pay out as the reward pool refills so that pool depletion never silently denies a prize.
- As an operator, I want total pending SOL liability visible in peek so that I can decide when to top up the treasury.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section "Loot crates" — restated as a daily, tiered, claim-on-the-next-day model rather than a per-round random drop.
- **Replaces**: spec 400 FR-5 (Loot Crate Drops) per-round random path. Other FR-5 elements that survive: `crate_drops` table, `CRATE_SOL_PAYOUT` payout handler, `GET /crates/mine` history endpoint, peek crate-drops admin views.
- **Reuses**: `reward_pool` accounting (FR-4 of spec 400), `point_grants` ledger (spec 401), `game_entries` participation table (spec 100/101/001 settlement paths), commit-reveal-style fairness philosophy (spec 005/006 — slot-hash entropy).
- **Current baseline**: Per-round crate drop is shipped and live in dev. This spec is a behavior-changing migration, not a greenfield addition.

---

## Required Context Files

Read before implementation:

- `backend/migrations/011_challenge_engine.sql` — existing `crate_drops`, `reward_pool`, `point_grants` schemas
- `backend/migrations/007_game_entries.sql` — wager-history table the lazy volume query reads
- `backend/src/queue/handlers/crate-drop.ts` — existing per-game crate handler (to be removed)
- `backend/src/queue/handlers/game-settled.ts` — settlement handler (CRATE_DROP emit to be removed)
- `backend/src/queue/handlers/reward-pool-fund.ts` — pool-funding handler (extend with retry tail)
- `docs/specs/400-challenge-engine/spec.md` FR-4, FR-5, FR-13 — existing crate semantics to override
- `docs/specs/401-reward-economy/spec.md` — multiplier rule for crate point grants
- `docs/references/daily-crate.csv` — authoritative human-readable tier table (mainnet)

---

## Contract Files

- `backend/src/config/economy/mainnet/daily-crate-tiers.ts` — TS module imported by the backend for mainnet. Authoritative source of mainnet tier values.
- `backend/src/config/economy/dev/daily-crate-tiers.ts` — devnet variant. Ships identical to mainnet at launch; team may diverge for testing fixtures.
- `backend/src/config/economy/schema.ts` — Zod schema enforcing the data-shape invariants (ppm sum, ascending thresholds, contiguous tier numbers).
- `backend/src/config/economy/index.ts` — selects active variant by `config.cluster`.
- `docs/references/daily-crate.csv` — human-readable reference doc; not consumed at build time.

---

## System Invariants

1. **Deterministic outcomes.** For a given `(slot_hash, user_id, day_id, config_hash, tier)`, the outcome is uniquely determined. Re-rolling is impossible because no input is operator-controlled.
2. **One crate per user per day.** UNIQUE `(user_id, trigger_type, trigger_id)` on `crate_drops` with `trigger_type='daily_crate'` and `trigger_id=day_id`.
3. **Refunded rounds never count.** Day-volume sum filters `is_winner IS NOT NULL` (matches `quest_eligible()` semantics in spec 400).
4. **Probability tables sum to exactly 1,000,000 ppm per tier.** Enforced at TS-module load; backend refuses to start if violated.
5. **Reward pool can never go negative.** SOL payouts use `SELECT ... FOR UPDATE` on the singleton; insufficient balance leaves the crate at `status='pending'` for retry, never overdrafts.
6. **Crate point grants are unmultiplied.** `effective_multiplier = 1.0` recorded on the `point_grants` row; the active PNS multiplier is not applied.
7. **Claim has no expiry.** A `(user_id, day_id)` pair with `day_lamports >= floor` remains claimable indefinitely.

---

## Functional Requirements

### FR-1: Daily Wager Volume Calculation

The daily wager volume for a `(user_id, day_id)` pair is computed lazily from `game_entries`:

```sql
SELECT COALESCE(SUM(amount_lamports), 0) AS day_lamports
FROM game_entries
WHERE user_id = $1
  AND settled_at >= ($day_id at 00:00:00 UTC)
  AND settled_at <  ($day_id at 24:00:00 UTC)
  AND is_winner IS NOT NULL;
```

- A round whose `created_at` is on day N but `settled_at` is on day N+1 counts toward day N+1, not day N. Assignment is by settlement timestamp.
- The query relies on existing index `idx_game_entries_user_settled (user_id, settled_at DESC)` — no new index needed.

**Acceptance Criteria:**
- [ ] Helper `computeDayLamports(db, userId, dayId)` exists and returns a `bigint`.
- [ ] Refunded rows (`is_winner IS NULL`) are excluded.
- [ ] Range is `[00:00 UTC of day_id, 00:00 UTC of day_id+1)` half-open.
- [ ] Unit test: seed `game_entries` rows spanning a day boundary; verify each is assigned to the correct day.
- [ ] Unit test: refunded round on day N does not contribute to its volume.
- [ ] Performance test: query returns < 5ms for a player with 100 settled rounds in a day on a representative dev database.

### FR-2: Tier Configuration File (Code-Resident)

Tier thresholds and outcome distributions live in committed TS files under `backend/src/config/economy/{dev,mainnet}/daily-crate-tiers.ts`, exported as `DAILY_CRATE_TIERS: Tier[]` with the shape:

```ts
type Outcome = { item_type: 'points' | 'sol'; amount: bigint; ppm: number };
type Tier    = { tier: number; threshold_lamports: bigint; outcomes: Outcome[] };
```

- An `index.ts` selects between `dev` and `mainnet` variants by reading the active cluster from `config.cluster`.
- A Zod schema enforced at module import asserts:
  - `tier` numbers are 1..N consecutive (no gaps).
  - `threshold_lamports` is strictly ascending.
  - For each tier, `sum(outcomes[].ppm) === 1_000_000` exactly.
  - All `amount` values are positive bigints.
- A helper `getDailyCrateConfigHash()` returns `SHA256(stableStringify(DAILY_CRATE_TIERS))`, memoized at boot.
- The TS files are the **editable source of truth**. `docs/references/daily-crate.csv` is a human-readable reference doc only — not consumed at build time, not enforced for drift. Author hand-edits the TS files (with comments explaining each tier) and updates the CSV when convenient. Probabilities in TS are stored directly in ppm integers; the file ships at launch with values derived from the CSV with rounding redistributed onto each tier's largest-ppm row so the sum lands exactly on 1,000,000.
- `DAILY_CRATE_MIN_LAMPORTS` is exported as `DAILY_CRATE_TIERS[0].threshold_lamports` — there is no separate floor knob.

**Acceptance Criteria:**
- [ ] `backend/src/config/economy/{dev,mainnet}/daily-crate-tiers.ts` exist with all 13 tiers from the CSV.
- [ ] Both files export the same `DAILY_CRATE_TIERS` shape; content is identical at launch.
- [ ] Zod validation runs on module load; backend exits with a clear error on malformed config.
- [ ] Unit test: malformed config (sum != 1M, out-of-order thresholds, gap in tier numbers) is rejected with a useful message.
- [ ] Unit test: `getDailyCrateConfigHash()` is stable across calls and changes when content changes.
- [ ] Per-tier sum check: every tier's outcomes total exactly `1_000_000` ppm.

### FR-3: Daily Boundary Slot Recording (Rollover Job)

A cron worker runs at 00:00 UTC daily and records the deterministic boundary slot for the day that just ended.

- **Boundary-slot rule** (committed in spec, not operator-tunable): the first finalized Solana slot whose `block_time >= 00:00:00 UTC of day_id+1`. The day_id is the day that ended at that boundary.
- The job calls Solana RPC, walks finalized slots forward from approximately the expected slot, and selects the first whose `getBlockTime` value is at or past the target Unix timestamp.
- It writes one row to `daily_crate_seeds`:

```sql
CREATE TABLE daily_crate_seeds (
  day_id         DATE PRIMARY KEY,
  boundary_slot  BIGINT NOT NULL,
  slot_hash      TEXT   NOT NULL,
  config_hash    TEXT   NOT NULL,                  -- SHA256 of active DAILY_CRATE_TIERS at rollover
  rpc_endpoint   TEXT,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- Insert is `ON CONFLICT (day_id) DO NOTHING`. The job is idempotent and safe to re-run.
- If the cron is delayed or RPC is unreachable, the job retries with exponential backoff. Even hours-late discovery yields the same canonical slot because the rule is purely deterministic over public chain state.
- `config_hash` snapshots the TS-module hash at the moment of recording so historical claims resolve against the table that was active at rollover, regardless of subsequent code deploys.

**Acceptance Criteria:**
- [ ] Cron worker registered in the existing scheduler with a 00:00 UTC trigger.
- [ ] Helper `findBoundarySlot(connection, targetUnix): { slot, blockTime, slotHash }` exists.
- [ ] On success, writes a `daily_crate_seeds` row idempotently.
- [ ] On RPC failure, retries up to N times with backoff; surfaces `seed.recording_failed` event for ops alerting on persistent failure.
- [ ] Unit test (with mocked connection): given a stream of slots with simulated `block_time`s, the helper returns the first slot ≥ target.
- [ ] Integration test: run the worker against a simulated boundary; verify a `daily_crate_seeds` row is written; re-run and verify no duplicate insert.
- [ ] `config_hash` matches `getDailyCrateConfigHash()` at the moment of insert.

### FR-4: Crate Eligibility & Tier Determination

Given a `(user_id, day_id)` pair:

1. Compute `day_lamports` per FR-1.
2. If `day_lamports < DAILY_CRATE_MIN_LAMPORTS` → no crate; `eligible = false`.
3. Otherwise: `tier = max{ t.tier : t.threshold_lamports <= day_lamports }` from `DAILY_CRATE_TIERS`.
4. The day's `daily_crate_seeds` row must exist; otherwise the crate is "earned but not yet rollable" (`seed_recorded = false` on the API).

**Acceptance Criteria:**
- [ ] Pure helper `determineTier(dayLamports: bigint): { tier: number; threshold_lamports: bigint } | null` against `DAILY_CRATE_TIERS`.
- [ ] Returns `null` below floor.
- [ ] Returns the highest matching tier for any value at or above floor (e.g., `0.6 SOL` → tier 3 because `0.5 ≤ 0.6 < 1.0`).
- [ ] Unit tests cover: below floor; exactly at each threshold; between thresholds; above the highest threshold.

### FR-5: Provably-Fair Roll & Outcome Selection

Given `(slot_hash, user_id, day_id, tier)`, the outcome is computed deterministically:

1. `entropy = SHA256(slot_hash || user_id || day_id_str)` where `day_id_str` is the ISO-8601 date `'YYYY-MM-DD'`.
2. `roll = first 8 bytes of entropy interpreted as big-endian u64, mod 1_000_000`.
3. Walk `tier.outcomes` in their natural order, accumulating `ppm`. The first outcome whose running sum strictly exceeds `roll` is selected.
4. The selected outcome's `(item_type, amount)` becomes the crate contents.

The function is a pure helper, exposed as `rollDailyCrateOutcome(slotHash, userId, dayId, tier): { outcome: Outcome; rollValue: number }`.

**Acceptance Criteria:**
- [ ] Helper is pure and deterministic; same inputs always yield same output.
- [ ] Hashing uses a stable byte-level concatenation that the verifier can reproduce. Spec the concatenation explicitly: `slot_hash` is treated as a base58 string, `user_id` as a UTF-8 string, `day_id_str` as a UTF-8 string, joined by ASCII `':'`. Document in the function's comment block.
- [ ] Unit test: known triples `(slot_hash, user_id, day_id)` produce expected `roll_value`s (golden vectors committed to the test).
- [ ] Unit test: at every tier, exhaustively sweep `roll = 0..999_999` and verify the resulting outcome distribution matches the configured `ppm` exactly.
- [ ] No floating-point arithmetic in the selection path. All comparisons are integer.

### FR-6: Claim Flow & Idempotency

Endpoint: `POST /crates/daily/claim`, body `{ day_id: 'YYYY-MM-DD' }`, JWT-authed.

Steps inside a single DB transaction:

1. Resolve `user_id` from JWT.
2. `SELECT * FROM daily_crate_seeds WHERE day_id = $day_id` → 425 `seed_not_recorded` if missing (rollover hasn't completed).
3. Compute `day_lamports` per FR-1; determine `tier` per FR-4. If ineligible (below floor), 409 `no_crate_earned`.
4. Try `INSERT INTO crate_drops (...) ON CONFLICT (user_id, trigger_type, trigger_id) DO NOTHING`:
    ```
    user_id        = $user_id
    trigger_type   = 'daily_crate'
    trigger_id     = $day_id          -- the YYYY-MM-DD string
    crate_type     = (rolled outcome's item_type)
    contents_amount= (rolled outcome's amount, as TEXT)
    tier           = $tier
    roll_value     = $rollValue
    seed_day_id    = $day_id
    status         = 'pending'
    ```
5. If conflict (already claimed): re-SELECT the existing row and return its outcome with HTTP 200 (idempotent replay).
6. If newly inserted: emit a side-effect event:
    - **Points outcome** → emit `POINTS_GRANT` with `source_type='daily_crate'`, `source_id=$day_id`, `metadata={tier, rollValue}`. Existing handler updates `point_balances` and `point_grants`. The `crate_drops.status` becomes `'granted'` when the grant ledger row is written (handler responsibility).
    - **SOL outcome** → in same transaction, `SELECT ... FOR UPDATE` on `reward_pool`:
        - If `balance >= amount`: decrement balance, increment `lifetime_paid`, emit `CRATE_SOL_PAYOUT` event with the `crate_drops.id` payload. Existing handler executes the on-chain transfer and sets `status='granted'`.
        - If `balance < amount`: leave `status='pending'`, emit `CRATE_SOL_RETRY_QUEUED` event for ops visibility (no immediate payout). Per FR-7 the retry path will eventually fulfil it.
7. Commit and return outcome to the player. Response includes the proof material the future verifier page will use: `tier`, `rollValue`, `slotHash`, `configHash`, `seedDayId`, `outcome`.

The `point_grants.source_type` CHECK constraint is extended to allow `'daily_crate'`. The `crate_drops.trigger_type` CHECK is changed from `('game_settled', 'challenge_completed', 'bonus_completed')` to `('daily_crate', 'challenge_completed', 'bonus_completed')` after asserting no `'game_settled'` rows exist.

**Acceptance Criteria:**
- [ ] Endpoint exists with JWT middleware and Zod-validated body.
- [ ] Returns 425 `seed_not_recorded` when the day's seed row is missing.
- [ ] Returns 409 `no_crate_earned` when day_lamports < floor.
- [ ] First successful call inserts a `crate_drops` row, emits the correct side-effect event, returns 200 with the outcome.
- [ ] Replay of the same call returns the original outcome (idempotent), no second event emitted, no second `crate_drops` insert.
- [ ] Concurrent claim race (two parallel POSTs) is resolved by the UNIQUE constraint; one succeeds, one returns the same outcome via the conflict path. No double payout.
- [ ] Integration test: full claim flow against a test DB, including event emission and downstream handler effect on `point_balances` (points path) or `crate_drops.status='granted'` after handler runs (sol path with funded pool).
- [ ] Integration test: SOL claim against a depleted pool leaves `status='pending'`, no on-chain transfer attempted, `CRATE_SOL_RETRY_QUEUED` event emitted.

### FR-7: SOL Outcome Pool Handling & Retry

When a SOL outcome lands in `crate_drops` with `status='pending'` (pool was insufficient), it must be paid as soon as the pool can cover it.

- The existing `REWARD_POOL_FUND` event handler (spec 400 FR-4) gains a tail step run after the pool deposit:
    1. `SELECT * FROM crate_drops WHERE status='pending' AND crate_type='sol' ORDER BY created_at ASC` (limited batch, e.g. 100 per tick).
    2. For each row: `SELECT ... FOR UPDATE` on `reward_pool`. If `balance >= row.contents_amount::BIGINT`: decrement balance, increment `lifetime_paid`, emit `CRATE_SOL_PAYOUT` for the row, advance to next. If insufficient: **skip and continue** (do NOT block on this row — opportunistic-no-FIFO so a single mega-prize doesn't starve smaller pending crates below it).
    3. Stop when batch exhausted or no more pending rows.
- This makes pool refills opportunistic: any time pool funds arrive, every row that fits gets paid, oldest first within "fits."
- Operators see `peek` aggregate of total pending SOL liability so they can decide whether to top up the treasury for a stuck mega-prize.

**Acceptance Criteria:**
- [ ] `REWARD_POOL_FUND` handler is extended with the retry tail; per-tail batch limit is configurable (env or `reward_config`).
- [ ] Retry uses `SELECT ... FOR UPDATE` on the pool singleton; no overdraft is possible.
- [ ] Skip-not-block: a pending row whose amount exceeds current pool is skipped, smaller subsequent rows still get a chance.
- [ ] Each successful retry emits `CRATE_SOL_PAYOUT`; the existing payout handler transfers SOL and sets `status='granted'`.
- [ ] Integration test: seed two pending SOL rows (large then small). Fund pool with enough for the small but not the large. Verify the small gets paid, the large remains pending. Fund again with enough for the large. Verify the large gets paid.
- [ ] Peek admin view exposes total pending SOL crate liability (sum of `contents_amount` where `status='pending' AND crate_type='sol'`).

### FR-8: Player API Surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/crates/daily/today` | JWT | Live snapshot of today's accumulating crate. Returns `{ dayLamports, currentTier (nullable), nextTier (nullable), nextThresholdLamports (nullable), sampleOutcomes (top-N by ppm of `currentTier`) }`. Read-only; does not roll. |
| `GET` | `/crates/daily/pending` | JWT | List of past `(day_id)` where `day_lamports >= floor` AND no `crate_drops` row exists yet for `(user, 'daily_crate', day_id)`. Each item has `dayId, dayLamports, tier, seedRecorded`. |
| `POST` | `/crates/daily/claim` | JWT | Body `{ day_id }`. Performs FR-6. Returns the outcome plus the proof material. |
| `GET` | `/crates/mine` | JWT | **Existing endpoint from spec 400.** Already paginates `crate_drops` history; daily-crate rows surface automatically with `triggerType='daily_crate'`. No change. |

The standalone "verify by drop id" endpoint is **deferred** — the proof material is already persisted on `crate_drops` rows, and a future fairness page can hydrate them then.

**Acceptance Criteria:**
- [ ] All four routes are implemented behind JWT middleware with the existing response envelope.
- [ ] `/crates/daily/today` excludes refunded rounds and uses the same volume helper as `/claim`.
- [ ] `/crates/daily/pending` orders by `day_id DESC`, paginates standardly, and surfaces `seedRecorded=false` for days whose rollover hasn't completed.
- [ ] All endpoints return appropriate HTTP status codes per the project's transport-semantics rule (200 success, 409 ineligible, 425 seed-not-recorded, 401/403 auth).
- [ ] OpenAPI types are generated and committed.

### FR-9: Migration & Removal of Per-Game Crate Drops

A new migration (e.g. `028_daily_crate.sql`) executes the following in order:

1. `CREATE TABLE daily_crate_seeds (...)` per FR-3.
2. `ALTER TABLE crate_drops ADD COLUMN tier INT, ADD COLUMN roll_value BIGINT, ADD COLUMN seed_day_id DATE REFERENCES daily_crate_seeds(day_id)`.
3. Assert pre-condition: `SELECT COUNT(*) FROM crate_drops WHERE trigger_type='game_settled'` must equal 0. We are in dev; if any rows are found, the migration fails and the operator must clean up first (truncate or relabel). Production deployment of this spec MUST occur before any `'game_settled'` rows ever exist.
4. `ALTER TABLE crate_drops DROP CONSTRAINT crate_drops_trigger_type_check, ADD CONSTRAINT crate_drops_trigger_type_check CHECK (trigger_type IN ('daily_crate','challenge_completed','bonus_completed'))`.
5. `ALTER TABLE point_grants DROP CONSTRAINT point_grants_source_type_check, ADD CONSTRAINT point_grants_source_type_check CHECK (source_type IN ('wager','challenge_completed','bonus_completed','crate_points','daily_crate'))`.
6. `reward_config` keys are **not** deleted. The challenge-completion and bonus-completion paths still emit `CRATE_DROP` and still read `points_crate_drop_rate`, `sol_crate_drop_rate`, `sol_crate_pool_pct`, `sol_crate_min_value`, `points_crate_min`, `points_crate_max` for those rolls. Tuning those values is out of scope.

Backend code changes:

- `backend/src/queue/handlers/game-settled.ts` — remove the `CRATE_DROP` event emit (one block); surrounding logic (points grant, challenge progress, pool funding) is untouched. Other places that emit `CRATE_DROP` (challenge engine, bonus completion) keep emitting it.
- `backend/src/queue/handlers/crate-drop.ts` — **kept**. Continues to handle `'challenge_completed'` and `'bonus_completed'` triggers as today. The handler is unaware that `'game_settled'` no longer reaches it, but the trigger CHECK on `crate_drops` will now reject any such row at insert time as a defense-in-depth.
- `backend/src/queue/handlers/reward-pool-fund.ts` — extend with the retry tail per FR-7.
- New: `backend/src/queue/handlers/daily-crate-claim.ts` — pure-function-heavy module wiring the FR-5/FR-6 logic into the route.
- New: `backend/src/cron/daily-crate-rollover.ts` — the FR-3 cron worker.
- New: `backend/src/routes/crates-daily.ts` — the FR-8 endpoints.
- New: `backend/src/config/economy/{dev,mainnet}/daily-crate-tiers.ts`, `backend/src/config/economy/index.ts`, and `backend/src/config/economy/schema.ts` — FR-2.

`docs/TECH_DEBT.md` gains an entry: "Per-round random `crate.drop` from `game.settled` was removed in spec 402; the same handler still serves challenge-completion and bonus-completion crates with the legacy probabilistic roll. Re-tune or replace those paths in a future spec if the daily-crate model should fully subsume crate semantics."

**Acceptance Criteria:**
- [ ] Migration runs cleanly on a fresh dev DB.
- [ ] Pre-condition assertion fires when `'game_settled'` rows exist.
- [ ] Spec 400 FR-5 acceptance criteria for the per-round path are explicitly marked overridden in this spec's history; the spec-400 spec file gains a banner pointing to spec 402.
- [ ] After migration, attempting to insert `crate_drops` with `trigger_type='game_settled'` fails the CHECK.
- [ ] Backend boots without errors.
- [ ] `crate-drop.ts` continues to function for challenge/bonus triggers — integration test: complete a challenge that rewards a crate, verify the `crate_drops` row is inserted with `trigger_type='challenge_completed'`.

### FR-10: Operator Visibility (peek)

Peek admin (spec 305) gains:

- **Daily Crate Liability** widget on the economy page: total pending SOL liability, count of pending SOL rows, oldest pending row's `created_at`.
- **Daily Crate Seeds** table view: paginate `daily_crate_seeds` rows with `day_id`, `boundary_slot`, `slot_hash`, `config_hash`, `recorded_at`. Filter by date.
- The existing crate-drops admin views automatically include daily-crate rows (no schema change to those views — `triggerType='daily_crate'` filter already works).

**Acceptance Criteria:**
- [ ] Pending-SOL aggregate query returns < 50ms on a representative dev database.
- [ ] Seeds-table view exists with date-range filter.
- [ ] Existing peek crate-drops table renders daily-crate rows correctly with their tier and roll_value visible in detail expansion.

---

## Success Criteria

1. A player who wagers 0.6 SOL in settled rounds across UTC day N can call `POST /crates/daily/claim` on day N+1 and receive a tier-3 outcome whose distribution matches `daily_crate_tiers[3]`.
2. A player offline for 5 days returns and successfully claims 5 crates, each with its own deterministic outcome.
3. The same `(slotHash, userId, dayId, tier)` always yields the same outcome — verified by a unit test with golden vectors.
4. A SOL outcome with the pool drained sits at `status='pending'`, then is paid automatically the next time the pool is funded with enough balance — verified by integration test.
5. The per-round random crate drop in `game.settled` no longer fires — verified by integration test that settles a round and asserts zero `crate_drops` rows are created.
6. Backend refuses to start if `daily-crate-tiers.ts` is malformed (sum != 1M, gaps, descending thresholds).

---

## Dependencies & Assumptions

- **Async event queue** (spec 301) is operational. `POINTS_GRANT`, `CRATE_SOL_PAYOUT`, `REWARD_POOL_FUND` events flow through it.
- **`game_entries`** (spec for game settlement) records `settled_at` reliably for every settled round.
- **`reward_pool`** (spec 400) accounting is correct; this spec does not refactor pool funding mechanics.
- **JWT auth** (spec 007) protects all `/crates/daily/*` routes.
- **Solana RPC** (dRPC for devnet, configurable for mainnet) returns finalized block times within seconds of block production. We do not assume sub-slot precision; the boundary rule is robust to ±1 slot of clock noise on the RPC side.
- **No backfill of historical `crate_drops` rows.** This spec is a forward-looking change. Any per-round crate rows in dev DBs are dropped or relabeled before migration.

---

## Validation Plan

**Unit:**
- FR-1 day-volume helper across boundary cases.
- FR-4 tier determination across all 13 thresholds.
- FR-5 roll function with golden vectors and full-sweep distribution check per tier.
- FR-2 Zod validation rejects malformed configs.
- FR-2 ppm-sum invariant enforced at module load (every tier sums to exactly 1,000,000).

**Integration:**
- FR-3 rollover worker against a mocked Solana connection.
- FR-6 claim flow end-to-end: eligible → claim → points granted; eligible → claim → SOL with funded pool → on-chain transfer; eligible → claim → SOL with empty pool → pending.
- FR-7 retry path: drained pool, fund event arrives, oldest pending paid.
- FR-9 migration on a snapshot of dev DB with no `'game_settled'` rows.
- Idempotency: replay a claim call twice; second is a no-op.
- Concurrency: parallel claims for the same `(user, day)`; only one succeeds.

**Manual / smoke:**
- Devnet: wager across a UTC boundary, observe rollover seed gets recorded, claim, observe outcome and proof on `/crates/mine`.
- Verify the proof material on a claim response can be used to recompute the outcome from scratch using only `slot_hash`, `userId`, `dayId`, and the committed TS config — proves end-to-end fairness.

**`./scripts/verify` must pass at task completion** (full backend lint, typecheck, tests).

---

## Design Decisions & Review Notes

1. **Replaces, not supplements.** Running both the per-game and the daily systems simultaneously was rejected in brainstorming — clearer mental model, no double-rewarding, simpler ops.
2. **Volume in lamports, not USD.** The reward table is denominated in SOL; tracking lamports keeps the player narrative simple ("wager 5 SOL today to hit tier 6") and avoids FX in the hot path.
3. **00:00 UTC global, not per-user windows.** Single global clock is easier to communicate and coordinates with future global features (Dogpile, leaderboards).
4. **Slot-only fairness, no server commit/reveal.** The Solana slot hash at the deterministic boundary is publicly observable; combined with `userId` salt, no validator can grind outcomes for any specific player. Removes the need to publish anything pre-rollover.
5. **Off-chain seed record (not on-chain).** Persisting `(boundary_slot, slot_hash, config_hash)` server-side is sufficient for v1; the data is reconstructible from any RPC. On-chain anchoring is forward-compatible if trust requirements grow.
6. **Lazy roll at claim time.** Removes the need for a heavy batch job at midnight. Outcome is deterministic, so lazy and pre-rolled produce identical results.
7. **Config in TS, not DB.** Code review and version control beat an admin UI we don't need yet. DB stays minimal; the future port to DB-resident config is a one-migration affair if it ever matters.
8. **Env-split TS files (`dev`, `mainnet`).** Allows test fixtures (predictable outcomes) without touching the production table. Pattern is the precedent for future env-specific business configs.
9. **Opportunistic-no-FIFO retry.** A single 20,000-SOL pending row must not block thousands of small ones; if the pool can't cover the head, we skip and try the next.
10. **Crate point grants unmultiplied.** Restated from spec 401's launch decision; no rule change, just confirmation.
11. **Verifier endpoint deferred.** Scoping out the `/crates/daily/verify/:dropId` endpoint and the public fairness page; the proof material is captured on the row so a future spec can build the page without schema migration.

---

## Deferred / Out of Scope

- **Public fairness page** — the human-facing UI that lets anyone enter a `crate_drops.id` and see the recomputed roll. Data is captured; UI is a later spec.
- **On-chain anchor** of daily seed rows — strongest trust-minimization, ~1 TX/day. Forward-compatible; not v1.
- **Operator admin UI for tier table** — TS code review is the editing path. Future spec when admin tooling needs it.
- **Crate "open animation" UI** — frontend concern, separate project per `docs/SCOPE.md`.
- **Lifecycle / multi-day caps** (e.g. "you can claim at most N backlog crates per session") — not requested; the user's brief says "no time limitation on claiming."
- **Pool reservation accounting** for known-pending mega-prizes — operators can reason about it via the peek liability widget; reserving a pool slice for queued payouts is a future refinement.
- **Tier outcome tuning post-launch** based on observed payout distributions — economy-tuning spec, not this one.
- **Multi-currency outcomes** — only `points` and `sol` for v1, mirroring the CSV.

---

## Completion Signal

Spec is implementable when:
- [ ] All FR sections have unambiguous acceptance criteria.
- [ ] CSV → TS codegen approach is agreed.
- [ ] Pool retry semantics (opportunistic-no-FIFO) is agreed.
- [ ] Migration ordering is reviewed against current dev DB state (no `'game_settled'` rows assumed).
- [ ] User has reviewed the spec and approved the move to writing-plans.
