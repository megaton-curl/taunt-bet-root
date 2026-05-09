# Implementation History — 402-daily-crate

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Phase 0 schema migration

- Authored `backend/migrations/032_daily_crate.sql` per FR-9 step ordering:
  - Pre-condition assertion `SELECT COUNT(*) FROM crate_drops WHERE trigger_type='game_settled' = 0` via `DO $$ ... RAISE EXCEPTION` block; aborts the whole migration transaction on violation.
  - `daily_crate_runs` (PK day_id) with status CHECK + table-level CHECK enforcing `status='completed' ⇒ all seed/config fields populated`.
  - `daily_crate_rewards` (BIGINT identity PK) with `UNIQUE (user_id, day_id)`, status CHECK over the 8 lifecycle states, hold_reason CHECK enforcing the held↔reason invariant, crate_type CHECK, `contents_amount > 0` CHECK, FK to `daily_crate_runs(day_id)`.
  - Three partial/full indexes on `daily_crate_rewards`: `_user_pending` (partial, NOT IN granted/failed/rejected), `_retry` (partial, awaiting_funds + sol), `_day_status`.
  - Partial index `idx_game_entries_daily_crate_settled_user` on `game_entries (settled_at, user_id) WHERE settled_at IS NOT NULL AND is_winner IS NOT NULL`.
  - Tightened `crate_drops_trigger_type_check` to `('challenge_completed','bonus_completed')`.
  - Extended `point_grants_source_type_check` to add `'daily_crate'` while preserving every value from migration 018.
  - `INSERT INTO payout_controls VALUES ('daily_crate_sol') ON CONFLICT DO NOTHING`.
- Updated three integration test fixtures (`crate-drop-handler.test.ts`, `crate-sol-payout.test.ts`, `points-and-crates-routes.test.ts`) that hard-coded `trigger_type='game_settled'` to use `'challenge_completed'` instead. The handler's logic doesn't filter on trigger_type; this preserves test coverage on the still-supported challenge/bonus path. The production `game-settled.ts` still emits `CRATE_DROP` with the now-rejected trigger; that emit removal is Phase 5's job.
- Verified: `pnpm migrate` (apply + idempotent re-run), `pnpm typecheck:self`, `pnpm lint:self`, `pnpm test:unit:self` (286 tests pass), `pnpm test:integration:self` (251 tests pass).
- Outcome: ✅ Item 1 complete.

## Iteration 1 — 2026-05-08T12:08:52Z — OK
- **Log**: iteration-001.log

## Iteration 2 — Phase 1 daily-crate config registry

- Added the `canonicalize` (RFC 8785 JCS) dependency to `backend/package.json` and `pnpm-lock.yaml`; needed because the spec's hash invariant (cross-language reproducibility) requires JCS canonicalization rather than `JSON.stringify`.
- Authored `backend/src/config/economy/schema.ts`:
  - `Outcome`, `Tier`, `DailyCrateConfig` types.
  - Zod schemas using `superRefine` (Zod v4 dropped the function-style refine signature) enforcing positive `version`, contiguous tier numbers 1..N, strictly-ascending `threshold_lamports`, per-tier ppm-sum-exactly-1_000_000, positive bigint amounts, and registry-level uniqueness + strictly-ascending source order.
  - `validateDailyCrateConfigs(input)` collects all issues and throws with a multi-line message.
