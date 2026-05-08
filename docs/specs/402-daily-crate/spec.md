# Specification: [402] Daily Crate

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Track | Economy |
| NR_OF_TRIES | 7 |
| Replaces | Per-game `crate.drop` flow in spec 400 |
| Authors | (assigned at refine time) |

---

## Overview

Replace the per-game random crate drop (spec 400) with a single **Daily Crate** per player per UTC day. As a player wagers throughout the day, their crate "tier" upgrades through stepped daily-wager-volume thresholds. After the UTC day closes, a daily computation job materializes one reward row per eligible player/day. That row freezes the day volume, selected config version, tier, roll, outcome type, outcome value, seed material, and reward hash. From then on, claiming is delivery only. Claims have no expiry; backlog of past-day crates is allowed.

Randomness is provably fair without any pre-published commitment: the entropy is the **Solana blockhash at the deterministic boundary slot of the day** (the first finalized slot whose `block_time >= 00:00 UTC` of the next day). Anyone can recompute every player's roll from public chain data, the committed append-only configuration registry, and the immutable `daily_crate_rewards` row.

**Replaces**, not supplements, the spec-400 per-round random crate drop. Specifically: the `CRATE_DROP` event emit in `game.settled` is removed and the trigger type `'game_settled'` is removed from `crate_drops.trigger_type`. The shared `crate-drop.ts` handler continues to serve the **challenge-completion** (`'challenge_completed'`) and **bonus-completion** (`'bonus_completed'`) paths from spec 400 unchanged, including their probabilistic roll mechanics and the `points_crate_drop_rate` / `sol_crate_drop_rate` / etc. config keys those paths depend on. Re-tuning the challenge/bonus crate paths is out of scope for this spec.

### Design Principles

1. **Deterministic, publicly verifiable.** No server secret. The boundary blockhash is the seed; a future verifier page can recompute outcomes from chain + git + the immutable reward row.
2. **Append-only code-resident configs.** Tier thresholds and prize distributions live in committed TS files, validated at backend boot. Each config has a mandatory positive integer `version`; old versions are never edited or deleted.
3. **Materialized earned rewards.** The daily job freezes eligibility, tier, roll, and outcome into `daily_crate_rewards`. Claim never recomputes volume, tier, or outcome.
4. **Crate point grants are unmultiplied.** Consistent with spec 401's launch decision.
5. **This spec writes intent, not transactions.** No code path in this spec sends a transaction, signs an instruction, or talks to any on-chain RPC for delivery. The compute job, the claim endpoint, the FR-7 retry tail, and any operator action all do exactly two things: mutate `daily_crate_rewards` row state and emit an event (`POINTS_GRANT` or `CRATE_SOL_PAYOUT`) onto the existing async queue. Actually moving SOL on-chain, retrying RPC failures, persisting transaction signatures, reconciling partial failures, and writing the audit trail are owned by the existing payout subsystem (queue + payout handler + audit log). This separation is non-negotiable: any future change that tries to inline a transaction send into this spec's code paths is a violation of the architecture and must be redirected through the queue.

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
- `backend/migrations/007_game_entries.sql` — wager-history table the daily computation reads
- `backend/src/queue/handlers/crate-drop.ts` — existing per-game crate handler (to be removed)
- `backend/src/queue/handlers/game-settled.ts` — settlement handler (CRATE_DROP emit to be removed)
- `backend/src/queue/handlers/reward-pool-fund.ts` — pool-funding handler (extend with retry tail)
- `docs/specs/400-challenge-engine/spec.md` FR-4, FR-5, FR-13 — existing crate semantics to override
- `docs/specs/401-reward-economy/spec.md` — multiplier rule for crate point grants
- `docs/references/daily-crate.csv` — seed input used during initial implementation to populate the launch TS configs; deleted at implementation time. Not authoritative beyond that point.

---

## Contract Files

- `backend/src/config/economy/mainnet/daily-crate-configs.ts` — append-only TS registry imported by the backend for mainnet. Authoritative source of mainnet config versions.
- `backend/src/config/economy/dev/daily-crate-configs.ts` — devnet variant. Ships identical to mainnet at launch; team may diverge for testing fixtures.
- `backend/src/config/economy/schema.ts` — Zod schema enforcing the data-shape invariants (ppm sum, ascending thresholds, contiguous tier numbers).
- `backend/src/config/economy/index.ts` — selects active variant by `config.cluster`.
- (`docs/references/daily-crate.csv` is not a contract file. It is a seed input deleted at implementation time — see FR-9 and the Required Context Files note.)

---

## System Invariants

1. **Deterministic outcomes.** For a given `(boundary_blockhash, user_id, day_id, config_version, tier)`, the outcome is uniquely determined. Re-rolling is impossible because no input is operator-controlled.
2. **One daily reward per user per day.** `daily_crate_rewards` has `UNIQUE (user_id, day_id)`.
3. **Refunded rounds never count.** Day-volume sum filters `is_winner IS NOT NULL` (matches `quest_eligible()` semantics in spec 400).
4. **Probability tables sum to exactly 1,000,000 ppm per tier.** Enforced for every config version at TS-module load; backend refuses to start if violated.
5. **Earned rows are immutable.** After `daily_crate_rewards` is inserted, `day_lamports`, `config_version`, `config_hash`, `tier`, seed fields (`boundary_slot`, `boundary_block_time`, `blockhash`), `roll_value`, `crate_type`, `contents_amount`, and `reward_hash` are never changed. Only delivery status, hold/failure metadata, and timestamps may change.
6. **Reward pool can never go negative.** SOL payouts reserve or pay with `SELECT ... FOR UPDATE` on the singleton; insufficient balance leaves the reward awaiting funds for retry, never overdrafts.
7. **Crate point grants are unmultiplied.** `effective_multiplier = 1.0` recorded on the `point_grants` row; the active PNS multiplier is not applied.
8. **Claim has no expiry.** A materialized `daily_crate_rewards` row remains claimable indefinitely until delivered.

---

## Functional Requirements

### FR-1: Daily Wager Volume Calculation

The daily wager volume for each `(user_id, day_id)` pair is computed by the daily crate computation job from `game_entries`:

```sql
SELECT COALESCE(SUM(amount_lamports), 0) AS day_lamports
FROM game_entries
WHERE user_id = $1
  AND settled_at >= ($day_id at 00:00:00 UTC)
  AND settled_at <  ($day_id at 24:00:00 UTC)
  AND is_winner IS NOT NULL;
```

- A round whose `created_at` is on day N but `settled_at` is on day N+1 counts toward day N+1, not day N. Assignment is by settlement timestamp.
- `game_entries.settled_at` is set to `NOW()` at DB-write time in the settlement handler (not the on-chain `block_time` of the resolve TX). This guarantees that a row is visible to whichever day's compute runs after it is written: late-arriving settlements naturally fall into the next day's window rather than being silently dropped. Implementation must verify and preserve this contract; if `settled_at` is ever changed to `block_time`, this spec needs a watermark/grace-period rule before the daily compute runs.
- All `settled_at`-range queries go through a single helper `dayIdBoundsUtc(dayId): { startUtc: Date; endUtc: Date }` that constructs UTC bounds explicitly from the `'YYYY-MM-DD'` string. No raw `::date` casts in queries.
- The per-user helper can use existing index `idx_game_entries_user_settled (user_id, settled_at DESC)`.
- The all-player daily aggregation path requires a new partial index optimized for the day range scan:
  `CREATE INDEX idx_game_entries_daily_crate_settled_user ON game_entries (settled_at, user_id) WHERE settled_at IS NOT NULL AND is_winner IS NOT NULL;`
- Claim does **not** recompute `day_lamports`; it reads the immutable value persisted on `daily_crate_rewards`.

**Acceptance Criteria:**
- [ ] Helper `computeDayLamports(db, userId, dayId)` exists and returns a `bigint`.
- [ ] Helper `computeEligibleDailyVolumes(db, dayId)` exists and returns one row per user whose computed volume is at or above the active config floor.
- [ ] Refunded rows (`is_winner IS NULL`) are excluded.
- [ ] Range is `[00:00 UTC of day_id, 00:00 UTC of day_id+1)` half-open.
- [ ] Migration creates `idx_game_entries_daily_crate_settled_user` or an equivalent day-range aggregation index.
- [ ] Unit test: seed `game_entries` rows spanning a day boundary; verify each is assigned to the correct day.
- [ ] Unit test: refunded round on day N does not contribute to its volume.
- [ ] Performance test: daily aggregation completes within the agreed cron budget on a representative dev database.

### FR-2: Versioned Tier Configuration Files (Code-Resident)

Tier thresholds and outcome distributions live in committed TS files under `backend/src/config/economy/{dev,mainnet}/daily-crate-configs.ts`, exported as `DAILY_CRATE_CONFIGS: DailyCrateConfig[]` with the shape:

```ts
type Outcome = { item_type: 'points' | 'sol'; amount: bigint; ppm: number };
type Tier    = { tier: number; threshold_lamports: bigint; outcomes: Outcome[] };
type DailyCrateConfig = { version: number; tiers: Tier[] };
```

- An `index.ts` selects between `dev` and `mainnet` variants by reading the active cluster from `config.cluster`.
- A Zod schema enforced at module import asserts:
  - `version` is a positive integer.
  - config versions are unique and strictly ascending in the exported array.
  - `tier` numbers are 1..N consecutive (no gaps).
  - `threshold_lamports` is strictly ascending.
  - For each tier, `sum(outcomes[].ppm) === 1_000_000` exactly.
  - All `amount` values are positive bigints.
- A helper `getActiveDailyCrateConfig()` returns the config with the highest `version` integer in the active registry, regardless of array order in the source file. The daily computation samples this **exactly once per day, at first seed-discovery**, and persists `config_version`/`config_hash` on the owning `daily_crate_runs` row. Subsequent retries for that day read those values from the run row instead of re-sampling — see FR-3 "Config locking".
- A helper `getDailyCrateConfigHash(config)` returns `SHA256(JCS(config))`, where `JCS` is the RFC 8785 JSON Canonicalization Scheme. JCS is required (not "stable stringify") so that external verifiers in any language can reproduce the hash. `bigint` fields are serialized as JSON strings before canonicalization.
- Old config versions are append-only after deployment: never edit or delete a shipped version. Tuning is done by adding a new version with a higher number.
- Operational rule: a deploy before the daily computation changes the config used for the day that just ended. A deploy after the computation affects the next computation.
- Known fairness limitation for v1: because config changes are expected to be rare and code-reviewed, v1 does not pre-commit the config for day N before day N starts. This means an operator deploy after the boundary slot is public but before the daily computation could change the config version/order used for the just-ended day. If daily crate configs begin changing with any regularity, replace this rule with `effective_from_day` config selection or a day-start `daily_crate_config_snapshots` row that freezes `config_version` and `config_hash` before the boundary slot is known.
- The TS files are the **editable source of truth**. `docs/references/daily-crate.csv` is a human-readable reference doc only — not consumed at build time, not enforced for drift. Author hand-edits the TS files and updates the CSV when convenient. Probabilities in TS are stored directly in ppm integers; the launch version ships with values derived from the CSV with rounding redistributed onto each tier's largest-ppm row so the sum lands exactly on 1,000,000.
- `DAILY_CRATE_MIN_LAMPORTS` for a config is `config.tiers[0].threshold_lamports` — there is no separate floor knob.

