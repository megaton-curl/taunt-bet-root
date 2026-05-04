# Referral Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 1000 bps referrer rate with a volume-based 4-tier system computed daily off referee wager activity, while preserving the manual KOL override as a partnership lever that always wins.

**Architecture:** Two new tables — `referral_tier_definitions` (operator-editable brackets, seeded by migration) and `referral_tiers` (per-user computed snapshot). A scheduled worker reads earnings volume per referrer over a configurable window, buckets into a tier via a pure helper, writes the rate snapshot. Settlement reads the resolved rate via the existing `getReferrerRate` (extended to KOL → tier → default). Tier-definition edits are forward-only because settlement already snapshots `referrer_rate_bps` per earning row.

**Tech Stack:** PostgreSQL 16 (postgres.js), Hono + `@hono/zod-openapi`, vitest, Node 24.

**Spec:** `docs/specs/308-referral-tiers/spec.md`

---

## File Structure

**New files:**
- `backend/migrations/029_referral_tiers.sql` — schema for both tables + dev seed for tier defs.
- `backend/src/worker/referral-tier.ts` — `bucketTier` pure helper, `runReferralTierComputation`, `startReferralTierWorker`.
- `backend/src/worker/__tests__/referral-tier.test.ts` — unit tests for `bucketTier`.
- `backend/src/__tests__/referral-tier-integration.test.ts` — integration tests for DB methods, worker, precedence, idempotency, forward-only.

**Modified files:**
- `backend/src/db/referrals.ts` — add `TierDefinition`/`TierRow` types, interface methods, implementations; rewrite `getReferrerRate` precedence.
- `backend/src/config.ts` — add `referralTierWindowDays`, `referralTierRecomputeHours`.
- `backend/src/contracts/validators.ts` — extend `ReferralStatsSchema` with a `tier` block.
- `backend/src/routes/referral.ts` — populate the new `tier` block in `GET /referral/stats`.
- `backend/src/__tests__/referral-routes.test.ts` — add new tables to inline `beforeAll` schema; assert `tier` block.
- `backend/src/index.ts` — wire `startReferralTierWorker` into startup.
- `backend/.do/app-dev.yaml`, `backend/.do/app-prod.yaml` — declare both new env vars.

---

## Task 1: Migration — schema and seed

**Files:**
- Create: `backend/migrations/029_referral_tiers.sql`

- [ ] **Step 1: Confirm `028` is the latest migration**

```bash
ls backend/migrations/ | tail -3
```

Expected: `028_payout_controls.sql` is the highest. If a higher number exists, bump to the next free number throughout this plan.

- [ ] **Step 2: Write the migration file**

```sql
-- 029_referral_tiers.sql — Volume-based referral tier system (spec 308).
-- Adds operator-editable tier brackets and a per-user computed snapshot
-- that the settlement path reads via getReferrerRate (KOL > tier > default).

CREATE TABLE referral_tier_definitions (
  tier                 INTEGER     PRIMARY KEY CHECK (tier BETWEEN 1 AND 4),
  min_volume_lamports  BIGINT      NOT NULL CHECK (min_volume_lamports >= 0),
  rate_bps             INTEGER     NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dev seed. Prod operators tune via UPDATE before launch.
--   tier 1: 0      lamports → 1000 bps (10%)
--   tier 2: 0.05   SOL      → 2000 bps (20%)
--   tier 3: 0.10   SOL      → 3000 bps (30%)
--   tier 4: 0.20   SOL      → 4000 bps (40%)
INSERT INTO referral_tier_definitions (tier, min_volume_lamports, rate_bps) VALUES
  (1,           0, 1000),
  (2,  50000000,  2000),
  (3, 100000000,  3000),
  (4, 200000000,  4000);

CREATE TABLE referral_tiers (
  user_id          TEXT        PRIMARY KEY,
  tier             INTEGER     NOT NULL CHECK (tier BETWEEN 1 AND 4),
  rate_bps         INTEGER     NOT NULL,
  volume_lamports  BIGINT      NOT NULL,
  window_days      INTEGER     NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Run the migration locally**

```bash
cd backend && pnpm migrate
```

Expected: `Applied 029_referral_tiers.sql`. Re-running prints `Already up to date` (idempotent).

- [ ] **Step 4: Verify the seed**

```bash
psql $DATABASE_URL -c "SELECT tier, min_volume_lamports, rate_bps FROM referral_tier_definitions ORDER BY tier"
```

Expected: 4 rows with values `(1, 0, 1000)`, `(2, 50000000, 2000)`, `(3, 100000000, 3000)`, `(4, 200000000, 4000)`.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/029_referral_tiers.sql
git commit -m "spec(308-referral-tiers): add migration for tier definitions and per-user tier table"
```

---

## Task 2: Add new tables to existing test fixture

The `referral-routes.test.ts` suite inlines schema in `beforeAll` rather than running migrations. Subsequent tasks will update `getReferrerRate` to read `referral_tiers`, so the inline schema must already include the new tables before that change lands. Adding them now keeps existing tests green throughout the rest of the plan.

**Files:**
- Modify: `backend/src/__tests__/referral-routes.test.ts:117-209`

- [ ] **Step 1: Extend the `DROP TABLE` in beforeAll**

Replace the existing line 117-118:

```ts
    await rawSql`
      DROP TABLE IF EXISTS referral_claims, referral_earnings, referral_links, referral_codes, referral_kol_rates CASCADE
    `;
```

With:

```ts
    await rawSql`
      DROP TABLE IF EXISTS referral_tiers, referral_tier_definitions, referral_claims, referral_earnings, referral_links, referral_codes, referral_kol_rates CASCADE
    `;
```

- [ ] **Step 2: Add table creation after `referral_kol_rates` block (line ~208)**

Append after the `CREATE TABLE referral_kol_rates ...` template:

