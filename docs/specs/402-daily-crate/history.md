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