**Acceptance Criteria:**
- [ ] `backend/src/config/economy/{dev,mainnet}/daily-crate-configs.ts` exist with launch config version 1 and all 13 tiers from the CSV.
- [ ] Both files export the same `DAILY_CRATE_CONFIGS` shape; content is identical at launch.
- [ ] Zod validation runs on module load; backend exits with a clear error on malformed config.
- [ ] Unit test: malformed config (duplicate/non-ascending versions, sum != 1M, out-of-order thresholds, gap in tier numbers) is rejected with a useful message.
- [ ] Unit test: `getActiveDailyCrateConfig()` returns the highest `version` integer regardless of array order in the source file (test seeds versions out of order).
- [ ] Unit test: `getDailyCrateConfigHash(config)` is stable across calls, changes when content changes, and matches a JCS reference vector computed by an independent implementation (e.g., `canonicalize` in JS plus a Python or Rust JCS reproduction in CI).
- [ ] Per-tier sum check: every tier in every config totals exactly `1_000_000` ppm.

### FR-3: Daily Reward Computation Job

A cron worker runs at **00:15 UTC** daily and materializes deterministic daily crate rewards for the day that just ended. The 15-minute grace period gives any in-flight settlement handlers time to finish writing `game_entries` rows, so a round whose on-chain settle landed at 23:59:58 with a slow DB commit is still visible by the time the compute query runs.

- **Boundary-slot rule** (committed in spec, not operator-tunable): the first finalized Solana slot whose `block_time >= 00:00:00 UTC of day_id+1`. The day_id is the day that ended at that boundary.
- The job calls Solana RPC, walks finalized slots forward from approximately the expected slot, and selects the first whose `getBlockTime` value is at or past the target Unix timestamp. It then reads that finalized block and uses the block's actual `blockhash` field as entropy. This is not the SlotHashes sysvar and not a recent transaction blockhash selected by the server.
- The job uses `daily_crate_runs` as both seed-state-persistence AND lightweight worker coordination:

```sql
CREATE TABLE daily_crate_runs (
  day_id              DATE PRIMARY KEY,
  status              TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count       INT NOT NULL DEFAULT 1,
  boundary_slot       BIGINT,
  boundary_block_time BIGINT,
  blockhash           TEXT,
  config_version      INT,
  config_hash         TEXT,
  rpc_endpoint        TEXT,
  failure_reason      TEXT,
  completed_at        TIMESTAMPTZ,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    status <> 'completed'
    OR (boundary_slot IS NOT NULL
        AND boundary_block_time IS NOT NULL
        AND blockhash IS NOT NULL
        AND config_version IS NOT NULL
        AND config_hash IS NOT NULL
        AND completed_at IS NOT NULL)
  )
);
```

  Seed and config fields are nullable until the worker discovers them — only `status='completed'` requires the full seed/config payload to be present (enforced by the table-level CHECK).

- **Worker coordination protocol**:
  1. Worker tries `INSERT INTO daily_crate_runs (day_id, status) VALUES ($day_id, 'processing') ON CONFLICT (day_id) DO NOTHING RETURNING day_id`. A returned row means this worker owns the run; an empty result means another worker already claimed it.
  2. If conflict, worker reads the existing row. If `status='completed'`, nothing to do. If `status='processing'` and `last_attempted_at` is recent (within a configurable heartbeat window, default 30 minutes), this worker backs off — another worker is actively processing. If `last_attempted_at` is older than the heartbeat window, the previous worker is presumed dead and the current worker takes over: `UPDATE daily_crate_runs SET attempt_count = attempt_count + 1, last_attempted_at = now() WHERE day_id = $day_id AND last_attempted_at < now() - INTERVAL '30 minutes'`. If that UPDATE returned a row, this worker now owns the run; otherwise another worker just took over and this one backs off.
  3. The owning worker updates `last_attempted_at` periodically as a heartbeat (e.g., between insert chunks), so a healthy run is never mistaken for a dead one.
  4. Once a worker owns a run, all subsequent retries for that `day_id` read seed and config fields from the existing row instead of re-discovering them, so a deploy mid-compute does **not** change the version mid-day.
- **Config locking**: when the owning worker reaches the seed-discovery step, it samples `getActiveDailyCrateConfig()` exactly once and persists the result on the run row via `UPDATE daily_crate_runs SET config_version = $1, config_hash = $2 WHERE day_id = $day_id AND config_version IS NULL`. Subsequent retries (post-deploy or otherwise) read `config_version` and `config_hash` off the run row and use those values verbatim. **One day, one config**, regardless of how many retries or deploys happen during the compute window.
- For each eligible user, the job computes `day_lamports`, determines tier, computes the roll/outcome, computes `reward_hash`, and inserts one immutable `daily_crate_rewards` row:

```sql
CREATE TABLE daily_crate_rewards (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           TEXT NOT NULL,
  day_id            DATE NOT NULL REFERENCES daily_crate_runs(day_id),
  config_version    INT NOT NULL,
  config_hash       TEXT NOT NULL,
  day_lamports      BIGINT NOT NULL,
  tier              INT NOT NULL,
  boundary_slot     BIGINT NOT NULL,
  boundary_block_time BIGINT NOT NULL,
  blockhash         TEXT NOT NULL,
  roll_value        BIGINT NOT NULL,
  crate_type        TEXT NOT NULL CHECK (crate_type IN ('points', 'sol')),
  contents_amount   BIGINT NOT NULL CHECK (contents_amount > 0),
  reward_hash       TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('earned', 'grant_queued', 'awaiting_funds', 'held', 'payout_queued', 'granted', 'failed', 'rejected')),
  hold_reason       TEXT CHECK (
    (status = 'held' AND hold_reason IN ('global_pause','above_threshold','fraud_flag','manual_hold'))
    OR (status <> 'held' AND hold_reason IS NULL)
  ),
  failure_reason    TEXT,
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ,
  granted_at        TIMESTAMPTZ,
  UNIQUE (user_id, day_id)
);
```

  `contents_amount` is `BIGINT` (lamports for SOL outcomes, integer points for points outcomes). The fresh schema does not inherit the legacy `crate_drops.contents_amount TEXT` typing — payout and liability queries do straight integer math without casts.

- The reward row's `config_version` and `config_hash` are **copies** of the values persisted on the owning `daily_crate_runs` row. They are duplicated onto every reward for fast verifier lookup (no JOIN needed) and as a defense-in-depth: if the run row were ever corrupted, each reward row independently carries the proof material.
- `reward_hash = SHA256(JCS({...}))` over a canonical object containing `domain: "daily_crate:v1"`, `user_id`, `day_id` (as `'YYYY-MM-DD'`), `config_version` (number), `config_hash` (string), `day_lamports` (number), `tier` (number), `boundary_slot` (number), `boundary_block_time` (number), `blockhash` (base58 string), `roll_value` (number), `crate_type` (string), `contents_amount` (number). RFC 8785 JCS canonicalization. All numeric fields fit comfortably in JS `number` precision (lamports ≤ 2^53), so JSON-number serialization is safe; should that assumption ever break, the canonical encoding swaps to JSON string and `reward_hash` semantics are bumped to `"daily_crate:v2"`.
- Insert is idempotent via `UNIQUE (user_id, day_id)`. Re-running a completed job must not change existing reward rows; conflicting inserts are skipped via `ON CONFLICT (user_id, day_id) DO NOTHING`. Two workers can never end up doing duplicate compute work because of the coordination protocol above; ON CONFLICT is the belt-and-suspenders safety net for the (race-window) case where one worker is mid-tx as another claims the run after a stale heartbeat.
- **Insert pattern: single transaction, chunked multi-row INSERTs.** All reward rows for a given `day_id` are inserted inside a single `BEGIN ... COMMIT`, in chunks of ~500 rows per `INSERT ... VALUES (...), (...), ... ON CONFLICT DO NOTHING` statement. The whole day is atomic — either every eligible reward exists post-commit or none do, no partial state ever visible to readers. Chunking keeps wire payloads and server-side memory bounded (a single 100K-row INSERT statement is unwieldy; 200 chunks of 500 is fine). On crash before COMMIT, the transaction rolls back; retry recomputes deterministically and lands cleanly.
- Run recovery is safe at any time:
  - If a `daily_crate_runs` row already has `boundary_slot`, `boundary_block_time`, and `blockhash`, retry uses those persisted seed fields and does **not** call Solana RPC for entropy.
  - If no run row exists yet, or the row exists but seed fields are NULL, the worker performs RPC discovery and UPDATEs the run row with the seed fields before computing rewards. RPC access is required only for this first discovery step. See "Dependencies & Assumptions" for the retention SLA requirement.
  - The coordination protocol above ensures only one worker actively compute-runs a `day_id` at a time. Stale-heartbeat takeover handles dead workers.
- Automatic retry is a worker concern, not an API-server startup side effect. On worker startup and each scheduler tick, the worker scans a bounded window of incomplete runs (default: yesterday plus the previous 14 days, configurable), attempts them oldest-first via the coordination protocol, and emits alerts for runs that remain `failed` after the retry budget.
- If the cron is delayed or RPC is unreachable, the job retries with exponential backoff. Even hours-late discovery yields the same canonical slot because the boundary rule is deterministic over public chain state, subject to the RPC/history availability caveat above.