```ts
    await rawSql`
      CREATE TABLE referral_tier_definitions (
        tier INTEGER PRIMARY KEY CHECK (tier BETWEEN 1 AND 4),
        min_volume_lamports BIGINT NOT NULL CHECK (min_volume_lamports >= 0),
        rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await rawSql`
      INSERT INTO referral_tier_definitions (tier, min_volume_lamports, rate_bps) VALUES
        (1, 0, 1000),
        (2, 50000000, 2000),
        (3, 100000000, 3000),
        (4, 200000000, 4000)
    `;
    await rawSql`
      CREATE TABLE referral_tiers (
        user_id TEXT PRIMARY KEY,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
        rate_bps INTEGER NOT NULL,
        volume_lamports BIGINT NOT NULL,
        window_days INTEGER NOT NULL,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
```

- [ ] **Step 3: Add new tables to the `TRUNCATE` in beforeEach (line ~217)**

Replace:

```ts
    await rawSql`TRUNCATE referral_codes, referral_links, referral_earnings, referral_claims, referral_kol_rates, event_queue, fee_allocation_events, fee_bucket_debits RESTART IDENTITY CASCADE`;
```

With:

```ts
    await rawSql`TRUNCATE referral_tiers, referral_codes, referral_links, referral_earnings, referral_claims, referral_kol_rates, event_queue, fee_allocation_events, fee_bucket_debits RESTART IDENTITY CASCADE`;
```

(Note: do NOT truncate `referral_tier_definitions` — its seed data is what `bucketTier` and the worker depend on.)

- [ ] **Step 4: Run the suite to confirm no regressions**

```bash
cd backend && pnpm vitest run src/__tests__/referral-routes.test.ts
```

Expected: all tests pass. New tables are present but unused so far.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/referral-routes.test.ts
git commit -m "spec(308-referral-tiers): add tier tables to referral-routes test fixture"
```

---

## Task 3: `bucketTier` pure helper (TDD)

A pure function that takes a volume and tier definitions and returns the matched tier + rate + next-tier preview. Unit-testable without DB.

**Files:**
- Create: `backend/src/worker/referral-tier.ts`
- Create: `backend/src/worker/__tests__/referral-tier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/worker/__tests__/referral-tier.test.ts
import { describe, it, expect } from "vitest";
import { bucketTier, type TierDefinition } from "../referral-tier.js";

const DEFS: TierDefinition[] = [
  { tier: 1, min_volume_lamports: 0,         rate_bps: 1000 },
  { tier: 2, min_volume_lamports: 50_000_000,  rate_bps: 2000 },
  { tier: 3, min_volume_lamports: 100_000_000, rate_bps: 3000 },
  { tier: 4, min_volume_lamports: 200_000_000, rate_bps: 4000 },
];

describe("bucketTier", () => {
  it("returns tier 1 for zero volume", () => {
    const r = bucketTier(0, DEFS);
    expect(r.tier).toBe(1);
    expect(r.rateBps).toBe(1000);
    expect(r.nextTier).toEqual({ tier: 2, minVolumeLamports: 50_000_000, rateBps: 2000 });
  });

  it("returns tier 2 exactly at the tier-2 boundary", () => {
    const r = bucketTier(50_000_000, DEFS);
    expect(r.tier).toBe(2);
    expect(r.rateBps).toBe(2000);
    expect(r.nextTier?.tier).toBe(3);
  });

  it("stays in tier 2 between tier-2 and tier-3 mins", () => {
    const r = bucketTier(99_999_999, DEFS);
    expect(r.tier).toBe(2);
  });

  it("returns tier 4 with no nextTier at the top", () => {
    const r = bucketTier(1_000_000_000, DEFS);
    expect(r.tier).toBe(4);
    expect(r.rateBps).toBe(4000);
    expect(r.nextTier).toBeNull();
  });

  it("throws when definitions array is empty", () => {
    expect(() => bucketTier(0, [])).toThrow(/no tier definitions/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pnpm vitest run src/worker/__tests__/referral-tier.test.ts
```

Expected: FAIL — module `../referral-tier.js` not found.

- [ ] **Step 3: Implement the helper**

```ts
// backend/src/worker/referral-tier.ts
//
// Volume-based referral tier system (spec 308).
// `bucketTier` is a pure helper — testable in isolation.
// `runReferralTierComputation` and `startReferralTierWorker` follow in later tasks.

export interface TierDefinition {
  tier: number;
  min_volume_lamports: number;
  rate_bps: number;
}

export interface BucketResult {
  tier: number;
  rateBps: number;
  nextTier: { tier: number; minVolumeLamports: number; rateBps: number } | null;
}

/**
 * Pick the tier whose `min_volume_lamports` is the largest value not exceeding
 * `volumeLamports`. Definitions are expected to be a complete set covering 1..4
 * but the function tolerates any non-empty ascending or descending list.
 */
export function bucketTier(volumeLamports: number, definitions: TierDefinition[]): BucketResult {
  if (definitions.length === 0) {
    throw new Error("bucketTier: no tier definitions provided");
  }

  const sorted = [...definitions].sort((a, b) => a.min_volume_lamports - b.min_volume_lamports);

  let matchedIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.min_volume_lamports <= volumeLamports) {
      matchedIdx = i;
    } else {
      break;
    }
  }

  const matched = sorted[matchedIdx]!;
  const next = sorted[matchedIdx + 1];

  return {
    tier: matched.tier,
    rateBps: matched.rate_bps,
    nextTier: next
      ? { tier: next.tier, minVolumeLamports: next.min_volume_lamports, rateBps: next.rate_bps }
      : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pnpm vitest run src/worker/__tests__/referral-tier.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/worker/referral-tier.ts backend/src/worker/__tests__/referral-tier.test.ts
git commit -m "spec(308-referral-tiers): add bucketTier pure helper with unit tests"
```

---

## Task 4: Tier DB types + interface skeleton

Add type definitions and `ReferralsDb` interface methods. Implementations follow in tasks 5-7.

**Files:**
- Modify: `backend/src/db/referrals.ts:1-67` (types) and `:70-193` (interface) and `:214-459` (impl)

- [ ] **Step 1: Add row types after `ReferralClaim` (line ~64)**

Append in the Types section:

```ts
export interface TierDefinitionRow {
  tier: number;
  min_volume_lamports: number;
  rate_bps: number;
  updated_at: Date;
}

export interface TierRow {
  user_id: string;
  tier: number;
  rate_bps: number;
  volume_lamports: number;
  window_days: number;
  computed_at: Date;
}
```

- [ ] **Step 2: Add interface methods before the closing `}` of `ReferralsDb` (line ~193)**

Insert before the closing brace of `interface ReferralsDb`:

```ts
  /**
   * Read all tier definitions ordered by tier ascending.
   * Returned rows drive `bucketTier` resolution in the worker and the stats endpoint.
   */
  getTierDefinitions(): Promise<TierDefinitionRow[]>;

  /** Read a referrer's current tier snapshot, or undefined if not yet computed. */
  getTierRow(userId: string): Promise<TierRow | undefined>;

  /**
   * Sum referee wager_lamports written to referral_earnings within the lookback window.
   * Window is inclusive: `created_at > now() - INTERVAL 'windowDays days'`.
   */
  getReferrerVolumeLamports(userId: string, windowDays: number): Promise<number>;

  /** UPSERT a per-user tier row. `computed_at` is refreshed to now() on every call. */
  upsertTierRow(params: {
    userId: string;
    tier: number;
    rateBps: number;
    volumeLamports: number;
    windowDays: number;
  }): Promise<TierRow>;
```

- [ ] **Step 3: Add type exports**

In the existing `export type` line in `backend/src/db.ts:19`:

```ts
export type { ReferralCode, ReferralLink, ReferralEarning, ReferralStats, ReferralClaim, ReferralsDb, TierDefinitionRow, TierRow } from "./db/referrals.js";
```

- [ ] **Step 4: Add skeleton implementations before the closing `};` of `createReferralsDb` (line ~458)**

Insert before the closing `};` of the returned object:

```ts
    async getTierDefinitions() {
      throw new Error("not implemented");
    },

    async getTierRow(_userId) {
      throw new Error("not implemented");
    },

    async getReferrerVolumeLamports(_userId, _windowDays) {
      throw new Error("not implemented");
    },

    async upsertTierRow(_params) {
      throw new Error("not implemented");
    },
```

- [ ] **Step 5: Verify typecheck passes**

```bash
cd backend && pnpm typecheck
```

Expected: no type errors. Existing tests don't call the new methods so runtime is unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/referrals.ts backend/src/db.ts
git commit -m "spec(308-referral-tiers): add tier DB types and interface skeleton"
```

---

## Task 5: Implement `getTierDefinitions`

Replace the skeleton with a real query and verify with an integration test.

**Files:**
- Create: `backend/src/__tests__/referral-tier-integration.test.ts`
- Modify: `backend/src/db/referrals.ts` (replace skeleton)

- [ ] **Step 1: Write the failing integration test**

```ts
// backend/src/__tests__/referral-tier-integration.test.ts
//
// Integration tests for the spec-308 tier system. Uses the same real-Postgres
// pattern as referral-routes.test.ts — inline schema in beforeAll, TRUNCATE in
// beforeEach, full referrals subset of the Db interface available.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import postgres from "postgres";
import { createDb, type Db } from "../db.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://vscode@localhost:5432/taunt_bet_dev";

function makeSql() {
  if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL);
  return postgres({
    host: "/var/run/postgresql",
    user: "vscode",
    database: "taunt_bet_dev",
  });
}

describe("Referral tier integration", () => {
  let rawSql: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(async () => {
    rawSql = makeSql();
    await rawSql`
      DROP TABLE IF EXISTS referral_tiers, referral_tier_definitions, referral_earnings, referral_links, referral_codes, referral_kol_rates CASCADE
    `;
    await rawSql`
      CREATE TABLE referral_codes (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        wallet TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await rawSql`
      CREATE TABLE referral_links (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        referee_user_id TEXT NOT NULL UNIQUE,
        referrer_wallet TEXT NOT NULL,
        referee_wallet TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await rawSql`
      CREATE TABLE referral_earnings (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        referee_user_id TEXT NOT NULL,
        referrer_wallet TEXT NOT NULL,
        referee_wallet TEXT NOT NULL,
        round_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        wager_lamports BIGINT NOT NULL,
        fee_lamports BIGINT NOT NULL,
        referrer_earned_lamports BIGINT NOT NULL,
        referrer_rate_bps INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_referral_earnings_referee_round UNIQUE (referee_user_id, round_id)
      )
    `;
    await rawSql`
      CREATE INDEX idx_referral_earnings_referrer ON referral_earnings (referrer_user_id, created_at)
    `;
    await rawSql`
      CREATE TABLE referral_kol_rates (
        user_id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL UNIQUE,
        rate_bps INTEGER NOT NULL,
        set_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await rawSql`
      CREATE TABLE referral_tier_definitions (
        tier INTEGER PRIMARY KEY CHECK (tier BETWEEN 1 AND 4),
        min_volume_lamports BIGINT NOT NULL CHECK (min_volume_lamports >= 0),
        rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await rawSql`
      INSERT INTO referral_tier_definitions (tier, min_volume_lamports, rate_bps) VALUES
        (1, 0, 1000),
        (2, 50000000, 2000),
        (3, 100000000, 3000),
        (4, 200000000, 4000)
    `;
    await rawSql`
      CREATE TABLE referral_tiers (
        user_id TEXT PRIMARY KEY,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
        rate_bps INTEGER NOT NULL,
        volume_lamports BIGINT NOT NULL,
        window_days INTEGER NOT NULL,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    db = createDb(DATABASE_URL, rawSql);
  });

  afterAll(async () => {
    if (db) await db.close();
    await rawSql.end();
  });

  beforeEach(async () => {
    await rawSql`TRUNCATE referral_tiers, referral_codes, referral_links, referral_earnings, referral_kol_rates RESTART IDENTITY CASCADE`;
  });

  describe("getTierDefinitions", () => {
    it("returns the four seeded tier rows ordered by tier", async () => {
      const defs = await db.getTierDefinitions();
      expect(defs).toHaveLength(4);
      expect(defs.map((d) => d.tier)).toEqual([1, 2, 3, 4]);
      expect(defs[0]!.min_volume_lamports).toBe(0);
      expect(defs[0]!.rate_bps).toBe(1000);
      expect(defs[3]!.min_volume_lamports).toBe(200_000_000);
      expect(defs[3]!.rate_bps).toBe(4000);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: FAIL with "not implemented".

- [ ] **Step 3: Replace the skeleton with the real implementation**

In `backend/src/db/referrals.ts`, replace:

```ts
    async getTierDefinitions() {
      throw new Error("not implemented");
    },
```

With:

```ts
    async getTierDefinitions() {
      const rows = await sql<TierDefinitionRow[]>`
        SELECT tier, min_volume_lamports, rate_bps, updated_at
          FROM referral_tier_definitions
         ORDER BY tier ASC
      `;
      return rows.map((row) => ({
        ...row,
        min_volume_lamports: Number(row.min_volume_lamports),
        rate_bps: Number(row.rate_bps),
      }));
    },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/db/referrals.ts
git commit -m "spec(308-referral-tiers): implement getTierDefinitions"
```

---

## Task 6: Implement `getTierRow` and `upsertTierRow`

These two methods are paired — write both tests first, implement both.

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)
- Modify: `backend/src/db/referrals.ts` (replace skeletons)

- [ ] **Step 1: Append failing tests**

Inside the existing `describe("Referral tier integration", () => { … })`, append:

```ts
  describe("upsertTierRow + getTierRow", () => {
    it("inserts a tier row and reads it back", async () => {
      const upserted = await db.upsertTierRow({
        userId: "usr_a",
        tier: 2,
        rateBps: 2000,
        volumeLamports: 75_000_000,
        windowDays: 90,
      });
      expect(upserted.user_id).toBe("usr_a");
      expect(upserted.tier).toBe(2);

      const fetched = await db.getTierRow("usr_a");
      expect(fetched).toBeDefined();
      expect(fetched!.rate_bps).toBe(2000);
      expect(fetched!.volume_lamports).toBe(75_000_000);
      expect(fetched!.window_days).toBe(90);
    });

    it("updates an existing row on conflict", async () => {
      await db.upsertTierRow({
        userId: "usr_b",
        tier: 1,
        rateBps: 1000,
        volumeLamports: 0,
        windowDays: 90,
      });
      await db.upsertTierRow({
        userId: "usr_b",
        tier: 3,
        rateBps: 3000,
        volumeLamports: 150_000_000,
        windowDays: 90,
      });

      const fetched = await db.getTierRow("usr_b");
      expect(fetched!.tier).toBe(3);
      expect(fetched!.rate_bps).toBe(3000);
      expect(fetched!.volume_lamports).toBe(150_000_000);
    });

    it("getTierRow returns undefined when no row exists", async () => {
      const fetched = await db.getTierRow("usr_nonexistent");
      expect(fetched).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: FAILs with "not implemented".

- [ ] **Step 3: Implement both methods**

Replace the two skeletons in `backend/src/db/referrals.ts`:

```ts
    async getTierRow(userId) {
      const rows = await sql<TierRow[]>`
        SELECT user_id, tier, rate_bps, volume_lamports, window_days, computed_at
          FROM referral_tiers
         WHERE user_id = ${userId}
      `;
      const row = rows[0];
      if (!row) return undefined;
      return {
        ...row,
        rate_bps: Number(row.rate_bps),
        volume_lamports: Number(row.volume_lamports),
        window_days: Number(row.window_days),
      };
    },

    async upsertTierRow(params) {
      const rows = await sql<TierRow[]>`
        INSERT INTO referral_tiers (user_id, tier, rate_bps, volume_lamports, window_days, computed_at)
        VALUES (${params.userId}, ${params.tier}, ${params.rateBps}, ${params.volumeLamports}, ${params.windowDays}, now())
        ON CONFLICT (user_id) DO UPDATE SET
          tier            = EXCLUDED.tier,
          rate_bps        = EXCLUDED.rate_bps,
          volume_lamports = EXCLUDED.volume_lamports,
          window_days     = EXCLUDED.window_days,
          computed_at     = now()
        RETURNING user_id, tier, rate_bps, volume_lamports, window_days, computed_at
      `;
      const row = rows[0]!;
      return {
        ...row,
        rate_bps: Number(row.rate_bps),
        volume_lamports: Number(row.volume_lamports),
        window_days: Number(row.window_days),
      };
    },
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: 4 passed (1 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/db/referrals.ts
git commit -m "spec(308-referral-tiers): implement getTierRow and upsertTierRow"
```

---

## Task 7: Implement `getReferrerVolumeLamports`

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)
- Modify: `backend/src/db/referrals.ts` (replace skeleton)

- [ ] **Step 1: Append failing test**

Inside the existing describe block, append:

```ts
  describe("getReferrerVolumeLamports", () => {
    it("sums wager_lamports for a referrer within the window", async () => {
      // Three earnings rows, all within window: 30M + 40M + 50M = 120M lamports
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps
        ) VALUES
          ('usr_ref', 'usr_e1', 'wref', 'we1', 'r1', 'flipyou', 30000000, 1500000, 150000, 1000),
          ('usr_ref', 'usr_e2', 'wref', 'we2', 'r2', 'flipyou', 40000000, 2000000, 200000, 1000),
          ('usr_ref', 'usr_e3', 'wref', 'we3', 'r3', 'flipyou', 50000000, 2500000, 250000, 1000)
      `;

      const vol = await db.getReferrerVolumeLamports("usr_ref", 90);
      expect(vol).toBe(120_000_000);
    });

    it("excludes rows older than the window", async () => {
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps, created_at
        ) VALUES
          ('usr_ref', 'usr_e1', 'wref', 'we1', 'r1', 'flipyou', 50000000, 2500000, 250000, 1000, now() - INTERVAL '5 days'),
          ('usr_ref', 'usr_e2', 'wref', 'we2', 'r2', 'flipyou', 25000000, 1250000, 125000, 1000, now() - INTERVAL '1 day')
      `;

      const within2Days = await db.getReferrerVolumeLamports("usr_ref", 2);
      expect(within2Days).toBe(25_000_000);

      const within10Days = await db.getReferrerVolumeLamports("usr_ref", 10);
      expect(within10Days).toBe(75_000_000);
    });

    it("returns 0 when the referrer has no earnings", async () => {
      const vol = await db.getReferrerVolumeLamports("usr_nobody", 90);
      expect(vol).toBe(0);
    });
  });
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts -t "getReferrerVolumeLamports"
```

Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement the method**

Replace the skeleton in `backend/src/db/referrals.ts`:

```ts
    async getReferrerVolumeLamports(userId, windowDays) {
      // Window must be >= 1 day. Use a fragment for the interval since postgres.js
      // does not parameterise INTERVAL literals — coerce to integer first.
      const days = Math.max(1, Math.floor(windowDays));
      const rows = await sql<{ volume: string }[]>`
        SELECT COALESCE(SUM(wager_lamports), 0)::TEXT AS volume
          FROM referral_earnings
         WHERE referrer_user_id = ${userId}
           AND created_at > now() - (${days} || ' days')::INTERVAL
      `;
      return Number(rows[0]?.volume ?? "0");
    },
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: 7 passed (1 + 3 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/db/referrals.ts
git commit -m "spec(308-referral-tiers): implement getReferrerVolumeLamports"
```

---

## Task 8: Update `getReferrerRate` precedence to KOL → tier → default

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)
- Modify: `backend/src/db/referrals.ts:452-457`

- [ ] **Step 1: Append failing precedence tests**

Inside the existing describe block, append:

```ts
  describe("getReferrerRate precedence (KOL > tier > default)", () => {
    const DEFAULT = 1000;

    it("returns default when neither KOL nor tier rows exist", async () => {
      const rate = await db.getReferrerRate("usr_no_rows", DEFAULT);
      expect(rate).toBe(1000);
    });

    it("returns tier rate when only a tier row exists", async () => {
      await db.upsertTierRow({
        userId: "usr_tier_only",
        tier: 3,
        rateBps: 3000,
        volumeLamports: 150_000_000,
        windowDays: 90,
      });
      const rate = await db.getReferrerRate("usr_tier_only", DEFAULT);
      expect(rate).toBe(3000);
    });

    it("returns KOL rate when only a KOL row exists", async () => {
      await rawSql`
        INSERT INTO referral_kol_rates (user_id, wallet, rate_bps, set_by)
        VALUES ('usr_kol_only', 'wkol', 5000, 'admin')
      `;
      const rate = await db.getReferrerRate("usr_kol_only", DEFAULT);
      expect(rate).toBe(5000);
    });

    it("KOL rate wins when both KOL and tier rows exist", async () => {
      await rawSql`
        INSERT INTO referral_kol_rates (user_id, wallet, rate_bps, set_by)
        VALUES ('usr_both', 'wb', 5000, 'admin')
      `;
      await db.upsertTierRow({
        userId: "usr_both",
        tier: 4,
        rateBps: 4000,
        volumeLamports: 300_000_000,
        windowDays: 90,
      });
      const rate = await db.getReferrerRate("usr_both", DEFAULT);
      expect(rate).toBe(5000);
    });
  });
```

- [ ] **Step 2: Run tests, expect failures (3 of 4)**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts -t "getReferrerRate"
```

Expected: 1 passed (no rows → default), 3 fail (tier-only and both still return default since current impl only checks KOL).

- [ ] **Step 3: Replace `getReferrerRate` impl**

In `backend/src/db/referrals.ts`, replace lines ~452-457:

```ts
    async getReferrerRate(userId, defaultRateBps) {
      const rows = await sql<{ rate_bps: number | null }[]>`
        SELECT COALESCE(
          (SELECT rate_bps FROM referral_kol_rates WHERE user_id = ${userId}),
          (SELECT rate_bps FROM referral_tiers     WHERE user_id = ${userId})
        ) AS rate_bps
      `;
      const resolved = rows[0]?.rate_bps;
      return resolved == null ? defaultRateBps : Number(resolved);
    },
```

- [ ] **Step 4: Update the doc comment on the interface (line ~185)**

Replace:

```ts
  /**
   * Get the effective referrer rate for a user in bps.
   * Checks `referral_kol_rates` first; falls back to `defaultRateBps`.
   */
```

With:

```ts
  /**
   * Get the effective referrer rate for a user in bps.
   * Precedence: `referral_kol_rates` → `referral_tiers` → `defaultRateBps`.
   * KOL overrides always win; auto-computed tiers come next; default is the platform-wide bps.
   */
```

- [ ] **Step 5: Run all referral-related tests to confirm green**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts src/__tests__/referral-routes.test.ts
```

Expected: all pass. Existing referral-routes tests already created the empty `referral_tiers` table in Task 2 so the new query is safe.

- [ ] **Step 6: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/db/referrals.ts
git commit -m "spec(308-referral-tiers): getReferrerRate precedence KOL → tier → default"
```

---

## Task 9: Add config env vars

**Files:**
- Modify: `backend/src/config.ts:116-123`

- [ ] **Step 1: Add fields to the Config interface and `loadConfig` body**

Find the existing block in `loadConfig`:

```ts
    referralDefaultRateBps: parseInt(
      process.env.REFERRAL_DEFAULT_RATE_BPS ?? "1000",
      10,
    ),
    referralMinClaimLamports: parseInt(
      process.env.REFERRAL_MIN_CLAIM_LAMPORTS ?? "10000000",
      10,
    ),
```

Append immediately after:

```ts
    referralTierWindowDays: clampedInt(
      process.env.REFERRAL_TIER_WINDOW_DAYS,
      90,
      1,
      365,
      "REFERRAL_TIER_WINDOW_DAYS",
    ),
    referralTierRecomputeHours: clampedInt(
      process.env.REFERRAL_TIER_RECOMPUTE_HOURS,
      24,
      1,
      168,
      "REFERRAL_TIER_RECOMPUTE_HOURS",
    ),
```

- [ ] **Step 2: Add the helper at the top of `config.ts` (above `loadConfig`)**

```ts
function clampedInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    console.warn(
      `[config] ${name}=${raw} out of range [${min}, ${max}]; falling back to default ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}
```

- [ ] **Step 3: Add the fields to the `Config` interface**

Find the `Config` interface in the same file and add (in the same numeric/section the existing referral fields live in):

```ts
  referralTierWindowDays: number;
  referralTierRecomputeHours: number;
```

- [ ] **Step 4: Verify typecheck and existing tests still pass**

```bash
cd backend && pnpm typecheck && pnpm vitest run src/__tests__/referral-routes.test.ts
```

Expected: clean typecheck, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.ts
git commit -m "spec(308-referral-tiers): add REFERRAL_TIER_WINDOW_DAYS and RECOMPUTE_HOURS config"
```

---

## Task 10: Implement `runReferralTierComputation`

The single-tick worker function. Reads tier defs, iterates `referral_codes.user_id`, computes volume, buckets, upserts. No advisory lock yet (added in next task).

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)
- Modify: `backend/src/worker/referral-tier.ts` (append)

- [ ] **Step 1: Append the failing happy-path test**

Inside the existing describe block, append:

```ts
  describe("runReferralTierComputation", () => {
    it("creates a tier row for every referral_codes user, including zero-volume", async () => {
      const { runReferralTierComputation } = await import("../worker/referral-tier.js");

      // Three referrers in referral_codes; only one has earnings in window.
      await rawSql`
        INSERT INTO referral_codes (user_id, wallet, code) VALUES
          ('usr_active',   'wa', 'codeactive'),
          ('usr_inactive', 'wi', 'codeinactive'),
          ('usr_top',      'wt', 'codetop')
      `;
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps
        ) VALUES
          ('usr_active', 'usr_e1', 'wa', 'we1', 'r1', 'flipyou', 75000000, 3750000, 750000, 1000),
          ('usr_top',    'usr_e2', 'wt', 'we2', 'r2', 'flipyou', 250000000, 12500000, 5000000, 2000)
      `;

      await runReferralTierComputation(db, { windowDays: 90 });

      const active = await db.getTierRow("usr_active");
      expect(active!.tier).toBe(2);
      expect(active!.rate_bps).toBe(2000);
      expect(active!.volume_lamports).toBe(75_000_000);
      expect(active!.window_days).toBe(90);

      const inactive = await db.getTierRow("usr_inactive");
      expect(inactive!.tier).toBe(1);
      expect(inactive!.rate_bps).toBe(1000);
      expect(inactive!.volume_lamports).toBe(0);

      const top = await db.getTierRow("usr_top");
      expect(top!.tier).toBe(4);
      expect(top!.rate_bps).toBe(4000);
    });

    it("downgrades a referrer when their volume drops below current tier", async () => {
      const { runReferralTierComputation } = await import("../worker/referral-tier.js");

      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES ('usr_x', 'wx', 'cx')`;
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps, created_at
        ) VALUES
          ('usr_x', 'usr_e1', 'wx', 'we1', 'r1', 'flipyou', 250000000, 12500000, 5000000, 2000, now() - INTERVAL '95 days'),
          ('usr_x', 'usr_e2', 'wx', 'we2', 'r2', 'flipyou', 30000000, 1500000, 150000, 1000, now() - INTERVAL '1 day')
      `;

      await runReferralTierComputation(db, { windowDays: 90 });

      const row = await db.getTierRow("usr_x");
      expect(row!.tier).toBe(1); // 30M lamports → tier 1; the 250M is outside the window
      expect(row!.volume_lamports).toBe(30_000_000);
    });
  });
```

- [ ] **Step 2: Run tests, expect failures**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts -t "runReferralTierComputation"
```

Expected: FAIL — `runReferralTierComputation` not exported.

- [ ] **Step 3: Append the implementation to `referral-tier.ts`**

```ts
// ---------------------------------------------------------------------------
// Worker: runReferralTierComputation
// ---------------------------------------------------------------------------

import type { ReferralsDb } from "../db/referrals.js";

/** Subset of Db this worker reads/writes. */
export interface TierWorkerDeps extends ReferralsDb {
  // Re-uses ReferralsDb plus a raw enumeration of referrers. We piggy-back on
  // listAllReferralCodeUserIds rather than coupling to player_profiles, since
  // a user is only a "referrer" once they've created a code.
  listAllReferralCodeUserIds(): Promise<string[]>;
}

export interface TierComputationOptions {
  windowDays: number;
}

/**
 * Compute and persist the current tier for every referrer.
 * Reads tier definitions on each call so editing them between ticks takes
 * effect immediately on the next computation. Idempotent: running twice
 * with no new earnings produces identical row state (only `computed_at` updates).
 */
export async function runReferralTierComputation(
  db: TierWorkerDeps,
  options: TierComputationOptions,
): Promise<void> {
  const definitions = await db.getTierDefinitions();
  if (definitions.length === 0) {
    throw new Error("runReferralTierComputation: referral_tier_definitions is empty");
  }

  const userIds = await db.listAllReferralCodeUserIds();
  for (const userId of userIds) {
    const volume = await db.getReferrerVolumeLamports(userId, options.windowDays);
    const bucket = bucketTier(volume, definitions);
    await db.upsertTierRow({
      userId,
      tier: bucket.tier,
      rateBps: bucket.rateBps,
      volumeLamports: volume,
      windowDays: options.windowDays,
    });
  }
}
```

- [ ] **Step 4: Add `listAllReferralCodeUserIds` to `ReferralsDb`**

In `backend/src/db/referrals.ts`, add to the interface (near the other tier methods):

```ts
  /** Enumerate every user_id that has set a referral code. Used by the tier worker. */
  listAllReferralCodeUserIds(): Promise<string[]>;
```

And add the implementation in `createReferralsDb` (near the codes section, ~line 240):

```ts
    async listAllReferralCodeUserIds() {
      const rows = await sql<{ user_id: string }[]>`
        SELECT user_id FROM referral_codes ORDER BY user_id ASC
      `;
      return rows.map((r) => r.user_id);
    },
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: all integration tests pass (including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/db/referrals.ts backend/src/worker/referral-tier.ts
git commit -m "spec(308-referral-tiers): implement runReferralTierComputation"
```

---

## Task 11: `startReferralTierWorker` + advisory lock

Wraps the computation in a `pg_try_advisory_lock` so multi-replica deploys don't double-compute, and adds an interval scheduler with a one-shot boot run.

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)
- Modify: `backend/src/worker/referral-tier.ts` (append)

- [ ] **Step 1: Append the failing test for advisory-lock-protected single-flight**

```ts
  describe("startReferralTierWorker advisory lock", () => {
    it("two parallel runReferralTierComputationLocked calls only execute once", async () => {
      const { runReferralTierComputationLocked } = await import("../worker/referral-tier.js");

      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES ('usr_a', 'wa', 'ca')`;

      // Race two locked computations. Both resolve, but only one acquires the lock.
      const results = await Promise.all([
        runReferralTierComputationLocked(rawSql, db, { windowDays: 90 }),
        runReferralTierComputationLocked(rawSql, db, { windowDays: 90 }),
      ]);

      // Exactly one returns "ran"; the other "skipped".
      const ran = results.filter((r) => r === "ran");
      const skipped = results.filter((r) => r === "skipped");
      expect(ran.length).toBe(1);
      expect(skipped.length).toBe(1);

      const row = await db.getTierRow("usr_a");
      expect(row!.tier).toBe(1);
    });

    it("idempotent: two sequential runs leave (tier, rate_bps, volume_lamports) unchanged", async () => {
      const { runReferralTierComputation } = await import("../worker/referral-tier.js");

      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES ('usr_b', 'wb', 'cb')`;
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps
        ) VALUES ('usr_b', 'usr_e1', 'wb', 'we1', 'r1', 'flipyou', 60000000, 3000000, 600000, 1000)
      `;

      await runReferralTierComputation(db, { windowDays: 90 });
      const first = await db.getTierRow("usr_b");

      await runReferralTierComputation(db, { windowDays: 90 });
      const second = await db.getTierRow("usr_b");

      expect(second!.tier).toBe(first!.tier);
      expect(second!.rate_bps).toBe(first!.rate_bps);
      expect(second!.volume_lamports).toBe(first!.volume_lamports);
      // computed_at strictly later (or equal at sub-ms resolution)
      expect(second!.computed_at.getTime()).toBeGreaterThanOrEqual(first!.computed_at.getTime());
    });
  });
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts -t "advisory lock"
```

Expected: FAIL — `runReferralTierComputationLocked` not exported.

- [ ] **Step 3: Append `runReferralTierComputationLocked` and `startReferralTierWorker` to `referral-tier.ts`**

Add at the top of the file:

```ts
import type postgres from "postgres";
```

Append at the bottom:

```ts
// Stable advisory-lock key for the tier worker. Picked to be unlikely to
// collide with other system locks (308 = spec ID, 308 again to widen).
const TIER_WORKER_LOCK_KEY = 308308;

