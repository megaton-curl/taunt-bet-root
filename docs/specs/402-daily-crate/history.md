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