**Acceptance Criteria:**
- [ ] Cron worker registered in the existing scheduler with a 00:15 UTC trigger.
- [ ] Helper `findBoundarySlot(connection, targetUnix): { slot, blockTime, blockhash }` exists.
- [ ] `daily_crate_runs` schema has nullable seed/config fields and the table-level CHECK that enforces `status='completed' ⇒ all seed/config fields populated`.
- [ ] Worker uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` to claim a run; only one worker holds an active claim per `day_id` at a time, verified by an integration test that races two workers and asserts only one runs the compute body to completion.
- [ ] Stale-heartbeat takeover: if a worker dies, another worker reclaims the run after `last_attempted_at` exceeds the heartbeat window (default 30 min); takeover increments `attempt_count` and resets `last_attempted_at`.
- [ ] Once `config_version` is written on `daily_crate_runs`, every subsequent retry reads it from the run row rather than re-sampling `getActiveDailyCrateConfig()`. Integration test: deploy a new config version mid-compute; assert the day finishes on the originally-locked version.
- [ ] All `daily_crate_rewards` rows for a `day_id` carry the same `config_version` and `config_hash` as the `daily_crate_runs` row.
- [ ] On success, writes a `daily_crate_runs` row and all eligible `daily_crate_rewards` rows idempotently.
- [ ] Re-running a completed day does not mutate existing rewards.
- [ ] If seed fields are already persisted, retry can complete reward materialization without Solana RPC.
- [ ] On RPC failure before seed persistence, retries up to N times with backoff; surfaces `daily_crate.run_failed` event/log for ops alerting on persistent failure.
- [ ] Reward inserts execute inside a single transaction with chunks of ~500 rows per multi-row INSERT statement; integration test verifies a simulated crash mid-day yields a clean rollback (zero rows post-recovery for that day until the next successful run).
- [ ] `contents_amount` is `BIGINT` on `daily_crate_rewards` and on payload schemas; no string→bigint casts in payout or liability queries.
- [ ] Unit test (with mocked connection): given a stream of slots with simulated `block_time`s, the helper returns the first slot ≥ target.
- [ ] Integration test: run the worker against a simulated boundary; verify run/reward rows are written; re-run and verify no duplicate insert or changed reward data.

### FR-4: Crate Eligibility & Tier Determination

During daily reward computation for `(user_id, day_id)`:

1. Compute `day_lamports` per FR-1.
2. If `day_lamports < activeConfig.tiers[0].threshold_lamports` → no reward row is created.
3. Otherwise: `tier = max{ t.tier : t.threshold_lamports <= day_lamports }` from the sampled active config.
4. The resulting `tier`, `day_lamports`, `config_version`, and `config_hash` are persisted on `daily_crate_rewards`.

**Acceptance Criteria:**
- [ ] Pure helper `determineTier(config, dayLamports: bigint): Tier | null`.
- [ ] Returns `null` below floor.
- [ ] Returns the highest matching tier for any value at or above floor (e.g., `0.6 SOL` → tier 3 because `0.5 ≤ 0.6 < 1.0`).
- [ ] Unit tests cover: below floor; exactly at each threshold; between thresholds; above the highest threshold.

### FR-5: Provably-Fair Roll & Outcome Selection

Given `(blockhash, user_id, day_id, config_version, tier)`, the outcome is computed deterministically during daily reward computation:

1. `entropy = SHA256(JCS({ domain: "daily_crate_roll:v1", blockhash, user_id, day_id, config_version, tier }))` where `blockhash` is the base58-encoded blockhash from the finalized Solana block at `boundary_slot`, `day_id` is the ISO-8601 string `'YYYY-MM-DD'`, and `config_version`/`tier` are JSON numbers. Canonicalization is RFC 8785 JCS so any-language verifier reproduces it byte-for-byte.
2. `roll = first 8 bytes of entropy interpreted as big-endian u64, mod 1_000_000`.
3. Walk `tier.outcomes` in their natural order, accumulating `ppm`. The first outcome whose running sum strictly exceeds `roll` is selected.
4. The selected outcome's `(item_type, amount)` becomes the crate contents persisted on `daily_crate_rewards`.

The function is a pure helper, exposed as `rollDailyCrateOutcome(blockhash, userId, dayId, configVersion, tier): { outcome: Outcome; rollValue: number; outcomeRange: { startInclusive: number; endExclusive: number } }`.

The fairness-determining inputs are exactly `(blockhash, user_id, day_id, config_version, tier)`. No other inputs (e.g., per-row randomness) are mixed into the entropy — the spec deliberately keeps the input set small and fully deterministic from public/persisted state so any third party can reproduce the roll without server-side secrets.

**Acceptance Criteria:**
- [ ] Helper is pure and deterministic; same inputs always yield same output.
- [ ] Hashing uses RFC 8785 JCS over the input object. Document in the function's comment block, including a worked example.
- [ ] Unit test: known tuples `(blockhash, user_id, day_id, config_version, tier)` produce expected `roll_value`s (golden vectors committed to the test).
- [ ] Cross-language reproduction test in CI: a Python or Rust JCS implementation, fed the same inputs, produces the same `roll_value`. Catches accidental dependence on a JS-specific canonicalization quirk.
- [ ] Unit test: at every tier, exhaustively sweep `roll = 0..999_999` and verify the resulting outcome distribution matches the configured `ppm` exactly.
- [ ] No floating-point arithmetic in the selection path. All comparisons are integer.

### FR-6: Claim / Delivery Flow & Idempotency

Endpoint: `POST /crates/daily/claim`, body `{ day_id: 'YYYY-MM-DD' }`, JWT-authed.

Steps inside a single DB transaction:

1. Resolve `user_id` from JWT.
2. Reject future/today claims: `day_id` must be earlier than the current UTC date.
3. `SELECT * FROM daily_crate_runs WHERE day_id = $day_id`:
   - missing or `status='processing'` → 425 `daily_crate_not_ready`
   - `status='failed'` → 503 `daily_crate_run_failed`
4. `SELECT * FROM daily_crate_rewards WHERE user_id=$user_id AND day_id=$day_id FOR UPDATE`.
   - missing → 409 `no_crate_earned`
5. If status is already `grant_queued`, `awaiting_funds`, `held`, `payout_queued`, `granted`, `failed`, or `rejected`, return HTTP 200 with the persisted outcome/proof and current public status. No second event is emitted. Internal `held` is reported to the player as `pending`; `hold_reason`, `reviewed_by`, `reviewed_at`, and `failure_reason` are operator-only and never returned to the player. `rejected` is reported to the player per the cross-cutting payout-controls spec's player-facing rejection language (the daily-crate spec does not define new rejection UX). The four `hold_reason` values currently defined are `'global_pause'`, `'above_threshold'`, `'fraud_flag'`, `'manual_hold'`; only the first two are actively set by code paths in this spec — `'fraud_flag'` and `'manual_hold'` are reserved for forward compatibility (no code path enters them at launch, but the CHECK constraint accepts them to avoid a follow-up migration when those features land).
6. If status is `earned`, set `claimed_at=now()` and:
   - Resolve the current canonical wallet from `player_profiles` by `user_id`. This resolved wallet is the delivery wallet for any emitted grant/payout event.
   - **Points outcome** → set `status='grant_queued'`; emit `POINTS_GRANT` with `source_type='daily_crate'`, `source_id=$daily_crate_rewards.id` (BIGINT cast to TEXT if `point_grants.source_id` is TEXT), `user_id`, resolved `wallet`, `amount=contents_amount`, `metadata={dayId, configVersion, tier, rollValue, rewardHash}`. **Dedupe contract**: the points-grant consumer dedupes on the existing natural key `(user_id, source_type, source_id)` already enforced as `UNIQUE` on `point_grants`. A redelivered event therefore violates the unique constraint on second-attempt insert and the consumer treats the conflict as a successful no-op. No additional `idempotency_key` field is required on the event payload because the schema-level uniqueness already provides the guarantee. On confirmed application of the grant, the points-grant handler sets `daily_crate_rewards.status='granted'`. If the queue exhausts its retry budget for this event (a downstream concern owned by spec 301 / the points-grant handler, not this spec), the handler sets `status='failed'` with `failure_reason`.
   - **SOL outcome** → run the payout gate from spec 307 with `claim_kind='daily_crate_sol'`, amount `contents_amount`, and the row's `reviewed_at`. If the gate returns hold, atomically set `status='held'` with the returned `hold_reason`; do not reserve pool funds and do not emit a payout event. If the gate proceeds, attempt pool reservation per FR-7 using the resolved wallet for delivery. If funds can be reserved, set `status='payout_queued'` and emit `CRATE_SOL_PAYOUT` with the reward id, `user_id`, resolved `wallet`, payout amount, and an explicit `idempotency_key='daily_crate_reward:{daily_crate_rewards.id}'` field on the event payload. **Dedupe contract**: the payout subsystem persists `idempotency_key` on its own payout-attempts table with a `UNIQUE` constraint and checks for it before initiating any on-chain transfer. A redelivered event with the same key short-circuits to whatever the prior attempt's outcome was. The exact column name and storage format on the payout side are owned by the cross-cutting payout-controls spec; this spec is only responsible for emitting the key. If funds cannot be reserved, set `status='awaiting_funds'`. The `CRATE_SOL_PAYOUT` handler — including how it retries RPC failures, persists transaction signatures, and reconciles partial failures — is owned by the payout subsystem, not this spec. From this spec's point of view, the handler eventually sets the row to `granted` (success), `failed` with `failure_reason` (queue gave up), or `rejected` with `failure_reason` (operator rejected via peek).
7. Commit and return the persisted outcome to the player. Response includes proof material: `rewardId`, `userId`, `dayId`, `dayLamports`, `configVersion`, `configHash`, `tier`, `boundarySlot`, `boundaryBlockTime`, `blockhash`, `rollValue`, `rewardHash`, `outcome`, and current `status`.

The `point_grants.source_type` CHECK constraint is extended to allow `'daily_crate'`. Daily crate rewards live in `daily_crate_rewards`; they do not use `crate_drops`.

**Acceptance Criteria:**
- [ ] Endpoint exists with JWT middleware and Zod-validated body.
- [ ] Returns 425 `daily_crate_not_ready` when the day's run is missing or still processing.
- [ ] Returns 503 `daily_crate_run_failed` when the day's run failed.
- [ ] Returns 409 `no_crate_earned` when no reward row exists for the player/day.
- [ ] Claim resolves delivery wallet from `player_profiles.user_id`; event payloads do not trust a client-supplied wallet.
- [ ] SOL claims call the spec-307 payout gate with `claim_kind='daily_crate_sol'` before any pool reservation or transfer event.
- [ ] Above-threshold or globally paused SOL claims become internal `status='held'` with `hold_reason`; no pool reservation, no transfer, and player-facing responses report them as pending.
- [ ] First successful call transitions `earned` to the appropriate delivery state, emits the correct side-effect event if needed, returns 200 with the persisted outcome.
- [ ] Replay returns the original outcome/status, no second event emitted.
- [ ] Concurrent claim race is serialized by `FOR UPDATE`; no double grant or double payout event.
- [ ] **Concurrent-claim integration test:** fire two parallel claim requests against the same `(user_id, day_id)`; assert exactly one transitioned the row out of `earned`, exactly one event was emitted, and the second request returned 200 with the persisted outcome (replay path) without a second event.
- [ ] `POINTS_GRANT` events dedupe via the existing `point_grants` natural key `(user_id, source_type, source_id)`; `CRATE_SOL_PAYOUT` events carry an explicit `idempotency_key='daily_crate_reward:{id}'` field that the payout subsystem persists and checks before any on-chain transfer. Integration test redelivers each event type and asserts the consumer-side dedupe path holds (no second grant / no second payout).
- [ ] Integration test: full claim flow against a test DB, including event emission and downstream handler effect on `point_balances` (points path) or `daily_crate_rewards.status='granted'` after handler runs (sol path with funded pool).
- [ ] Integration test: SOL claim against a depleted pool leaves `status='awaiting_funds'`, no on-chain transfer attempted.

### FR-7: SOL Outcome Pool Handling & Retry

When a SOL outcome lands in `daily_crate_rewards` with `status='awaiting_funds'`, it must be paid as soon as the pool can cover it.

- The existing `REWARD_POOL_FUND` event handler (spec 400 FR-4) gains a tail step run after the pool deposit:
    1. `SELECT * FROM daily_crate_rewards WHERE status='awaiting_funds' AND crate_type='sol' ORDER BY created_at ASC` (limited batch, e.g. 100 per tick).
    2. For each row: lock the reward row and `reward_pool` singleton in a consistent order. If `balance >= row.contents_amount`: run the spec-307 payout gate with `claim_kind='daily_crate_sol'`. If the gate returns hold, set `status='held'` with `hold_reason`, do not reserve funds, and continue. If the gate proceeds, resolve the current canonical wallet from `player_profiles` by `user_id`, reserve/pay according to the pool accounting model (see "Dependencies & Assumptions"), set `status='payout_queued'`, emit `CRATE_SOL_PAYOUT` with `idempotency_key='daily_crate_reward:{id}'` and the resolved wallet, advance to next. If insufficient: **skip and continue** (do NOT block on this row — opportunistic-no-FIFO so a single mega-prize doesn't starve smaller pending crates below it).
    3. Stop when batch exhausted or no more pending rows.
- This makes pool refills opportunistic: any time pool funds arrive, every row that fits gets paid, oldest first within "fits."
- Operators see `peek` aggregate of total pending SOL liability so they can decide whether to top up the treasury for a stuck mega-prize.
- Operator approval for a held daily crate SOL reward sets `reviewed_at` / `reviewed_by`, clears `hold_reason`, moves the row to `status='awaiting_funds'`, and invokes the same bounded retry helper used by the `REWARD_POOL_FUND` tail. If the pool can cover it, the row advances to `payout_queued`; if not, it remains `awaiting_funds` until a later funding event.
- Operator **rejection** of a held daily crate SOL reward sets `reviewed_at` / `reviewed_by` plus `failure_reason='rejected_by_operator'` (or a more specific code from the payout-controls spec's vocabulary), clears `hold_reason`, moves the row to `status='rejected'`, and emits no event. No pool reservation, no on-chain transfer. The row is terminal from this spec's perspective; any reversal/refund mechanics are owned by the payout-controls spec.
- The payout handler marks `daily_crate_rewards.status='granted'` only on a confirmed on-chain transfer, or `status='failed'` with `failure_reason` when the queue exhausts its retry budget for the `CRATE_SOL_PAYOUT` event. **How** the payout subsystem retries RPC failures, classifies retryable vs terminal errors, persists signatures, and reconciles partial failures is owned by the payout subsystem (queue + payout handler internals), not this spec. This spec is intentionally agnostic to those mechanics — it only requires that the handler eventually settle the row to `granted` or `failed`.
- **Pool reservation accounting** (reserved-vs-available split, retry counters, `next_retry_at`, transaction signature persistence, reconciliation rules) is owned by the future fees-and-redistribution spec, not this one. This spec consumes whatever model that spec lands on. Until that spec exists, FR-7 retains the high-level "lock + check balance + emit" sketch above and treats the concrete reservation model as an implementation hand-off.
- **Manual retry** for `failed` rows is an ops action in peek: reset to the appropriate queued state (`grant_queued` or `payout_queued`) and re-emit the event. Consumer-side dedupe (the `point_grants` natural key for points; the persisted `idempotency_key` on the payout-attempts table for SOL) protects against double-grant if the original attempt actually completed. `rejected` rows are not retryable through this path — they're terminal — but ops may manually transition `rejected` → `payout_queued` if the rejection is itself reversed (a workflow owned by the payout-controls spec).

**Acceptance Criteria:**
- [ ] `REWARD_POOL_FUND` handler is extended with the retry tail; per-tail batch limit is configurable (env or `reward_config`).
- [ ] Retry uses `SELECT ... FOR UPDATE` on the pool singleton; no overdraft is possible.
- [ ] Retry path runs the spec-307 payout gate before reserving funds or emitting `CRATE_SOL_PAYOUT`; held rows are visible in peek for approval.
- [ ] Retry resolves delivery wallet from `player_profiles.user_id`; it does not rely on a stale or client-supplied wallet.
- [ ] Approving a held daily crate SOL reward records reviewer metadata, clears the hold, and immediately re-enters the payout retry path.
- [ ] Skip-not-block: a pending row whose amount exceeds current pool is skipped, smaller subsequent rows still get a chance.
- [ ] Each successful retry emits `CRATE_SOL_PAYOUT`; the payout handler transfers SOL and sets `daily_crate_rewards.status='granted'` after confirmation, or `status='failed'` with `failure_reason` when its retry budget is exhausted.
- [ ] Integration test: seed two pending SOL rows (large then small). Fund pool with enough for the small but not the large. Verify the small gets paid, the large remains pending. Fund again with enough for the large. Verify the large gets paid.
- [ ] Peek admin view exposes total pending SOL crate liability (`SUM(contents_amount) WHERE status IN ('awaiting_funds','held','payout_queued','failed') AND crate_type='sol'`). `rejected` rows are excluded — they are terminal and not a future-pay liability.
- [ ] Manual-retry action in peek: an operator can reset a `failed` row to `payout_queued` (SOL) or `grant_queued` (points) and re-emit the corresponding event with the same `idempotency_key`; integration test confirms the consumer-side dedupe path holds.

### FR-8: Player API Surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/crates/daily/today` | JWT | Live snapshot of *the current UTC date's* accumulating crate. Returns `{ dayLamports, currentTier (nullable), nextTier (nullable), nextThresholdLamports (nullable), sampleOutcomes (top-N by ppm of `currentTier`) }`. Read-only; does not roll. The previous day's earned crate (if any) is **not** returned by this endpoint; it appears on `/crates/daily/pending` only after the daily compute completes. Between 00:00 UTC and the moment the daily compute finishes, the previous day's reward is invisible to the player on either endpoint — this is by design and matches the run lifecycle. |
| `GET` | `/crates/daily/pending` | JWT | List materialized `daily_crate_rewards` rows for the user whose status is not terminally granted/failed. Each item includes `rewardId, dayId, dayLamports, tier, crateType, contentsAmount, status`. Internal `held` rows are returned as `status='pending'` and do not expose hold metadata. |
| `POST` | `/crates/daily/claim` | JWT | Body `{ day_id }`. Performs FR-6. Returns the persisted outcome plus proof material. |
| `GET` | `/crates/daily/configs/:version` | Public | Returns the committed config version used for verification, including full tier/outcome table and `configHash`. |
| `GET` | `/crates/daily/rewards/:rewardId/verify` | Public | Returns the reward row proof material so a third party can recompute `roll_value`, the selected outcome, and `reward_hash` from public Solana data + the committed config registry. Returns `userId`, `dayId`, `configVersion`, `configHash`, `dayLamports`, `tier`, `boundarySlot`, `boundaryBlockTime`, `blockhash`, `rollValue`, `crateType`, `contentsAmount`, `rewardHash`, plus the selected tier's full outcome list and the selected outcome's range `[startInclusive, endExclusive)`. Public exposure of `userId` is acceptable per the project's privacy model — `userId` is derivable from public chain activity in any case. The endpoint never returns wallet, claim status, or any delivery state. Responses set `Cache-Control: public, max-age=86400, immutable` because reward rows are never mutated after creation; per-IP rate limit applied via the existing middleware. |
| `GET` | `/crates/mine` | JWT | Existing crate history endpoint from spec 400 for legacy challenge/bonus crate rows. Daily crates may be returned by a new daily endpoint instead of overloading this legacy view. |

