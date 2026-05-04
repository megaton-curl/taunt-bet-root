# Specification: [308] Referral Tiers

## Meta

| Field | Value |
|-------|-------|
| Status | Complete |
| Priority | P1 |
| Track | Extended |
| NR_OF_TRIES | 0 |

---

## Overview

Replace the flat referrer rate (1000 bps for everyone) with a **volume-based tier system** computed daily off referee wager activity. The more SOL a referrer's referees wager in a rolling window, the higher the referrer's fee share. Volume goes down → tier goes down. Tier brackets and rates are stored in a DB table operators can edit; per-user tier rows are produced by a scheduled worker.

The KOL override (`referral_kol_rates`, spec 300) is preserved as a manual partnership lever that **always wins** over the auto-tier. Resolution precedence becomes **KOL → tier → default**.

This spec is entirely off-chain. No program changes, no event-queue dependency. Settlement still snapshots the resolved rate into `referral_earnings.referrer_rate_bps`, so historical earnings are unaffected when tier defs change.

## User Stories

- As a referrer, I want my reward share to grow as my referees wager more so that high-volume referrers are compensated meaningfully.
- As a referrer, I want my tier to drop if my referees stop wagering so that the system rewards ongoing activity rather than legacy referrals.
- As an operator, I want to edit tier brackets and rates in a DB table so that I can tune the program without a deploy.
- As an operator, I want the new tier definitions to apply to all future settlements while leaving past earnings unchanged so that operator action is forward-only and auditable.
- As an engineer, I want tiers computed off-line by a worker so that settlement stays a single fast DB lookup.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Extends spec 300 (referral system). Off-chain growth tooling.
- **Current baseline fit**: Extends spec 300. No on-chain changes.
- **Planning bucket**: Extended.

## Required Context Files

- `docs/specs/300-referral-system/spec.md` — current referral system, rate resolution
- `backend/src/db/referrals.ts` — `getReferrerRate`, `recordReferralEarnings` integration point
- `backend/src/worker/settle-tx.ts` — settlement hook that calls `getReferrerRate`
- `backend/src/config.ts` — `REFERRAL_DEFAULT_RATE_BPS`, env wiring pattern
- `backend/migrations/010_referral.sql` — current referral schema (codes/links/earnings/claims/kol_rates)
- `backend/src/index.ts` — worker registration / startup wiring

## Contract Files

- New table: `referral_tier_definitions` (operator-editable brackets)
- New table: `referral_tiers` (per-user computed tier, snapshot)
- Updated: `getReferrerRate` precedence becomes KOL → tier → default
- Updated: `GET /referral/stats` response shape gains tier metadata

---

## System Invariants

1. **KOL always wins.** A row in `referral_kol_rates` for a user MUST take precedence over any tier row for the same user. The tier worker MUST NOT touch `referral_kol_rates`.
2. **Tier defs are forward-only.** Editing `referral_tier_definitions` MUST NOT alter `referral_earnings.referrer_rate_bps` for already-recorded earnings. Past earnings stay at the rate snapshotted at settlement.
3. **Settlement is a single lookup.** `recordReferralEarnings` MUST resolve the referrer's rate via one DB call and MUST NOT compute volume on the settlement path.
4. **Tier worker is idempotent.** Running the worker twice in a row with no new earnings MUST produce identical `referral_tiers` rows (same tier, same volume_lamports, refreshed `computed_at`).
5. **No retroactive demotion.** Lowering a tier in `referral_tiers` MUST NOT reduce already-recorded earnings or already-claimable balances.
6. **Inputs in lamports.** Tier thresholds and accumulated volume are stored as `BIGINT` lamports — no floating point, no USD conversion.

---

## Functional Requirements

> **Note:** Frontend is a separate project. Tier metadata exposed by `GET /referral/stats` is a backend data contract; rendering is out of scope for this spec.

### FR-1: Tier Definitions (DB-Editable)

Tier brackets and rates are stored in `referral_tier_definitions`, seeded by migration with dev defaults, editable by operators via SQL or future peek admin UI.

**Schema:**