- Authored `backend/src/config/economy/mainnet/daily-crate-configs.ts` with the launch `version: 1` covering all 13 tiers from the CSV. ppm computed as `round(percentage * 10000)`, rounding residual subtracted from each tier's largest-ppm row so every tier sums to exactly 1,000,000 (verified by an independent generator script + the per-tier-sum unit test).
- Authored `backend/src/config/economy/dev/daily-crate-configs.ts` as a re-export of the mainnet registry; spec says they ship identical at launch and may diverge later for QA fixtures.
- Authored `backend/src/config/economy/index.ts`:
  - Module-import-time validation of both registries (boot-fail on malformed config).
  - `getDailyCrateRegistry(cluster)` and `getActiveDailyCrateConfig(cluster)` — selecting `mainnet`/`mainnet-beta` → mainnet, anything else → dev. `getActiveDailyCrateConfig` linearly scans for the highest-version entry rather than relying on array order.
  - `getDailyCrateConfigHash(config)` = `sha256(canonicalize(jsonReady(config)))` — bigint fields serialized as JSON strings before canonicalization, throws if `canonicalize` returns `undefined` (defensive; can't happen on a validated config).
- Added `backend/src/__tests__/daily-crate-config.test.ts` with 20 unit tests:
  - Launch registries pass validation; every tier in every committed config sums to exactly 1,000,000 ppm.
  - Malformed config rejection: ppm sum mismatch, non-contiguous tier numbers, non-ascending thresholds, duplicate versions, non-ascending source order, non-positive version, non-positive amount.
  - `getActiveDailyCrateConfig` returns version 1 for mainnet/devnet/unknown-cluster.
  - Selection logic returns highest-version when seeded out-of-order.
  - Hash is stable across calls, matches between mainnet and dev at launch, changes on ppm/threshold edits, and is independent of source-object key order (JCS property test).
- Deleted `docs/references/daily-crate.csv` per spec FR-9.
- Verified: `pnpm lint:self` (1 pre-existing warning, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (306 tests pass — was 286 pre-iteration; +20 from the new file).
- Skipped: `pnpm test:integration:self` — Postgres is not running in this iteration's environment (`ECONNREFUSED 127.0.0.1:5432`), pre-existing and unrelated to this iteration's pure-config / pure-unit-test changes. The autonomous-loop targeted-check rule for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Outcome: ✅ Item 2 complete.

## Iteration 2 — 2026-05-08T12:19:45Z — OK
- **Log**: iteration-002.log

## Iteration 3 — Phase 1 day-volume helpers (FR-1)

- Authored `backend/src/services/daily-crate.ts`:
  - `dayIdBoundsUtc(dayId)` — strict `^\d{4}-\d{2}-\d{2}$` regex + `Date` NaN-check; returns half-open `[start, end)` constructed via `new Date(${dayId}T00:00:00.000Z)` and `start + 86_400_000ms`. No `::date` casts anywhere; rejects malformed strings (`"2026-5-8"`, `"2026/05/08"`, `""`) and unreal calendar dates (`"2026-13-01"`).
  - `computeDayLamports(sql, userId, dayId): Promise<bigint>` — single-user `SELECT COALESCE(SUM(amount_lamports), 0)::TEXT FROM game_entries WHERE user_id = $1 AND settled_at >= $2 AND settled_at < $3 AND is_winner IS NOT NULL`. Casts to TEXT then `BigInt()` to keep numeric precision regardless of the postgres driver's bigint coercion. Returns `0n` when there are no qualifying rows. Index: `idx_game_entries_user_settled (user_id, settled_at DESC)`.
  - `computeEligibleDailyVolumes(sql, dayId, floorLamports): Promise<{ userId, dayLamports }[]>` — single aggregate `SELECT user_id, SUM(amount_lamports)::TEXT … GROUP BY user_id HAVING SUM(amount_lamports) >= $floor::BIGINT`. Floor is bound as TEXT and cast in SQL to keep the binding bigint-safe. Below-floor users are filtered at the SQL layer so the worker never streams ineligible rows. Throws on negative floor. Index: `idx_game_entries_daily_crate_settled_user` (partial, settled_at + user_id, WHERE is_winner IS NOT NULL — created in iteration 1's migration).
- Authored `backend/src/__tests__/daily-crate-volume.test.ts` (registered in `vitest.integration.files.ts`):
  - Pure `dayIdBoundsUtc` block (6 tests) — bounds correctness, month/year/leap rollover, malformed-input rejection. Runs without a DB connection because `beforeAll` only fires for the second describe.
  - Integration block (9 tests) covering `computeDayLamports` happy path, refund exclusion (`is_winner IS NULL`), day-boundary assignment by `settled_at` (23:59:59.999 of day N stays on day N; 00:00:00.000 of day N+1 falls into day N+1, half-open exclusivity), `settled_at IS NULL` exclusion, per-user isolation; and `computeEligibleDailyVolumes` floor cutoff, exact-equality inclusion, empty-result, and negative-floor rejection.
- Verified `pnpm lint:self` (1 pre-existing warning, 0 errors) and `pnpm typecheck:self` (clean). The targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified `pnpm test:unit:self` (306 tests pass, unchanged from iteration 2 — `daily-crate-volume.test.ts` is integration-only).
- Skipped `pnpm test:integration:self`: the dev devcontainer's Postgres listens only on the Unix socket `/var/run/postgresql` and the existing `makeSql()` fallback hardcodes `taunt_bet_dev` while the live DB is `rng_utopia_dev`. Same pre-existing infra gap as iteration 2; unrelated to this iteration.
- Manually exercised the implementation against the live `rng_utopia_dev` database via a one-off node script that mirrored the four `computeDayLamports` / `computeEligibleDailyVolumes` test scenarios. All assertions held: basic refund-excluding sum = 150_000_000n; boundary day-N = 10_000_000n / day-N+1 = 20_000_000n; floor exclusion returned exactly `[u_above → 400_000_000n]`; exact-equality floor inclusion returned `[u_exact → 100_000_000n]`. Cleaned up after the run.
- Outcome: ✅ Item 3 complete.

## Iteration 3 — 2026-05-08T12:30:00Z — OK
- **Log**: iteration-003.log

## Iteration 3 — 2026-05-08T12:31:39Z — OK
- **Log**: iteration-003.log

## Iteration 4 — Phase 1 tier/roll/reward-hash pure helpers (FR-4, FR-5, FR-3)

- Extended `backend/src/services/daily-crate.ts`:
  - `determineTier(config, dayLamports)` — single forward scan, breaking once a strictly-greater threshold is seen (registry order is validated as strictly ascending). Returns the last tier whose `threshold_lamports <= dayLamports`, or `null` when below floor.
  - `rollDailyCrateOutcome(blockhash, userId, dayId, configVersion, tier)` — canonicalizes `{ domain: "daily_crate_roll:v1", blockhash, user_id, day_id, config_version, tier }` (snake_case keys per spec), SHA256s, reads first 8 bytes as BE u64 via `Buffer.readBigUInt64BE` (avoids Number truncation), `mod 1_000_000n`, then walks `tier.outcomes` accumulating ppm and returns the first whose running sum strictly exceeds `rollValue`, plus the selected outcome's range `[startInclusive, endExclusive)`. Integer-only — ppm sums fit comfortably in Number (always ≤ 1_000_000), comparison is strict-`>`. Throws on impossible no-selection (defensive against config corruption that bypassed Zod).
  - `computeRewardHash(input)` — accepts mixed bigint/number numeric fields; coerces via `toSafeInteger` which throws on non-integer / non-finite / out-of-Number-safe-range bigints (per spec, every numeric field comfortably fits in 2^53; bumping past that requires `daily_crate:v2` semantics). Builds the canonical reward envelope, JCS, SHA256, hex.
- Authored `backend/src/__tests__/fixtures/generate-daily-crate-vectors.py` — independent Python JCS+SHA256 reference. Hand-transcribes the launch v1 mainnet config (13 tiers × 12-13 outcomes each), defines `jcs_bytes(obj) = json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=False).encode('utf-8')` (verified equivalent to the JS `canonicalize` v3 package on the restricted ASCII/integer/bool/null input set the spec uses), and emits 6 hand-picked test cases covering tier 1, 3, 5, 8, and 13 with diverse `(blockhash, user_id, day_id)` combinations. Output committed to `daily-crate-vectors.json` alongside the script.
- Authored `backend/src/__tests__/daily-crate-roll.test.ts` (32 tests, pure unit — no DB):
  - `determineTier` (4 tests): below floor returns null; each threshold returns its tier; just-above-lower / just-below-upper between any adjacent thresholds returns the lower tier (covers the spec's worked example `0.6 SOL → tier 3`); above-top returns the top tier.
  - Cross-language fixtures (7 tests): JS-side `getDailyCrateConfigHash` matches the Python `config_hash`, then for each of 6 fixture cases JS reproduces the Python `rollValue`, outcome (item_type/amount/ppm), `outcomeRange`, and `rewardHash` byte-exact. Drift in either the JS canonicalization or the launch config content fails the test.
  - Determinism + integer invariants (3 tests): same inputs always yield same output; `rollValue` and outcomeRange bounds are integers in valid range; varying user_id changes the roll.
  - Distribution sweep (13 tests, one per launch-config tier): walk every roll 0..999_999, count outcome hits, assert each count equals the declared `ppm`. This is the strongest possible structural check — catches off-by-one in the strict-`>` boundary, accidental skip/double-count, and any FP creep.
  - `computeRewardHash` invariants (5 tests): stable across calls; identical bytes for number-vs-bigint numeric inputs; changes when any single field changes; rejects non-integer / NaN inputs; rejects bigints exceeding 2^53.
- Verified `pnpm lint:self` (1 pre-existing warning unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (338 tests pass, +32 from this iteration — was 306 pre-iteration). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Skipped `pnpm test:integration:self`: same pre-existing infra gap as iterations 2/3 (Postgres only on Unix socket, fixture DB name mismatch). This iteration is pure-function-only — no DB schema or query touched — so integration tests are not load-bearing here.
- Outcome: ✅ Item 4 complete.

## Iteration 4 — 2026-05-08T12:42:34Z — OK
- **Log**: iteration-004.log

## Iteration 5 — Phase 2 boundary-slot helper (FR-3)

- Authored `backend/src/worker/daily-crate-compute.ts` with the `findBoundarySlot(connection, targetUnixSeconds, { startSlot, maxSearchSlots? })` helper. Public surface area: a tiny `BoundarySlotConnection` interface (only `getBlockTime` and `getBlock`) — the real `@solana/web3.js` `Connection` already satisfies it, but unit tests can supply a 20-line mock. Walks slots forward from `startSlot`; on each slot calls `getBlockTime`; null (skipped/unfinalized) is silently passed over; the first non-null `blockTime >= targetUnixSeconds` triggers a single `getBlock(slot, { maxSupportedTransactionVersion: 0, commitment: "finalized", transactionDetails: "none", rewards: false })` and returns `{ slot, blockTime, blockhash: block.blockhash }`. The walk stops at the chosen slot — `getBlockTime` is never invoked beyond it, so the RPC bill is proportional to the gap, not the search budget. `maxSearchSlots` defaults to 10 000 (~67 min at 400 ms/slot) — bounds RPC traffic for misconfigured targets.
  - Defensive guards: rejects non-positive integer `targetUnixSeconds`, rejects negative/non-integer `startSlot`, rejects non-positive `maxSearchSlots`, rejects null block on the chosen slot, rejects empty-string `blockhash` field. Throws a descriptive error when the search budget is exhausted before the target is met.
  - Why the caller supplies `startSlot`: the next iteration's `runDailyCrateComputation` will compute it via `currentSlot + (targetUnixSeconds - currentBlockTime) / 0.4` and pass it in. Keeping the estimate out of this primitive means the unit test's mock surface stays narrow (no `getSlot` mock needed) and the estimate logic gets tested where it lives, rather than smeared across two helpers.
- Authored `backend/src/worker/__tests__/daily-crate-compute.test.ts` (12 tests, pure unit — no DB, no live RPC):
  - Happy paths: target lands on a slot exactly; target falls between slots (returns first strictly past); start slot already meets target → returns it directly with one `getBlockTime` call.
  - Skipped-slot handling: null `blockTime` interleaved before/after the boundary; helper passes over them and picks the first non-null ≥ target.
  - "Never reads past" invariant: mock `getBlockTime` is wired to throw on any slot beyond the test's known stream; assert the helper visited exactly `[startSlot..chosenSlot]`. Catches any future regression that walks one slot too far.
  - Search-budget exhaustion: stream of below-target slots → `maxSearchSlots: 3` → throws `/no slot with block_time >=/`; `getBlock` never called.
  - GetBlock config assertion: the chosen-slot call is made with `{ maxSupportedTransactionVersion: 0, commitment: "finalized", transactionDetails: "none", rewards: false }` — `transactionDetails: "none"` keeps the RPC payload minimal since we only need `blockhash`.
  - Error paths: `getBlock → null`, `getBlock → block with empty blockhash` both throw.
  - Input validation: rejects target ≤ 0, target non-integer, negative startSlot, non-integer startSlot, maxSearchSlots ≤ 0.
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — was 338 pre-iteration; +12 from the new file). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Skipped `pnpm test:integration:self`: same pre-existing infra gap as iterations 2/3/4 (Postgres only on Unix socket, fixture DB name mismatch). This iteration is pure-helper-only with no DB or live Solana RPC dependency — integration tests are not load-bearing here.
- Outcome: ✅ Item 5 complete.

## Iteration 5 — 2026-05-08T12:50:16Z — OK
- **Log**: iteration-005.log

## Iteration 6 — Phase 2 daily-crate compute worker (FR-3, FR-4, FR-5)

- Extended `backend/src/worker/daily-crate-compute.ts` with full per-day driver:
  - `runDailyCrateComputation(sql, connection, dayId, options)` returns one of `'completed' | 'already_completed' | 'busy' | 'failed'` and never throws — RPC/work errors leave the row in `'processing'` for retry until `attempt_count >= maxAttempts` (default 5), at which point the row transitions to `'failed'` with `failure_reason` set and a `daily_crate.run_failed` log line.
  - `tryClaimRun(sql, dayId, heartbeatStaleMinutes)` issues `INSERT ... ON CONFLICT DO NOTHING RETURNING`; on conflict, reads existing row (returns `'already_completed'` if status='completed') and otherwise attempts the stale-takeover `UPDATE ... WHERE last_attempted_at < now() - $heartbeatStaleMinutes::INT * INTERVAL '1 minute'` (atomic — concurrent takeover attempts both return zero updated rows when row is fresh).
  - `lockSeedAndConfig(...)` writes `boundary_slot, boundary_block_time, blockhash` via `UPDATE ... WHERE boundary_slot IS NULL` (first-write-wins), samples `getActiveDailyCrateConfig(cluster)` and writes `config_version, config_hash` via `UPDATE ... WHERE config_version IS NULL` (one day, one config — every retry reads the locked values back). Re-reads the row authoritatively after writing, then resolves the locked config from the current registry and asserts the hash matches what the registry produces today (drift here means a shipped config was edited in source — fairness-breaking).
  - `prepareRewardRows(...)` calls `computeEligibleDailyVolumes` with the locked tier-1 floor, then per user calls `determineTier` → `rollDailyCrateOutcome` → `computeRewardHash`. Crate type derives from outcome `item_type` (`'sol' → 'sol'`, anything else → `'points'`).
  - `materializeRewards(...)` runs the chunked multi-row INSERT pattern inside a single `sql.begin` transaction. Each chunk is `INSERT INTO daily_crate_rewards ${tx(chunk, ...keys)} ON CONFLICT (user_id, day_id) DO NOTHING`. Heartbeat `UPDATE daily_crate_runs SET last_attempted_at = now()` runs between chunks. Rollback semantics are postgres-native: on any throw before COMMIT the entire reward write rolls back atomically.
  - `estimateBoundaryStartSlot(connection, targetUnixSeconds)` probes `getBlockTime` near `getSlot()`, walks back until it finds a finalized slot to anchor a recent (slot, block_time) pair, then projects backward to give `findBoundarySlot` a runway before the boundary.
  - `startDailyCrateWorker(sql, connection, options)` runs reconciliation over yesterday + previous N=14 days oldest-first at boot, then schedules `setTimeout` to fire at the next 00:15 UTC and re-arms after each tick. Errors caught at every level; the worker never crashes the process. `timer.unref()` so the timer doesn't keep Node alive solely for this worker.
- Wired `startDailyCrateWorker(sql, connection, { cluster: config.cluster })` into `backend/src/index.ts` startup right after `startReferralTierWorker`.
- Integration tests in `backend/src/__tests__/daily-crate-compute.test.ts` (registered in `vitest.integration.files.ts`), 8 tests, real Postgres + tiny in-process Solana mock:
  - **Happy path**: 3 game_entries seeded (2 above floor, 1 below). Worker writes 2 reward rows. Asserts `run_row.status='completed'`, all seed/config fields persisted, every reward carries `config_version=1`, `config_hash` matches the active registry's hash for v1, blockhash matches the boundary block, status='earned'. Tiers correctly assigned (250M lamports → tier 2, 600M → tier 3).
  - **No eligible users**: only sub-floor wager. Worker writes zero rewards but still marks the run completed.
  - **Idempotent re-run**: first run inserts 1 reward, second run returns `already_completed` and the existing row is byte-identical (id, reward_hash, created_at all unchanged).
  - **Race**: two concurrent `runDailyCrateComputation` calls. Asserts one returns 'completed' and the other backs off (returns 'busy' if row was still processing when re-read, or 'already_completed' if the first finished by then). Reward rows written exactly once.
  - **Recovery**: pre-populate `daily_crate_runs` with seed + config locked + stale heartbeat. Worker takes over via stale-takeover, runs with a Connection that throws on every method, completes successfully (proves the locked-seed path needs zero RPC).
  - **Transactional rollback**: deliberate `sql.begin` block that mirrors the worker's pattern and aborts mid-tx, asserts zero reward rows post-rollback. Tests the rollback semantics the worker relies on.
  - **Config lock**: pre-populate run row with seed + config_version=1 already locked. Worker reads back the locked values rather than re-sampling the registry. Asserts every reward carries the locked version/hash.
  - **Retry-budget exhaustion**: pre-populate run row at attempt_count=5 with stale heartbeat. Stale-takeover increments to 6, exceeds the budget; throwing connection causes work to fail; row transitions to 'failed' with `failure_reason` set. Asserts `daily_crate.run_failed` log path and `failed` terminal state.
- Verified `pnpm lint:self` (1 pre-existing warning unrelated, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass, no regression — same as iteration 5; the new tests are all integration tests). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new integration suite directly: `PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev pnpm vitest --config vitest.integration.config.ts --run src/__tests__/daily-crate-compute.test.ts` → all 8 tests pass against the live `rng_utopia_dev` DB. Cleanup is scoped to test-owned `dayId` strings (`'2024-01-10'..'2024-01-17'`, far in the past) plus `wallet LIKE 'TestWallet_dailycomp_<TS>_%'` so the suite is fully order-independent and leaves no production data behind.
- Skipped the full `pnpm test:integration:self` run: the existing `makeSql()` fallback hardcodes `taunt_bet_dev` (the dev devcontainer's PG database is `rng_utopia_dev`), causing every pre-existing integration test that uses the fallback to fail with `database "taunt_bet_dev" does not exist`. Same pre-existing infra gap noted in iterations 2/3/4/5; unrelated to this iteration's changes. Pointing PGDATABASE/PGHOST/PGUSER at the local DB lets every existing fallback resolve correctly, but iteration 6 only owns the new test file's behavior.
- Outcome: ✅ Item 6 complete.

## Iteration 6 — 2026-05-08T13:05:00Z — OK
- **Log**: iteration-006.log

## Iteration 6 — 2026-05-08T13:06:43Z — OK
- **Log**: iteration-006.log

## Iteration 7 — Phase 3 daily_crate POINTS_GRANT handler extension (FR-3, FR-6)

- Extended `backend/src/queue/handlers/points-grant.ts`:
  - `daily_crate` source_type naturally falls into the existing fixed-grant `else` branch alongside `crate_points`/`challenge_completed`/`bonus_completed`. That branch initializes `effectiveMultiplier = 1` and never consults `getActivePointRate`, `applyWagerToEconomyState`, or `computeEffectiveMultiplier`, so FR-3 invariant 7 (unmultiplied crate point grants) holds structurally — there is no code path through which a dogpile/event/ladder modifier can reach a daily-crate grant. Updated the inline comment + the file-header docblock to call this out explicitly so the next maintainer doesn't accidentally route `daily_crate` through the wager path.
  - Added a `daily_crate`-only `UPDATE daily_crate_rewards SET status='granted', granted_at=now() WHERE id = ${BigInt(sourceId)} AND status IN ('grant_queued', 'earned')` step **inside the same `db.withTransaction` block** that wrote the `point_grants` row. Placed *after* `insertPointGrant` and *before* the `if (!inserted) return` early-return so the UPDATE runs unconditionally — the status guard makes it idempotent (no-op when the row is already `granted`/`failed`/`rejected`), and running it on the dedupe path matters for the manual-retry-from-`failed` flow that peek-admin will introduce in a later iteration: peek resets the row to `grant_queued` and re-emits the same event, so the consumer-side dedupe on `point_grants` UNIQUE returns `inserted=false` but the daily_crate row still needs to advance from `grant_queued` → `granted`. Other source types are untouched (wager/challenge/bonus/crate_points hit the early-return on dedupe and skip the UPDATE).
- Updated `backend/src/__tests__/integration-test-helpers.ts`:
  - `ensureRewardEconomyTables` re-asserts the `point_grants_source_type_check` constraint on every `openIntegrationDb` call (it `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`). The launch list was missing `'daily_crate'`, which would have rejected every `INSERT INTO point_grants ... source_type='daily_crate'` even though the production migration `032_daily_crate.sql` extends the constraint correctly. Added `'daily_crate'` to the helper's check list to match the migration's view of the schema; without this, no integration test using `openIntegrationDb` could exercise the new code path.
  - Made the Unix-socket fallback in `makeSql()` honor `PGHOST`/`PGUSER`/`PGDATABASE` env vars when set (still defaults to `vscode@/var/run/postgresql/taunt_bet_dev` when nothing is set, so existing CI configurations are unaffected). This is the same pre-existing infra gap iterations 2/3/4/5/6 noted: the dev devcontainer's actual DB is `rng_utopia_dev`, not the hardcoded `taunt_bet_dev`. The minimal change unblocks `PGDATABASE=rng_utopia_dev pnpm vitest ...` for any integration test, including the new file in this iteration.
- Authored `backend/src/__tests__/daily-crate-points-grant.test.ts` (3 integration tests, registered in `vitest.integration.files.ts`):
  - **2× event modifier ignored**: seeds an active `multiplier_modifiers` row with `mode='set_value', value=2.0` (the same shape the existing `points.grant handler applies active event hard-override multipliers` test uses to prove wager grants ARE multiplied). Fires a `daily_crate` POINTS_GRANT with `amount: "3000"`. Asserts the persisted `point_grants.amount = 3000n` (NOT 6000n), `effective_multiplier = 1`, `metadata.multiplier = 1`, and the spec-mandated metadata fields (`dayId`, `configVersion`, `tier`) round-trip into `point_grants.metadata` JSONB. The active 2× modifier touching wager grants has no effect — proves the structural separation, not just call-site discipline.
  - **Status transition**: seeds `daily_crate_rewards` row in `'grant_queued'` with `granted_at IS NULL`, fires the event, asserts the row advances to `'granted'` with `granted_at IS NOT NULL` after the handler returns. Confirms the same-transaction UPDATE landed.
  - **Redelivery dedupe**: fires the same event twice. Asserts exactly one `point_grants` row exists for `(user_id, source_type, source_id)`, `point_balances.balance = 750n` (single-credit, not 1500), and the `daily_crate_rewards` row remains in `'granted'`. The handler's `logger.info("points.grant: duplicate grant, skipping", ...)` line emits on the second call (visible in the test log output).
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning unrelated, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 6; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new integration suite directly: `PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev pnpm vitest --config vitest.integration.config.ts --run src/__tests__/daily-crate-points-grant.test.ts` → all 3 tests pass against the live `rng_utopia_dev` DB. Cleanup is scoped to test-owned `dayId='2024-02-01'` plus user-id prefixes specific to this file. Also re-ran `reward-funding-and-points.test.ts` (5 tests, all pass) to confirm the existing wager/challenge/bonus/crate_points paths through `points-grant.ts` were not regressed by the daily_crate UPDATE addition.
- Skipped the full `pnpm test:integration:self` run: same pre-existing infra gap as iterations 2/3/4/5/6 (multiple unrelated test files have their own pre-existing failures against this devcontainer's DB layout). This iteration's contract is the new test file plus the regression check on `reward-funding-and-points.test.ts`.
- Outcome: ✅ Item 7 complete.

## Iteration 7 — 2026-05-08T13:18:00Z — OK
- **Log**: iteration-007.log

## Iteration 7 — 2026-05-08T13:19:16Z — OK
- **Log**: iteration-007.log

## Iteration 8 — Phase 3 CRATE_SOL_PAYOUT daily_crate dispatch (FR-6, FR-7)

- Added `backend/migrations/033_payout_attempts.sql` rather than editing already-applied migration 032. The spec offered "author it here under migration 032 if missing", but 032 is already in dev DBs' `_migrations` table and the runner skips applied versions; a new forward, additive migration is the safer reading of the project's "Production data safety is non-negotiable" rule. Schema: `idempotency_key TEXT PK, claim_kind TEXT, amount_lamports BIGINT (>=0 CHECK), tx_sig TEXT NULL, status TEXT CHECK ('pending'|'success'|'failed'), created_at, updated_at`. Plus index `idx_payout_attempts_claim_kind_status` for future per-claim-kind sweeps.
- Extended `backend/src/queue/handler-registry.ts` with an optional `EventContext` second arg (`{ attempts, maxAttempts }`) on `EventHandler`. Backwards-compatible — every existing factory still returns `(payload) => Promise<void>` and ignores the second arg. The worker (`backend/src/queue/worker.ts`) now passes `{ attempts: event.attempts, maxAttempts: event.max_attempts }` into the handler call. The daily_crate path consumes this to decide whether the current call is the final allowed attempt: `attempts + 1 >= maxAttempts` is the exhaustion test that mirrors how the worker itself decides to mark the queue event `dead` *after* the handler returns/throws.
- Rewrote `backend/src/queue/handlers/crate-sol-payout.ts` around a `payload.source` discriminator:
  - `source` missing or `'crate_drop'` → `handleLegacyCrateDrop(...)` retains the original behavior bit-for-bit (load `crate_drops` by id, transfer SOL via `executeSolTransfer`, mark `'granted'` on success / `'failed'` on error, swallow the error so `failed` stays terminal). Pulled the SystemProgram-transfer code into a shared `executeSolTransfer` helper so both paths share blockhash/commitment/sign/confirm semantics.
  - `source === 'daily_crate'` → `handleDailyCrate(...)` reads the payload (`rewardId`, `userId`, `wallet`, `amountLamports`, `idempotency_key`), short-circuits if `payout_attempts` already records `'success'` or `'failed'` for this key, loads the `daily_crate_rewards` row, no-ops if status isn't `'payout_queued'`, then `INSERT ... ON CONFLICT DO NOTHING` reserves the idempotency key (a parallel deliverer racing the insert lands here with `inserted=false` and short-circuits via the existing row). On confirmed transfer marks the payout-attempts row `success` + `tx_sig` and the reward row `granted` + `granted_at`. On RPC failure: if the worker context indicates this is the final allowed attempt → `markPayoutAttempt(..., 'failed', null)` + `markDailyCrateFailed(rewardId, 'payout_handler_exhausted')` + rethrow so the queue records the event `dead` with the final error; if not → `DELETE` the payout-attempts row so the next queue retry can re-reserve the idempotency key, leave the reward in `'payout_queued'`, and rethrow for the queue's retry/backoff.
  - Unknown `source` discriminator throws — fail-fast on payload schema drift rather than silently entering the legacy path.
- Updated `backend/src/__tests__/integration-test-helpers.ts`:
  - `ensureRewardEconomyTables` now also `CREATE TABLE IF NOT EXISTS payout_attempts (...)` so integration tests (including pre-existing `crate-sol-payout.test.ts`) work in dev DBs that haven't run migration 033 yet — same idempotent shape as the migration.
  - Added `payout_attempts` to `RESET_TABLES` so `resetIntegrationState` truncates it between tests; ordering inside the TRUNCATE list doesn't matter since the table has no FKs.
- Authored `backend/src/__tests__/daily-crate-payout.test.ts` (registered in `vitest.integration.files.ts`), 7 integration tests:
  - **Legacy regression**: emit a `'challenge_completed'` `crate_drops` row, fire the handler with no `source` (default = `'crate_drop'`), assert the row advances to `'granted'` with `granted_at` set and a transfer was attempted on-chain. Proves the discriminator default keeps existing flows working.
  - **Daily crate happy path**: seed `daily_crate_runs` + `daily_crate_rewards` (`payout_queued`), fire with `source: 'daily_crate'` + a fresh idempotency key, assert reward → `granted`, payout_attempts row exists with `claim_kind='daily_crate_sol'`, `status='success'`, `tx_sig` populated, and a transaction was sent.
  - **Re-delivery**: same event fired twice. Asserts `mockConn.lastRawTx` is null on the second call (no second on-chain transfer), payout_attempts row count stays at 1 with status `success`, and the reward stays `granted`.
  - **Retry-budget exhaustion**: throwing connection + `ctx={attempts: 2, maxAttempts: 3}` (final allowed attempt). Asserts the handler rethrows, the reward becomes `failed` with `failure_reason='payout_handler_exhausted'`, and the payout_attempts row is `failed` with `tx_sig=null`.
  - **Non-final retry**: throwing connection + `ctx={attempts: 0, maxAttempts: 3}`. Asserts the handler rethrows, the reward stays `payout_queued`, and the payout_attempts row is **deleted** so the next retry can re-reserve the key.
  - **Malformed payload**: missing required daily_crate fields throws `/malformed daily_crate payload/`.
  - **Wrong reward status**: a row in `'earned'` (not `'payout_queued'`) is a no-op — no transfer attempted, no payout_attempts row created.
- Verified `pnpm lint:self` (1 pre-existing warning in `api-envelope.ts` unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 7; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression integration suites directly: `PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev pnpm vitest --config vitest.integration.config.ts --run src/__tests__/daily-crate-payout.test.ts src/__tests__/crate-sol-payout.test.ts src/__tests__/crate-drop-handler.test.ts src/__tests__/daily-crate-points-grant.test.ts` → all 19 tests pass against the live `rng_utopia_dev` DB. Cleanup is scoped to test-owned `dayId='2024-02-02'` and `idempotency_key LIKE 'daily_crate_reward:%'` so the suite is fully order-independent and leaves no production data behind.
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2/3/4/5/6/7 (e.g. `queue.test.ts` constructs its own SQL connection that hardcodes the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 8 complete.

## Iteration 8 — 2026-05-08T13:34:00Z — OK
- **Log**: iteration-008.log

## Iteration 8 — 2026-05-08T13:34:48Z — OK
- **Log**: iteration-008.log

## Iteration 9 — Phase 3 POST /crates/daily/claim (FR-6, FR-8)

- Added `backend/src/routes/crates-daily.ts` with `createCratesDailyRoutes({ db })` exposing `POST /claim`. The factory mounts under `/crates/daily` so the existing `app.use("/crates/*", createJwtAuthMiddleware({ requireAllMethods: true }))` middleware in `index.ts` already protects it; no new middleware wiring needed.
  - Body: Zod-validated `{ day_id }` against the canonical `^\d{4}-\d{2}-\d{2}$` regex. Malformed inputs land on the standard `defaultHook` returning 422 `VALIDATION_FAILED`.
  - Future/today guard runs **before** any DB call: `dayId >= todayDayIdUtc()` returns 400 `INVALID_DAY_ID`.
  - Run-status guard reads `daily_crate_runs` outside the transaction (read-only): missing or `'processing'` → 425 `DAILY_CRATE_NOT_READY`; `'failed'` → 503 `DAILY_CRATE_RUN_FAILED`. Adding `425` to `ErrorStatus` in `contracts/api-envelope.ts` was the only envelope-types change.
  - Wallet resolution via `db.getProfileByUserId(userId)` runs before the transaction (404 `PROFILE_NOT_FOUND` if missing). The resolved wallet is the only delivery wallet emitted on grant/payout events — never trusts client input.
  - Inside `db.withTransaction`: `SELECT … FOR UPDATE` on `daily_crate_rewards (user_id, day_id)` serializes concurrent claims; missing row returns 409 `NO_CRATE_EARNED`. Non-`'earned'` status takes the replay path (returns 200 with persisted outcome + proof material; `'held'` is masked to public `'pending'` with no `hold_reason` exposure). `'earned'` triggers the per-outcome transition:
    - **Points**: `claimed_at = now()`, `status = 'grant_queued'`, then `emitEvent(POINTS_GRANT, { sourceType: 'daily_crate', sourceId, userId, wallet, amount, metadata: { dayId, configVersion, tier, rollValue, rewardHash } })`. The downstream handler chain (iteration 7) advances `'grant_queued' → 'granted'` atomically with the `point_grants` write.
    - **SOL**: payout-controls read via `createPayoutControlsDb(txDb.rawSql)` inside the transaction → `evaluateGate` (spec 307). Hold → `status = 'held'` with the returned `hold_reason`, no event, no reservation. Proceed → `SELECT FOR UPDATE` on `reward_pool (id=1)`, sufficient → decrement + `status = 'payout_queued'` + `emitEvent(CRATE_SOL_PAYOUT, { source: 'daily_crate', rewardId, userId, wallet, amountLamports, idempotency_key: 'daily_crate_reward:{id}' })`; insufficient → `status = 'awaiting_funds'`, no transfer, no event (FR-7 retry tail picks it up later).
- Added 5 new error codes in `backend/src/contracts/api-errors.ts` (`DAILY_CRATE_NOT_READY`, `DAILY_CRATE_RUN_FAILED`, `NO_CRATE_EARNED`, `INVALID_DAY_ID`, `PAYOUT_CONTROLS_MISSING`). Codes are SCREAMING_SNAKE_CASE per envelope rules; no shipped code was renamed.
- Wired `createCratesDailyRoutes` into `index.ts` at `/crates/daily` (right after the existing `/crates` mount) and into the OpenAPI contract test (`buildSpecApp`) so the new route appears in the generated spec and stays envelope-conformant.
- Authored `backend/src/__tests__/crates-daily-claim.test.ts` (16 integration tests, registered in `vitest.integration.files.ts`):
  - **Happy paths**: points → 200 `'grant_queued'`, POINTS_GRANT payload + metadata round-trip, sourceId is the BIGINT id as TEXT; full pipeline (claim → handler) lands `'granted'` and credits `point_balances`. SOL with funded pool → 200 `'payout_queued'`, pool decremented exactly by `contents_amount`, single CRATE_SOL_PAYOUT emitted with `source='daily_crate'` and `idempotency_key='daily_crate_reward:{id}'`. SOL with empty pool → 200 `'awaiting_funds'`, pool unchanged, zero payout events.
  - **Gate paths**: above-threshold → 200, internal `'held'` with `hold_reason='above_threshold'`, public response masked to `'pending'` with no operator metadata leakage. Globally paused → `hold_reason='global_pause'`. Both verify zero pool reservation and zero event emission.
  - **Replay**: second call returns 200 with the persisted outcome, exactly one POINTS_GRANT exists post-second-call. Held replay still reports public `'pending'`, never exposes `holdReason`/`failureReason`/`reviewedAt`.
  - **Concurrency**: two parallel claim requests via `Promise.all` against the same `(user, day)` — both return 200, exactly one event emitted, row reaches `'grant_queued'`. The FOR UPDATE on the reward row is the serialization point.
  - **Status guards**: missing run row → 425, `'processing'` run → 425, `'failed'` run → 503, missing reward row → 409, `day_id >= today UTC` → 400, malformed `day_id` → 422, missing JWT → 401.
  - Each test uses a fresh `Keypair.generate()` user + `_` suffix so cleanup is naturally scoped to `day_id` (TEST_DAY_ID = `'2024-02-03'`, plus `'2024-02-04'` for the failed-run / processing-run cases). `afterAll` deletes both day_ids; `beforeEach` truncates the global `RESET_TABLES` and re-seeds the run row.
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 8; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression suites directly:
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crates-daily-claim.test.ts` → all 16 tests pass.
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/points-and-crates-routes.test.ts src/__tests__/daily-crate-points-grant.test.ts src/__tests__/daily-crate-payout.test.ts` → 16 tests pass (no regression on the existing routes/handlers).
  - `pnpm vitest --config vitest.unit.config.ts --run src/__tests__/openapi-contract.test.ts` → 11 tests pass; the new `/crates/daily/claim` route is in the generated spec, every 2xx body uses the success envelope, every 4xx/5xx body uses the error envelope.
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2/3/4/5/6/7/8 (multiple unrelated test files construct their own SQL connections that hardcode the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 9 complete.

## Iteration 9 — 2026-05-08T13:52:38Z — OK
- **Log**: iteration-009.log

## Iteration 10 — Phase 3 GET /crates/daily/today + /pending (FR-8)

- Extended `backend/src/routes/crates-daily.ts`:
  - Added `cluster: string` to `CratesDailyRoutesDeps` so the JWT-protected `/today` endpoint can read `getActiveDailyCrateConfig(cluster)`. The daily compute worker locks the active config snapshot per-day on `daily_crate_runs`, so `/today` is the only surface needing live cluster awareness — `/claim`, `/pending`, and the public `/configs/:version`/`/verify` endpoints (next iteration) all read locked snapshots from persisted rows.
  - `GET /today`: JWT-resolves `userId`, computes today's UTC dayId via `todayDayIdUtc()`, calls `computeDayLamports(db.rawSql, userId, dayId)` (the same FR-1 helper the daily compute uses, so refunded `is_winner IS NULL` rows are structurally excluded — the helper's `WHERE is_winner IS NOT NULL` clause is the single point of truth). Reads the active config off the in-memory registry, picks `currentTier` (highest threshold ≤ dayLamports, null below floor) and `nextTier` (lowest threshold > dayLamports, null at top). `sampleOutcomes` = top-N (N=5) by ppm-descending of `currentTier ?? tiers[0]` so the player below floor sees what the floor unlocks. Returns `{ dayId, dayLamports, configVersion, currentTier, nextTier, nextThresholdLamports, sampleOutcomes }`. No DB write, no roll.
  - `GET /pending`: JWT-resolves `userId`, paginates `daily_crate_rewards WHERE user_id = $1 AND status NOT IN ('granted','failed','rejected') ORDER BY day_id DESC` with cursor on `day_id` (cursor is a `YYYY-MM-DD` string Zod-validated against `DAY_ID_REGEX`) and limit 1..50 (default 20, max 50 — matches the existing `/crates/mine` envelope). The `status NOT IN (...)` filter mirrors the partial index `idx_daily_crate_rewards_user_pending` predicate exactly so the planner can use it. `'held'` is mapped to public `'pending'` via the existing `toPublicStatus` helper; the response schema's `status` enum is restricted to `('earned','grant_queued','awaiting_funds','pending','payout_queued')` — operator-only fields (`hold_reason`, `failure_reason`, `reviewed_at`, `reviewed_by`) never appear on the wire because they're not selected in the SELECT list. Each item: `{ rewardId, dayId, dayLamports, tier, crateType, contentsAmount, rewardHash, status, createdAt }`.
  - Added `SAMPLE_OUTCOME_COUNT = 5`, `PENDING_DEFAULT_LIMIT = 20`, `PENDING_MAX_LIMIT = 50` constants and three pure helpers (`pickCurrentTier`, `pickNextTier`, `topSampleOutcomes`) — `pickCurrentTier` mirrors `determineTier` from the service layer but is duplicated locally so the route doesn't pull a settlement-coupled helper into the request path; the small dup keeps the read surface narrow.
  - Added OpenAPI route definitions `todayRoute` and `pendingRoute` with shared `TodayResponseSchema`, `PendingItemSchema`, `PendingResponseSchema`, and `SampleOutcomeSchema` registered as named OpenAPI components — the contract test (`openapi-contract.test.ts`) discovers them via the auto-generated spec.
- Wired `cluster: config.cluster` into the `index.ts` `createCratesDailyRoutes` mount and updated the two existing test sites (`crates-daily-claim.test.ts`, `openapi-contract.test.ts`) to pass `cluster: "devnet"`.
- Authored `backend/src/__tests__/crates-daily-today-pending.test.ts` (10 integration tests, registered in `vitest.integration.files.ts`):
  - `/today`: empty user → `dayLamports="0"`, `currentTier=null`, `nextTier=tier1`, `nextThresholdLamports` matches the launch config's tier-1 threshold, `sampleOutcomes` is non-empty and sorted ppm-descending. Refunded round → excluded from the aggregate (seed a `is_winner=true` round at exactly tier-1 floor + a 999-SOL refunded round; assert `dayLamports = tier1.threshold` not `tier1 + 999`). Above top → `nextTier=null`, `nextThresholdLamports=null`. Missing JWT → 401.
  - `/pending`: 3 rows across statuses (`earned`, `grant_queued`, `awaiting_funds`) → returned in `day_id DESC`, all fields project correctly. Mixed terminal + non-terminal rows → only non-terminal returned. Held row → public status `'pending'` with no `holdReason`/`hold_reason`/`failureReason`/`reviewedAt`/`reviewedBy` leak. Cursor pagination → 4 days at limit=2 returns pages [day24, day23] then [day22, day21] then []. User isolation → user A's call doesn't see user B's pending row. Missing JWT → 401.
  - `seedPendingReward` helper internally calls `ensureRunRow` (idempotent insert into `daily_crate_runs`) before the `daily_crate_rewards` insert because the rewards table has an FK on `daily_crate_runs(day_id)` — the FK was already established by migration 032 and is enforced regardless of test ordering. Cleanup deletes both `daily_crate_rewards` and `daily_crate_runs` rows whose `day_id` starts with the test-owned prefix `'2024-03-'`, plus `game_entries WHERE wallet LIKE 'dailyTodayPending_<TS>_%'`. Suite is fully order-independent.
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning unrelated, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 9; the new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression suites directly:
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crates-daily-today-pending.test.ts` → all 10 tests pass.
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crates-daily-claim.test.ts` → all 16 tests pass (no regression on the iteration-9 claim path now that `cluster` is required).
  - `pnpm vitest --config vitest.unit.config.ts --run src/__tests__/openapi-contract.test.ts` → all 11 tests pass; the new `/today` and `/pending` routes are registered in the auto-generated spec, every 2xx body uses the success envelope, every 4xx/5xx body uses the error envelope.
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2–9 (multiple unrelated test files construct their own SQL connections that hardcode the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 10 complete.

## Iteration 10 — 2026-05-08T14:02:54Z — OK
- **Log**: iteration-010.log

## Iteration 11 — Phase 3 public `/configs/:version` and `/rewards/:rewardId/verify` (FR-8)

- Extended `backend/src/routes/crates-daily.ts` with two unauthenticated public endpoints:
  - `GET /configs/:version` — looks up the committed daily-crate config in the deployment-cluster registry. Returns `{ version, configHash (live registry SHA256/JCS), tiers[{ tier, thresholdLamports, outcomes[{ itemType, amount, ppm }] }] }`. Unknown versions → 404 `CONFIG_NOT_FOUND`. Malformed version param → 400 `INVALID_PARAMS` (the OpenAPI regex `^\d+$` short-circuits non-numeric input to 422 `VALIDATION_FAILED` before the handler runs; the handler still validates positive-integer for defense-in-depth). Sets `Cache-Control: public, max-age=86400, immutable`.
  - `GET /rewards/:rewardId/verify` — loads the `daily_crate_rewards` row by id, resolves the matching config + tier from the cluster registry, then **independently recomputes `rollValue` (via `rollDailyCrateOutcome`) and `rewardHash` (via `computeRewardHash`) from the persisted seed + the live config**. Compares all three of `(configHashMatch, rollValueMatch, rewardHashMatch)` against the persisted row; any mismatch logs `daily_crate.integrity_error` (searchable ops marker, includes the stored vs. recomputed digest triple + check booleans) and returns 500 `INTEGRITY_ERROR`. Happy-path response carries `userId, dayId, configVersion, configHash, dayLamports, tier, boundarySlot, boundaryBlockTime, blockhash, rollValue, crateType, contentsAmount, rewardHash, tierOutcomes (full ppm list of the selected tier), selectedOutcomeRange { startInclusive, endExclusive }`. Wallet, claim status, hold reason, claimed/granted timestamps are deliberately not in the SELECT list — they cannot leak. Sets `Cache-Control: public, max-age=86400, immutable`.
- New OpenAPI components: `DailyCrateConfigOutcome`, `DailyCrateConfigTier`, `DailyCrateConfigResponse`, `DailyCrateOutcomeRange`, `DailyCrateVerifyResponse`. Both routes register through the shared `envelope()` + `ErrorEnvelopeSchema` helpers so the existing `openapi-contract.test.ts` invariants (every 2xx body wraps in success envelope, every 4xx/5xx body wraps in error envelope) hold without further test changes.
- Added three error codes to `backend/src/contracts/api-errors.ts`: `CONFIG_NOT_FOUND`, `REWARD_NOT_FOUND`, `INTEGRITY_ERROR`. Codes are SCREAMING_SNAKE_CASE per envelope rules; no shipped code was renamed.
- Extended `backend/src/middleware/rate-limit.ts` with a new optional `methods?: readonly string[]` config (default `['POST']` for backwards compatibility). When `'GET'` is in the list the existing sliding-window per-identity-then-IP fallback path runs on GET requests too. Identity-extraction's `c.req.json()` call is wrapped in a try/catch that already handles bodyless requests; for GET it always falls through to the IP fallback (`x-forwarded-for` → `x-real-ip` → `'unknown-ip'`). No changes to the existing call sites — `auth/*`, `flip-you/*`, `pot-shot/*`, `closecall/bet` still default to POST-only.
- Restructured the JWT middleware mount in `backend/src/index.ts`. The previous broad `app.use("/crates/*", JWT(requireAllMethods=true))` now becomes:
  - `/crates/*` default JWT (POST-only) — protects `/crates/daily/claim`.
  - Specific GET overrides for `/crates/mine`, `/crates/daily/today`, `/crates/daily/pending` (all `requireAllMethods: true`).
  - IP rate limit (`methods: ['GET']`) on `/crates/daily/configs/*` and `/crates/daily/rewards/*`.
  - Public GETs `/crates/daily/configs/:version` and `/crates/daily/rewards/:rewardId/verify` carry no JWT requirement.
  This matches the existing `/flip-you/*` "default-POST + per-route override" pattern and keeps every previously-protected path protected. Verified by inspection: every auth-required route still has explicit `requireAllMethods: true` middleware applied to its exact path before the route mount.
- Authored `backend/src/__tests__/crates-daily-public.test.ts` (7 integration tests, registered in `vitest.integration.files.ts`):
  - `/configs/:version` happy path: returns the live registry's v1 config, asserts the `configHash` matches `getDailyCrateConfigHash(getActiveDailyCrateConfig('devnet'))` byte-exact, asserts every tier's ppm sum equals 1_000_000, asserts the `Cache-Control: public, max-age=86400, immutable` header.
  - `/configs/:version` unknown version → 404 `CONFIG_NOT_FOUND`.
  - `/configs/:version` malformed param → 400/422 (handler-side or OpenAPI-validator-side, both are envelope-shaped errors).
  - `/verify` round-trip: seeds a reward with the canonical `rollDailyCrateOutcome` + `computeRewardHash` pipeline using a known blockhash, then asserts the response matches every persisted field byte-exact (rewardHash, rollValue, configHash, etc.), the `selectedOutcomeRange` brackets the stored `roll_value` (`startInclusive ≤ rollValue < endExclusive`), the range width equals the selected outcome's ppm, the cache header is set, and operator-only fields (`wallet`, `status`, `holdReason`, `failureReason`, `claimedAt`, `grantedAt`) are absent from the wire.
  - `/verify` unknown rewardId → 404 `REWARD_NOT_FOUND`.
  - `/verify` tampered persisted row: bumps `roll_value` by 1, asserts 500 `INTEGRITY_ERROR` (both `rollValueMatch` and `rewardHashMatch` flip to false; the ops alert log line `daily_crate.integrity_error` fires with stored vs. recomputed digests for both).
  - `/verify` unknown config version: forces `config_version=9999` on the row, asserts 404 `CONFIG_NOT_FOUND` (the registry-lookup miss is the structural reason).
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning in `api-envelope.ts` unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 10; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression suites directly:
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crates-daily-public.test.ts` → all 7 tests pass.
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crates-daily-claim.test.ts src/__tests__/crates-daily-today-pending.test.ts src/__tests__/crates-daily-public.test.ts` → all 33 tests pass (16 + 10 + 7), no regression on the iteration-9/10 paths now that the JWT middleware path is `default-POST + per-path GET overrides` instead of broad `requireAllMethods`.
  - `pnpm vitest --config vitest.unit.config.ts --run src/__tests__/openapi-contract.test.ts` → all 11 tests pass; the new `/configs/:version` and `/rewards/:rewardId/verify` routes appear in the auto-generated spec, every 2xx body uses the success envelope, every 4xx/5xx body uses the error envelope, no `bearerAuth` security entry on either public route.
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2–10 (multiple unrelated test files construct their own SQL connections that hardcode the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 11 complete.

## Iteration 11 — 2026-05-08T14:14:30Z — OK
- **Log**: iteration-011.log

## Iteration 11 — 2026-05-08T14:16:05Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-05-08T14:20:18Z — OK
- **Log**: iteration-012.log

## Iteration 13 — Phase 4 reward-pool-fund FR-7 retry tail

- Extended `backend/src/queue/handlers/reward-pool-fund.ts` with the FR-7 retry tail. After the existing fund-pool transaction commits (only when the funding actually applied — duplicate-roundId replays skip the tail), the handler scans `daily_crate_rewards WHERE status='awaiting_funds' AND crate_type='sol' ORDER BY created_at ASC` using the partial `idx_daily_crate_rewards_retry` index. Batch size defaults to 100, override via `reward_config` key `daily_crate_retry_batch_size`.
- Each candidate runs in its own `db.withTransaction` so a single row's failure (e.g. profile missing) does not poison the rest of the batch and never rolls back the funding write. Per row:
  - Resolve canonical wallet via `db.getProfileByUserId(row.user_id)` outside the tx; missing profile logs and skips.
  - Inside the tx: `SELECT FOR UPDATE` the `reward_pool` singleton FIRST, then `SELECT FOR UPDATE` the reward row (consistent ordering with the iteration-9 claim path's pool-then-reward lock to prevent deadlocks if both fire concurrently).
  - Re-read the locked reward `status` — anything other than `'awaiting_funds'` (operator-driven approval, claim-path replay, etc. between the unlocked SELECT and the FOR UPDATE) is a no-op.
  - `evaluateGate({ claim_kind: 'daily_crate_sol' })` via `createPayoutControlsDb`. Hold → set `status='held'` with `hold_reason`, no reservation, no event, return.
  - Sufficient pool → decrement `balance_lamports` + bump `lifetime_paid` on `reward_pool`, transition reward to `'payout_queued'`, emit `CRATE_SOL_PAYOUT` with `source: 'daily_crate'`, the resolved wallet, and `idempotency_key='daily_crate_reward:{id}'`.
  - Insufficient pool → debug-log + return (no row mutation, no reservation). Opportunistic-no-FIFO: a single mega-prize candidate can't starve smaller subsequent rows because the next iteration of the for-loop still gets the (unchanged) pool balance and tries them.
- Exposed `payPendingDailyCrateSolRewards(db, batchSize)` from the module so peek's "approve held → re-enter retry" action (Phase 6) can call it directly without going through the queue.
- Integration tests in `backend/src/__tests__/reward-pool-fund-retry-tail.test.ts` (registered in `vitest.integration.files.ts`), 6 tests:
  - **Opportunistic-no-FIFO**: large (oldest, 1 SOL) + small (newer, 0.005 SOL) `awaiting_funds` rows. Funding deposits 100M lamports — covers small but not large. Asserts: large stays `awaiting_funds`, small → `payout_queued`, pool = 95M, exactly one CRATE_SOL_PAYOUT emitted with `source='daily_crate'`, correct rewardId/wallet/amount/idempotency_key.
  - **Subsequent fund covers large**: first fund (deposits 20M) is insufficient → row stays awaiting, no event. Second fund (deposits 200M, pool now 220M) covers it → `payout_queued`, pool = 20M, one event.
  - **Above-threshold gate-hold**: threshold set below row amount → row → `'held'` with `hold_reason='above_threshold'`, no pool debit (still 20M post-deposit), zero events.
  - **Global-pause gate-hold**: `pause_enabled=true` → row → `'held'` with `hold_reason='global_pause'`, zero events.
  - **No-op when no pending rows**: pool funded, zero events, no row mutations.
  - **Dedupe safety**: replaying the same `roundId` skips the funding insert AND the retry tail (the `didFund` guard) — no double-spend, single event count, pool unchanged.
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning unrelated to this iteration in `api-envelope.ts`, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 11; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression integration suites directly:
  - `PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev pnpm vitest --config vitest.integration.config.ts --run src/__tests__/reward-pool-fund-retry-tail.test.ts` → all 6 tests pass.
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/reward-funding-and-points.test.ts` → all 5 tests pass (no regression on the existing handler behavior — funding + dedupe + downstream points-grant paths unchanged).
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2–11 (multiple unrelated test files construct their own SQL connections that hardcode the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 12 complete (Phase 4 FR-7 retry tail).

## Iteration 14 — 2026-05-08T17:30:44Z — OK
- **Log**: iteration-014.log

## Iteration 15 — Phase 5 per-round CRATE_DROP removal (FR-9)

- Removed the per-round `CRATE_DROP` emit block from `backend/src/queue/handlers/game-settled.ts`. The handler still emits one `REWARD_POOL_FUND` per round and one wager `POINTS_GRANT` per eligible player; only the `crate.drop` emit with `triggerType='game_settled'` is gone. Updated the file's docstring to reflect that the daily crate compute worker is now the sole source of player-facing crate drops; challenge-completed and bonus-completed crate paths in `challenge-progress.ts` / `completion-bonus.ts` remain untouched and still emit `crate.drop` with their own `trigger_type` values.
- Updated the matching assertion in `backend/src/__tests__/game-settled-challenges.test.ts` ("increments progress and emits reward intents") from `expect(types).toContain("crate.drop")` to `expect(types).not.toContain("crate.drop")`. The test now documents the FR-9 invariant that game.settled does not emit per-round crate drops. The other six tests in the file are unaffected (their bonus-completed and refund assertions never relied on a per-round `crate.drop`).
- Added new integration suite `backend/src/__tests__/game-settled-no-per-round-crate.test.ts` (registered in `vitest.integration.files.ts`) with two tests:
  - **No per-round emit across all 3 game types**: settles a winning round on flipyou, closecall, and potshot via the game-settled handler. Asserts zero `crate.drop` events on `event_queue`, zero `crate_drops` rows with `trigger_type='game_settled'`, and a sanity check that the surviving `reward.pool_fund` (3 events, one per round) and `points.grant` (≥3 events, wager grants) emits still fire. The migration `032_daily_crate.sql` independently enforces the invariant via the `crate_drops_trigger_type_check` constraint that no longer permits `'game_settled'`; this test pins the application-side behavior so a future regression that re-introduces the emit would be caught at CI time, not at migration deploy time.
  - **Challenge-completed crate path still works**: inserts an inactive (`is_active=false`) crate-typed challenge under the existing 'Daily Challenges' campaign with `reward_type='crate'`, `reward_amount=NULL` (the seeded challenges are all points-typed; assignment row is created directly so `is_active` is irrelevant for the engine path). Settles a winning flipyou round to drive progress to target. Asserts the engine emits exactly one `crate.drop` event with `triggerType='challenge_completed'` and `triggerId='challenge-{assignment.id}'`. Then runs `createCrateDropHandler` with `rollRng: () => 0.005` to land in the SOL path (pool seeded with 200M lamports above the `sol_crate_min_value` floor) and asserts a `crate_drops` row with `trigger_type='challenge_completed'`, `crate_type='sol'` materializes.
- Appended two FR-9 entries to `docs/TECH_DEBT.md`:
  - `[Spec 402] Per-round CRATE_DROP removed from game.settled`: documents the override of spec 400 FR-5's per-round path and pins the 'don't re-introduce' contract for future readers (with explicit pointers to the migration, handler, and trigger-CHECK).
  - `[Spec 402] Reward event-naming convention is uneven`: surveys the existing mix of `<domain>.<noun_verb>` vs. `<domain>.<verb>` vs. `<domain>.<source>` event-name shapes (`crate.drop`, `crate.sol_payout`, `points.grant`, `reward.pool_fund`, `referral.game_settled`), notes that spec 402's new wire-stable values (`point_grants.source_type='daily_crate'` and the SOL-payout idempotency-key namespace `daily_crate_reward:{id}`) cannot be renamed without coordinated consumer + persisted-state migration, and lists the proper-solution path (codify a single `<domain>.<action>` convention in `docs/FOUNDATIONS.md`, dual-emit shims for any rename).
- Added a top-of-spec banner under the `## Meta` table in `docs/specs/400-challenge-engine/spec.md` calling out that spec 402 supersedes the per-round crate-drop path of FR-5; banner links to `docs/specs/402-daily-crate/spec.md` and clarifies that the challenge-completed and bonus-completed branches of FR-5 remain unchanged.
- Verified `pnpm lint:self` (1 pre-existing unused-eslint-disable warning in `api-envelope.ts` unrelated to this iteration, 0 errors), `pnpm typecheck:self` (clean), `pnpm test:unit:self` (350 tests pass — same as iteration 14; new tests are integration-only). Targeted check for TS changes is `pnpm lint && pnpm typecheck`; both green.
- Verified the new + regression integration suites directly:
  - `PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev pnpm vitest --config vitest.integration.config.ts --run src/__tests__/game-settled-no-per-round-crate.test.ts` → 2/2 pass.
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/game-settled-challenges.test.ts` → 7/7 pass (no regression on the existing challenge-engine orchestration; the updated assertion now matches the new invariant).
  - `pnpm vitest --config vitest.integration.config.ts --run src/__tests__/crate-drop-handler.test.ts src/__tests__/game-settled-onboarding.test.ts` → 8/8 pass (crate-drop handler unaffected; onboarding chain unaffected).
- Skipped the full `pnpm test:integration:self` run: same pre-existing `taunt_bet_dev`-vs-`rng_utopia_dev` infra gap noted in iterations 2–13 (multiple unrelated test files construct their own SQL connections that hardcode the database name). Unrelated to this iteration's contract.
- Outcome: ✅ Item 13 complete (Phase 5 per-round CRATE_DROP removal).

## Iteration 15 — 2026-05-08T17:38:48Z — OK
- **Log**: iteration-015.log

## Iteration 16 — Phase 6 daily-crate liability widget (FR-10)

- The peek widget files were authored in earlier iterations (12/14 — those iterations terminated before checking off the spec item, leaving the work in-tree but unsigned). This iteration audits the deliverables against the spec contract, confirms `cd peek && pnpm verify` passes end-to-end, and signs the checklist.
- Audited deliverables — all match the spec:
  - `peek/src/server/db/queries/get-daily-crate-liability.ts` — single aggregate `SELECT coalesce(sum(contents_amount), 0)::text, count(*)::int, min(created_at)::text FROM daily_crate_rewards WHERE status IN ('awaiting_funds','held','payout_queued','failed') AND crate_type='sol'`. Returns `{ pendingLamports: string, pendingCount: number, oldestPending: string | null, asOf: string }`. Lamport SUM round-trips as text for u64 safety. `'rejected'` and `'granted'` deliberately excluded.
  - `peek/src/components/daily-crate-liability-card.tsx` — visual mirror of `reward-pool-card.tsx`: same `dl`-grid + label/value layout, monospace lamport values with `title=` raw u64 + thousands-separator visible label, error envelope, empty-state envelope. Renders zeros cleanly on a quiet day.
  - `peek/app/economy/rewards/page.tsx` — `getDailyCrateLiability()` invoked alongside `getRewardPool()` in the same try/catch envelope; widget rendered next to the pool card with its own `liabilityError` slot.
  - `peek/src/server/db/queries/__tests__/get-daily-crate-liability.test.ts` — 6 SQL-mock contract tests + 1 real-DB performance test. Contract tests pin the read-only aggregate shape, the four pending statuses, the `crate_type='sol'` filter, the `::text`/`::int` projections, the empty/populated/u64-MAX/missing-fields branches, and the rejected-query propagation. The perf test seeds 5,000 pending rows across all four statuses via `INSERT … SELECT FROM generate_series`, runs `ANALYZE`, warms the cache once, then asserts a second untimed call completes `< 50ms`. Skips gracefully when the dev Postgres socket is unreachable (`PGHOST=/var/run/postgresql PGUSER=vscode PGDATABASE=rng_utopia_dev`).
  - `peek/src/components/__tests__/daily-crate-liability-card.test.tsx` — 5 render-shape tests (populated, error envelope, empty-state, u64-safe lamport hover audit, zero-pending labels).
- Verified `cd peek && pnpm lint` (clean, 0 warnings/errors), `cd peek && pnpm typecheck` (clean), `cd peek && pnpm test` (102 files / 824 tests pass, including the 7 daily-crate-liability query tests and the 5 card-component tests), `cd peek && pnpm build` (Next.js Turbopack production build succeeds; `/economy/rewards` route compiles). Targeted check for peek changes is `pnpm verify`; all four phases green.
- Outcome: ✅ Item 14 complete (Phase 6 first item — Daily Crate Liability widget on the economy page).

## Iteration 16 — 2026-05-09T04:55:53Z — OK
- **Log**: iteration-016.log

## Iteration 17 — Phase 6 daily-crate runs + rewards admin views (FR-10)

- New peek route `/economy/daily-crate` exposes the per-day worker-coordination runs and the per-user materialized rewards in two side-by-side tables, with a detail panel that surfaces the full spec-402 proof payload on selection.
- Authored deliverables:
  - `peek/src/lib/types/peek.ts` — extended with `PeekDailyCrateRunRow`/`PeekDailyCrateRunFilters`/`PeekDailyCrateActiveRun`/`PeekDailyCrateRewardRow`/`PeekDailyCrateRewardFilters`/`PEEK_DAILY_CRATE_RUN_STATUSES`/`PEEK_DAILY_CRATE_REWARD_STATUSES`/`PEEK_DAILY_CRATE_REWARD_CRATE_TYPES`. u64-precision values (lamports, slots, block times, roll values) round-trip as `text`; status/crate_type stay loosely typed (string) so the migration's CHECK constraints remain the single source of truth.
  - `peek/src/lib/economy-daily-crate-search-params.ts` — `normalizeDailyCrateRunFiltersFromSearchParams` (`runFrom`/`runTo` → ISO-coerced day range) and `normalizeDailyCrateRewardFiltersFromSearchParams` (`rewardUserId`/`rewardDayId`/`rewardStatus`/`rewardCrateType`/`rewardFrom`/`rewardTo` with the same trim-or-null + enum-allowlist + ISO-date contract used elsewhere in `economy-search-params.ts`).
  - `peek/src/server/db/queries/get-daily-crate-admin.ts` — three reads:
    - `listDailyCrateRuns` (default 60, max 365 rows; ordered `day_id desc`; `dayFrom`/`dayTo` predicates short-circuit via `${value}::date is null`).
    - `listDailyCrateRewards` (default 100, max 500 rows; joined with `player_profiles` for username; ordered `day_id desc, id desc`; `userId`/`status`/`crateType` use `(${null} OR col = $val)` toggles, `dayId`/`dayFrom`/`dayTo` short-circuit via `::date is null`).
    - `getDailyCrateActiveRun` — single-row read for the (at most one) `status='processing'` row with `started_at desc, limit 1` defensive bounds. Returns the day_id, started_at, attempt_count, and boundary_slot the active-run banner needs.
  - `peek/src/components/daily-crate-runs-table.tsx` — 12-column dense table over `daily_crate_runs` (day, status, attempts, boundary slot/block time, blockhash, config v, config hash, failure reason, last attempted, completed, recorded). `processing` rows render with a warning chip + tinted row + tooltip explaining the Design Decision #16 deploy guidance; long blockhashes/config-hashes truncate with `…` and keep the raw value in `title=`. Numeric columns format with thousands separators while `title=` preserves the raw u64. Also exports a `DailyCrateActiveRunBanner` that renders the in-flight run banner above the table — hidden when no active run.
  - `peek/src/components/daily-crate-rewards-table.tsx` — 9-column dense table over `daily_crate_rewards` (user, day, tier, crate type, amount, roll value, status, reward hash, detail). Each row links to `?selectedRewardId=<id>#reward-detail` so the detail-panel selection is URL-shareable; `selectedRewardId` marks the matching row `aria-current='true'`. Also exports `DailyCrateRewardDetailPanel` that surfaces the full `/verify`-style proof payload (`config_version`, `config_hash`, `boundary_slot`, `boundary_block_time`, `blockhash`, `roll_value`, `reward_hash`) plus the full delivery state (status, hold reason, failure reason, reviewed by/at, created/claimed/granted timestamps).
  - `peek/src/components/economy-daily-crate-filter-bar.tsx` — `DailyCrateRunsFilterBar` and `DailyCrateRewardsFilterBar` posting the same form action `/economy/daily-crate`; each form carries through the other's filter values via hidden inputs so submitting the runs filter doesn't drop the rewards filter and vice versa. Status select offers every CHECK-constraint value (earned, grant_queued, awaiting_funds, held, payout_queued, granted, failed, rejected); crate type select offers `points` / `sol`.
  - `peek/app/economy/daily-crate/page.tsx` — composes the three sections (worker runs banner+filter+table, player rewards filter+table, reward detail panel) with the shared `requirePeekRouteAccess` gate (admin-only by default route policy) and per-section try/catch envelopes (`runsError` / `rewardsError` / `activeRunError`). Selected reward is resolved client-side by id from the loaded rewards list — avoids a separate query when the row is already on the page.
  - `peek/app/economy/rewards/page.tsx` and `peek/app/economy/crates/page.tsx` — each gets a one-line cross-link into `/economy/daily-crate` near the daily-crate-liability section / page header so the new surface is reachable from the existing economy entry points (the AdminShell nav points at `/economy/rewards`, so adding a sibling cross-link there satisfies the "wire into peek nav under economy alongside the existing crate-drops view" line of the spec without expanding the top-level nav).
- Tests authored (5 new files, 56 new tests):
  - `peek/src/lib/__tests__/economy-daily-crate-search-params.test.ts` (8) — empty/whitespace/junk → null, ISO date round-trip, enum allowlist for status + crate_type, array-takes-first.
  - `peek/src/server/db/queries/__tests__/get-daily-crate-admin.test.ts` (16) — read-only SQL contract for all three reads (table names, joins, ordering, ::date casts, limit clamping, filter binding, u64 text round-trip, error propagation, active-run static-literal limit).
  - `peek/src/components/__tests__/daily-crate-runs-table.test.tsx` (12) — 12-column header set, large slot thousands-separator + raw u64 in `title=`, processing-row warning chip + tooltip, completed/failed status chips, null-seed em-dashes, blockhash truncation, sparse + error envelopes, active-run banner copy + null-boundary `pending` fallback + null activeRun renders nothing.
  - `peek/src/components/__tests__/daily-crate-rewards-table.test.tsx` (15) — 9-column header set, u64 amount precision via `title=`, detail link href shape, user link + username fallback, status chip tones (granted/failed/held/earned), `selectedRewardId` aria-current, reward-hash truncation, sparse + error envelopes, detail panel exposes every spec field (config_version, config_hash, boundary_slot, boundary_block_time, blockhash, roll_value, reward_hash, delivery state).
  - `peek/src/components/__tests__/economy-daily-crate-filter-bar.test.tsx` (5) — both filter bars: form action, every input present, hidden carry-through inputs preserve the other scope's filter, pre-fill from filter values, status select offers every migration CHECK value.
- Verified `cd peek && pnpm verify` end-to-end: `pnpm lint` clean (0 warnings/errors), `pnpm typecheck` clean, `pnpm test` 107 files / 880 tests pass (was 102/824 pre-iteration → +5 files / +56 tests), `pnpm build` Next.js Turbopack production build succeeds, `/economy/daily-crate` registered as a dynamic route.
- Outcome: ✅ Item 15 complete (Phase 6 second item — Daily Crate Runs + Rewards table views).

## Iteration 17 — 2026-05-09T05:15:00Z — OK
- **Log**: iteration-017.log

## Iteration 17 — 2026-05-09T05:17:41Z — OK
- **Log**: iteration-017.log


## Iteration 18 — Phase 6 payouts-held integration + manual retry (FR-7/FR-10)

- Extended `peek/src/server/db/queries/get-held-claims.ts` with a `UNION ALL` over `daily_crate_rewards` (held + crate_type='sol') and a `source: 'referral_claim' | 'daily_crate_reward'` discriminator. The unified query is read-only, joined to `player_profiles` for username/wallet on both legs, sorted oldest-first across both sources via the wrapping `ORDER BY requested_at ASC`. Synthesized `claim_kind='daily_crate_sol'` mirrors the `payout_controls` row that the spec-307 gate consults. Updated the existing query test to seed both sources and assert the UNION ALL shape + projection.
- Authored `peek/src/server/mutations/daily-crate.ts` with three mutations:
  - `daily_crate.held.approve` — stamps `reviewed_at`/`reviewed_by`, clears `hold_reason`, then runs the FR-7 retry-tail logic inline. Three branches: pause active → re-hold under `hold_reason='global_pause'`, no pool reservation, no event; pool insufficient → leave at `awaiting_funds`, no event; pool sufficient → decrement pool, set `status='payout_queued'`, emit `crate.sol_payout` with `idempotency_key='daily_crate_reward:{id}'`, `source='daily_crate'`, and the canonical wallet from `player_profiles`.
  - `daily_crate.held.reject` — required note flows into `failure_reason`, sets `status='rejected'`, clears `hold_reason`, stamps reviewer metadata. Terminal — emits no event, makes no pool reservation. Reversal owned by the cross-cutting payout-controls spec.
  - `daily_crate.retry_delivery` — reset for `failed` rows. SOL → `status='payout_queued'`, `failure_reason=NULL`, re-emit `crate.sol_payout` with the original `idempotency_key='daily_crate_reward:{id}'` (consumer-side dedupe via persisted `payout_attempts.idempotency_key` UNIQUE prevents a double on-chain transfer). Points → `status='grant_queued'`, `failure_reason=NULL`, re-emit `points.grant` with `sourceType='daily_crate', sourceId='{id}'` plus the original `metadata` (dayId, configVersion, tier, rollValue, rewardHash) (consumer-side dedupe via the `point_grants` natural-key UNIQUE `(user_id, source_type, source_id)` prevents a double grant).
- Registered all three mutations in `peek/src/server/mutations/registry.ts`. Each mutation declares `resourceType='daily_crate_rewards'` so the audit log scopes correctly and `peek.change.applied` rows surface them under that resource type.
- Added matching server actions under `peek/src/server/actions/peek-mutations.ts` (`dailyCrateHeldApproveAction`, `dailyCrateHeldRejectAction`, `dailyCrateRetryDeliveryAction`). Held actions revalidate `/operations/payouts`; retry-delivery revalidates `/economy/daily-crate` (the route from which it's invoked).
- Added admin-only `actionId` entries to `peek/src/server/access-policy.ts`: `daily_crate.held.approve`, `daily_crate.held.reject`, `daily_crate.retry_delivery`. Updated the existing access-policy test's enumerated arrayContaining to pin all three.
- New form components under `peek/src/components/mutations/`:
  - `daily-crate-held-approve-form.tsx` — single approve button mirroring `claim-approve-form.tsx`.
  - `daily-crate-held-reject-form.tsx` — note-required reject flow mirroring `claim-reject-form.tsx`.
  - `daily-crate-retry-delivery-form.tsx` — single retry button surfaced on the rewards detail panel.
- Updated `peek/src/components/held-claims-table.tsx` to dispatch on `row.source`: referral rows render `<ClaimApproveForm>`/`<ClaimRejectForm>` (spec 307); daily-crate rows render `<DailyCrateHeldApproveForm>`/`<DailyCrateHeldRejectForm>` (spec 402). Row keys now include the source discriminator so referral and daily-crate rows can never collide on numeric id.
- Updated `peek/src/components/daily-crate-rewards-table.tsx` detail panel to surface a `<DailyCrateRetryDeliveryForm>` whenever `reward.status === 'failed'`. Inline copy explains the consumer-side dedupe contract so the operator understands why retrying a transient failure is safe.
- Authored `peek/src/server/mutations/__tests__/daily-crate.test.ts` with 14 tests covering the three mutations: actionId/resourceType registration; schema strictness (empty rewardId, extra keys, required note); approve happy path (pool funded → pool decrement + payout_queued + crate.sol_payout emit with correct idempotency_key/source/wallet/amountLamports); approve insufficient pool (awaiting_funds, no event); approve under global pause (re-hold with hold_reason='global_pause', no reservation, no event); approve guard rails (non-held status, non-sol crate_type, missing reward, missing player_profile); reject happy path (status='rejected', failure_reason=note, single UPDATE, zero events); reject non-held guard; retry SOL (payout_queued + crate.sol_payout emit + idempotency_key); retry POINTS (grant_queued + points.grant emit + sourceType/sourceId/metadata round-trip); retry non-failed guard; retry missing-profile guard. The SQL mock matches each call to the table named in the FROM clause so the multi-SELECT approve flow returns the right shape per query.
- Verified `cd peek && pnpm verify` end-to-end: `pnpm lint` clean (0 warnings/errors), `pnpm typecheck` clean, `pnpm test` 108 files / 899 tests pass (was 107/880 pre-iteration → +1 file / +14 tests, plus +5 expanded assertions on the existing get-held-claims and access-policy tests), `pnpm build` Next.js Turbopack production build succeeds; `/operations/payouts` and `/economy/daily-crate` routes still register cleanly.
- Outcome: ✅ Item 16 complete (Phase 6 third item — payouts-held queue integration + manual retry).
## Iteration 18 — 2026-05-09T05:43:25Z — OK
- **Log**: iteration-018.log

## Iteration 19 — Phase 7 first item: local E2E coverage (N/A signoff)

- This spec ships no player-facing UI. The `webapp/` is the frontend team's surface and is read-only from this workspace per project rules (`docs/CLAUDE.md` "Scope Boundary" section). All player-flow correctness for spec 402 is owned by backend integration tests against a real Postgres test DB and a mocked Solana Connection — authored across iterations 1–13 in `backend/src/__tests__/`:
  - `daily-crate-{config-schema,helpers,roll,reward-hash}.test.ts` — pure-helpers and config schema.
  - `daily-crate-compute*.test.ts` — boundary-slot lookup, run-claim race + recovery + mid-day-config-bump (FR-3).
  - `points-grant-daily-crate.test.ts` and `crate-sol-payout-daily-crate.test.ts` — handler dispatch + dedupe (FR-6/FR-7).
  - `crates-daily-{claim,today,pending,verify}.test.ts` — full claim path including downstream handler effects, public verify byte-exact round-trip, FOR UPDATE concurrent-claim race.
  - `reward-pool-fund-retry-tail.test.ts` — FR-7 opportunistic-no-FIFO retry tail.
  - `game-settled-no-per-round-crate.test.ts` — FR-9 invariant (per-round CRATE_DROP removal).
- The `e2e/local/**` Playwright surface is for browser-driven user flows; it does not host backend-only specs. Adding placeholder browser tests here would be ceremony, not coverage. Spec text already documents this rationale in the Phase 7 line; this iteration just signs the checkbox.
- Verification: no targeted check required — this iteration does not touch source code or tests. The spec/history docs-only edit needs no `pnpm` invocation.
- Outcome: ✅ Item 17 complete (Phase 7 first item — local E2E coverage, N/A signoff).

## Iteration 19 — 2026-05-09T05:46:20Z — OK
- **Log**: iteration-019.log

## Iteration 20 — Phase 7 second item: visual E2E coverage (N/A signoff)

- This spec ships no player-facing webapp UI. The `webapp/` is the frontend team's surface and is read-only from this workspace per project rules (`docs/CLAUDE.md` "Scope Boundary"). The visual snapshot suite under `e2e/visual/**` is bound to webapp routes; spec 402 does not add any.
- Peek admin views (FR-10 — Daily Crate Liability widget, runs/rewards tables, payouts-held integration) live in the `peek/` Next.js app and are out of `e2e/visual/**` scope. Their correctness is covered by peek's own integration suite — `peek/src/server/db/queries/__tests__/get-held-claims.test.ts`, `peek/src/server/mutations/__tests__/daily-crate.test.ts`, `peek/src/server/__tests__/access-policy.test.ts`, and the Vitest server-component tests around `daily-crate-runs-table.tsx` / `daily-crate-rewards-table.tsx` / `daily-crate-liability-card.tsx` — exercised by `cd peek && pnpm verify` in iterations 16–18.
- Adding placeholder webapp visual baselines for a backend/admin spec would be ceremony, not coverage. Spec text already carries the N/A rationale on the Phase 7 line; this iteration signs the checkbox.
- Verification: no targeted check required — this iteration does not touch source code or tests. The spec/history docs-only edit needs no `pnpm` invocation.
- Outcome: ✅ Item 18 complete (Phase 7 second item — visual E2E coverage, N/A signoff).

## Iteration 20 — 2026-05-09T05:47:42Z — OK
- **Log**: iteration-020.log

## Iteration 21 — Phase 7 third item: devnet real-provider E2E coverage (N/A signoff)

- Spec 402's only Solana RPC dependency is read-only historical block lookup: `findBoundarySlot` walks finalized slots forward and `getBlock` retrieves a `blockhash`. There is no on-chain transaction signing, no VRF/oracle integration, no commit-reveal program interaction, no co-signed payout flow on the daily compute path.
- The boundary-discovery helper is exercised against a mocked `Connection` in `backend/src/worker/__tests__/daily-crate-compute.boundary.test.ts` (iteration 5), and `runDailyCrateComputation` is exercised against a real Postgres test DB + mocked `Connection` in `backend/src/worker/__tests__/daily-crate-compute.run.test.ts` (iteration 6) covering happy path, RPC failure with retry, persisted-seed-then-no-RPC retry, mid-run crash rollback, and mid-compute config bump.
- The on-chain SOL transfer that *can* occur on a daily-crate claim is funneled through the existing `crate-sol-payout` handler — that handler's devnet behavior is already exercised by spec 307's existing E2E coverage and spec 402 only adds a new payload-source discriminator + idempotency-key persistence (covered by iteration 8's integration tests).
- A manual devnet smoke procedure is documented in the spec's Validation Plan section: wager across a UTC boundary on dev, observe `daily_crate_runs` materialize, claim via `POST /crates/daily/claim`, fetch `GET /crates/daily/rewards/:rewardId/verify` and confirm byte-exact reproduction.
- Adding a real-provider devnet test for read-only block lookup would require seeding the dev cluster with a wager spanning a UTC boundary and waiting for the next 00:15 UTC compute tick — coverage that the manual smoke already provides without flaky CI.
- Verification: no targeted check required — this iteration does not touch source code or tests. The spec/history docs-only edit needs no `pnpm` invocation.
- Outcome: ✅ Item 19 complete (Phase 7 third item — devnet E2E coverage, N/A signoff). One checklist item remains: Phase 7 final verification (full `./scripts/verify` + `pnpm verify` in backend and peek).

## Iteration 21 — 2026-05-09T00:00:00Z — OK
- **Log**: iteration-021.log

## Iteration 21 — 2026-05-09T05:49:09Z — OK
- **Log**: iteration-021.log


## Iteration 22 — Phase 7 final item: full verification gate

- Phase 7 final item: full `./scripts/verify` exit 0, `cd peek && pnpm verify` exit 0, migrations apply cleanly on a fresh dev DB, `daily-crate.csv` removed (already deleted in iteration 2).
- Test infra setup: this devcontainer's PostgreSQL listens on the Unix socket only (`/var/run/postgresql/.s.PGSQL.5432`); TCP at `localhost:5432` is closed. The integration helpers in `backend/src/__tests__/integration-test-helpers.ts` correctly fall back to a socket connection (`PGHOST` default `/var/run/postgresql`, `PGDATABASE` default `taunt_bet_dev`) when `DATABASE_URL` is unset, but `backend/.env` sets `DATABASE_URL=postgres://vscode@localhost:5432/rng_utopia_dev` which is unreachable in this environment. To run the verify gate against the socket, I (a) created an empty `taunt_bet_dev` database (`createdb taunt_bet_dev`), (b) applied all 33 backend migrations (`001_init.sql` … `033_payout_attempts.sql`) via a one-shot Node script that uses the postgres-js socket-options form, and (c) ran the verify gate with `env -u DATABASE_URL ./scripts/verify` so the integration tests pick up the socket fallback.
- Verification results:
  - `./scripts/verify` (full) — exit 0.
    - Backend TS: 38 test files / 325 tests pass; lint clean; typecheck clean.
    - Solana Anchor: 92 passing (1 pending) across flipyou, closecall, potshot, platform, fairness suites.
  - `cd peek && pnpm verify` — exit 0. 108 test files / 899 tests pass; lint clean; typecheck clean; Next.js production build succeeds (all 20 routes register).
  - Migrations applied cleanly on a fresh `taunt_bet_dev` DB (33 migrations, all committed in their own transactions; the only diagnostics surfaced were the expected NOTICE-level "already exists, skipping" lines from idempotent CREATE TABLE IF NOT EXISTS / DROP COLUMN IF EXISTS statements in earlier migrations).
  - `docs/references/daily-crate.csv` already deleted in iteration 2 (verified via `git status` showing `D docs/references/daily-crate.csv`).
- Spec Meta Status updated from `Ready` to `Done`; `NR_OF_TRIES` bumped from 21 to 22.
- All 20 implementation checklist items now `[x]`.
- Outcome: ✅ Spec 402 complete. Daily Crate ships with: 32_daily_crate.sql + 033_payout_attempts.sql migrations, code-resident dev/mainnet config registry with Zod + JCS hash, `daily-crate.ts` services (volume + tier + roll + reward hash with golden vectors), daily compute worker with race/recovery semantics, `points-grant` and `crate-sol-payout` handler extensions with idempotency, four routes (`POST /crates/daily/claim`, `GET /crates/daily/today`, `GET /crates/daily/pending`, `GET /crates/daily/configs/:version`, `GET /crates/daily/rewards/:rewardId/verify`), FR-7 reward-pool retry tail, per-round CRATE_DROP removal in `game-settled`, peek admin liability widget + runs/rewards tables + payouts-held integration with manual-retry action.
## Iteration 22 — 2026-05-09T06:14:57Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-022.log

## Devnet E2E — 2026-05-09T06:14:58Z
- **Result**: PASS

## Gap Analysis — 2026-05-09T06:30:17Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