The verifier UI is deferred, but the API/data needed by that UI is in scope so proof material is testable at launch.

**Acceptance Criteria:**
- [ ] Authenticated daily routes are implemented behind JWT middleware with the existing response envelope; public config/verify routes expose no wallet, no delivery status, no internal claim state.
- [ ] `/crates/daily/today` excludes refunded rounds and uses the same volume helper as the daily computation.
- [ ] `/crates/daily/pending` orders by `day_id DESC`, paginates standardly, and returns only materialized reward rows.
- [ ] `/crates/daily/configs/:version` returns 404 for unknown versions and returns the exact committed config for known versions.
- [ ] `/crates/daily/rewards/:rewardId/verify` recomputes `rollValue`, the selected outcome, and `rewardHash` from persisted fields and config; mismatch returns an internal integrity error (500 with structured code, alerted to ops).
- [ ] All endpoints return appropriate HTTP status codes per the project's transport-semantics rule (200 success, 409 ineligible, 425 daily-crate-not-ready, 401/403 auth).
- [ ] `/crates/daily/rewards/:rewardId/verify` sets `Cache-Control: public, max-age=86400, immutable` and is rate-limited per IP via existing middleware.
- [ ] OpenAPI types are generated and committed.

### FR-9: Migration & Removal of Per-Game Crate Drops

A new migration (e.g. `032_daily_crate.sql`, using the next available number) executes the following in order:

1. `CREATE TABLE daily_crate_runs (...)` per FR-3.
2. `CREATE TABLE daily_crate_rewards (...)` per FR-3.
3. Indexes on `daily_crate_rewards`:
   - `CREATE INDEX idx_daily_crate_rewards_user_pending ON daily_crate_rewards (user_id, day_id DESC) WHERE status NOT IN ('granted','failed','rejected')` — `/crates/daily/pending` per-user list ordered by day, partial to keep it small.
   - `CREATE INDEX idx_daily_crate_rewards_retry ON daily_crate_rewards (created_at) WHERE status = 'awaiting_funds' AND crate_type = 'sol'` — FR-7 retry tail (oldest-first scan over awaiting funds).
   - `CREATE INDEX idx_daily_crate_rewards_day_status ON daily_crate_rewards (day_id, status)` — peek per-day rewards-table view filters/sort, plus aggregates.
   - `(user_id, day_id)` is already covered by the `UNIQUE` constraint, so single-row claim/replay lookups need no extra index.
   - Verifier lookup is by primary key `id`, so no extra index needed.
4. Indexes on `game_entries` for the daily aggregation:
   - `CREATE INDEX idx_game_entries_daily_crate_settled_user ON game_entries (settled_at, user_id) WHERE settled_at IS NOT NULL AND is_winner IS NOT NULL`.
5. Assert pre-condition: `SELECT COUNT(*) FROM crate_drops WHERE trigger_type='game_settled'` must equal 0. We are in dev; if any rows are found, the migration fails and the operator must clean up first (truncate or relabel). Production deployment of this spec MUST occur before any `'game_settled'` rows ever exist.
6. `ALTER TABLE crate_drops DROP CONSTRAINT crate_drops_trigger_type_check, ADD CONSTRAINT crate_drops_trigger_type_check CHECK (trigger_type IN ('challenge_completed','bonus_completed'))`.
7. `ALTER TABLE point_grants DROP CONSTRAINT point_grants_source_type_check, ADD CONSTRAINT point_grants_source_type_check CHECK (...)` preserving all currently allowed source types and adding `'daily_crate'`. Implementation must verify `point_grants.source_id`'s column type accepts the BIGINT identity from `daily_crate_rewards.id` (cast to text in the emit if `source_id` is TEXT, or extend the type otherwise — decide at implementation time after reading the existing column definition).
8. `INSERT INTO payout_controls (claim_kind) VALUES ('daily_crate_sol') ON CONFLICT (claim_kind) DO NOTHING` so daily crate SOL payouts use the same pause/review-threshold rail as other claimable SOL payouts. Default `review_threshold` and `is_paused` values for *all* SOL `claim_kind` rows (including this one) are owned by the cross-cutting payout-controls spec, not this one. This spec is responsible only for ensuring the row exists; the launch values are set there so the policy is consistent across referrals, daily crates, and any other future SOL payout rails.
9. `reward_config` keys are **not** deleted. The challenge-completion and bonus-completion paths still emit `CRATE_DROP` and still read `points_crate_drop_rate`, `sol_crate_drop_rate`, `sol_crate_pool_pct`, `sol_crate_min_value`, `points_crate_min`, `points_crate_max` for those rolls. Tuning those values is out of scope.

Backend code changes:

- `backend/src/queue/handlers/game-settled.ts` — remove the `CRATE_DROP` event emit (one block); surrounding logic (points grant, challenge progress, pool funding) is untouched. Other places that emit `CRATE_DROP` (challenge engine, bonus completion) keep emitting it.
- `backend/src/queue/handlers/crate-drop.ts` — **kept**. Continues to handle `'challenge_completed'` and `'bonus_completed'` triggers as today. The handler is unaware that `'game_settled'` no longer reaches it, but the trigger CHECK on `crate_drops` will now reject any such row at insert time as a defense-in-depth.
- `backend/src/queue/handlers/reward-pool-fund.ts` — extend with the retry tail per FR-7.
- New/updated payout and points handlers support `daily_crate_rewards` status transitions.
- New: `backend/src/services/daily-crate.ts` — pure-function-heavy module wiring config selection, tiering, rolling, reward hash, and delivery state transitions.
- New: `backend/src/cron/daily-crate-compute.ts` — the FR-3 daily computation worker.
- New: `backend/src/routes/crates-daily.ts` — the FR-8 endpoints.
- New: `backend/src/config/economy/{dev,mainnet}/daily-crate-configs.ts`, `backend/src/config/economy/index.ts`, and `backend/src/config/economy/schema.ts` — FR-2.
- Delete: `docs/references/daily-crate.csv`. The CSV is a launch-only seed for the TS files; the TS files become the sole source of truth at implementation time and the CSV is not retained.

`docs/TECH_DEBT.md` gains entries:
- "Per-round random `crate.drop` from `game.settled` was removed in spec 402; the same handler still serves challenge-completion and bonus-completion crates with the legacy probabilistic roll. Re-tune or replace those paths in a future spec if the daily-crate model should fully subsume crate semantics."
- "Event naming convention is asymmetric: `POINTS_GRANT` is generic and dispatched via `source_type`, while `CRATE_SOL_PAYOUT` is crate-scoped. A future cleanup pass should unify around a generic `SOL_PAYOUT` with `source_type='daily_crate' | 'crate_drop' | 'referral' | ...` to mirror the points pattern. Out of scope for spec 402 to avoid forking the convention mid-rollout."

**Acceptance Criteria:**
- [ ] Migration runs cleanly on a fresh dev DB.
- [ ] Pre-condition assertion fires when `'game_settled'` rows exist.
- [ ] Spec 400 FR-5 acceptance criteria for the per-round path are explicitly marked overridden in this spec's history; the spec-400 spec file gains a banner pointing to spec 402.
- [ ] After migration, attempting to insert `crate_drops` with `trigger_type='game_settled'` fails the CHECK.
- [ ] `point_grants.source_type` retains all pre-existing allowed values and adds `daily_crate`.
- [ ] `payout_controls` has a `daily_crate_sol` row; peek payout controls can pause or threshold daily crate SOL payouts independently from referrals.
- [ ] Backend boots without errors.
- [ ] `crate-drop.ts` continues to function for challenge/bonus triggers — integration test: complete a challenge that rewards a crate, verify the `crate_drops` row is inserted with `trigger_type='challenge_completed'`.

### FR-10: Operator Visibility (peek)

Peek admin (spec 305) gains:

- **Daily Crate Liability** widget on the economy page: total pending SOL liability, count of pending SOL rows, oldest pending row's `created_at`.
- **Daily Crate Runs** table view: paginate `daily_crate_runs` rows with `day_id`, `boundary_slot`, `boundary_block_time`, `blockhash`, `config_version`, `config_hash`, `status`, `attempt_count`, `failure_reason`, `last_attempted_at`, `completed_at`, `recorded_at`. Filter by date.
- **Daily Crate Rewards** table view/detail: paginate `daily_crate_rewards` rows with user, day, tier, amount, roll, outcome, status, and reward hash.
- **Payouts held queue integration**: daily crate SOL rewards held by the spec-307 gate appear in the existing peek payouts review surface as `claim_kind='daily_crate_sol'`. **Approve** sets `reviewed_at`/`reviewed_by`, clears the hold, moves the row to `awaiting_funds`, and immediately invokes the payout retry helper. **Reject** sets `reviewed_at`/`reviewed_by` and `failure_reason`, clears the hold, moves the row to `rejected`, and emits no payout event — see FR-7. Both actions follow the existing payout-review policy from the cross-cutting payout-controls spec.
- **Compute-running indicator**: the runs-table view surfaces whether a `processing` row exists for any recent day, with the boundary slot and start time. Per Design Decision #16, ops uses this to avoid landing config-changing deploys during the daily compute window.
- **Manual retry for `failed` rewards**: from the rewards-table detail, a "Retry delivery" action resets a `failed` row to `payout_queued` (SOL) or `grant_queued` (points), clears `failure_reason`, and re-emits the corresponding event with the same `idempotency_key='daily_crate_reward:{id}'`. Audit trail (operator id + timestamp) is captured per the existing peek action-logging pattern.
- The existing crate-drops admin views continue to show legacy challenge/bonus crate rows.

**Acceptance Criteria:**
- [ ] Pending-SOL aggregate query returns < 50ms on a representative dev database.
- [ ] Runs-table view exists with date-range filter and a compute-running indicator.
- [ ] Rewards-table detail shows `config_version`, `config_hash`, `boundary_slot`, `boundary_block_time`, `blockhash`, `roll_value`, `reward_hash`, and current delivery status.
- [ ] Held daily crate SOL rewards are visible in the existing payouts held queue and can be approved through the existing review action.
- [ ] Manual-retry action on `failed` rows resets status, clears `failure_reason`, re-emits the event with the original idempotency key, and is logged in the peek audit trail.

---

## Success Criteria

1. A player who wagers 0.6 SOL in settled rounds across UTC day N gets a materialized tier-3 `daily_crate_rewards` row after the day closes, using the latest config version sampled by that daily computation.
2. A player offline for 5 days returns and successfully claims 5 crates, each with its own deterministic outcome.
3. The same `(blockhash, userId, dayId, configVersion, tier)` always yields the same outcome — verified by a unit test with golden vectors.
4. A SOL outcome with the pool drained sits at `status='awaiting_funds'`, then is paid automatically the next time the pool is funded with enough balance and passes the payout gate — verified by integration test.
5. A SOL outcome above the configured `daily_crate_sol` threshold is held internally and not transferred until an operator approves it through peek.
6. The per-round random crate drop in `game.settled` no longer fires — verified by integration test that settles a round and asserts zero `crate_drops` rows are created.
7. Backend refuses to start if `daily-crate-configs.ts` is malformed (duplicate versions, sum != 1M, gaps, descending thresholds).

---

## Dependencies & Assumptions

- **Async event queue** (spec 301) is operational. `POINTS_GRANT`, `CRATE_SOL_PAYOUT`, `REWARD_POOL_FUND` events flow through it.
- **Payout pause/review rail** (spec 307) is operational. Daily crate SOL payouts use `claim_kind='daily_crate_sol'`; global pause and review thresholds hold payouts before any transfer.
- **`game_entries`** (spec for game settlement) records `settled_at` reliably for every settled round.
- **`reward_pool`** (spec 400) accounting is correct; this spec does not refactor pool funding mechanics.
- **JWT auth** (spec 007) protects all `/crates/daily/*` routes.
- **Solana RPC** (dRPC for devnet, configurable for mainnet) returns finalized block times within seconds of block production. We do not assume sub-slot precision; the boundary rule is robust to ±1 slot of clock noise on the RPC side.
- **Solana historical block access** is needed only until the boundary seed is persisted. Once `boundary_slot`, `boundary_block_time`, and `blockhash` are stored, reward computation and retry no longer require RPC access to that historical block.
- **RPC retention SLA must cover the worst-case retry budget.** Implementation must verify the chosen RPC provider retains finalized blocks for at least as long as the configured retry-window for failed daily runs (default 14 days). If the provider's retention is shorter, either bump to an archival tier, shorten the retry window, or document a manual recovery path via an external archival source (Solana Bigtable export, etc.). This MUST be confirmed before mainnet rollout.
- **Pool reservation accounting** (reserved-vs-available split, retry counters, transaction-signature persistence, reconciliation rules for failed transfers) is owned by the future fees-and-redistribution spec. This spec consumes whatever model that spec lands on. Until then, FR-7 implementation must not regress the existing pool-singleton lock-and-decrement contract.
- **No backfill of historical `crate_drops` rows.** This spec is a forward-looking change. Any per-round crate rows in dev DBs are dropped or relabeled before migration.

---

## Validation Plan

**Unit:**
- FR-1 day-volume helper across boundary cases.
- FR-4 tier determination across all 13 thresholds.
- FR-5 roll function with golden vectors and full-sweep distribution check per tier.
- FR-5 cross-language reproduction: a Python or Rust JCS+SHA256 reference implementation reproduces the same `roll_value` from the same inputs. Catches accidental dependence on JS-specific canonicalization quirks.
- FR-2 Zod validation rejects malformed configs.
- FR-2 ppm-sum invariant enforced at module load (every tier sums to exactly 1,000,000).
- **Future test optimization (note, not v1 blocker):** the FR-5 full-sweep distribution check (1M iterations × N tiers × M configs) will get slow as configs accumulate. Switch to property-based sampling (e.g., 10k rolls per tier with chi-square goodness-of-fit) once the suite slows the test cycle; the per-tier `sum === 1_000_000` invariant already gives exactness.

**Integration:**
- FR-3 daily computation worker against a mocked Solana connection.
- FR-3 recovery: persisted seed + missing reward rows → retry completes without RPC; concurrent-worker test → two workers compute the same day in parallel and produce identical reward rows via `ON CONFLICT DO NOTHING`, no duplicates, no mutation; mid-day crash → atomic rollback of the chunked-tx insert leaves zero rows, next run reinserts cleanly.
- FR-6 claim flow end-to-end: earned → claim → points granted; earned → claim → SOL with funded pool → on-chain transfer; earned → claim → SOL with empty pool → awaiting funds.
- FR-6/FR-7 payout gate: SOL amount at/above `daily_crate_sol` threshold → internal held row, no reservation/transfer, public status pending; approve → row returns to payout path and can complete.
- FR-7 retry path: drained pool, fund event arrives, oldest pending paid.
- FR-9 migration on a snapshot of dev DB with no `'game_settled'` rows.
- Idempotency: replay a claim call twice; second is a no-op.
- Concurrency: parallel claims for the same `(user, day)`; only one succeeds.

**Manual / smoke:**
- Devnet: wager across a UTC boundary, observe daily run/reward rows get recorded, claim, observe outcome and proof on `/crates/daily/pending` or the verify endpoint.
- Verify the proof material on a claim response can be used to recompute the outcome from scratch using `blockhash`, `userId`, `dayId`, `configVersion`, and the committed TS config registry — proves end-to-end fairness.

**`./scripts/verify` must pass at task completion** (full backend lint, typecheck, tests).

---

## Design Decisions & Review Notes