```sql
CREATE TABLE referral_tier_definitions (
  tier                 INTEGER     PRIMARY KEY CHECK (tier BETWEEN 1 AND 4),
  min_volume_lamports  BIGINT      NOT NULL,        -- inclusive lower bound
  rate_bps             INTEGER     NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Dev seed:**

| tier | min_volume_lamports | SOL equivalent | rate_bps |
|------|---------------------|----------------|----------|
| 1    | 0                   | 0 SOL          | 1000 (10%) |
| 2    | 50_000_000          | 0.05 SOL       | 2000 (20%) |
| 3    | 100_000_000         | 0.10 SOL       | 3000 (30%) |
| 4    | 200_000_000         | 0.20 SOL       | 4000 (40%) |

(Prod thresholds will be set by operator update before launch — no env override needed.)

**Bucketing rule:** for a referrer with summed volume `V`, pick the row with the **largest `min_volume_lamports` ≤ V**. Tier 1 (`min=0`) always matches.

**Acceptance Criteria:**
- [x] Migration `029_referral_tiers.sql` creates `referral_tier_definitions` and seeds the four dev rows above.
- [x] Schema enforces `tier ∈ [1,4]` and `rate_bps ∈ [0, 10000]` via CHECK constraints.
- [x] Updating a row (changing `min_volume_lamports` or `rate_bps`) does not require a deploy; the worker reads definitions on every tick.
- [x] Editing `referral_tier_definitions` does not modify any existing `referral_earnings.referrer_rate_bps` value.

### FR-2: Per-User Tier Snapshot

`referral_tiers` is the canonical lookup the settlement path reads.

**Schema:**

```sql
CREATE TABLE referral_tiers (
  user_id          TEXT        PRIMARY KEY,
  tier             INTEGER     NOT NULL CHECK (tier BETWEEN 1 AND 4),
  rate_bps         INTEGER     NOT NULL,
  volume_lamports  BIGINT      NOT NULL,             -- summed referee wager over window
  window_days      INTEGER     NOT NULL,             -- window used to compute this row
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`rate_bps` is denormalised from the tier row at compute time so settlement does not have to join two tables.

**Acceptance Criteria:**
- [x] Migration creates `referral_tiers` with the schema above.
- [x] `user_id` is the primary key — at most one tier row per referrer.
- [x] `rate_bps` snapshot equals the `referral_tier_definitions.rate_bps` of the matched tier at compute time.

### FR-3: Tier Computation Worker

A scheduled worker recomputes tiers off the settlement hot path.

**Algorithm (per tick):**

1. Read `referral_tier_definitions` (4 rows).
2. For each `user_id` in `referral_codes` (one per existing referrer), aggregate referee wager volume from `referral_earnings`:
   ```sql
   SELECT COALESCE(SUM(wager_lamports), 0) AS volume
     FROM referral_earnings
    WHERE referrer_user_id = $user_id
      AND created_at > now() - INTERVAL '${windowDays} days';
   ```
3. Bucket `volume` against the tier definitions (largest `min_volume_lamports ≤ volume`).
4. UPSERT into `referral_tiers (user_id, tier, rate_bps, volume_lamports, window_days, computed_at)`.

**Cadence:**

- Recomputes every `REFERRAL_TIER_RECOMPUTE_HOURS` (default 24).
- **Runs once at backend startup** before serving traffic so a fresh deploy doesn't sit on stale tiers (or no tiers at all on first install).

**Window:**

- `REFERRAL_TIER_WINDOW_DAYS` env, default **2** on dev / **90** on prod.

**Acceptance Criteria:**
- [x] Worker module `backend/src/worker/referral-tier.ts` exposes `runReferralTierComputation()` and `startReferralTierWorker()`.
- [x] `startReferralTierWorker()` is registered from `backend/src/index.ts`, runs once at startup, then every `REFERRAL_TIER_RECOMPUTE_HOURS`.
- [x] Worker produces one `referral_tiers` row for every `referral_codes.user_id`, including referrers with zero volume in window (mapped to tier 1).
- [x] Worker reads definitions from DB on every tick — editing `referral_tier_definitions` between ticks changes the next computation.
- [x] Worker is idempotent: two consecutive runs with no new earnings produce identical `(tier, rate_bps, volume_lamports)` per row (only `computed_at` updates).
- [x] Worker errors are logged and do not crash the process; the next tick retries.

### FR-4: Rate Resolution Update

`getReferrerRate` precedence changes from KOL → default to **KOL → tier → default**.

**Resolution (single query preferred):**

```sql
SELECT COALESCE(
  (SELECT rate_bps FROM referral_kol_rates WHERE user_id = $1),
  (SELECT rate_bps FROM referral_tiers     WHERE user_id = $1)
) AS rate_bps;
```

If both return NULL, fall back to `defaultRateBps` (still 1000).

**Acceptance Criteria:**
- [x] `backend/src/db/referrals.ts:getReferrerRate(userId, defaultRateBps)` checks KOL first, then tier, then default.
- [x] When a user has both a KOL row and a tier row, the KOL rate is returned.
- [x] When a user has only a tier row, the tier `rate_bps` is returned.
- [x] When a user has neither, `defaultRateBps` is returned.
- [x] `recordReferralEarnings` continues to snapshot the resolved rate into `referral_earnings.referrer_rate_bps` — no schema change.

### FR-5: Stats Endpoint Augmentation

`GET /referral/stats` (spec 300, FR-7) gains tier metadata so the player-facing dashboard can show "you are tier 2; 0.04 SOL of activity from referees in the last 2 days; reach 0.05 SOL for tier 3."

**Response additions:**

```ts
{
  // ... existing fields (referredCount, activeCount, totalVolumeLamports, totalEarnedLamports, pendingLamports)
  tier: {
    current: 1 | 2 | 3 | 4,
    rateBps: number,                    // resolved rate (KOL > tier > default)
    source: "kol" | "tier" | "default", // which precedence layer answered
    windowDays: number,                 // current window setting
    volumeLamports: string,             // referee wager in window
    nextTier: { tier: number; minVolumeLamports: string; rateBps: number } | null
  }
}
```

`source: "default"` covers brand-new referrers whose tier worker hasn't run yet (or who exist before first compute).

**Acceptance Criteria:**
- [x] Response includes `tier` object with all six fields.
- [x] `current` matches the user's `referral_tiers.tier`, or `1` when no row exists.
- [x] `rateBps` matches the resolution that settlement would use right now.
- [x] `source` correctly reports `"kol"` / `"tier"` / `"default"`.
- [x] `nextTier` is `null` when the user is already at the top tier; otherwise the immediate next bracket.
- [x] All lamport values are JSON strings (not numbers).

### FR-6: Configuration

Two env vars only — tier brackets and rates live in DB (FR-1).

| Env | Default (dev) | Default (prod) | Purpose |
|-----|---------------|----------------|---------|
| `REFERRAL_TIER_WINDOW_DAYS` | `2` | `90` | Lookback for referee wager volume |
| `REFERRAL_TIER_RECOMPUTE_HOURS` | `24` | `24` | Worker tick interval |

**Acceptance Criteria:**
- [x] Both env vars are wired through `backend/src/config.ts` with defaults above.
- [x] Bounds validation: window in `[1, 365]`, recompute hours in `[1, 168]`. Out-of-range values fall back to default with a logged warning.
- [x] `.do/app-dev.yaml` and `.do/app-prod.yaml` are updated per the App Platform env contract (backend/CLAUDE.md).

### FR-7: Tests

**Unit:**

- [x] Bucketing function: `(volume, defs) → tier` covers boundaries (V=0 → tier 1; V exactly at min of tier 2 → tier 2; V between tier 3 min and tier 4 min → tier 3; V huge → tier 4).
- [x] `getReferrerRate` precedence: KOL only, tier only, both (KOL wins), neither (default).

**Integration:**

- [x] Settle several games for a referrer's referees totalling > tier-3 threshold → run worker → `referral_tiers` shows tier 3 → resolve rate → next settlement snapshots tier-3 `rate_bps`.
- [x] Update `referral_tier_definitions` (raise tier-3 threshold) → run worker again → referrer demoted to tier 2 → new settlements use tier-2 rate; pre-update `referral_earnings` rows unchanged.
- [x] Worker idempotency: run twice, assert `(tier, rate_bps, volume_lamports)` unchanged.
- [x] On-boot run: start backend with no `referral_tiers` rows → after init, every existing `referral_codes` user has a row.

---

## Success Criteria

- A referrer's tier reflects the SUM of their referees' settled wagers in the configured window, bucketed against the DB-driven definitions.
- Operators can edit `referral_tier_definitions` without a deploy; changes apply to future settlements only.
- KOL overrides continue to win over auto-computed tiers.
- Settlement latency is unaffected — tier resolution is a single indexed read.
- A fresh backend boot produces correct tiers before any new settlements occur.

---

## Dependencies

- Spec 300 (referral system) — `referral_codes`, `referral_links`, `referral_earnings`, `referral_kol_rates`, `getReferrerRate`, `recordReferralEarnings`.
- Existing `idx_referral_earnings_referrer (referrer_user_id, created_at)` index — covers the worker's volume aggregation query.

## Assumptions

- Referrer count stays small enough (< ~10k) that a full re-bucket per tick is trivial. If we ever exceed that, switch to incremental updates keyed off recently-touched referrers.
- Refund / cancellation paths do not write to `referral_earnings` (they bypass `recordReferralEarnings`), so refunded wagers correctly do not count toward tier volume.
- SOL price volatility is acceptable as tier currency — denominating in SOL means a referrer's tier is stable in lamports terms even if USD value swings.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Migration seeds tier defs | Run migration, `SELECT * FROM referral_tier_definitions` | 4 rows with dev defaults |
| 2 | Bucketing correct at boundaries | Unit test | Test output |
| 3 | Worker writes one row per referrer | Integration test with N referral_codes | `COUNT(*)` matches |
| 4 | KOL beats tier | Integration test | `getReferrerRate` returns KOL rate |
| 5 | Editing defs is forward-only | Integration test (update threshold mid-run) | Old `referral_earnings.referrer_rate_bps` unchanged |
| 6 | Worker idempotent | Run twice, diff rows | Identical `(tier, rate_bps, volume_lamports)` |
| 7 | On-boot compute | Start backend with empty `referral_tiers` | Rows present before first request |
| 8 | Stats endpoint includes tier block | API test | Response shape matches |
| 9 | Settlement uses resolved rate | Integration test: settle game, inspect `referral_earnings.referrer_rate_bps` | Snapshot equals resolution at that moment |

---

## Completion Signal

### Implementation Checklist

#### Backend — Schema
- [x] [backend] Migration `backend/migrations/029_referral_tiers.sql`: `CREATE TABLE referral_tier_definitions` (PK `tier`, CHECKs on `tier ∈ [1,4]` and `rate_bps ∈ [0,10000]`, `min_volume_lamports BIGINT NOT NULL`, `updated_at TIMESTAMPTZ`) seeded with the four dev rows from FR-1; `CREATE TABLE referral_tiers` (PK `user_id`, `tier INT CHECK (1..4)`, `rate_bps INT`, `volume_lamports BIGINT`, `window_days INT`, `computed_at TIMESTAMPTZ`). Migration runs and is idempotent on re-run (FR-1, FR-2).

#### Backend — Pure Helper (Unit-Testable)
- [x] [backend] Pure function `bucketTier(volumeLamports: bigint, definitions: TierDefinition[])` in `backend/src/worker/referral-tier.ts` returning `{ tier, rateBps, nextTier: { tier, minVolumeLamports, rateBps } | null }`. Picks the row with the largest `min_volume_lamports ≤ volume`. Exported for unit testing without DB (FR-3).

#### Backend — DB Methods
- [x] [backend] In `backend/src/db/referrals.ts`, add to the `ReferralsRepo` interface and implementation: `getTierDefinitions(): Promise<TierDefinition[]>` (single SELECT ordered by `tier ASC`) and `getTierRow(userId): Promise<TierRow | null>`. Add `TierDefinition` and `TierRow` row types (FR-3).
- [x] [backend] Add `getReferrerVolumeLamports(userId, windowDays): Promise<bigint>` to `backend/src/db/referrals.ts` — single `SELECT COALESCE(SUM(wager_lamports), 0) FROM referral_earnings WHERE referrer_user_id = $1 AND created_at > now() - INTERVAL '$2 days'`. Uses existing `idx_referral_earnings_referrer (referrer_user_id, created_at)` index (FR-3).
- [x] [backend] Add `upsertTierRow(userId, tier, rateBps, volumeLamports, windowDays)` to `backend/src/db/referrals.ts` — `INSERT … ON CONFLICT (user_id) DO UPDATE` setting all columns plus `computed_at = now()` (FR-3).
- [x] [backend] Update `getReferrerRate(userId, defaultRateBps)` in `backend/src/db/referrals.ts` to a single COALESCE query: `SELECT COALESCE((SELECT rate_bps FROM referral_kol_rates WHERE user_id = $1), (SELECT rate_bps FROM referral_tiers WHERE user_id = $1))` then fall back to `defaultRateBps` if NULL. No interface signature change (FR-4).

#### Backend — Worker
- [x] [backend] In `backend/src/worker/referral-tier.ts`, implement `runReferralTierComputation(db)`: read defs, list `referral_codes.user_id` set, for each compute volume + bucket + UPSERT. Wrap the whole tick in a `pg_try_advisory_lock(<stable-key>)` so multi-replica deployments don't double-compute; if the lock isn't acquired, log and skip (FR-3).
- [x] [backend] In the same file, implement `startReferralTierWorker(db, { windowDays, recomputeHours })`: invoke `runReferralTierComputation` once at startup (await — blocks readiness), then schedule a `setInterval` at `recomputeHours`. Errors logged via existing logger; never crashes the process (FR-3).
- [x] [backend] Register `startReferralTierWorker` in `backend/src/index.ts` startup sequence — `await` the boot run before `app.fetch` is exposed / Node listens (FR-3).

#### Backend — Config
- [x] [backend] Add `REFERRAL_TIER_WINDOW_DAYS` (default 2 dev / 90 prod) and `REFERRAL_TIER_RECOMPUTE_HOURS` (default 24) to `backend/src/config.ts` following the `REFERRAL_DEFAULT_RATE_BPS` pattern. Bounds: window in `[1,365]`, recompute in `[1,168]`; out-of-range → fall back to default with `console.warn` (FR-6).
- [x] [backend] Update `.do/app-dev.yaml` and `.do/app-prod.yaml` to declare both new env vars per the App Platform env contract (`backend/CLAUDE.md`) (FR-6).

#### Backend — API
- [x] [backend] Extend `ReferralStatsSchema` in `backend/src/contracts/validators.ts` with a required `tier` object: `{ current: 1|2|3|4, rateBps: int, source: "kol"|"tier"|"default", windowDays: int, volumeLamports: LamportsString, nextTier: { tier, minVolumeLamports, rateBps } | null }` (FR-5).
- [x] [backend] Update `GET /referral/stats` handler in `backend/src/routes/referral.ts` to populate the `tier` block: resolve via KOL → tier → default (mirroring `getReferrerRate`), read `referral_tiers` for `volumeLamports` (default `"0"` when missing), compute `nextTier` from `referral_tier_definitions`. `source` reflects which layer answered. Update `referral-routes.test.ts` to assert the new shape (FR-5).

#### Tests
- [x] [test] Unit tests for `bucketTier` in `backend/src/worker/__tests__/referral-tier.test.ts`: V=0 → tier 1; V exactly at tier 2 min → tier 2; V between tier 2 and tier 3 mins → tier 2; V huge → tier 4; `nextTier` is null at top tier (FR-7).
- [x] [test] Unit tests for `getReferrerRate` precedence in `backend/src/__tests__/referrals.test.ts` (or extend existing): KOL only → KOL rate; tier only → tier rate; both rows present → KOL wins; neither → defaultRateBps (FR-7).
- [x] [test] Integration test in `backend/src/__tests__/referral-tier-integration.test.ts`: seed referral_codes + referral_links, insert referral_earnings totalling > tier-2 threshold, run `runReferralTierComputation`, assert `referral_tiers` row has `tier=2, rate_bps=2000, volume_lamports` matching, then call `getReferrerRate` and assert it returns 2000 (FR-7).
- [x] [test] Forward-only test in the same file: run worker → snapshot `referral_earnings.referrer_rate_bps` for an existing row → `UPDATE referral_tier_definitions SET min_volume_lamports = ... WHERE tier = 2` → run worker again → assert that existing row is unchanged AND that a fresh `getReferrerRate` reflects the new bracket (FR-7).
- [x] [test] Idempotency test in the same file: run worker twice with no new earnings → assert all `referral_tiers` rows have identical `(tier, rate_bps, volume_lamports, window_days)` between runs (only `computed_at` updates) (FR-7).
- [x] [test] On-boot test in the same file: with empty `referral_tiers` and N seeded `referral_codes` rows, call `runReferralTierComputation` once → `SELECT COUNT(*) FROM referral_tiers` equals N (zero-volume referrers get tier 1 rows) (FR-7).
- [x] [test] Stats endpoint test: extend `referral-routes.test.ts` with cases asserting `tier` block shape for (a) referrer with KOL row (`source: "kol"`), (b) referrer with tier row only (`source: "tier"`), (c) brand-new referrer with no rows (`source: "default"`, `volumeLamports: "0"`, `nextTier` populated from defs) (FR-5).
- [x] [test] Mark `e2e/local/**` and `e2e/visual/**` coverage **N/A** — backend-only spec, no frontend surface (frontend is a separate repo per project rules).
- [x] [test] Mark `e2e/devnet/**` coverage **N/A** — no on-chain program changes, no external provider/oracle/VRF integration.

### Testing Requirements

#### Code Quality
- [x] All existing tests pass (`pnpm test` in `backend/`)
- [x] No lint errors (`pnpm lint` in `backend/`)
- [x] Typecheck clean (`pnpm typecheck` in `backend/`)

#### Functional Verification
- [x] All FR acceptance criteria verified
- [x] KOL precedence preserved
- [x] Worker boot + interval both verified

#### Smoke Test
- [x] Set up two test users; user A refers user B; user B wagers > tier-2 threshold; run worker; verify A's `getReferrerRate` returns 2000 bps; settle one more wager; verify `referral_earnings.referrer_rate_bps` row records 2000.
- [x] `UPDATE referral_tier_definitions SET min_volume_lamports = ... WHERE tier = 2`; re-run worker; verify A's tier row reflects new bracket; old earning row unchanged.

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
`/gap-analysis 308 --non-interactive` which audits each FR acceptance criterion against the
codebase, writes `docs/specs/308-referral-tiers/gap-analysis.md`, and annotates checkboxes with
`<!-- satisfied: ... -->` / `<!-- gap: ... -->` evidence.

---

## Deferred / Out of Scope

- **Manual recompute trigger** — peek admin button or CLI script to force a worker tick after editing tier defs. Workaround for v1: restart the backend (on-boot run handles it) or wait up to `REFERRAL_TIER_RECOMPUTE_HOURS`.
- **Tier history / time-series** — `referral_tiers` is single-row-per-user. If we want to chart tier over time, append-only `referral_tier_history` is a follow-up.
- **Frontend rendering** of tier metadata in the referral dashboard — separate frontend project.
- **Peek admin UI** for editing `referral_tier_definitions` — direct SQL is the v1 interface; peek surface is a follow-up.
- **Per-game-type tier weighting** — currently all `referral_earnings.wager_lamports` count equally regardless of `game_type`. If we want flipyou wagers to count more than closecall, that's a future change.

---

## Key Decisions

- **Separate `referral_tiers` table, not `referral_kol_rates` reuse** — keeps manual KOL overrides isolated from auto-computed tiers; worker never touches KOL rows.
- **Tier defs in DB, not env** — operator can tune brackets/rates without a deploy; only operational knobs (window, recompute interval) live in env.
- **Forward-only effect** — `referral_earnings.referrer_rate_bps` is already a per-row snapshot, so editing tier defs never rewrites history.
- **SOL-denominated thresholds** — eliminates SOL/USD price oracle dependency on the tier path; tier stability matches the system's lamport-native accounting.
- **On-boot run** — guarantees fresh deploys / first-install have correct tiers before serving traffic.
- **KOL > tier > default precedence** — partnership deals are honoured even if a KOL's referees go quiet.