/**
 * Run a tier computation behind a non-blocking PG advisory lock so multiple
 * backend replicas (or a stuck overlapping tick) do not double-compute.
 * Returns "ran" if the lock was acquired and the computation executed, or
 * "skipped" if another worker held the lock.
 */
export async function runReferralTierComputationLocked(
  sql: ReturnType<typeof postgres>,
  db: TierWorkerDeps,
  options: TierComputationOptions,
): Promise<"ran" | "skipped"> {
  const rows = await sql<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_lock(${TIER_WORKER_LOCK_KEY}) AS acquired
  `;
  if (!rows[0]?.acquired) return "skipped";
  try {
    await runReferralTierComputation(db, options);
    return "ran";
  } finally {
    await sql`SELECT pg_advisory_unlock(${TIER_WORKER_LOCK_KEY})`;
  }
}

export interface ReferralTierWorker {
  start(): Promise<void>;
  stop(): void;
}

export interface StartTierWorkerOptions {
  windowDays: number;
  recomputeHours: number;
  logger?: { info: (msg: string, meta?: object) => void; error: (msg: string, meta?: object) => void };
}

/**
 * Boot the tier worker. The returned `start()` runs an immediate computation
 * (await-able) so callers can block startup on first tier population, then
 * schedules a setInterval at `recomputeHours`.
 */
export function startReferralTierWorker(
  sql: ReturnType<typeof postgres>,
  db: TierWorkerDeps,
  options: StartTierWorkerOptions,
): ReferralTierWorker {
  const log = options.logger ?? console;
  let timer: NodeJS.Timeout | null = null;

  async function tick(label: string) {
    try {
      const result = await runReferralTierComputationLocked(sql, db, {
        windowDays: options.windowDays,
      });
      log.info(`[referral-tier] ${label} ${result}`, {
        windowDays: options.windowDays,
      });
    } catch (err) {
      log.error(`[referral-tier] ${label} failed`, { err: String(err) });
    }
  }

  return {
    async start() {
      await tick("boot");
      const intervalMs = options.recomputeHours * 60 * 60 * 1000;
      timer = setInterval(() => {
        // Fire and forget — errors are caught inside tick().
        void tick("interval");
      }, intervalMs);
      // Don't keep Node alive solely for this timer.
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm green**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: all integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts backend/src/worker/referral-tier.ts
git commit -m "spec(308-referral-tiers): add advisory-locked worker and startReferralTierWorker"
```

---

## Task 12: Wire `startReferralTierWorker` into `index.ts`

**Files:**
- Modify: `backend/src/index.ts:30` (imports) and `:227` (worker startup)

- [ ] **Step 1: Add the import**

After the existing worker imports (around line 32):

```ts
import { startReferralTierWorker } from "./worker/referral-tier.js";
```

- [ ] **Step 2: Start the worker after `closeCallClock.start()` (around line 227)**

Insert immediately after line 227 (`closeCallClock.start();`):

```ts
// Referral tier worker — daily recompute of per-referrer tier from referee wager volume.
// Boot run is awaited so first HTTP request sees correct tiers; advisory lock makes it
// safe for multi-replica deployments.
const referralTierWorker = startReferralTierWorker(sql, db, {
  windowDays: config.referralTierWindowDays,
  recomputeHours: config.referralTierRecomputeHours,
  logger,
});
await referralTierWorker.start();
```

- [ ] **Step 3: Verify the file still compiles**

```bash
cd backend && pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Smoke-test by starting the dev server**

```bash
cd backend && pnpm dev &
sleep 3
curl -fsS http://127.0.0.1:3100/health
kill %1
```

Expected: `[referral-tier] boot ran` log line appears in dev output; `/health` returns 200.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "spec(308-referral-tiers): wire startReferralTierWorker into backend startup"
```

---

## Task 13: Extend `ReferralStatsSchema` with the `tier` block

**Files:**
- Modify: `backend/src/contracts/validators.ts:343-349`

- [ ] **Step 1: Replace the schema**

Replace lines 343-349:

```ts
export const ReferralStatsSchema = z.object({
  referredCount: z.number().int(),
  activeCount: z.number().int(),
  totalVolumeLamports: LamportsStringSchema,
  totalEarnedLamports: LamportsStringSchema,
  pendingLamports: LamportsStringSchema,
});
```

With:

```ts
export const ReferralTierNextSchema = z.object({
  tier: z.number().int().min(2).max(4),
  minVolumeLamports: LamportsStringSchema,
  rateBps: z.number().int(),
});

export const ReferralTierStatsSchema = z.object({
  current: z.number().int().min(1).max(4),
  rateBps: z.number().int(),
  source: z.enum(["kol", "tier", "default"]),
  windowDays: z.number().int(),
  volumeLamports: LamportsStringSchema,
  nextTier: ReferralTierNextSchema.nullable(),
});

export const ReferralStatsSchema = z.object({
  referredCount: z.number().int(),
  activeCount: z.number().int(),
  totalVolumeLamports: LamportsStringSchema,
  totalEarnedLamports: LamportsStringSchema,
  pendingLamports: LamportsStringSchema,
  tier: ReferralTierStatsSchema,
});
```

- [ ] **Step 2: Verify typecheck (existing handler will fail to satisfy schema until Task 14)**

```bash
cd backend && pnpm typecheck
```

Expected: a type error in `routes/referral.ts` because the `ok(c, { ... })` payload now lacks `tier`. That is expected — Task 14 fixes it. Do not commit yet.

- [ ] **Step 3: Stage but do not commit**

```bash
git add backend/src/contracts/validators.ts
```

(We bundle the schema and handler change in one commit so the tree never sits in a broken state on the branch.)

---

## Task 14: Update `GET /referral/stats` handler + route tests

**Files:**
- Modify: `backend/src/routes/referral.ts:458-481`
- Modify: `backend/src/__tests__/referral-routes.test.ts:534+` (the existing `/stats` describe block)

- [ ] **Step 1: Replace the stats handler**

Replace the block at lines ~458-481:

```ts
  app.openapi(statsRoute, async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required");
    }

    try {
      const stats = await db.getReferralStatsByUserId(userId);
      return ok(c, {
        referredCount: stats.referred_count,
        activeCount: stats.active_count,
        totalVolumeLamports: stats.total_volume_lamports,
        totalEarnedLamports: stats.total_earned_lamports,
        pendingLamports: stats.pending_lamports,
      });
    } catch (fetchError) {
      logger.error("Failed to fetch referral stats", {
        err: String(fetchError),
        userId,
      });
      return err(
        c,
```

With (preserving the surrounding error handling):

```ts
  app.openapi(statsRoute, async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required");
    }

    try {
      const [stats, kolRow, tierRow, defs] = await Promise.all([
        db.getReferralStatsByUserId(userId),
        db.getReferralKolRate(userId),
        db.getTierRow(userId),
        db.getTierDefinitions(),
      ]);

      // Resolution: KOL > tier > default.
      let source: "kol" | "tier" | "default";
      let rateBps: number;
      if (kolRow) {
        source = "kol";
        rateBps = kolRow.rate_bps;
      } else if (tierRow) {
        source = "tier";
        rateBps = tierRow.rate_bps;
      } else {
        source = "default";
        rateBps = config.referralDefaultRateBps;
      }

      const currentTier = tierRow?.tier ?? 1;
      const volumeLamports = String(tierRow?.volume_lamports ?? 0);

      // nextTier: the def with the smallest min_volume_lamports strictly greater
      // than current tier row's volume (or 0 for default).
      const currentVol = tierRow?.volume_lamports ?? 0;
      const next = defs
        .filter((d) => d.min_volume_lamports > currentVol)
        .sort((a, b) => a.min_volume_lamports - b.min_volume_lamports)[0];

      return ok(c, {
        referredCount: stats.referred_count,
        activeCount: stats.active_count,
        totalVolumeLamports: stats.total_volume_lamports,
        totalEarnedLamports: stats.total_earned_lamports,
        pendingLamports: stats.pending_lamports,
        tier: {
          current: currentTier,
          rateBps,
          source,
          windowDays: tierRow?.window_days ?? config.referralTierWindowDays,
          volumeLamports,
          nextTier: next
            ? {
                tier: next.tier,
                minVolumeLamports: String(next.min_volume_lamports),
                rateBps: next.rate_bps,
              }
            : null,
        },
      });
    } catch (fetchError) {
      logger.error("Failed to fetch referral stats", {
        err: String(fetchError),
        userId,
      });
      return err(
        c,
```

- [ ] **Step 2: Add `getReferralKolRate` to `ReferralsDb` if not already present**

Check whether `getReferralKolRate` already exists:

```bash
grep -n "getReferralKolRate" backend/src/db/referrals.ts
```

If absent, add it to the interface:

```ts
  /** Read a user's KOL override row, or undefined if none. */
  getReferralKolRate(userId: string): Promise<{ user_id: string; rate_bps: number } | undefined>;
```

And to the implementation (near other KOL/rate methods):

```ts
    async getReferralKolRate(userId) {
      const rows = await sql<{ user_id: string; rate_bps: number }[]>`
        SELECT user_id, rate_bps FROM referral_kol_rates WHERE user_id = ${userId}
      `;
      const row = rows[0];
      if (!row) return undefined;
      return { user_id: row.user_id, rate_bps: Number(row.rate_bps) };
    },
```

- [ ] **Step 3: Add stats-tier test cases to the existing `/stats` describe block**

Inside `describe("GET /referral/stats", () => { ... })` in `referral-routes.test.ts`, append:

```ts
    it("returns tier block with source=default for a brand-new referrer", async () => {
      // Set up the referrer with a code but no earnings or tier row.
      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES (${referrerUserId}, ${referrer}, 'cdef')`;

      const token = await makeJwt(referrer);
      const res = await app.request("/referral/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.tier).toEqual({
        current: 1,
        rateBps: 1000,
        source: "default",
        windowDays: expect.any(Number),
        volumeLamports: "0",
        nextTier: { tier: 2, minVolumeLamports: "50000000", rateBps: 2000 },
      });
    });

    it("returns tier block with source=tier when a tier row exists", async () => {
      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES (${referrerUserId}, ${referrer}, 'ctier')`;
      await rawSql`
        INSERT INTO referral_tiers (user_id, tier, rate_bps, volume_lamports, window_days)
        VALUES (${referrerUserId}, 3, 3000, 150000000, 90)
      `;

      const token = await makeJwt(referrer);
      const res = await app.request("/referral/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const body: any = await res.json();
      expect(body.data.tier.source).toBe("tier");
      expect(body.data.tier.current).toBe(3);
      expect(body.data.tier.rateBps).toBe(3000);
      expect(body.data.tier.volumeLamports).toBe("150000000");
      expect(body.data.tier.windowDays).toBe(90);
      expect(body.data.tier.nextTier).toEqual({
        tier: 4,
        minVolumeLamports: "200000000",
        rateBps: 4000,
      });
    });

    it("returns tier block with source=kol when a KOL row exists (KOL wins over tier)", async () => {
      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES (${referrerUserId}, ${referrer}, 'ckol')`;
      await rawSql`
        INSERT INTO referral_kol_rates (user_id, wallet, rate_bps, set_by)
        VALUES (${referrerUserId}, ${referrer}, 5000, 'admin')
      `;
      await rawSql`
        INSERT INTO referral_tiers (user_id, tier, rate_bps, volume_lamports, window_days)
        VALUES (${referrerUserId}, 2, 2000, 75000000, 90)
      `;

      const token = await makeJwt(referrer);
      const res = await app.request("/referral/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const body: any = await res.json();
      expect(body.data.tier.source).toBe("kol");
      expect(body.data.tier.rateBps).toBe(5000);
      // current still reflects the tier row even when KOL wins for rate
      expect(body.data.tier.current).toBe(2);
    });

    it("returns nextTier=null at top tier", async () => {
      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES (${referrerUserId}, ${referrer}, 'ctop')`;
      await rawSql`
        INSERT INTO referral_tiers (user_id, tier, rate_bps, volume_lamports, window_days)
        VALUES (${referrerUserId}, 4, 4000, 500000000, 90)
      `;

      const token = await makeJwt(referrer);
      const res = await app.request("/referral/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const body: any = await res.json();
      expect(body.data.tier.current).toBe(4);
      expect(body.data.tier.nextTier).toBeNull();
    });
```

- [ ] **Step 4: Update the test config to include the new fields**

In `referral-routes.test.ts`, find the `testConfig` constant (~line 79) and update:

```ts
  const testConfig = {
    referralDefaultRateBps: 1000,
    referralMinClaimLamports: 10_000_000,
    referralTierWindowDays: 90,
    referralTierRecomputeHours: 24,
  } as Config;
```

- [ ] **Step 5: Run the full referral suite**

```bash
cd backend && pnpm vitest run src/__tests__/referral-routes.test.ts src/__tests__/referral-tier-integration.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run typecheck and lint**

```bash
cd backend && pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit (bundle schema + handler + tests)**

```bash
git add backend/src/contracts/validators.ts backend/src/routes/referral.ts backend/src/db/referrals.ts backend/src/__tests__/referral-routes.test.ts
git commit -m "spec(308-referral-tiers): expose tier block on GET /referral/stats"
```

---

## Task 15: Forward-only effect integration test

Verify that editing `referral_tier_definitions` between worker runs only affects future computations and does not rewrite `referral_earnings.referrer_rate_bps`.

**Files:**
- Modify: `backend/src/__tests__/referral-tier-integration.test.ts` (append)

- [ ] **Step 1: Append the test**

```ts
  describe("forward-only effect of tier definition edits", () => {
    it("editing referral_tier_definitions does not rewrite past referral_earnings", async () => {
      const { runReferralTierComputation } = await import("../worker/referral-tier.js");

      await rawSql`INSERT INTO referral_codes (user_id, wallet, code) VALUES ('usr_fwd', 'wf', 'cfwd')`;
      // Pre-existing earning recorded at the old rate (snapshot in referrer_rate_bps).
      await rawSql`
        INSERT INTO referral_earnings (
          referrer_user_id, referee_user_id, referrer_wallet, referee_wallet,
          round_id, game_type, wager_lamports, fee_lamports,
          referrer_earned_lamports, referrer_rate_bps
        ) VALUES ('usr_fwd', 'usr_e1', 'wf', 'we1', 'r1', 'flipyou', 75000000, 3750000, 750000, 2000)
      `;

      // First run: 75M → tier 2 → rate 2000.
      await runReferralTierComputation(db, { windowDays: 90 });
      expect((await db.getTierRow("usr_fwd"))!.rate_bps).toBe(2000);

      // Operator raises tier 2 threshold so 75M no longer qualifies.
      await rawSql`UPDATE referral_tier_definitions SET min_volume_lamports = 100000000 WHERE tier = 2`;

      // Second run: 75M → tier 1 → rate 1000.
      await runReferralTierComputation(db, { windowDays: 90 });
      expect((await db.getTierRow("usr_fwd"))!.rate_bps).toBe(1000);

      // Past earning row is untouched — historical correctness preserved.
      const earnings = await rawSql<{ referrer_rate_bps: number }[]>`
        SELECT referrer_rate_bps FROM referral_earnings WHERE referrer_user_id = 'usr_fwd'
      `;
      expect(Number(earnings[0]!.referrer_rate_bps)).toBe(2000);

      // Restore default seed for subsequent tests.
      await rawSql`UPDATE referral_tier_definitions SET min_volume_lamports = 50000000 WHERE tier = 2`;
    });
  });
```

- [ ] **Step 2: Run the new test**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts -t "forward-only"
```

Expected: 1 passed.

- [ ] **Step 3: Run the full integration suite to confirm no cross-test pollution**

```bash
cd backend && pnpm vitest run src/__tests__/referral-tier-integration.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/referral-tier-integration.test.ts
git commit -m "spec(308-referral-tiers): test forward-only effect of tier definition edits"
```

---

## Task 16: Update App Platform yamls

**Files:**
- Modify: `backend/.do/app-dev.yaml:41+`
- Modify: `backend/.do/app-prod.yaml` (mirror)

- [ ] **Step 1: Add the env block to dev yaml**

Find the `envs:` list in `backend/.do/app-dev.yaml` (line 41) and append two entries (place near other `REFERRAL_*` envs if any exist; otherwise at the end of the list):

```yaml
      - key: REFERRAL_TIER_WINDOW_DAYS
        scope: RUN_AND_BUILD_TIME
        value: "2"
      - key: REFERRAL_TIER_RECOMPUTE_HOURS
        scope: RUN_AND_BUILD_TIME
        value: "24"
```

- [ ] **Step 2: Add the env block to prod yaml**

Append the same two keys to the `envs:` list in `backend/.do/app-prod.yaml`, with prod values:

```yaml
      - key: REFERRAL_TIER_WINDOW_DAYS
        scope: RUN_AND_BUILD_TIME
        value: "90"
      - key: REFERRAL_TIER_RECOMPUTE_HOURS
        scope: RUN_AND_BUILD_TIME
        value: "24"
```

- [ ] **Step 3: Verify yaml parses (smoke check)**

```bash
node -e "console.log(require('js-yaml').load(require('fs').readFileSync('backend/.do/app-dev.yaml', 'utf8')).services?.[0]?.envs?.length ?? 'parse-failed')"
```

Expected: a number that's at least 2 higher than before (or your repo's existing env count + 2). If `js-yaml` is not installed, skip this step — `pnpm typecheck` and the App Platform CI will catch syntax errors.

- [ ] **Step 4: Commit**

```bash
git add backend/.do/app-dev.yaml backend/.do/app-prod.yaml
git commit -m "spec(308-referral-tiers): declare REFERRAL_TIER_* env vars in App Platform configs"
```

---

## Task 17: Final verify pass

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && pnpm test
```

Expected: 0 failures. Pay attention to any unexpected snapshot diffs in OpenAPI / contract tests — the `tier` block addition is intended.

- [ ] **Step 2: Run lint and typecheck**

```bash
cd backend && pnpm lint && pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Run cross-repo verify**

```bash
./scripts/verify
```

Expected: exit code 0.

- [ ] **Step 4: Verify dev defaults via env**

```bash
cd backend && REFERRAL_TIER_WINDOW_DAYS=2 REFERRAL_TIER_RECOMPUTE_HOURS=1 pnpm dev &
sleep 5
curl -fsS http://127.0.0.1:3100/health | jq .
kill %1
```

Expected: dev server boots, `/health` returns 200, log line `[referral-tier] boot ran` appears.

- [ ] **Step 5: Mark spec checklist test items**

In `docs/specs/308-referral-tiers/spec.md`, update the three remaining unchecked items in the Tests section:

- The two unit-test checkboxes flip to `[x]` once Task 3 / Task 8 commits land.
- The integration-test checkboxes flip to `[x]` after Tasks 10, 11, 15.
- The two N/A items (`e2e/local/**`, `e2e/visual/**`, `e2e/devnet/**`) are pre-checked with the rationale already in spec text.

- [ ] **Step 6: Final commit**

```bash
git add docs/specs/308-referral-tiers/spec.md
git commit -m "spec(308-referral-tiers): mark implementation checklist complete"
```

---

## Self-Review Notes

**Spec coverage check:** Each FR maps to tasks:
- FR-1 (tier defs DB-editable) → Task 1, 5
- FR-2 (per-user snapshot) → Task 1, 6
- FR-3 (worker) → Task 10, 11, 12
- FR-4 (rate resolution) → Task 8
- FR-5 (stats endpoint) → Task 13, 14
- FR-6 (config) → Task 9, 16
- FR-7 (tests) → Tasks 3, 8, 10, 11, 14, 15, plus Task 17 N/A markers

**Type consistency:** `bucketTier` uses `number` for lamports (Task 3); `getReferrerVolumeLamports` returns `number` (Task 7); `upsertTierRow` accepts `volumeLamports: number` (Task 6). All consistent.

**Snapshot concern:** Task 13 changes `ReferralStatsSchema`. The `openapi-contract.test.ts` test fixture and any consumer mocks that snapshot the schema may need regeneration. Task 17 step 1 catches this — re-run, expect snapshot diff, accept if it matches the new shape and contains the `tier` block.

**Migration ordering:** Plan assumes `028_payout_controls.sql` is the latest. Task 1 step 1 explicitly checks; bump if not.

**No frontend tasks:** Per project rules, frontend (`webapp/`, `waitlist/`) is a separate team. Backend exposes the new `tier` block via `/referral/stats`; frontend rendering is out of scope.