1. **Replaces, not supplements.** Running both the per-game and the daily systems simultaneously was rejected in brainstorming — clearer mental model, no double-rewarding, simpler ops.
2. **Volume in lamports, not USD.** The reward table is denominated in SOL; tracking lamports keeps the player narrative simple ("wager 5 SOL today to hit tier 6") and avoids FX in the hot path.
3. **00:00 UTC global, not per-user windows.** Single global clock is easier to communicate and coordinates with future global features (Dogpile, leaderboards).
4. **Blockhash-only fairness, no server commit/reveal.** The Solana blockhash at the deterministic boundary slot is publicly observable. Per-user outcomes diverge because `user_id` is mixed into the entropy hash alongside `day_id`, `config_version`, and `tier`. No server secret is published pre-rollover; verification is reproducible from public chain data plus the committed config registry.
5. **Off-chain seed record (not on-chain).** Persisting `(boundary_slot, boundary_block_time, blockhash, config_version, config_hash)` server-side is sufficient for v1. The seed is reconstructible from RPC while the historical block is available; after persistence, retries use the stored seed. On-chain anchoring is forward-compatible if trust requirements grow.
6. **Precomputed rewards, lazy delivery.** The daily job freezes tier and outcome so old claims never depend on mutable game history or later config changes.
7. **Config in append-only TS, not DB.** Code review and version control beat an admin UI we don't need yet. DB stores the selected config version/hash on each reward row; the future port to DB-resident config is a one-migration affair if it ever matters.
8. **Env-split TS files (`dev`, `mainnet`).** Allows test fixtures (predictable outcomes) without touching the production table. Pattern is the precedent for future env-specific business configs.
9. **Opportunistic-no-FIFO retry.** A single 20,000-SOL pending row must not block thousands of small ones; if the pool can't cover the head, we skip and try the next.
10. **Crate point grants unmultiplied.** Restated from spec 401's launch decision; no rule change, just confirmation.
11. **Verifier UI deferred, verifier data/API in scope.** The proof material is captured on the row and public verification endpoints expose enough data for a future page to render the full table and selected range.
12. **Config pre-commit deferred.** The team accepts the v1 fairness limitation around post-boundary config deploy timing because daily crate configs should rarely, if ever, change. If config edits become operationally common, this decision must be revisited before shipping those edits.
13. **SOL payout guardrails reuse spec 307.** Daily crate SOL payouts do not get bespoke caps. They run through `payout_controls` with `claim_kind='daily_crate_sol'`; too-large or globally paused payouts sit in the held/pending rail until an operator approves them.
14. **V1 trust limitations — accepted, documented, not patched in this spec.** Four known weaknesses are deferred to future hardening:
    - **Validator-grindability of the boundary blockhash.** A leader producing the boundary block can influence the block's transaction set, which influences the merkle root, which influences `blockhash`. Theoretical grinding cost is low for high-tier SOL prizes if the leader knows the eligible-user set. **Mitigation v1:** the spec-307 review threshold for `claim_kind='daily_crate_sol'` is set low enough that high-tier SOL outcomes always require operator approval before transfer. Future hardening: mix multiple subsequent blockhashes, or anchor an operator-supplied randomness beacon.
    - **Single-RPC source of the boundary blockhash.** Until the seed is persisted, one malicious or buggy RPC could poison an entire day's outcomes. Future hardening: 2-of-3 quorum across independent RPC providers.
    - **No on-chain anchor for the config registry.** Append-only is enforced only by code review; an operator with merge access could in theory ship a "new version 1" with different content. Future hardening: anchor `config_hash` per version on-chain (~1 TX per config bump).
    - **Operator-trust model for reward materialization.** The compute job runs server-side and decides which eligible users get an inserted reward row. A malicious operator could selectively suppress rows or falsify `day_lamports`, and neither is detectable from public data. V1 accepts this gap: there is no Merkle root, no on-chain commitment, no DB-level append-only triggers, no public audit log. The defense is operational (code review of the cron path, ops monitoring of aggregate count/liability) plus the spec-307 review threshold catching high-value SOL outcomes before transfer. Future spec: per-day Merkle root over reward leaves + inclusion-proof endpoint + DB triggers that block UPDATE/DELETE on immutable columns + audit log table.
15. **Append-only config without per-day pre-commit (v1 acceptance).** Restated from FR-2: an operator deploy after the boundary slot becomes public but before the daily compute runs could change the active `config_version`. Daily crate configs are expected to change rarely; if that assumption breaks, this decision must be revisited before the next config bump.
16. **One day, one config — locked at first seed-discovery.** When the owning worker for a `day_id` discovers the boundary slot, it samples the active config exactly once and writes `config_version`/`config_hash` onto the `daily_crate_runs` row. Every subsequent retry — including retries that span a deploy — reads those values off the run row rather than re-sampling. Every reward row for that day carries the same `(config_version, config_hash)` tuple. A deploy mid-compute does not change the day's outcomes; it only affects the *next* compute. The previously discussed "mixed config versions within a day" mode was rejected: it complicated verification, made operator deploy timing load-bearing for fairness, and bought no real benefit.

## Open Review Items

1. **Scheduler runbook details (operational tuning, not behavioral).** Cron time is fixed at 00:15 UTC and the worker reconciliation window covers the previous 14 days. Worker coordination is via `daily_crate_runs` INSERT...ON CONFLICT plus a heartbeat-based stale-takeover (default 30 min). Still to decide at refine time: per-failure-class retry policy on the worker side (RPC errors auto-retry with backoff per spec, other classes leave the run `failed` and alert), exact heartbeat interval and stale threshold, alert thresholds (e.g., page if `daily_crate_runs.status='failed'` for more than 6 hours), manual rerun CLI/peek command.
2. ~~Daily crate table indexes~~ — resolved in FR-9 step 3 (partial pending-list index, partial retry index, day/status index for peek).
3. **Fraud controls beyond payout review.** Decide whether daily crate earning/claiming should also consult fraud flags before non-SOL delivery or before showing claimable rewards. Likely punted to a fraud-controls spec.
4. **Operator workflow for `failed` rows.** This spec collapses transient/terminal distinctions into a single `failed` status; downstream queue retries are owned by the payout subsystem. The peek action to reset a `failed` row + re-emit the event is acceptance-criteria-level in FR-7. Concrete UX (button labels, confirmation prompts, audit trail of who reset which row) is implementation detail decided at refine time.
5. **Public tamper resistance** (Merkle root + on-chain anchor + DB-level append-only triggers + audit log). Discussed during review but not landed in v1; FR-3 immutability is enforced only by code/convention, and selective row suppression by an operator is currently undetectable from public data. Track as a follow-up trust-minimization spec; in the meantime, the spec-307 review threshold for high-tier SOL outcomes is the primary defense.

---

## Deferred / Out of Scope

- **Public fairness page** — the human-facing UI that lets anyone enter a daily reward id and see the recomputed roll. Data/API are captured; UI is a later spec.
- **On-chain anchor** of daily run rows — strongest trust-minimization, ~1 TX/day. Forward-compatible; not v1.
- **Operator admin UI for tier table** — TS code review is the editing path. Future spec when admin tooling needs it.
- **Crate "open animation" UI** — frontend concern, separate project per `docs/SCOPE.md`.
- **Lifecycle / multi-day caps** (e.g. "you can claim at most N backlog crates per session") — not requested; the user's brief says "no time limitation on claiming."
- **Advanced pool reservation accounting** for known-pending mega-prizes — operators can reason about it via the peek liability widget; a fuller reserved/available pool split is a future refinement if the launch transfer handler does not need it.
- **Tier outcome tuning post-launch** based on observed payout distributions — economy-tuning spec, not this one.
- **Multi-currency outcomes** — only `points` and `sol` for v1; the `Outcome.item_type` enum can be extended in a future config version when needed.

---

## Completion Signal

### Spec Readiness Gates

- [x] All FR sections have unambiguous acceptance criteria.
- [x] Launch tier table will be hand-authored into `daily-crate-configs.ts` from the seed CSV in iteration 2; CSV deleted in the same iteration.
- [x] Pool retry semantics (opportunistic-no-FIFO) is agreed; pool reservation accounting hand-off to the future fees-and-redistribution spec is acknowledged in `Dependencies & Assumptions`.
- [x] Migration ordering reviewed against current dev DB state — `crate_drops` has zero `'game_settled'` rows in dev; the migration will assert this pre-condition before altering the CHECK.
- [x] Refinement complete; user has approved the move to executing the implementation loop.

### Implementation Checklist

Each item is one autonomous iteration (one `claude -p` invocation). Tests are bundled with the feature they verify. Items are ordered by dependency — execute top to bottom.

**Phase 0: Schema & Migration**

- [x] [backend] Add migration `backend/migrations/032_daily_crate.sql`: `CREATE TABLE daily_crate_runs` (per FR-3, with status CHECK and the table-level `status='completed' ⇒ all seed/config fields populated` CHECK), `CREATE TABLE daily_crate_rewards` (per FR-3, with status CHECK, hold_reason CHECK, `crate_type` CHECK, `contents_amount > 0` CHECK, `UNIQUE (user_id, day_id)`); create the three FR-9 step-3 indexes on `daily_crate_rewards` (`idx_daily_crate_rewards_user_pending` partial, `idx_daily_crate_rewards_retry` partial, `idx_daily_crate_rewards_day_status`); create `idx_game_entries_daily_crate_settled_user` partial index on `game_entries`; assert pre-condition `SELECT COUNT(*) FROM crate_drops WHERE trigger_type='game_settled'` is 0 (fail migration otherwise); ALTER `crate_drops` trigger_type CHECK to allow only `('challenge_completed','bonus_completed')`; ALTER `point_grants` source_type CHECK preserving every value currently in `018_reward_economy.sql` and adding `'daily_crate'`; `INSERT INTO payout_controls (claim_kind) VALUES ('daily_crate_sol') ON CONFLICT DO NOTHING`. Migration runs cleanly on fresh dev DB and is idempotent on re-run. Verify: `cd backend && pnpm migrate && pnpm typecheck && pnpm test` (FR-3, FR-9). (done: iteration 1)

**Phase 1: Config & Pure Helpers**

- [x] [backend] Author `backend/src/config/economy/{schema.ts, index.ts, dev/daily-crate-configs.ts, mainnet/daily-crate-configs.ts}`. `schema.ts` defines `Outcome`, `Tier`, `DailyCrateConfig` types and a Zod schema enforcing FR-2 invariants (positive integer `version`; ascending unique versions across the registry; contiguous `tier` numbers 1..N; ascending `threshold_lamports`; `sum(outcomes[].ppm) === 1_000_000` per tier; positive bigint amounts). `index.ts` selects the variant by `config.cluster`, exports `getActiveDailyCrateConfig()` returning the highest-version entry regardless of array order, and `getDailyCrateConfigHash(config)` computing `SHA256(JCS(config))` per RFC 8785 (use the `canonicalize` package; serialize bigints as JSON strings before canonicalization). Both `dev/` and `mainnet/` files export an identical launch `version: 1` config covering all 13 tiers from `docs/references/daily-crate.csv`, with rounding redistributed onto each tier's largest-ppm row so each tier sums to exactly 1,000,000 ppm. The schema validates on module import; the backend exits with a clear error on malformed config. Delete `docs/references/daily-crate.csv` in this iteration. Unit tests: malformed configs (duplicate/non-ascending versions, sum != 1M, non-ascending thresholds, gap in tier numbers) rejected with useful messages; `getActiveDailyCrateConfig()` returns the highest-version entry when seeded out-of-order; hash is stable across calls and changes when content changes; ppm-per-tier sum invariant verified for every tier in every config. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-2). (done: iteration 2)

- [x] [backend] Add `backend/src/services/daily-crate.ts` with the FR-1 day-volume helpers: `dayIdBoundsUtc(dayId): { startUtc, endUtc }` constructs the half-open `[00:00 UTC of dayId, 00:00 UTC of dayId+1)` window from the `'YYYY-MM-DD'` string with no `::date` casts; `computeDayLamports(db, userId, dayId): Promise<bigint>` runs the FR-1 SQL using `idx_game_entries_user_settled`; `computeEligibleDailyVolumes(db, dayId, floorLamports): Promise<{ userId, dayLamports }[]>` runs a single aggregate using `idx_game_entries_daily_crate_settled_user`. All queries filter `is_winner IS NOT NULL`. Unit tests: rounds spanning a day boundary are assigned by `settled_at` to the correct day; refunded (`is_winner IS NULL`) rows excluded; floor exclusion. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-1). (done: iteration 3)

- [x] [backend] Extend `backend/src/services/daily-crate.ts` with `determineTier(config, dayLamports: bigint): Tier | null` (returns null below `tiers[0].threshold_lamports`; otherwise returns the tier with the largest threshold ≤ volume), `rollDailyCrateOutcome(blockhash, userId, dayId, configVersion, tier): { outcome, rollValue, outcomeRange: { startInclusive, endExclusive } }` (entropy = `SHA256(JCS({ domain: "daily_crate_roll:v1", blockhash, user_id, day_id, config_version, tier }))`, `rollValue = first 8 bytes BE u64 mod 1_000_000`, walk `tier.outcomes` accumulating ppm and pick the first whose running sum strictly exceeds `rollValue`; integer-only arithmetic in selection), and `computeRewardHash(input): string` (`SHA256(JCS({ domain: "daily_crate:v1", user_id, day_id, config_version, config_hash, day_lamports, tier, boundary_slot, boundary_block_time, blockhash, roll_value, crate_type, contents_amount }))`). Commit golden-vector JSON fixtures at `backend/src/__tests__/fixtures/daily-crate-vectors.json` whose expected `roll_value` and `reward_hash` were generated from a Python or Rust JCS reference implementation during refinement; the JS unit test asserts byte-for-byte equality against those fixtures (this satisfies the FR-2/FR-5 cross-language reproduction AC without adding a Python/Rust runtime to backend CI). Unit tests: `determineTier` boundary cases (below floor, exactly at each threshold, between thresholds, above highest); deterministic roll for golden tuples; full-sweep `roll = 0..999_999` per tier in the launch config produces ppm-exact outcome distribution; no floating-point arithmetic on the selection path. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-4, FR-5). (done: iteration 4)

**Phase 2: Daily Compute Worker**

- [x] [backend] Add `backend/src/worker/daily-crate-compute.ts` with `findBoundarySlot(connection, targetUnixSeconds): Promise<{ slot, blockTime, blockhash }>` that walks finalized slots forward from approximately the expected slot, picks the first slot whose `getBlockTime` ≥ target, then calls `connection.getBlock(slot)` and returns its `blockhash` field. Unit test with a mocked Connection that yields a stream of `(slot, blockTime)` pairs across the boundary; helper picks the first ≥ target and never reads past it. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-3). (done: iteration 5)

- [x] [backend] In the same file, implement `runDailyCrateComputation(db, connection, dayId)` per FR-3: claim the run via `INSERT INTO daily_crate_runs (day_id, status) VALUES ($1, 'processing') ON CONFLICT (day_id) DO NOTHING RETURNING day_id`; on conflict either back off (recent `last_attempted_at`) or stale-takeover (`UPDATE ... WHERE last_attempted_at < now() - INTERVAL '30 minutes'`); if owning and seed fields are NULL → call `findBoundarySlot` and persist `boundary_slot, boundary_block_time, blockhash` plus a one-shot sample of `getActiveDailyCrateConfig()` written via `UPDATE ... WHERE config_version IS NULL` so retries read the locked values; compute eligible volumes, tiers, rolls, reward hashes; insert rewards in a single `BEGIN ... COMMIT` with chunks of ~500 rows per multi-row `INSERT ... ON CONFLICT (user_id, day_id) DO NOTHING`; finally set `status='completed', completed_at=now()`. RPC failure increments `attempt_count`, updates `last_attempted_at`, retains `'processing'` for retry; persistent failure after exhausting the configurable retry budget marks `'failed'` with `failure_reason` and emits `daily_crate.run_failed` log. Heartbeat `last_attempted_at` between insert chunks. Add `startDailyCrateWorker(db, connection, { reconciliationDays })` mirroring `startReferralTierWorker`: at boot run a reconciliation pass over yesterday plus the previous N=14 days oldest-first, then arm a `setTimeout` that fires at the next 00:15 UTC and re-arms after each tick; never crashes the process on errors. Wire `startDailyCrateWorker` into `backend/src/index.ts` startup after `startReferralTierWorker`. Integration tests against test DB + mocked Connection: race two concurrent workers on the same `day_id` and assert exactly one runs the compute body to completion, the other backs off, and reward rows are written exactly once via `ON CONFLICT DO NOTHING`; recovery — pre-populate seed fields, run with no Connection access, assert reward materialization completes; mid-day crash — abort the chunked transaction and assert zero rows post-rollback for that day, then re-run and assert clean reinsertion; mid-compute config bump — write a higher-version config to the registry between seed-discovery and reward materialization, assert every reward for that day carries the originally-locked `config_version`/`config_hash`. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-3, FR-4, FR-5). (done: iteration 6)

**Phase 3: Player & Public API + Handler Extensions**

- [ ] [backend] Extend `backend/src/queue/handlers/points-grant.ts`: when `payload.source_type === 'daily_crate'`, force `effective_multiplier = 1.0` regardless of any active dogpile/multiplier ladder (FR-3 invariant 7), require `payload.source_id` (the `daily_crate_rewards.id` cast to TEXT — fits the existing `point_grants.source_id TEXT` column), and after the existing UPSERT into `point_grants` run `UPDATE daily_crate_rewards SET status='granted', granted_at=now() WHERE id = $sourceId AND status IN ('grant_queued','earned')` inside the same transaction. Existing wager/challenge/bonus/crate_points paths unchanged. Integration tests: emit a `'daily_crate'` POINTS_GRANT while a 2× dogpile event is active and assert the recorded amount and `effective_multiplier` are unmultiplied; assert `daily_crate_rewards.status='granted'` after the handler runs; redeliver the same event and assert `point_grants` UNIQUE blocks the second insert (no double-grant) and the row stays `granted`. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-3, FR-6).

- [ ] [backend] Extend `backend/src/queue/handlers/crate-sol-payout.ts` to dispatch on a payload `source` discriminator: `source: 'crate_drop'` (default for legacy challenge/bonus crate rows) keeps the existing `crate_drops`-row path bit-for-bit unchanged; `source: 'daily_crate'` loads `daily_crate_rewards` by id, requires `status='payout_queued'`, persists the payload's `idempotency_key='daily_crate_reward:{id}'` to a new `payout_attempts` table (`UNIQUE (idempotency_key)` checked before any on-chain transfer; columns: `idempotency_key TEXT PK, claim_kind TEXT, amount_lamports BIGINT, tx_sig TEXT NULL, status TEXT, created_at TIMESTAMPTZ`) inside the same migration if not already present from an upcoming payout-controls extension — author it here under migration `032_daily_crate.sql` if missing, otherwise reuse. Execute the SOL transfer using the resolved wallet from the payload (do not consult `daily_crate_rewards.wallet` — that field doesn't exist; payload carries the resolved wallet from the claim path). On success set `daily_crate_rewards.status='granted', granted_at=now()` and update the payout-attempts row with `tx_sig` and `'success'`. On retryable RPC error leave `'payout_queued'` for queue retry. On retry-budget exhaustion set `daily_crate_rewards.status='failed', failure_reason='payout_handler_exhausted'`. Integration tests: legacy `crate_drops` path produces identical behavior to before (regression); daily-crate happy path transfers SOL + sets `granted`; redelivered event with same `idempotency_key` short-circuits to the prior outcome with no second on-chain transfer; retry-exhaustion sets `failed`. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-6, FR-7).

- [ ] [backend] Add `backend/src/routes/crates-daily.ts` and register on the app. Implement `POST /crates/daily/claim` per FR-6 inside a single DB transaction: JWT-resolve `user_id`; reject `day_id >= today UTC` with 400; SELECT `daily_crate_runs` (missing or `'processing'` → 425 `daily_crate_not_ready`; `'failed'` → 503 `daily_crate_run_failed`); SELECT FOR UPDATE on `daily_crate_rewards (user_id, day_id)` (missing → 409 `no_crate_earned`); for any non-`'earned'` status, return 200 with the persisted outcome and a public-safe status mapping (`'held'` → `'pending'` to the player; never expose `hold_reason`/`reviewed_by`/`reviewed_at`/`failure_reason`). For `'earned'`: resolve the canonical wallet from `player_profiles.user_id` (event payloads must carry this resolved wallet — never trust a client value); on points outcome set `claimed_at=now(), status='grant_queued'` and emit `POINTS_GRANT` `{ source_type: 'daily_crate', source_id: id.toString(), userId, wallet, amount: contents_amount, metadata: { dayId, configVersion, tier, rollValue, rewardHash } }`; on SOL outcome run the spec-307 payout-gate via `payoutGate({ claim_kind: 'daily_crate_sol', amount: contents_amount, reviewed_at })` — gate-hold sets `status='held'` with the returned `hold_reason`, no reservation, no event; gate-proceed locks `reward_pool` singleton via `SELECT ... FOR UPDATE`, on insufficient balance sets `status='awaiting_funds'` (no transfer attempted), on sufficient balance decrements pool, sets `status='payout_queued'`, emits `CRATE_SOL_PAYOUT` `{ source: 'daily_crate', rewardId: id.toString(), userId, wallet, amountLamports: contents_amount, idempotency_key: 'daily_crate_reward:' + id }`. Commit and return the proof material per FR-6 step 7. Add OpenAPI path module per backend conventions. Integration tests: points happy path applies grant + sets `granted`; SOL with funded pool → `payout_queued` then handler reaches `granted`; SOL with empty pool → `awaiting_funds` (zero on-chain transfers attempted); SOL above-threshold → `held` (no reservation, public status `'pending'`); replay returns 200 with persisted outcome and emits no second event; concurrent claim race serialized by FOR UPDATE — exactly one event emitted, second request returns 200 (replay path). Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-6, FR-8).

- [ ] [backend] In the same `routes/crates-daily.ts`, implement JWT-protected `GET /crates/daily/today` returning `{ dayLamports, currentTier (nullable), nextTier (nullable), nextThresholdLamports (nullable), sampleOutcomes }` for the current UTC date using `computeDayLamports` and `getActiveDailyCrateConfig` (does not roll, does not return the previous day's earned reward — that surfaces only on `/pending`); and `GET /crates/daily/pending` returning paginated `daily_crate_rewards` rows for the user where status is non-terminal, ordered `day_id DESC`, with `'held'` rows mapped to `status='pending'` and hold metadata stripped. Add OpenAPI path modules and register both routes. Integration tests: refunded rounds excluded from today's volume aggregate; `/pending` omits `granted/failed/rejected`; held rows are masked. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-8).

- [ ] [backend] In the same `routes/crates-daily.ts`, implement public unauth `GET /crates/daily/configs/:version` (returns the committed config for known versions, 404 for unknown) and `GET /crates/daily/rewards/:rewardId/verify` (returns `userId, dayId, configVersion, configHash, dayLamports, tier, boundarySlot, boundaryBlockTime, blockhash, rollValue, crateType, contentsAmount, rewardHash` plus the selected tier's full outcome list and the selected outcome's range `[startInclusive, endExclusive)`; never returns wallet, claim status, or any internal delivery state). On `/verify`, server-side recompute `rollValue` and `rewardHash` from the persisted seed + config and compare to the stored values; on mismatch return 500 with structured `INTEGRITY_ERROR` and emit an ops alert log (this catches accidental data tampering). Set `Cache-Control: public, max-age=86400, immutable` on `/verify` responses; rate-limit both public routes per IP via the existing middleware. Add OpenAPI path modules. Integration tests: known reward round-trips byte-exact; unknown rewardId → 404; unknown configVersion → 404; tampered persisted row → 500 INTEGRITY_ERROR; cache header set. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-8).

**Phase 4: Reward Pool Retry Tail**

- [ ] [backend] Extend `backend/src/queue/handlers/reward-pool-fund.ts` with the FR-7 retry tail: after the existing fund-pool transaction commits, run a bounded batch (default 100, configurable via `reward_config` key `daily_crate_retry_batch_size`) over `daily_crate_rewards WHERE status='awaiting_funds' AND crate_type='sol' ORDER BY created_at ASC` using `idx_daily_crate_rewards_retry`. For each row inside its own transaction: lock the reward row + `reward_pool` singleton (consistent order — pool first); resolve canonical wallet from `player_profiles`; run `payoutGate({ claim_kind: 'daily_crate_sol', amount, reviewed_at })`; gate-hold sets `status='held'` with `hold_reason`, no reservation, continue to next row; gate-proceed checks `balance >= contents_amount` — insufficient skips (opportunistic-no-FIFO, no blocking); sufficient decrements pool, sets `status='payout_queued'`, emits `CRATE_SOL_PAYOUT` with `idempotency_key='daily_crate_reward:{id}'` and resolved wallet. Stop on batch exhausted or no more pending rows. Integration tests: seed two pending SOL rows (large then small), fund pool sufficient for the small only → small paid first, large remains `awaiting_funds`; subsequent fund event covers large → large paid; gate-held row not reserved or emitted; concurrent fund events safe (no double-spend on the pool singleton). Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-7).

**Phase 5: Per-Round Removal & Cleanup**

- [ ] [backend] Remove the `CRATE_DROP` emit block (~lines around 177) from `backend/src/queue/handlers/game-settled.ts` that emits `trigger_type='game_settled'`; surrounding logic (points grant, challenge progress, pool funding) untouched. Other CRATE_DROP emits (challenge engine, completion bonus) keep emitting for `'challenge_completed'`/`'bonus_completed'` triggers. Append the two FR-9 entries to `docs/TECH_DEBT.md` (per-round-crate-drop removal note + event-naming-convention note). Add a banner near the top of `docs/specs/400-challenge-engine/spec.md` (under the `## Meta` table) noting that FR-5 per-round path is overridden by spec 402 with a link. Integration test: settle a flipyou + closecall + potshot round each, assert no `crate_drops` row with `trigger_type='game_settled'` is created; complete a challenge that rewards a crate and assert the `crate_drops` row still inserts with `trigger_type='challenge_completed'`. Verify: `cd backend && pnpm lint && pnpm typecheck && pnpm test` (FR-9).

**Phase 6: Peek Admin (FR-10)**

- [ ] [peek] Daily Crate Liability widget on the economy page: aggregate query `SELECT SUM(contents_amount) AS pending_lamports, COUNT(*) AS pending_count, MIN(created_at) AS oldest_pending FROM daily_crate_rewards WHERE status IN ('awaiting_funds','held','payout_queued','failed') AND crate_type='sol'` (`'rejected'` excluded — terminal, not future-pay liability). Add server-side fetch helper under `peek/src/server/db/`. Add widget component (mirroring existing `reward-pool-card.tsx` style) and place it on the economy page. Performance test asserts the aggregate query completes < 50ms on a representative dev DB seeded with N pending rows. Verify: `cd peek && pnpm verify` (FR-10).

- [ ] [peek] Daily Crate Runs + Rewards table views: add `peek/src/components/daily-crate-runs-table.tsx` paginating `daily_crate_runs` with columns `day_id, boundary_slot, boundary_block_time, blockhash, config_version, config_hash, status, attempt_count, failure_reason, last_attempted_at, completed_at, recorded_at`, with a date-range filter and a compute-running indicator that surfaces any `status='processing'` row with start time + boundary slot (per Design Decision #16, ops uses this to avoid landing config-changing deploys during the daily compute window). Add `peek/src/components/daily-crate-rewards-table.tsx` paginating `daily_crate_rewards` with columns `user_id, day_id, tier, crate_type, contents_amount, roll_value, status, reward_hash`, plus a detail panel exposing `config_version, config_hash, boundary_slot, boundary_block_time, blockhash, roll_value, reward_hash, current delivery status`. Wire into peek nav under economy alongside the existing crate-drops view. Verify: `cd peek && pnpm verify` (FR-10).

- [ ] [peek] Payouts-held queue integration + manual-retry action: extend `peek/src/components/held-claims-table.tsx` and `payout-decisions-list.tsx` (and their server actions under `peek/src/server/actions/` and `peek/src/server/mutations/`) so `claim_kind='daily_crate_sol'` rows appear in the existing held-payouts review surface. Approve action: set `reviewed_at=now(), reviewed_by=actor.email`, clear `hold_reason`, transition row to `'awaiting_funds'`, and immediately invoke the FR-7 retry helper (factor it out of `reward-pool-fund.ts` into a small reusable function on the same backend module if not already done). Reject action: set `reviewed_at, reviewed_by, failure_reason='rejected_by_operator'`, clear `hold_reason`, transition row to `'rejected'`, emit no event. Add a "Retry delivery" action on the rewards-detail panel for `failed` rows that resets `status` to `'payout_queued'` (SOL) or `'grant_queued'` (points), clears `failure_reason`, and re-emits the corresponding event with the original `idempotency_key='daily_crate_reward:{id}'` — consumer-side dedupe (the points-grant natural key for points; the persisted `idempotency_key` on `payout_attempts` for SOL) prevents double-grant. All three actions append an `operator_events` audit row. Add the matching `actionId` entries to `peek/src/server/access-policy.ts` (admin-only). Integration tests in peek: approve and reject from the held queue produce expected DB transitions and emit/no-emit correctly; manual-retry against a recovered transient failure short-circuits via dedupe (no double on-chain transfer / no double point grant). Verify: `cd peek && pnpm verify` (FR-7, FR-10).

**Phase 7: Test Gates & Final Verification**

- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) — **N/A**: this spec ships no player-facing UI. Player flows (claim → outcome, /today, /pending, /verify) are validated end-to-end via backend integration tests against a real Postgres test DB and a mocked Solana Connection. Webapp consumption is the frontend team's responsibility per project rules.
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes — **N/A**: no webapp UI in scope. Peek admin views (FR-10) live in the peek app and are not part of the `e2e/visual/**` baseline; their behavior is covered by peek's own integration tests.
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason) — **N/A**: the only Solana RPC integration is read-only historical block lookup (`findBoundarySlot` + `getBlock`), covered by mocked-Connection unit and integration tests. There is no on-chain transaction signing, no VRF/oracle dependency, no commit-reveal program interaction in this spec's code paths. A manual devnet smoke (wager across a UTC boundary on dev, observe the daily run row materialize, claim, observe `/verify` proof) is documented in the Validation Plan section of this spec.
- [ ] Final verification: full `./scripts/verify` exit 0; `cd backend && pnpm verify` exit 0; `cd peek && pnpm verify` exit 0; migrations applied cleanly on a fresh dev DB; `daily-crate.csv` removed.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal.

#### Code Quality

- [ ] All existing tests pass (`pnpm test` in `backend/` and `peek/`)
- [ ] No lint errors (`pnpm lint` in `backend/` and `peek/`)
- [ ] Typecheck clean (`pnpm typecheck` in `backend/` and `peek/`)

#### Functional Verification

- [ ] All FR acceptance criteria verified
- [ ] Refunded-round exclusion tested explicitly (FR-1)
- [ ] Module-load Zod validation tested for malformed configs (FR-2)
- [ ] Cross-language JCS reproduction satisfied via committed Python/Rust-generated golden vectors (FR-2, FR-5)
- [ ] Worker race + recovery + mid-day-deploy config-lock tested via integration tests (FR-3)
- [ ] Concurrent-claim race serialized by `SELECT FOR UPDATE` (FR-6)
- [ ] Idempotency holds on event redelivery for both `POINTS_GRANT` (natural key) and `CRATE_SOL_PAYOUT` (persisted `idempotency_key`) (FR-6, FR-7)
- [ ] Spec-307 payout-gate integration tested for hold + approve + reject paths (FR-6, FR-7)
- [ ] FR-7 retry tail opportunistic-no-FIFO behavior tested (FR-7)
- [ ] Per-round `CRATE_DROP` from `game.settled` no longer fires; challenge/bonus paths still produce crate rows (FR-9)
- [ ] Peek aggregate liability query < 50ms on representative dev DB (FR-10)

#### Integration Verification

- [ ] Daily compute worker integration test against a mocked Solana Connection covers happy path, RPC failure with retry, persisted-seed-then-no-RPC retry, mid-day crash rollback, mid-day config bump (FR-3)
- [ ] Full claim flow tested end-to-end including downstream handler effect: points → `point_balances` updated and `daily_crate_rewards.status='granted'`; SOL with funded pool → on-chain transfer + `granted` (FR-6)
- [ ] Public `/verify` endpoint round-trips byte-exact for a known reward row (FR-8)

### Iteration Instructions

- Execute items strictly top-to-bottom — each iteration depends on prior items
- Each iteration: implement the feature + write its bundled tests + run the iteration's targeted `pnpm` command
- Run full `./scripts/verify` after the final Phase 7 iteration before declaring complete
- The migration in iteration 1 is the only place that touches schema; do not add columns or constraints to `daily_crate_runs` / `daily_crate_rewards` outside of it
- The `payout_attempts` table is authored under iteration 8 (CRATE_SOL_PAYOUT extension) inside migration `032` — verify before authoring whether a payout-controls-extension spec already created an equivalent table; if so, reuse rather than duplicate
- Treat the JS-side JCS canonicalization as load-bearing for fairness verification: golden vectors in iteration 4 are the cross-language oracle and must not be silently regenerated from the JS impl itself
- Daily crate point grants are unmultiplied (FR-3 invariant 7) — guard this in the `points-grant.ts` handler, do not rely on the call site to suppress the multiplier

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis 402-daily-crate --non-interactive` which audits each FR acceptance criterion against the
codebase, writes `docs/specs/402-daily-crate/gap-analysis.md`, and annotates checkboxes with
`<!-- satisfied: ... -->` / `<!-- gap: ... -->` evidence.
