# Payout Pause and Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-controlled gate (emergency pause + above-threshold review) in front of every claimable SOL payout, starting with referral claims, with a peek operations page for approve/reject and full audit.

**Architecture:** A pure gate function (`evaluateGate`) is called inside the existing referral claim queue handler before any `SystemProgram.transfer`. A new `payout_controls` table holds per-`claim_kind` knobs. New `held` and `rejected` statuses extend the existing claim state machine. A sweeper running on the existing event-queue worker tick auto-releases pause-held claims when pause clears. Held claims surface in a new peek `operations/payouts` page with approve/reject mutations that write to `operator_events`.

**Tech Stack:** Postgres 16, postgres.js, Hono, Vitest, Next.js (peek), TypeScript, pnpm.

**Spec:** `docs/specs/307-payout-pause-and-review/spec.md`

---

## File Structure

**New files (backend):**
- `backend/migrations/028_payout_controls.sql` — schema migration
- `backend/src/services/payout-gate.ts` — pure gate function
- `backend/src/services/__tests__/payout-gate.test.ts` — gate unit tests
- `backend/src/db/payout-controls.ts` — DB module for `payout_controls`
- `backend/src/db/__tests__/payout-controls.test.ts` — DB module tests
- `backend/src/queue/sweepers/payout-pause-sweeper.ts` — sweeper logic
- `backend/src/queue/sweepers/__tests__/payout-pause-sweeper.test.ts` — sweeper tests

**New files (peek):**
- `peek/src/server/db/queries/get-held-claims.ts`
- `peek/src/server/db/queries/get-payout-controls.ts`
- `peek/src/server/db/queries/get-recent-payout-decisions.ts`
- `peek/src/server/mutations/payout-controls.ts` — `setPayoutPause`, `updatePayoutControls`
- `peek/src/server/mutations/claim-review.ts` — `approveClaim`, `rejectClaim`
- `peek/app/operations/payouts/page.tsx`
- `peek/src/components/payout-controls-card.tsx`
- `peek/src/components/held-claims-table.tsx`
- `peek/src/components/payout-decisions-list.tsx`

**Modified files:**
- `backend/src/db/referrals.ts` — extend `ReferralClaim.status` type; fix balance + stats queries
- `backend/src/db/fee-accounting.ts` — extend `FeeBucketDebitStatus`
- `backend/src/queue/handlers/referral-claim.ts` — gate integration + idempotency
- `backend/src/queue/worker.ts` — invoke sweeper each tick
- `backend/src/routes/referral.ts` — map internal `held`/`rejected` → public `pending`
- `peek/src/server/mutations/registry.ts` — register four new mutations
- `peek/src/server/access-policy.ts` — add `PEEK_ACTION_RULES` entries
- `peek/src/server/admin-shell-nav.ts` — add Payouts link
- `docs/TECH_DEBT.md` — note single-role limitation

---

## Task 1: Database migration — schema scaffolding

**Files:**
- Create: `backend/migrations/028_payout_controls.sql`

This is a "scaffolding" task. The migration is applied automatically on backend startup (`pnpm migrate` or first `pnpm dev`). After this lands, every other backend task can rely on the new columns and constraints.

- [ ] **Step 1: Write the migration**

Create `backend/migrations/028_payout_controls.sql`:

```sql
-- 028_payout_controls.sql — Admin-controlled gate in front of claimable SOL payouts.
--
-- Adds:
--   * payout_controls table — per-claim_kind pause + review threshold knobs.
--   * referral_claims columns: claim_kind, hold_reason, reviewed_by, reviewed_at.
--   * Status check constraint extended to include 'held' and 'rejected'.
--   * Hold reason check constraint enforces the held↔reason invariant.
--   * Concurrent-claim partial unique index updated to include 'held'.
--   * fee_bucket_debits status CHECK extended to include 'held' and 'rejected'
--     (the claim handler updates both rows atomically via updateFeeBucketDebitStatus).
--
-- Forward-only and additive. No destructive operations on existing data.

-- ── payout_controls ────────────────────────────────────────────────────────
CREATE TABLE payout_controls (
  claim_kind                TEXT         PRIMARY KEY,
  pause_enabled             BOOLEAN      NOT NULL DEFAULT FALSE,
  review_threshold_lamports BIGINT       NOT NULL DEFAULT 1000000000, -- 1 SOL
  updated_by                TEXT,
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_payout_controls_threshold_non_negative
    CHECK (review_threshold_lamports >= 0)
);

INSERT INTO payout_controls (claim_kind) VALUES ('referral');

-- ── referral_claims columns ────────────────────────────────────────────────
ALTER TABLE referral_claims
  ADD COLUMN claim_kind  TEXT NOT NULL DEFAULT 'referral',
  ADD COLUMN hold_reason TEXT,
  ADD COLUMN reviewed_by TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Replace status check constraint to include 'held' and 'rejected'.
-- The original constraint name was unnamed/inline in 010 — Postgres auto-named
-- it referral_claims_status_check, but we DROP IF EXISTS by both shapes for safety.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'referral_claims_status_check' AND conrelid = 'referral_claims'::regclass
  ) THEN
    ALTER TABLE referral_claims DROP CONSTRAINT referral_claims_status_check;
  END IF;
END $$;

ALTER TABLE referral_claims
  ADD CONSTRAINT referral_claims_status_check
  CHECK (status IN ('pending','held','processing','completed','failed','rejected','error'));

-- Hold-reason invariant.
ALTER TABLE referral_claims
  ADD CONSTRAINT referral_claims_hold_reason_check
  CHECK (
    (status = 'held' AND hold_reason IN ('global_pause','above_threshold'))
    OR (status <> 'held' AND hold_reason IS NULL)
  );

-- ── concurrent-claim guard updated to include 'held' ───────────────────────
DROP INDEX IF EXISTS idx_referral_claims_user_active;
CREATE UNIQUE INDEX idx_referral_claims_user_active
  ON referral_claims (user_id)
  WHERE status IN ('pending','held','processing','error');

-- Status partial index updated so the sweeper and held-queue listing can use it.
DROP INDEX IF EXISTS idx_referral_claims_status;
CREATE INDEX idx_referral_claims_status
  ON referral_claims (status)
  WHERE status IN ('pending','held','processing');

-- Sweeper / held-queue listing key.
CREATE INDEX idx_referral_claims_held_kind_reason
  ON referral_claims (claim_kind, hold_reason)
  WHERE status = 'held';

-- ── fee_bucket_debits status CHECK extended ────────────────────────────────
-- The existing constraint was added in migration 026 with the values
-- ('pending','processing','error','completed','failed'). The claim handler
-- (referral-claim.ts) updates the matching debit row in lockstep with
-- referral_claims via updateFeeBucketDebitStatus(...) — including new 'held'
-- and 'rejected' values — so the constraint must accept them.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'fee_bucket_debits'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%pending%processing%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE fee_bucket_debits DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE fee_bucket_debits
  ADD CONSTRAINT ck_fee_bucket_debits_status
  CHECK (status IN ('pending','held','processing','completed','failed','rejected','error'));
```

- [ ] **Step 2: Apply the migration**

Run from the repo root:

```bash
cd backend && pnpm migrate
```

Expected: migration logs `028_payout_controls.sql` applied successfully and exits 0. If the dev DB is already drifted from a prior failed attempt, fix the failure and re-run — do NOT delete data.

- [ ] **Step 3: Verify the schema**

Run:

```bash
cd backend && psql "$DATABASE_URL" -c "\d payout_controls" -c "\d referral_claims" -c "\d fee_bucket_debits"
```

Expected:
- `payout_controls` exists with `claim_kind` PK, `pause_enabled`, `review_threshold_lamports`, `updated_by`, `updated_at`, threshold-non-negative CHECK
- `referral_claims` has new columns `claim_kind`, `hold_reason`, `reviewed_by`, `reviewed_at`; status check includes `held` and `rejected`; hold-reason CHECK present; `idx_referral_claims_user_active` is `WHERE status IN ('pending','held','processing','error')`
- `fee_bucket_debits` status CHECK now includes `held` and `rejected`
- `payout_controls` has one row: `('referral', false, 1000000000, NULL, <ts>)`

- [ ] **Step 4: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add migrations/028_payout_controls.sql
git commit -m "feat(307): migration 028 — payout_controls + referral_claims hold columns"
```

---

## Task 2: Extend ReferralClaim status type

**Files:**
- Modify: `backend/src/db/referrals.ts:54`

The TypeScript type for `ReferralClaim.status` must accept the two new statuses. This is a pure type change — every consumer that compares against status values must continue to compile.

- [ ] **Step 1: Edit the type**

Open `backend/src/db/referrals.ts`. Change line 54 from:

```ts
  status: "pending" | "processing" | "error" | "completed" | "failed";
```

to:

```ts
  status: "pending" | "held" | "processing" | "error" | "completed" | "failed" | "rejected";
```

Add four new fields below `status` so the type matches the migration:

```ts
  status: "pending" | "held" | "processing" | "error" | "completed" | "failed" | "rejected";
  hold_reason: "global_pause" | "above_threshold" | null;
  claim_kind: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  retry_count: number;
```

(Keep the existing `retry_count`, `tx_signature`, `error`, `requested_at`, `processed_at` fields — only add the four new ones above the closing brace.)

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: PASS (the existing handler only checks `claim.status === "completed"` and `=== "failed"`, both of which remain valid). If anything fails to compile, examine the offending narrowing and adjust to the new union.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/db/referrals.ts
git commit -m "feat(307): extend ReferralClaim type with held/rejected statuses + hold metadata"
```

---

## Task 3: Extend FeeBucketDebitStatus type

**Files:**
- Modify: `backend/src/db/fee-accounting.ts:24-29`

The handler's `setClaimStatus` helper updates `referral_claims` and `fee_bucket_debits` in lockstep. After Task 1, the DB CHECK accepts `held` and `rejected` but the TypeScript type does not — adding them keeps the call sites type-safe.

- [ ] **Step 1: Edit the type**

Open `backend/src/db/fee-accounting.ts`. Change lines 24-29 from:

```ts
export type FeeBucketDebitStatus =
  | "pending"
  | "processing"
  | "error"
  | "completed"
  | "failed";
```

to:

```ts
export type FeeBucketDebitStatus =
  | "pending"
  | "held"
  | "processing"
  | "error"
  | "completed"
  | "failed"
  | "rejected";
```

- [ ] **Step 2: Run typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/db/fee-accounting.ts
git commit -m "feat(307): extend FeeBucketDebitStatus with held/rejected"
```

---

## Task 4: Update balance + stats queries to include `held` and exclude `rejected`

**Files:**
- Modify: `backend/src/db/referrals.ts:290-358` (`getPendingBalanceByUserId`, `getReferralStatsByUserId`)
- Test: `backend/src/__tests__/referral-balance.test.ts` (create)

A `held` claim must continue to be subtracted from the user's balance (so they can't double-request while one is held). A `rejected` claim must NOT be subtracted (so the user's balance is restored after rejection).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/referral-balance.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { createDb } from "../db.js";
import { resetDb, getTestDatabaseUrl } from "./helpers/test-db.js";

const DATABASE_URL = getTestDatabaseUrl();
const db = createDb(DATABASE_URL);

describe("referral balance: held subtracts, rejected does not (spec 307)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it("subtracts held claims from pending balance", async () => {
    await db.insertReferralEarning({
      referrerUserId: "u1",
      refereeUserId: "u2",
      referrerWallet: "Wr",
      refereeWallet: "We",
      roundId: "r1",
      gameType: "flipyou",
      wagerLamports: 1_000_000_000,
      feeLamports: 50_000_000,
      referrerEarnedLamports: 5_000_000,
      referrerRateBps: 1000,
    });

    const claim = await db.insertReferralClaim("u1", "Wr", "1000000");
    await db.sql`UPDATE referral_claims SET status='held', hold_reason='above_threshold' WHERE id=${claim.id}`;

    const pending = await db.getPendingBalanceByUserId("u1");
    expect(pending).toBe("4000000"); // 5_000_000 earning − 1_000_000 held
  });

  it("does not subtract rejected claims from pending balance", async () => {
    await db.insertReferralEarning({
      referrerUserId: "u1",
      refereeUserId: "u2",
      referrerWallet: "Wr",
      refereeWallet: "We",
      roundId: "r1",
      gameType: "flipyou",
      wagerLamports: 1_000_000_000,
      feeLamports: 50_000_000,
      referrerEarnedLamports: 5_000_000,
      referrerRateBps: 1000,
    });

    const claim = await db.insertReferralClaim("u1", "Wr", "1000000");
    await db.sql`UPDATE referral_claims SET status='rejected' WHERE id=${claim.id}`;

    const pending = await db.getPendingBalanceByUserId("u1");
    expect(pending).toBe("5000000"); // 5_000_000 earning, rejected ignored
  });
});
```

If `db.sql` is not exposed, use `getDirectSql()` or the helpers used by the existing referral tests — adapt the import to match what `backend/src/__tests__/referral-routes.test.ts` uses to manipulate rows directly.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/__tests__/referral-balance.test.ts
```

Expected: FAIL — both assertions fail. Currently `held` is not in the subtraction set (so the first test reports `5000000` instead of `4000000`), and `rejected` would silently NOT be subtracted only by accident; the test asserts the explicit behavior.

- [ ] **Step 3: Update the queries**

Open `backend/src/db/referrals.ts`. In `getPendingBalanceByUserId` (around line 300), change:

```ts
            FROM referral_claims WHERE user_id = ${userId} AND status IN ('pending', 'processing', 'error', 'completed')
```

to:

```ts
            FROM referral_claims WHERE user_id = ${userId} AND status IN ('pending', 'held', 'processing', 'error', 'completed')
```

In `getReferralStatsByUserId` (around line 354), change the same status set in the `pending_lamports` subquery from:

```ts
            - COALESCE((SELECT SUM(amount_lamports) FROM referral_claims WHERE user_id = ${userId} AND status IN ('pending','processing','error','completed')), 0)
```

to:

```ts
            - COALESCE((SELECT SUM(amount_lamports) FROM referral_claims WHERE user_id = ${userId} AND status IN ('pending','held','processing','error','completed')), 0)
```

`'rejected'` remains absent from both queries, so rejected claims do not subtract.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/__tests__/referral-balance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full referral test suite to catch regressions**

```bash
cd backend && pnpm vitest run --testNamePattern referral
```

Expected: PASS for everything that was previously passing.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/db/referrals.ts src/__tests__/referral-balance.test.ts
git commit -m "feat(307): held subtracts and rejected does not in pending balance + stats"
```

---

## Task 5: Create the payout-controls DB module

**Files:**
- Create: `backend/src/db/payout-controls.ts`
- Test: `backend/src/db/__tests__/payout-controls.test.ts`

A small, focused module that exposes typed accessors for `payout_controls`. The handler, sweeper, and peek read models all consume from here.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/__tests__/payout-controls.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import postgres from "postgres";
import {
  createPayoutControlsDb,
  type PayoutControls,
} from "../payout-controls.js";
import { getTestDatabaseUrl, resetDb } from "../../__tests__/helpers/test-db.js";

const sql = postgres(getTestDatabaseUrl());
const db = createPayoutControlsDb(sql);

describe("payout-controls DB module", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await sql.end();
  });

  it("returns the seeded referral row by default", async () => {
    const row = await db.getPayoutControls("referral");
    expect(row).toMatchObject<Partial<PayoutControls>>({
      claim_kind: "referral",
      pause_enabled: false,
      review_threshold_lamports: "1000000000",
    });
  });

  it("returns null for an unknown claim kind", async () => {
    const row = await db.getPayoutControls("crate");
    expect(row).toBeNull();
  });

  it("setPayoutPause toggles pause_enabled and bumps updated_by/updated_at", async () => {
    const before = await db.getPayoutControls("referral");
    await db.setPayoutPause("referral", true, "alice@digitalmob.ro");
    const after = await db.getPayoutControls("referral");
    expect(after?.pause_enabled).toBe(true);
    expect(after?.updated_by).toBe("alice@digitalmob.ro");
    expect(after?.updated_at.getTime()).toBeGreaterThanOrEqual(before!.updated_at.getTime());
  });

  it("updatePayoutControls sets threshold and bumps updated_by/updated_at", async () => {
    await db.updatePayoutControls("referral", "500000000", "alice@digitalmob.ro");
    const after = await db.getPayoutControls("referral");
    expect(after?.review_threshold_lamports).toBe("500000000");
    expect(after?.updated_by).toBe("alice@digitalmob.ro");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pnpm vitest run src/db/__tests__/payout-controls.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `backend/src/db/payout-controls.ts`:

```ts
/**
 * payout-controls — DB accessors for the payout_controls table (spec 307).
 *
 * One row per `claim_kind` (today: `referral`). The queue handler reads it on
 * every claim invocation; the peek admin mutates it. Lamports are stored as
 * BIGINT in the DB and surfaced to TypeScript as strings to avoid Number
 * precision loss.
 */

import type postgres from "postgres";

export interface PayoutControls {
  claim_kind: string;
  pause_enabled: boolean;
  review_threshold_lamports: string;
  updated_by: string | null;
  updated_at: Date;
}

export interface PayoutControlsDb {
  /** Returns the row for `claimKind`, or null if no row exists. */
  getPayoutControls(claimKind: string): Promise<PayoutControls | null>;

  /** Sets `pause_enabled` and stamps `updated_by`/`updated_at`. */
  setPayoutPause(
    claimKind: string,
    enabled: boolean,
    actorEmail: string,
  ): Promise<void>;

  /**
   * Updates `review_threshold_lamports` and stamps `updated_by`/`updated_at`.
   * Caller must validate non-negativity before calling.
   */
  updatePayoutControls(
    claimKind: string,
    thresholdLamports: string,
    actorEmail: string,
  ): Promise<void>;
}

interface RawRow {
  claim_kind: string;
  pause_enabled: boolean;
  review_threshold_lamports: string;
  updated_by: string | null;
  updated_at: Date;
}

export function createPayoutControlsDb(
  sql: postgres.Sql,
): PayoutControlsDb {
  return {
    async getPayoutControls(claimKind) {
      const rows = await sql<RawRow[]>`
        SELECT claim_kind, pause_enabled, review_threshold_lamports::TEXT AS review_threshold_lamports,
               updated_by, updated_at
        FROM payout_controls
        WHERE claim_kind = ${claimKind}
      `;
      return rows[0] ?? null;
    },

    async setPayoutPause(claimKind, enabled, actorEmail) {
      await sql`
        UPDATE payout_controls
        SET pause_enabled = ${enabled},
            updated_by = ${actorEmail},
            updated_at = now()
        WHERE claim_kind = ${claimKind}
      `;
    },

    async updatePayoutControls(claimKind, thresholdLamports, actorEmail) {
      await sql`
        UPDATE payout_controls
        SET review_threshold_lamports = ${thresholdLamports}::BIGINT,
            updated_by = ${actorEmail},
            updated_at = now()
        WHERE claim_kind = ${claimKind}
      `;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/db/__tests__/payout-controls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/db/payout-controls.ts src/db/__tests__/payout-controls.test.ts
git commit -m "feat(307): payout-controls DB module"
```

---

## Task 6: Payout gate service (FR-1)

**Files:**
- Create: `backend/src/services/payout-gate.ts`
- Test: `backend/src/services/__tests__/payout-gate.test.ts`

A pure function. No DB, no RPC. Encodes the four-rule gate from spec FR-1.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/payout-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateGate, type GateClaim, type GateControls } from "../payout-gate.js";

const baseControls: GateControls = {
  pause_enabled: false,
  review_threshold_lamports: "1000000000", // 1 SOL
};

const baseClaim: GateClaim = {
  amount_lamports: "100000000", // 0.1 SOL
  reviewed_at: null,
};

const NOW = new Date("2026-05-04T12:00:00Z");

describe("evaluateGate (spec 307 FR-1)", () => {
  it("proceeds when nothing is set", () => {
    expect(evaluateGate(baseClaim, baseControls, NOW)).toEqual({ proceed: true });
  });

  it("holds with global_pause when pause is enabled (even with low amount)", () => {
    const result = evaluateGate(baseClaim, { ...baseControls, pause_enabled: true }, NOW);
    expect(result).toEqual({ proceed: false, holdReason: "global_pause" });
  });

  it("holds with above_threshold when amount >= threshold", () => {
    const claim: GateClaim = { amount_lamports: "1000000000", reviewed_at: null };
    expect(evaluateGate(claim, baseControls, NOW)).toEqual({
      proceed: false,
      holdReason: "above_threshold",
    });
  });

  it("proceeds when amount equals threshold − 1 lamport", () => {
    const claim: GateClaim = { amount_lamports: "999999999", reviewed_at: null };
    expect(evaluateGate(claim, baseControls, NOW)).toEqual({ proceed: true });
  });

  it("admin-approved short-circuit lets above-threshold claim proceed when reviewed_at is set", () => {
    const claim: GateClaim = { amount_lamports: "5000000000", reviewed_at: NOW };
    expect(evaluateGate(claim, baseControls, NOW)).toEqual({ proceed: true });
  });

  it("pause overrides admin approval (emergency wins)", () => {
    const claim: GateClaim = { amount_lamports: "5000000000", reviewed_at: NOW };
    const result = evaluateGate(
      claim,
      { ...baseControls, pause_enabled: true },
      NOW,
    );
    expect(result).toEqual({ proceed: false, holdReason: "global_pause" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pnpm vitest run src/services/__tests__/payout-gate.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the gate**

Create `backend/src/services/payout-gate.ts`:

```ts
/**
 * payout-gate — pure gate function called inside the queue handler before any
 * SOL transfer (spec 307 FR-1).
 *
 * Evaluation order (short-circuits on first match):
 *   1. Pause check — if pause_enabled, hold with global_pause. ALWAYS first;
 *      pause overrides every other consideration including admin approval.
 *   2. Admin-approved short-circuit — if reviewed_at is set, proceed
 *      (admin has explicitly accepted the risk). Pause has already been
 *      checked, so this short-circuit is safe.
 *   3. Threshold check — if amount >= threshold, hold with above_threshold.
 *   4. Otherwise proceed.
 *
 * No DB, no RPC, no I/O. The handler owns side effects (DB writes).
 */

export interface GateClaim {
  amount_lamports: string;
  reviewed_at: Date | null;
}

export interface GateControls {
  pause_enabled: boolean;
  review_threshold_lamports: string;
}

export type GateDecision =
  | { proceed: true }
  | { proceed: false; holdReason: "global_pause" | "above_threshold" };

// `now` is currently unused but accepted so future per-kind policy (e.g. windowed
// caps) does not require changing the call sites.
export function evaluateGate(
  claim: GateClaim,
  controls: GateControls,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _now: Date,
): GateDecision {
  if (controls.pause_enabled) {
    return { proceed: false, holdReason: "global_pause" };
  }

  if (claim.reviewed_at !== null) {
    return { proceed: true };
  }

  const amount = BigInt(claim.amount_lamports);
  const threshold = BigInt(controls.review_threshold_lamports);
  if (amount >= threshold) {
    return { proceed: false, holdReason: "above_threshold" };
  }

  return { proceed: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/services/__tests__/payout-gate.test.ts
```

Expected: PASS — all six cases.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/services/payout-gate.ts src/services/__tests__/payout-gate.test.ts
git commit -m "feat(307): payout-gate pure function with precedence tests"
```

---

## Task 7: Wire the gate into the referral claim handler (FR-2)

**Files:**
- Modify: `backend/src/queue/handlers/referral-claim.ts`
- Test: `backend/src/__tests__/referral-claim-gate.test.ts` (create)

The handler must (a) treat `held` and `rejected` as terminal-for-this-event idempotency states, and (b) load the controls and call the gate before any transfer attempt.

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/__tests__/referral-claim-gate.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { createDb } from "../db.js";
import { createClaimHandler } from "../queue/handlers/referral-claim.js";
import { getTestDatabaseUrl, resetDb } from "./helpers/test-db.js";

const db = createDb(getTestDatabaseUrl());
// Connection isn't used unless gate proceeds — pass a stub URL.
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const serverKeypair = Keypair.generate();

const handler = createClaimHandler({ db, connection, serverKeypair });

async function seedEarning(userId: string, lamports: number) {
  await db.insertReferralEarning({
    referrerUserId: userId,
    refereeUserId: "ref",
    referrerWallet: "Wr",
    refereeWallet: "We",
    roundId: `r-${Math.random()}`,
    gameType: "flipyou",
    wagerLamports: lamports * 20,
    feeLamports: lamports * 2,
    referrerEarnedLamports: lamports,
    referrerRateBps: 1000,
  });
}

describe("referral-claim handler gate integration (spec 307 FR-2)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await db.end();
  });

  it("holds with global_pause when pause is on", async () => {
    await db.sql`UPDATE payout_controls SET pause_enabled=true WHERE claim_kind='referral'`;
    await seedEarning("u1", 100_000);
    const claim = await db.insertReferralClaim("u1", "Wr", "10000");

    await handler({
      claimId: claim.id,
      userId: "u1",
      wallet: "Wr",
      amountLamports: "10000",
    });

    const after = await db.getReferralClaim(claim.id);
    expect(after?.status).toBe("held");
    expect(after?.hold_reason).toBe("global_pause");
    expect(after?.tx_signature).toBeNull();
  });

  it("holds with above_threshold when amount exceeds threshold", async () => {
    await db.sql`UPDATE payout_controls SET review_threshold_lamports=5000 WHERE claim_kind='referral'`;
    await seedEarning("u1", 100_000);
    const claim = await db.insertReferralClaim("u1", "Wr", "10000");

    await handler({
      claimId: claim.id,
      userId: "u1",
      wallet: "Wr",
      amountLamports: "10000",
    });

    const after = await db.getReferralClaim(claim.id);
    expect(after?.status).toBe("held");
    expect(after?.hold_reason).toBe("above_threshold");
  });

  it("is a no-op when claim is already held", async () => {
    await seedEarning("u1", 100_000);
    const claim = await db.insertReferralClaim("u1", "Wr", "10000");
    await db.sql`UPDATE referral_claims SET status='held', hold_reason='above_threshold' WHERE id=${claim.id}`;

    await handler({
      claimId: claim.id,
      userId: "u1",
      wallet: "Wr",
      amountLamports: "10000",
    });

    const after = await db.getReferralClaim(claim.id);
    expect(after?.status).toBe("held");
    expect(after?.hold_reason).toBe("above_threshold");
  });

  it("is a no-op when claim is already rejected", async () => {
    await seedEarning("u1", 100_000);
    const claim = await db.insertReferralClaim("u1", "Wr", "10000");
    await db.sql`UPDATE referral_claims SET status='rejected' WHERE id=${claim.id}`;

    await handler({
      claimId: claim.id,
      userId: "u1",
      wallet: "Wr",
      amountLamports: "10000",
    });

    const after = await db.getReferralClaim(claim.id);
    expect(after?.status).toBe("rejected");
    expect(after?.tx_signature).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pnpm vitest run src/__tests__/referral-claim-gate.test.ts
```

Expected: FAIL — handler does not yet call the gate; it would mark the first two claims `processing` and try to call Solana, which will throw against the stub connection.

- [ ] **Step 3: Update the handler**

Open `backend/src/queue/handlers/referral-claim.ts`. Apply three changes:

3a. Import the gate and the payout-controls accessor at the top:

```ts
import { evaluateGate } from "../../services/payout-gate.js";
import { createPayoutControlsDb } from "../../db/payout-controls.js";
```

3b. Update the `ClaimStatus` type and the `setClaimStatus` helper to accept `held` / `rejected` and an optional `holdReason`:

Replace lines 25 and 30-44 with:

```ts
type ClaimStatus =
  | "pending"
  | "held"
  | "processing"
  | "error"
  | "completed"
  | "failed"
  | "rejected";

type HoldReason = "global_pause" | "above_threshold";

async function setClaimStatus(
  db: Db,
  claimId: string,
  status: ClaimStatus,
  opts?: {
    error?: string;
    txSignature?: string;
    incrementRetry?: boolean;
    holdReason?: HoldReason | null;
  },
): Promise<void> {
  await db.withTransaction(async (txDb) => {
    await txDb.updateClaimStatus(claimId, status, opts);
    await txDb.updateFeeBucketDebitStatus("referral", "claim", claimId, status);
  });
}
```

3c. Update the handler body. Replace the idempotency block (lines 67-87) and add the gate call before `setClaimStatus(db, claimId, "processing")`. The full new body for the returned async function (replacing lines 55-200) is:

```ts
  return async (payload: Record<string, unknown>): Promise<void> => {
    const claimId = payload.claimId as string;
    const userId = payload.userId as string;
    const wallet = payload.wallet as string;
    const amountLamports = payload.amountLamports as string;

    if (!claimId || !userId || !wallet || !amountLamports) {
      throw new Error(
        `referral.claim_requested: malformed payload — missing claimId, userId, wallet, or amountLamports`,
      );
    }

    // 1. Load claim and check idempotency (spec 307: held/rejected join completed/failed as no-op states)
    const claim = await db.getReferralClaim(claimId);
    if (!claim) {
      logger.warn("referral claim handler: claim not found", { claimId });
      return;
    }

    if (
      claim.status === "completed" ||
      claim.status === "failed" ||
      claim.status === "rejected" ||
      claim.status === "held"
    ) {
      logger.info("referral claim handler: terminal-for-event state, skipping", {
        claimId,
        status: claim.status,
      });
      return;
    }

    // 2. Run the payout gate before any transfer (spec 307 FR-2)
    const payoutControlsDb = createPayoutControlsDb(db.sql);
    const controls = await payoutControlsDb.getPayoutControls(claim.claim_kind);
    if (!controls) {
      throw new Error(
        `referral.claim_requested: no payout_controls row for claim_kind='${claim.claim_kind}'`,
      );
    }

    const decision = evaluateGate(
      { amount_lamports: claim.amount_lamports, reviewed_at: claim.reviewed_at },
      {
        pause_enabled: controls.pause_enabled,
        review_threshold_lamports: controls.review_threshold_lamports,
      },
      new Date(),
    );

    if (decision.proceed === false) {
      await setClaimStatus(db, claimId, "held", { holdReason: decision.holdReason });
      logger.info("referral claim handler: gate held claim", {
        claimId,
        holdReason: decision.holdReason,
      });
      return;
    }

    // 3. Existing flow — mark processing, re-verify balance, transfer, settle
    await setClaimStatus(db, claimId, "processing");

    try {
      const pendingStr = await db.getPendingBalanceByUserId(userId);
      const pending = BigInt(pendingStr);
      const amount = BigInt(amountLamports);

      if (pending < amount) {
        await setClaimStatus(db, claimId, "failed", {
          error: `Insufficient balance: pending=${pendingStr}, claim=${amountLamports}`,
        });
        logger.warn("referral claim handler: insufficient balance", {
          claimId, userId, wallet, pending: pendingStr, amount: amountLamports,
        });
        return;
      }

      const recipient = new PublicKey(wallet);
      const lamports = Number(amount);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: serverKeypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      });

      tx.add(
        SystemProgram.transfer({
          fromPubkey: serverKeypair.publicKey,
          toPubkey: recipient,
          lamports,
        }),
      );
      tx.sign(serverKeypair);

      const txSignature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });

      const confirmation = await connection.confirmTransaction(
        { signature: txSignature, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction confirmed with error: ${JSON.stringify(confirmation.value.err)}`,
        );
      }

      await setClaimStatus(db, claimId, "completed", { txSignature });
      logger.info("referral claim handler: transfer completed", {
        claimId, userId, wallet, amountLamports, txSignature,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown transfer error";
      const nextRetry = claim.retry_count + 1;
      const isFinal = nextRetry >= MAX_CLAIM_RETRIES;
      const nextStatus = isFinal ? "failed" : "error";

      await setClaimStatus(db, claimId, nextStatus, {
        error: errorMsg,
        incrementRetry: true,
      });

      if (isFinal) {
        logger.error("referral claim handler: max retries exceeded, permanently failed", {
          claimId, userId, wallet, amountLamports, retries: nextRetry, error: errorMsg,
        });
        return;
      }

      logger.warn("referral claim handler: transient error, will retry", {
        claimId, userId, wallet, amountLamports, retry: nextRetry, error: errorMsg,
      });
      throw err;
    }
  };
```

3d. The `updateClaimStatus` DB function takes `meta` of shape `{ txSignature?, error?, incrementRetry? }`. Add `holdReason` handling. Open `backend/src/db/referrals.ts` and update the `updateClaimStatus` method body (around line 420) to:

```ts
    async updateClaimStatus(claimId, status, meta) {
      const rows = await sql<ReferralClaim[]>`
        UPDATE referral_claims
        SET
          status = ${status},
          tx_signature = COALESCE(${meta?.txSignature ?? null}, tx_signature),
          error = COALESCE(${meta?.error ?? null}, error),
          hold_reason = ${
            status === "held"
              ? (meta?.holdReason ?? null)
              : null
          },
          retry_count = ${meta?.incrementRetry ? sql`retry_count + 1` : sql`retry_count`},
          processed_at = ${
            status === "completed" || status === "failed" || status === "rejected"
              ? sql`now()`
              : sql`processed_at`
          }
        WHERE id = ${claimId}
        RETURNING *
      `;
      return rows[0]!;
    },
```

Update the `meta` param type on the `ReferralsDb` interface (around line 173):

```ts
  updateClaimStatus(
    claimId: string,
    status: ReferralClaim["status"],
    meta?: {
      txSignature?: string;
      error?: string;
      incrementRetry?: boolean;
      holdReason?: "global_pause" | "above_threshold" | null;
    },
  ): Promise<ReferralClaim>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/__tests__/referral-claim-gate.test.ts
```

Expected: PASS — all four cases.

- [ ] **Step 5: Run all referral tests**

```bash
cd backend && pnpm vitest run --testNamePattern referral
```

Expected: PASS for all previously-passing tests. If `setClaimStatus(...)` callers in the handler were missed, the existing handler tests will surface it.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/queue/handlers/referral-claim.ts src/db/referrals.ts src/__tests__/referral-claim-gate.test.ts
git commit -m "feat(307): wire payout-gate into referral-claim handler"
```

---

## Task 8: Pause-release sweeper (FR-3)

**Files:**
- Create: `backend/src/queue/sweepers/payout-pause-sweeper.ts`
- Test: `backend/src/queue/sweepers/__tests__/payout-pause-sweeper.test.ts`
- Modify: `backend/src/queue/worker.ts` (call sweeper each tick)

When `payout_controls.pause_enabled` flips off, every `held / global_pause` claim for that kind is returned to `pending` and a fresh `referral.claim_requested` event is emitted in the same DB transaction.

- [ ] **Step 1: Write the failing test**

Create `backend/src/queue/sweepers/__tests__/payout-pause-sweeper.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { runPayoutPauseSweeper } from "../payout-pause-sweeper.js";
import { createDb } from "../../../db.js";
import { getTestDatabaseUrl, resetDb } from "../../../__tests__/helpers/test-db.js";

const db = createDb(getTestDatabaseUrl());

async function makeHeldByPause(userId: string): Promise<string> {
  await db.insertReferralEarning({
    referrerUserId: userId,
    refereeUserId: "ref",
    referrerWallet: "Wr",
    refereeWallet: "We",
    roundId: `r-${userId}-${Math.random()}`,
    gameType: "flipyou",
    wagerLamports: 1_000_000,
    feeLamports: 100_000,
    referrerEarnedLamports: 100_000,
    referrerRateBps: 1000,
  });
  const claim = await db.insertReferralClaim(userId, `W-${userId}`, "10000");
  await db.sql`UPDATE referral_claims SET status='held', hold_reason='global_pause' WHERE id=${claim.id}`;
  return claim.id;
}

describe("payout-pause sweeper (spec 307 FR-3)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await db.end();
  });

  it("returns held/global_pause to pending and emits fresh event when pause is off", async () => {
    const id = await makeHeldByPause("u1");
    // pause is OFF by default
    const released = await runPayoutPauseSweeper(db.sql);
    expect(released).toBe(1);

    const after = await db.getReferralClaim(id);
    expect(after?.status).toBe("pending");
    expect(after?.hold_reason).toBeNull();

    const events = await db.sql<{ event_type: string; payload: any }[]>`
      SELECT event_type, payload FROM event_queue WHERE event_type = 'referral.claim_requested'
    `;
    expect(events.length).toBe(1);
    expect(events[0]!.payload.claimId).toBe(id);
  });

  it("does not touch held/above_threshold claims", async () => {
    await db.insertReferralEarning({
      referrerUserId: "u2", refereeUserId: "ref", referrerWallet: "Wr",
      refereeWallet: "We", roundId: "r2", gameType: "flipyou",
      wagerLamports: 1_000_000, feeLamports: 100_000,
      referrerEarnedLamports: 100_000, referrerRateBps: 1000,
    });
    const claim = await db.insertReferralClaim("u2", "W-u2", "10000");
    await db.sql`UPDATE referral_claims SET status='held', hold_reason='above_threshold' WHERE id=${claim.id}`;

    const released = await runPayoutPauseSweeper(db.sql);
    expect(released).toBe(0);

    const after = await db.getReferralClaim(claim.id);
    expect(after?.status).toBe("held");
    expect(after?.hold_reason).toBe("above_threshold");
  });

  it("does NOT release when pause is still on", async () => {
    await db.sql`UPDATE payout_controls SET pause_enabled=true WHERE claim_kind='referral'`;
    await makeHeldByPause("u3");

    const released = await runPayoutPauseSweeper(db.sql);
    expect(released).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pnpm vitest run src/queue/sweepers/__tests__/payout-pause-sweeper.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the sweeper**

Create `backend/src/queue/sweepers/payout-pause-sweeper.ts`:

```ts
/**
 * payout-pause-sweeper — runs on each event-queue worker tick (spec 307 FR-3).
 *
 * For every claim_kind whose payout_controls.pause_enabled = false, scans
 * held/global_pause claims and atomically:
 *   - sets status='pending', clears hold_reason
 *   - emits a fresh referral.claim_requested event (claim_kind='referral' only)
 *
 * held/above_threshold claims are never touched — admin must approve or reject.
 *
 * Returns the number of claims released for telemetry/tests.
 */

import type postgres from "postgres";
import { logger } from "../../logger.js";

interface HeldRow {
  id: string;
  user_id: string;
  wallet: string;
  amount_lamports: string;
  claim_kind: string;
}

export async function runPayoutPauseSweeper(sql: postgres.Sql): Promise<number> {
  // Find candidates in a single query: held/global_pause claims whose kind is not paused.
  const candidates = await sql<HeldRow[]>`
    SELECT c.id, c.user_id, c.wallet, c.amount_lamports::TEXT AS amount_lamports, c.claim_kind
    FROM referral_claims c
    JOIN payout_controls p ON p.claim_kind = c.claim_kind
    WHERE c.status = 'held'
      AND c.hold_reason = 'global_pause'
      AND p.pause_enabled = false
    ORDER BY c.requested_at ASC
    LIMIT 100
  `;

  if (candidates.length === 0) return 0;

  let released = 0;
  for (const row of candidates) {
    try {
      await sql.begin(async (tx) => {
        const updated = await tx<{ id: string }[]>`
          UPDATE referral_claims
          SET status='pending', hold_reason=NULL
          WHERE id=${row.id} AND status='held' AND hold_reason='global_pause'
          RETURNING id
        `;
        if (updated.length === 0) return;

        // Currently only the referral kind exists; future kinds will need their
        // own emit path. Today we hard-code the event type to keep the sweeper
        // honest about what it's doing.
        if (row.claim_kind === "referral") {
          await tx`
            INSERT INTO event_queue (event_type, payload, max_attempts, scheduled_at)
            VALUES (
              'referral.claim_requested',
              ${tx.json({
                claimId: row.id,
                userId: row.user_id,
                wallet: row.wallet,
                amountLamports: row.amount_lamports,
              } as postgres.JSONValue)},
              3,
              now()
            )
          `;
        }
        released += 1;
      });
    } catch (err) {
      logger.error("payout-pause sweeper: failed to release claim", {
        claimId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (released > 0) {
    logger.info("payout-pause sweeper: released claims", { released });
  }
  return released;
}
```

- [ ] **Step 4: Hook the sweeper into the worker tick**

Open `backend/src/queue/worker.ts`. Add the import near the top (after the existing `getHandler` import):

```ts
import { runPayoutPauseSweeper } from "./sweepers/payout-pause-sweeper.js";
```

In the `poll` function, immediately after the line that starts `for (const event of events) {` block ends (line 147), add a sweep step at the END of `poll` (so it runs after event dispatch but inside the same tick):

Insert before the closing `}` of `async function poll()` (replace the existing closing of the for loop and function with):

```ts
    }

    // Spec 307 FR-3 — release pause-held referral claims when pause is off.
    try {
      await runPayoutPauseSweeper(sql);
    } catch (err) {
      logger.error("event queue worker: payout-pause sweeper error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
```

(That closes the original `for` block, runs the sweeper, then closes `poll`.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/queue/sweepers/__tests__/payout-pause-sweeper.test.ts
```

Expected: PASS — all three cases.

- [ ] **Step 6: Run worker tests to confirm no regressions**

```bash
cd backend && pnpm vitest run src/queue/__tests__/
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/queue/sweepers/ src/queue/worker.ts
git commit -m "feat(307): pause-release sweeper on worker tick"
```

---

## Task 9: Public claim status mapping (FR-5)

**Files:**
- Modify: `backend/src/routes/referral.ts:846` (and adjacent response shape)
- Test: `backend/src/__tests__/referral-routes.test.ts` (extend existing suite)

The internal `held` and `rejected` statuses MUST surface to the user as `pending`. No `holdReason` or `reviewedBy` field appears in the public response.

- [ ] **Step 1: Inspect the existing handler**

Open `backend/src/routes/referral.ts` and find the `GET /claim/:claimId` handler (search for `Poll claim status` or `claim.status`). Note the lines that build the response body (around 846).

- [ ] **Step 2: Write the failing test**

Append to `backend/src/__tests__/referral-routes.test.ts` (after the existing `GET /claim/:claimId` describe block, in the same `describe("GET /referral/claim/:claimId", ...)`):

```ts
    it("maps internal 'held' to public 'pending' (spec 307 FR-5)", async () => {
      const claim = await db.insertReferralClaim("user1", "Wr", "10000");
      await db.sql`UPDATE referral_claims SET status='held', hold_reason='above_threshold' WHERE id=${claim.id}`;
      const res = await app.request(`/referral/claim/${claim.id}`, {
        headers: authHeader("user1"),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe("pending");
      expect(body.data).not.toHaveProperty("holdReason");
      expect(body.data).not.toHaveProperty("reviewedBy");
    });

    it("maps internal 'rejected' to public 'pending' (spec 307 FR-5)", async () => {
      const claim = await db.insertReferralClaim("user1", "Wr", "10000");
      await db.sql`UPDATE referral_claims SET status='rejected' WHERE id=${claim.id}`;
      const res = await app.request(`/referral/claim/${claim.id}`, {
        headers: authHeader("user1"),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe("pending");
    });
```

(Use `authHeader` and `db`/`app` per the existing test fixture wiring; adjust import names if the test file uses different identifiers.)

- [ ] **Step 3: Run to verify it fails**

```bash
cd backend && pnpm vitest run src/__tests__/referral-routes.test.ts -t "maps internal"
```

Expected: FAIL — currently the route returns the raw status (`held` or `rejected`).

- [ ] **Step 4: Update the route**

In `backend/src/routes/referral.ts` find the response builder for `GET /claim/:claimId`. Where it currently does (approximately):

```ts
        ok(c, {
          claimId: claim.id,
          amountLamports: claim.amount_lamports,
          status: claim.status,
          ...(claim.tx_signature ? { txSignature: claim.tx_signature } : {}),
        }),
```

Replace with:

```ts
        ok(c, {
          claimId: claim.id,
          amountLamports: claim.amount_lamports,
          // Spec 307 FR-5 + Invariant 10 — internal `held` and `rejected` are
          // operator-only states. They surface to the user as `pending` so
          // operator decisions never leak into the public surface.
          status:
            claim.status === "held" || claim.status === "rejected"
              ? "pending"
              : claim.status,
          ...(claim.tx_signature ? { txSignature: claim.tx_signature } : {}),
        }),
```

If the response is built using a Zod-validated schema (e.g. `ClaimResponseSchema`), confirm that schema's `status` enum contains only `pending|processing|completed|failed`. If it includes `held` or `rejected`, REMOVE them — they must not be part of the public contract.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && pnpm vitest run src/__tests__/referral-routes.test.ts -t "claim/:claimId"
```

Expected: PASS for both new cases and the original ones.

- [ ] **Step 6: Run the OpenAPI contract test**

```bash
cd backend && pnpm vitest run src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts
```

Expected: PASS. If `held`/`rejected` were in the schema, removing them keeps the public contract consistent with the spec 300 shape.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/rng-utopia/backend
git add src/routes/referral.ts src/__tests__/referral-routes.test.ts
git commit -m "feat(307): map internal held/rejected to public pending in claim status"
```

---

## Task 10: Peek read model — held claims

**Files:**
- Create: `peek/src/server/db/queries/get-held-claims.ts`
- Test: `peek/src/server/db/queries/__tests__/get-held-claims.test.ts`

A server-only function that lists every `status='held'` claim joined with `player_profiles` for usernames.

- [ ] **Step 1: Write the failing test**

Create `peek/src/server/db/queries/__tests__/get-held-claims.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { listHeldClaims } from "../get-held-claims";
import { getPeekTestSql, resetPeekTestDb } from "../../../../__tests__/helpers/test-db";

const sql = getPeekTestSql();

describe("listHeldClaims (spec 307)", () => {
  beforeEach(async () => {
    await resetPeekTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("returns held claims oldest-first with username join", async () => {
    await sql`INSERT INTO player_profiles (user_id, username) VALUES ('u1','alice'),('u2','bob')`;
    await sql`INSERT INTO referral_claims (id, user_id, wallet, amount_lamports, status, hold_reason, claim_kind, requested_at)
              VALUES
                (gen_random_uuid(),'u1','Wr1',100000,'held','above_threshold','referral', now() - interval '5 minutes'),
                (gen_random_uuid(),'u2','Wr2',200000,'held','global_pause','referral', now())`;
    const rows = await listHeldClaims();
    expect(rows.length).toBe(2);
    expect(rows[0]!.userId).toBe("u1");
    expect(rows[0]!.username).toBe("alice");
    expect(rows[0]!.holdReason).toBe("above_threshold");
    expect(rows[1]!.userId).toBe("u2");
    expect(rows[1]!.holdReason).toBe("global_pause");
  });

  it("returns empty array when there are no held claims", async () => {
    const rows = await listHeldClaims();
    expect(rows).toEqual([]);
  });
});
```

(If peek's DB test helpers don't exist under that path, use whatever helper the existing `peek/src/server/db/queries/__tests__/get-event-queue.test.ts` uses to spin up its `sql` handle.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-held-claims.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the query**

Create `peek/src/server/db/queries/get-held-claims.ts`:

```ts
// /operations/payouts held queue read model (spec 307 FR-8).
//
// Lists every status='held' referral claim, joined with player_profiles for
// the username column. Sorted oldest-first so the longest-waiting claim
// appears at the top.

import { getPeekDbClient } from "../client";

export interface PeekHeldClaim {
  claimId: string;
  claimKind: string;
  userId: string;
  username: string | null;
  wallet: string;
  amountLamports: string;
  holdReason: "global_pause" | "above_threshold";
  requestedAt: string;
  error: string | null;
}

export async function listHeldClaims(): Promise<ReadonlyArray<PeekHeldClaim>> {
  const sql = getPeekDbClient();
  const rows = await sql<
    {
      claim_id: string;
      claim_kind: string;
      user_id: string;
      username: string | null;
      wallet: string;
      amount_lamports: string;
      hold_reason: "global_pause" | "above_threshold";
      requested_at: Date;
      error: string | null;
    }[]
  >`
    SELECT
      c.id::TEXT AS claim_id,
      c.claim_kind,
      c.user_id,
      pp.username,
      c.wallet,
      c.amount_lamports::TEXT AS amount_lamports,
      c.hold_reason,
      c.requested_at,
      c.error
    FROM referral_claims c
    LEFT JOIN player_profiles pp ON pp.user_id = c.user_id
    WHERE c.status = 'held'
    ORDER BY c.requested_at ASC
    LIMIT 200
  `;

  return rows.map((row) => ({
    claimId: row.claim_id,
    claimKind: row.claim_kind,
    userId: row.user_id,
    username: row.username,
    wallet: row.wallet,
    amountLamports: row.amount_lamports,
    holdReason: row.hold_reason,
    requestedAt: row.requested_at.toISOString(),
    error: row.error,
  }));
}
```

(Use the same `getPeekDbClient` import path as the other peek queries in `peek/src/server/db/queries/`.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-held-claims.test.ts
```

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/get-held-claims.ts src/server/db/queries/__tests__/get-held-claims.test.ts
git commit -m "feat(307): peek listHeldClaims read model"
```

---

## Task 11: Peek read model — payout controls

**Files:**
- Create: `peek/src/server/db/queries/get-payout-controls.ts`
- Test: `peek/src/server/db/queries/__tests__/get-payout-controls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `peek/src/server/db/queries/__tests__/get-payout-controls.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { listPayoutControls } from "../get-payout-controls";
import { getPeekTestSql, resetPeekTestDb } from "../../../../__tests__/helpers/test-db";

const sql = getPeekTestSql();

describe("listPayoutControls (spec 307)", () => {
  beforeEach(async () => {
    await resetPeekTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("returns the seeded referral row with default values", async () => {
    const rows = await listPayoutControls();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      claimKind: "referral",
      pauseEnabled: false,
      reviewThresholdLamports: "1000000000",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-payout-controls.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the query**

Create `peek/src/server/db/queries/get-payout-controls.ts`:

```ts
// /operations/payouts controls strip read model (spec 307 FR-8).

import { getPeekDbClient } from "../client";

export interface PeekPayoutControlsRow {
  claimKind: string;
  pauseEnabled: boolean;
  reviewThresholdLamports: string;
  updatedBy: string | null;
  updatedAt: string;
}

export async function listPayoutControls(): Promise<
  ReadonlyArray<PeekPayoutControlsRow>
> {
  const sql = getPeekDbClient();
  const rows = await sql<
    {
      claim_kind: string;
      pause_enabled: boolean;
      review_threshold_lamports: string;
      updated_by: string | null;
      updated_at: Date;
    }[]
  >`
    SELECT claim_kind, pause_enabled, review_threshold_lamports::TEXT AS review_threshold_lamports,
           updated_by, updated_at
    FROM payout_controls
    ORDER BY claim_kind ASC
  `;

  return rows.map((row) => ({
    claimKind: row.claim_kind,
    pauseEnabled: row.pause_enabled,
    reviewThresholdLamports: row.review_threshold_lamports,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-payout-controls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/get-payout-controls.ts src/server/db/queries/__tests__/get-payout-controls.test.ts
git commit -m "feat(307): peek listPayoutControls read model"
```

---

## Task 12: Peek read model — recent payout decisions

**Files:**
- Create: `peek/src/server/db/queries/get-recent-payout-decisions.ts`
- Test: `peek/src/server/db/queries/__tests__/get-recent-payout-decisions.test.ts`

Returns the last 50 `operator_events` whose `action` starts with `payout.`.

- [ ] **Step 1: Write the failing test**

Create `peek/src/server/db/queries/__tests__/get-recent-payout-decisions.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { listRecentPayoutDecisions } from "../get-recent-payout-decisions";
import { getPeekTestSql, resetPeekTestDb } from "../../../../__tests__/helpers/test-db";

const sql = getPeekTestSql();

describe("listRecentPayoutDecisions (spec 307)", () => {
  beforeEach(async () => {
    await resetPeekTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("returns only payout.* operator_events, newest first, capped at 50", async () => {
    // 60 payout rows + 5 unrelated rows
    for (let i = 0; i < 60; i += 1) {
      await sql`INSERT INTO operator_events (event_type, payload, created_at)
                VALUES ('peek.change.applied', ${{
                  action: "payout.pause.set",
                  index: i,
                }}, now() - (${i} || ' seconds')::interval)`;
    }
    for (let i = 0; i < 5; i += 1) {
      await sql`INSERT INTO operator_events (event_type, payload)
                VALUES ('peek.change.applied', ${{ action: "kol_rate.update" }})`;
    }
    const rows = await listRecentPayoutDecisions();
    expect(rows.length).toBe(50);
    expect(rows.every((r) => r.action.startsWith("payout."))).toBe(true);
  });
});
```

(If `operator_events` schema in the test fixture differs — e.g. column names — adapt the inserts to match what `peek/src/server/audit/` actually writes. Inspect `peek/src/server/audit/index.ts` if needed.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-recent-payout-decisions.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the query**

Create `peek/src/server/db/queries/get-recent-payout-decisions.ts`:

```ts
// /operations/payouts recent decisions read model (spec 307 FR-8).
//
// Returns the latest 50 operator_events whose payload `action` begins with
// 'payout.'. Read-only — surfaces actor email, action, target, and the
// before/after diff for the operator timeline.

import { getPeekDbClient } from "../client";

export interface PeekPayoutDecision {
  id: string;
  createdAt: string;
  actor: string | null;
  action: string;
  target: string | null;
  changes: ReadonlyArray<{ field: string; before: unknown; after: unknown }> | null;
}

export async function listRecentPayoutDecisions(): Promise<
  ReadonlyArray<PeekPayoutDecision>
> {
  const sql = getPeekDbClient();
  const rows = await sql<
    {
      id: string;
      created_at: Date;
      actor: string | null;
      action: string;
      target: string | null;
      changes: ReadonlyArray<{ field: string; before: unknown; after: unknown }> | null;
    }[]
  >`
    SELECT
      id::TEXT AS id,
      created_at,
      payload->>'actor' AS actor,
      payload->>'action' AS action,
      payload->>'target' AS target,
      payload->'changes' AS changes
    FROM operator_events
    WHERE payload->>'action' LIKE 'payout.%'
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    actor: row.actor,
    action: row.action,
    target: row.target,
    changes: row.changes,
  }));
}
```

If `operator_events` payload shape uses different keys (e.g., `actor_email` vs `actor`), inspect a sample row from a recent run and adjust the SELECT projections.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd peek && pnpm vitest run src/server/db/queries/__tests__/get-recent-payout-decisions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/get-recent-payout-decisions.ts src/server/db/queries/__tests__/get-recent-payout-decisions.test.ts
git commit -m "feat(307): peek listRecentPayoutDecisions read model"
```

---

## Task 13: Peek mutations — payout-controls (`setPayoutPause`, `updatePayoutControls`)

**Files:**
- Create: `peek/src/server/mutations/payout-controls.ts`
- Test: `peek/src/server/mutations/__tests__/payout-controls.test.ts`
- Modify: `peek/src/server/mutations/registry.ts`
- Modify: `peek/src/server/access-policy.ts`

Two mutations following the existing `kol-rate.ts` pattern: Zod schema, `execute` runs in a transaction, returns a before/after diff.

- [ ] **Step 1: Write the failing test**

Create `peek/src/server/mutations/__tests__/payout-controls.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import {
  payoutPauseSetMutation,
  payoutControlsUpdateMutation,
} from "../payout-controls";
import { getPeekTestSql, resetPeekTestDb } from "../../../__tests__/helpers/test-db";

const sql = getPeekTestSql();
const actor = { email: "alice@digitalmob.ro", route: "/operations/payouts" };

describe("payout-controls mutations (spec 307 FR-7)", () => {
  beforeEach(async () => {
    await resetPeekTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("setPayoutPause toggles pause and emits a diff", async () => {
    const result = await payoutPauseSetMutation.execute({
      sql,
      input: { claimKind: "referral", enabled: true },
      actor,
    });
    expect(result.resourceId).toBe("referral");
    expect(result.changes).toEqual([
      { field: "pause_enabled", before: false, after: true },
    ]);
    const [row] = await sql`SELECT pause_enabled, updated_by FROM payout_controls WHERE claim_kind='referral'`;
    expect(row?.pause_enabled).toBe(true);
    expect(row?.updated_by).toBe("alice@digitalmob.ro");
  });

  it("updatePayoutControls validates non-negative threshold", async () => {
    await expect(
      payoutControlsUpdateMutation.schema.parseAsync({
        claimKind: "referral",
        thresholdLamports: "-1",
      }),
    ).rejects.toThrow();
  });

  it("updatePayoutControls writes a diff only for changed fields", async () => {
    const result = await payoutControlsUpdateMutation.execute({
      sql,
      input: { claimKind: "referral", thresholdLamports: "500000000" },
      actor,
    });
    expect(result.changes).toEqual([
      {
        field: "review_threshold_lamports",
        before: "1000000000",
        after: "500000000",
      },
    ]);
  });

  it("setPayoutPause is a no-op (empty diff) when pause is unchanged", async () => {
    const result = await payoutPauseSetMutation.execute({
      sql,
      input: { claimKind: "referral", enabled: false },
      actor,
    });
    expect(result.changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd peek && pnpm vitest run src/server/mutations/__tests__/payout-controls.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the mutations**

Create `peek/src/server/mutations/payout-controls.ts`:

```ts
// Approved spec 307 mutations: emergency pause toggle and review-threshold edit.
//
// Identified by `claim_kind` (TEXT primary key on payout_controls). The diff
// only includes fields whose values actually change; updated_by/updated_at are
// operator metadata and are not part of the diff.

import type { Sql } from "postgres";
import { z } from "zod";
import type { PeekAuditChange } from "../../lib/types/peek";
import type {
  PeekMutationDefinition,
  PeekMutationExecuteContext,
  PeekMutationExecuteResult,
} from "./registry";

// ── setPayoutPause ─────────────────────────────────────────────────────────

export const payoutPauseSetInputSchema = z
  .object({
    claimKind: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export type PayoutPauseSetInput = z.infer<typeof payoutPauseSetInputSchema>;

async function fetchControlsRow(
  sql: Sql,
  claimKind: string,
): Promise<{ pause_enabled: boolean; review_threshold_lamports: string } | null> {
  const rows = await sql<
    { pause_enabled: boolean; review_threshold_lamports: string }[]
  >`
    SELECT pause_enabled, review_threshold_lamports::TEXT AS review_threshold_lamports
    FROM payout_controls
    WHERE claim_kind = ${claimKind}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function executePayoutPauseSet(
  ctx: PeekMutationExecuteContext<PayoutPauseSetInput>,
): Promise<PeekMutationExecuteResult> {
  const { sql, input, actor } = ctx;
  const existing = await fetchControlsRow(sql, input.claimKind);
  if (!existing) {
    throw new Error(`payout_controls: no row for claim_kind='${input.claimKind}'`);
  }

  const changes: PeekAuditChange[] = [];
  if (existing.pause_enabled !== input.enabled) {
    changes.push({ field: "pause_enabled", before: existing.pause_enabled, after: input.enabled });
  }

  await sql`
    UPDATE payout_controls
    SET pause_enabled = ${input.enabled},
        updated_by = ${actor.email},
        updated_at = now()
    WHERE claim_kind = ${input.claimKind}
  `;

  return { resourceId: input.claimKind, changes };
}

export const payoutPauseSetMutation: PeekMutationDefinition<PayoutPauseSetInput> = {
  actionId: "payout.pause.set",
  resourceType: "payout_controls",
  schema: payoutPauseSetInputSchema,
  execute: executePayoutPauseSet as PeekMutationDefinition["execute"],
};

// ── updatePayoutControls ───────────────────────────────────────────────────

const lamportStringSchema = z
  .string()
  .regex(/^\d+$/, "lamports must be a non-negative integer string");

export const payoutControlsUpdateInputSchema = z
  .object({
    claimKind: z.string().trim().min(1),
    thresholdLamports: lamportStringSchema,
  })
  .strict();

export type PayoutControlsUpdateInput = z.infer<
  typeof payoutControlsUpdateInputSchema
>;

async function executePayoutControlsUpdate(
  ctx: PeekMutationExecuteContext<PayoutControlsUpdateInput>,
): Promise<PeekMutationExecuteResult> {
  const { sql, input, actor } = ctx;
  const existing = await fetchControlsRow(sql, input.claimKind);
  if (!existing) {
    throw new Error(`payout_controls: no row for claim_kind='${input.claimKind}'`);
  }

  const changes: PeekAuditChange[] = [];
  if (existing.review_threshold_lamports !== input.thresholdLamports) {
    changes.push({
      field: "review_threshold_lamports",
      before: existing.review_threshold_lamports,
      after: input.thresholdLamports,
    });
  }

  await sql`
    UPDATE payout_controls
    SET review_threshold_lamports = ${input.thresholdLamports}::BIGINT,
        updated_by = ${actor.email},
        updated_at = now()
    WHERE claim_kind = ${input.claimKind}
  `;

  return { resourceId: input.claimKind, changes };
}

export const payoutControlsUpdateMutation: PeekMutationDefinition<PayoutControlsUpdateInput> =
  {
    actionId: "payout.controls.update",
    resourceType: "payout_controls",
    schema: payoutControlsUpdateInputSchema,
    execute: executePayoutControlsUpdate as PeekMutationDefinition["execute"],
  };
```

- [ ] **Step 4: Register in the mutation registry**

Open `peek/src/server/mutations/registry.ts`. Add an import near the existing imports (around line 27):

```ts
import {
  payoutControlsUpdateMutation,
  payoutPauseSetMutation,
} from "./payout-controls";
```

Add both to the `entries` array (around line 67-73):

```ts
const entries: ReadonlyArray<PeekMutationDefinition> = [
  kolRateUpdateMutation as PeekMutationDefinition,
  fraudFlagStatusUpdateMutation as PeekMutationDefinition,
  dogpileCancelMutation as PeekMutationDefinition,
  rewardConfigUpdateMutation as PeekMutationDefinition,
  authWhitelistAddMutation as PeekMutationDefinition,
  payoutPauseSetMutation as PeekMutationDefinition,
  payoutControlsUpdateMutation as PeekMutationDefinition,
];
```

- [ ] **Step 5: Add access-policy rules**

Open `peek/src/server/access-policy.ts`, find `PEEK_ACTION_RULES` (around line 187), and add:

```ts
  { actionId: "payout.pause.set", roles: ["admin"] },
  { actionId: "payout.controls.update", roles: ["admin"] },
```

- [ ] **Step 6: Run the tests**

```bash
cd peek && pnpm vitest run src/server/mutations/__tests__/payout-controls.test.ts
```

Expected: PASS — all four cases.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/mutations/payout-controls.ts src/server/mutations/__tests__/payout-controls.test.ts src/server/mutations/registry.ts src/server/access-policy.ts
git commit -m "feat(307): peek payout-controls mutations + registry/access-policy entries"
```

---

## Task 14: Peek mutations — claim review (`approveClaim`, `rejectClaim`)

**Files:**
- Create: `peek/src/server/mutations/claim-review.ts`
- Test: `peek/src/server/mutations/__tests__/claim-review.test.ts`
- Modify: `peek/src/server/mutations/registry.ts`
- Modify: `peek/src/server/access-policy.ts`

Two mutations:
- `approveClaim` flips `held → pending`, sets `reviewed_at`/`reviewed_by`, emits a fresh `referral.claim_requested` event in the same DB transaction so the queue handler picks it up. The handler's gate then short-circuits at "admin-approved."
- `rejectClaim` flips `held → rejected`, requires a non-empty `note`, no event emission. The user's pending balance is restored automatically by the FR-4 query change.

- [ ] **Step 1: Write the failing test**

Create `peek/src/server/mutations/__tests__/claim-review.test.ts`:

```ts
import { describe, it, beforeEach, afterAll, expect } from "vitest";
import { approveClaimMutation, rejectClaimMutation } from "../claim-review";
import { getPeekTestSql, resetPeekTestDb } from "../../../__tests__/helpers/test-db";

const sql = getPeekTestSql();
const actor = { email: "alice@digitalmob.ro", route: "/operations/payouts" };

async function seedHeld(reason: "global_pause" | "above_threshold"): Promise<string> {
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO referral_claims (user_id, wallet, amount_lamports, status, hold_reason, claim_kind)
    VALUES ('u1','Wr',100000,'held',${reason},'referral')
    RETURNING id::TEXT
  `;
  return id;
}

describe("claim-review mutations (spec 307 FR-7)", () => {
  beforeEach(async () => {
    await resetPeekTestDb();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("approveClaim returns claim to pending, sets reviewed_at, emits queue event", async () => {
    const id = await seedHeld("above_threshold");
    const result = await approveClaimMutation.execute({
      sql, input: { claimId: id }, actor,
    });
    expect(result.resourceId).toBe(id);

    const [row] = await sql<{ status: string; hold_reason: string | null; reviewed_by: string | null }[]>`
      SELECT status, hold_reason, reviewed_by FROM referral_claims WHERE id=${id}
    `;
    expect(row?.status).toBe("pending");
    expect(row?.hold_reason).toBeNull();
    expect(row?.reviewed_by).toBe("alice@digitalmob.ro");

    const [event] = await sql<{ payload: any }[]>`
      SELECT payload FROM event_queue WHERE event_type='referral.claim_requested' AND payload->>'claimId' = ${id}
    `;
    expect(event?.payload?.claimId).toBe(id);
  });

  it("approveClaim rejects when claim is not held", async () => {
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO referral_claims (user_id, wallet, amount_lamports, status, claim_kind)
      VALUES ('u1','Wr',100000,'completed','referral') RETURNING id::TEXT
    `;
    await expect(
      approveClaimMutation.execute({ sql, input: { claimId: id }, actor }),
    ).rejects.toThrow(/not in held state/i);
  });

  it("rejectClaim requires a non-empty note", async () => {
    await expect(
      rejectClaimMutation.schema.parseAsync({ claimId: "x", note: "" }),
    ).rejects.toThrow();
  });

  it("rejectClaim sets status='rejected' and stores the note", async () => {
    const id = await seedHeld("above_threshold");
    const result = await rejectClaimMutation.execute({
      sql, input: { claimId: id, note: "fraud signal — investigate" }, actor,
    });
    expect(result.resourceId).toBe(id);

    const [row] = await sql<{ status: string; error: string | null; reviewed_by: string | null }[]>`
      SELECT status, error, reviewed_by FROM referral_claims WHERE id=${id}
    `;
    expect(row?.status).toBe("rejected");
    expect(row?.error).toBe("fraud signal — investigate");
    expect(row?.reviewed_by).toBe("alice@digitalmob.ro");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd peek && pnpm vitest run src/server/mutations/__tests__/claim-review.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the mutations**

Create `peek/src/server/mutations/claim-review.ts`:

```ts
// Approved spec 307 mutations: approveClaim and rejectClaim.
//
// Both mutations are valid only when the claim is in 'held' state. Approve
// returns the claim to 'pending', sets reviewed_at/reviewed_by, and emits a
// fresh referral.claim_requested event in the same DB transaction. The
// handler's gate short-circuits on admin-approved (reviewed_at != null) so
// the claim does not re-hold for being above threshold.
//
// Reject sets status='rejected' (terminal). The non-empty note is stored in
// the existing `error` column for context. The user's pending balance is
// restored automatically because getPendingBalanceByUserId/getReferralStatsByUserId
// exclude rejected claims (spec 307 FR-4).

import type { Sql } from "postgres";
import { z } from "zod";
import type { PeekAuditChange } from "../../lib/types/peek";
import type {
  PeekMutationDefinition,
  PeekMutationExecuteContext,
  PeekMutationExecuteResult,
} from "./registry";

interface HeldRow {
  id: string;
  status: string;
  hold_reason: string | null;
  user_id: string;
  wallet: string;
  amount_lamports: string;
  claim_kind: string;
}

async function loadClaim(sql: Sql, id: string): Promise<HeldRow | null> {
  const rows = await sql<HeldRow[]>`
    SELECT id::TEXT AS id, status, hold_reason, user_id, wallet,
           amount_lamports::TEXT AS amount_lamports, claim_kind
    FROM referral_claims
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

// ── approveClaim ──────────────────────────────────────────────────────────

export const approveClaimInputSchema = z
  .object({ claimId: z.string().trim().min(1) })
  .strict();

export type ApproveClaimInput = z.infer<typeof approveClaimInputSchema>;

async function executeApproveClaim(
  ctx: PeekMutationExecuteContext<ApproveClaimInput>,
): Promise<PeekMutationExecuteResult> {
  const { sql, input, actor } = ctx;
  const claim = await loadClaim(sql, input.claimId);
  if (!claim) throw new Error(`approveClaim: claim ${input.claimId} not found`);
  if (claim.status !== "held") {
    throw new Error(
      `approveClaim: claim is not in held state (status=${claim.status})`,
    );
  }

  await sql`
    UPDATE referral_claims
    SET status = 'pending',
        hold_reason = NULL,
        reviewed_by = ${actor.email},
        reviewed_at = now()
    WHERE id = ${input.claimId}
  `;

  if (claim.claim_kind === "referral") {
    await sql`
      INSERT INTO event_queue (event_type, payload, max_attempts, scheduled_at)
      VALUES (
        'referral.claim_requested',
        ${sql.json({
          claimId: claim.id,
          userId: claim.user_id,
          wallet: claim.wallet,
          amountLamports: claim.amount_lamports,
        } as never)},
        3,
        now()
      )
    `;
  }

  const changes: ReadonlyArray<PeekAuditChange> = [
    { field: "status", before: "held", after: "pending" },
    { field: "hold_reason", before: claim.hold_reason, after: null },
  ];

  return { resourceId: input.claimId, changes };
}

export const approveClaimMutation: PeekMutationDefinition<ApproveClaimInput> = {
  actionId: "payout.claim.approve",
  resourceType: "referral_claims",
  schema: approveClaimInputSchema,
  execute: executeApproveClaim as PeekMutationDefinition["execute"],
};

// ── rejectClaim ───────────────────────────────────────────────────────────

export const rejectClaimInputSchema = z
  .object({
    claimId: z.string().trim().min(1),
    note: z.string().trim().min(1, "note is required"),
  })
  .strict();

export type RejectClaimInput = z.infer<typeof rejectClaimInputSchema>;

async function executeRejectClaim(
  ctx: PeekMutationExecuteContext<RejectClaimInput>,
): Promise<PeekMutationExecuteResult> {
  const { sql, input, actor } = ctx;
  const claim = await loadClaim(sql, input.claimId);
  if (!claim) throw new Error(`rejectClaim: claim ${input.claimId} not found`);
  if (claim.status !== "held") {
    throw new Error(
      `rejectClaim: claim is not in held state (status=${claim.status})`,
    );
  }

  await sql`
    UPDATE referral_claims
    SET status = 'rejected',
        hold_reason = NULL,
        reviewed_by = ${actor.email},
        reviewed_at = now(),
        error = ${input.note},
        processed_at = now()
    WHERE id = ${input.claimId}
  `;

  // Keep fee_bucket_debits in lockstep so the audit snapshot reflects the
  // terminal state (the queue handler usually does this; for direct admin
  // rejection we do it here).
  await sql`
    UPDATE fee_bucket_debits
    SET status = 'rejected', updated_at = now()
    WHERE bucket = 'referral' AND debit_type = 'claim' AND source_id = ${input.claimId}
  `;

  const changes: ReadonlyArray<PeekAuditChange> = [
    { field: "status", before: "held", after: "rejected" },
    { field: "hold_reason", before: claim.hold_reason, after: null },
    { field: "note", before: null, after: input.note },
  ];

  return { resourceId: input.claimId, changes };
}

export const rejectClaimMutation: PeekMutationDefinition<RejectClaimInput> = {
  actionId: "payout.claim.reject",
  resourceType: "referral_claims",
  schema: rejectClaimInputSchema,
  execute: executeRejectClaim as PeekMutationDefinition["execute"],
};
```

- [ ] **Step 4: Register in the mutation registry**

In `peek/src/server/mutations/registry.ts` add the import:

```ts
import { approveClaimMutation, rejectClaimMutation } from "./claim-review";
```

Add both to `entries`:

```ts
  approveClaimMutation as PeekMutationDefinition,
  rejectClaimMutation as PeekMutationDefinition,
```

- [ ] **Step 5: Add access-policy rules**

In `peek/src/server/access-policy.ts` add to `PEEK_ACTION_RULES`:

```ts
  { actionId: "payout.claim.approve", roles: ["admin"] },
  { actionId: "payout.claim.reject", roles: ["admin"] },
```

- [ ] **Step 6: Run the tests**

```bash
cd peek && pnpm vitest run src/server/mutations/__tests__/claim-review.test.ts
```

Expected: PASS — all four cases.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/mutations/claim-review.ts src/server/mutations/__tests__/claim-review.test.ts src/server/mutations/registry.ts src/server/access-policy.ts
git commit -m "feat(307): peek approveClaim + rejectClaim mutations"
```

---

## Task 15: Peek payouts page — controls card

**Files:**
- Create: `peek/src/components/payout-controls-card.tsx`

A small client component that renders the pause toggle and threshold input and calls the mutation runner. Mirrors the existing peek mutation UI patterns (e.g. `kol-rate` form components).

- [ ] **Step 1: Find the existing mutation form pattern**

```bash
grep -rln "applyPeekMutation\|/api/peek/mutations" /workspaces/rng-utopia/peek/src/components/ /workspaces/rng-utopia/peek/app/ 2>/dev/null | head -5
```

Read the file that surfaces — that's the client-side helper used by other admin forms (e.g. KOL rate form). Adapt its idioms.

- [ ] **Step 2: Implement the component**

Create `peek/src/components/payout-controls-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import type { PeekPayoutControlsRow } from "../server/db/queries/get-payout-controls";

const SOL_LAMPORTS = 1_000_000_000n;

function lamportsToSol(s: string): string {
  const n = BigInt(s);
  const whole = n / SOL_LAMPORTS;
  const frac = (n % SOL_LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

function solToLamports(s: string): string {
  const trimmed = s.trim();
  if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) {
    throw new Error("Threshold must be a positive number with up to 9 decimals");
  }
  const [whole, frac = ""] = trimmed.split(".");
  return (BigInt(whole) * SOL_LAMPORTS + BigInt(frac.padEnd(9, "0"))).toString();
}

async function applyMutation(actionId: string, input: unknown): Promise<void> {
  const res = await fetch("/api/peek/mutations/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actionId, input }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`mutation ${actionId} failed: ${res.status} ${body}`);
  }
}

export function PayoutControlsCard({ row }: { row: PeekPayoutControlsRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [thresholdSol, setThresholdSol] = useState(
    lamportsToSol(row.reviewThresholdLamports),
  );

  function togglePause() {
    if (pending) return;
    const next = !row.pauseEnabled;
    if (next && !confirm(`Enable emergency pause for "${row.claimKind}" payouts?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await applyMutation("payout.pause.set", {
          claimKind: row.claimKind,
          enabled: next,
        });
        location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "pause toggle failed");
      }
    });
  }

  function saveThreshold(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const lamports = solToLamports(thresholdSol);
        await applyMutation("payout.controls.update", {
          claimKind: row.claimKind,
          thresholdLamports: lamports,
        });
        location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "threshold update failed");
      }
    });
  }

  return (
    <article style={cardStyle}>
      <h3 style={titleStyle}>Payout controls · {row.claimKind}</h3>
      <div style={fieldRowStyle}>
        <label style={labelStyle}>Emergency pause</label>
        <button
          type="button"
          onClick={togglePause}
          disabled={pending}
          style={row.pauseEnabled ? toggleOnStyle : toggleOffStyle}
        >
          {row.pauseEnabled ? "ON — payouts halted" : "OFF — payouts running"}
        </button>
      </div>
      <form onSubmit={saveThreshold} style={fieldRowStyle}>
        <label style={labelStyle} htmlFor="threshold">
          Review threshold (SOL)
        </label>
        <input
          id="threshold"
          type="text"
          inputMode="decimal"
          value={thresholdSol}
          onChange={(e) => setThresholdSol(e.target.value)}
          style={inputStyle}
          disabled={pending}
        />
        <button type="submit" disabled={pending} style={saveButtonStyle}>
          Save
        </button>
      </form>
      <p style={metaStyle}>
        Last updated by {row.updatedBy ?? "—"} at {row.updatedAt}
      </p>
      {error && <p style={errorStyle}>{error}</p>}
    </article>
  );
}

const cardStyle: CSSProperties = { border: "1px solid #1e293b", borderRadius: "0.75rem", padding: "1rem", background: "#111827", display: "grid", gap: "0.75rem" };
const titleStyle: CSSProperties = { margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "#cbd5f5" };
const fieldRowStyle: CSSProperties = { display: "flex", gap: "0.5rem", alignItems: "center" };
const labelStyle: CSSProperties = { fontSize: "0.8125rem", color: "#cbd5f5", minWidth: "10rem" };
const inputStyle: CSSProperties = { padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", fontFamily: "monospace" };
const saveButtonStyle: CSSProperties = { padding: "0.4rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", cursor: "pointer" };
const toggleOnStyle: CSSProperties = { padding: "0.4rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #b91c1c", background: "#3f1d1d", color: "#fecaca", cursor: "pointer", fontWeight: 600 };
const toggleOffStyle: CSSProperties = { padding: "0.4rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #334155", background: "#0f172a", color: "#94a3b8", cursor: "pointer" };
const metaStyle: CSSProperties = { margin: 0, fontSize: "0.75rem", color: "#94a3b8" };
const errorStyle: CSSProperties = { margin: 0, padding: "0.5rem 0.75rem", borderRadius: "0.5rem", background: "#3f1d1d", color: "#fecaca", fontSize: "0.8125rem" };
```

If `/api/peek/mutations/apply` is not the actual route, replace with whatever `peek/app/api/peek/mutations/...` exposes (search for `/api/peek/mutations` in `peek/app/`).

- [ ] **Step 3: Run typecheck**

```bash
cd peek && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/components/payout-controls-card.tsx
git commit -m "feat(307): peek payout-controls-card component"
```

---

## Task 16: Peek payouts page — held claims table

**Files:**
- Create: `peek/src/components/held-claims-table.tsx`

- [ ] **Step 1: Implement the component**

Create `peek/src/components/held-claims-table.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import type { PeekHeldClaim } from "../server/db/queries/get-held-claims";

const SOL_LAMPORTS = 1_000_000_000n;
function lamportsToSol(s: string): string {
  const n = BigInt(s);
  const whole = n / SOL_LAMPORTS;
  const frac = (n % SOL_LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

async function applyMutation(actionId: string, input: unknown): Promise<void> {
  const res = await fetch("/api/peek/mutations/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actionId, input }),
  });
  if (!res.ok) throw new Error(`${actionId} failed: ${res.status} ${await res.text()}`);
}

export function HeldClaimsTable({ rows }: { rows: ReadonlyArray<PeekHeldClaim> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve(id: string) {
    if (pending) return;
    setError(null); setBusyId(id);
    startTransition(async () => {
      try {
        await applyMutation("payout.claim.approve", { claimId: id });
        location.reload();
      } catch (e) { setError(e instanceof Error ? e.message : "approve failed"); }
      finally { setBusyId(null); }
    });
  }

  function reject(id: string) {
    if (pending) return;
    const note = prompt("Reason for rejection (required)");
    if (!note || !note.trim()) return;
    setError(null); setBusyId(id);
    startTransition(async () => {
      try {
        await applyMutation("payout.claim.reject", { claimId: id, note: note.trim() });
        location.reload();
      } catch (e) { setError(e instanceof Error ? e.message : "reject failed"); }
      finally { setBusyId(null); }
    });
  }

  if (rows.length === 0) {
    return <p style={emptyStyle}>No held claims. The review queue is empty.</p>;
  }

  return (
    <div>
      {error && <p style={errorStyle}>{error}</p>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Kind</th>
            <th style={thStyle}>User</th>
            <th style={thStyle}>Wallet</th>
            <th style={thStyle}>Amount (SOL)</th>
            <th style={thStyle}>Reason</th>
            <th style={thStyle}>Requested at</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.claimId} style={trStyle}>
              <td style={tdStyle}>{row.claimKind}</td>
              <td style={tdStyle}>{row.username ?? row.userId}</td>
              <td style={{ ...tdStyle, fontFamily: "monospace" }}>{row.wallet}</td>
              <td style={{ ...tdStyle, fontFamily: "monospace" }}>{lamportsToSol(row.amountLamports)}</td>
              <td style={tdStyle}>{row.holdReason}</td>
              <td style={tdStyle}>{row.requestedAt}</td>
              <td style={{ ...tdStyle, display: "flex", gap: "0.4rem" }}>
                <button type="button" onClick={() => approve(row.claimId)} disabled={busyId === row.claimId} style={approveBtnStyle}>Approve</button>
                <button type="button" onClick={() => reject(row.claimId)} disabled={busyId === row.claimId} style={rejectBtnStyle}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const emptyStyle: CSSProperties = { color: "#94a3b8", fontSize: "0.875rem" };
const errorStyle: CSSProperties = { padding: "0.5rem 0.75rem", borderRadius: "0.5rem", background: "#3f1d1d", color: "#fecaca", fontSize: "0.8125rem", margin: "0 0 0.5rem 0" };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" };
const thStyle: CSSProperties = { textAlign: "left", padding: "0.5rem 0.6rem", color: "#94a3b8", borderBottom: "1px solid #1e293b", textTransform: "uppercase", fontSize: "0.7rem" };
const trStyle: CSSProperties = { borderBottom: "1px solid #1e293b" };
const tdStyle: CSSProperties = { padding: "0.5rem 0.6rem", color: "#e2e8f0" };
const approveBtnStyle: CSSProperties = { padding: "0.3rem 0.6rem", borderRadius: "0.4rem", border: "1px solid #166534", background: "#064e3b", color: "#bbf7d0", cursor: "pointer", fontSize: "0.75rem" };
const rejectBtnStyle: CSSProperties = { padding: "0.3rem 0.6rem", borderRadius: "0.4rem", border: "1px solid #b91c1c", background: "#3f1d1d", color: "#fecaca", cursor: "pointer", fontSize: "0.75rem" };
```

- [ ] **Step 2: Typecheck**

```bash
cd peek && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/components/held-claims-table.tsx
git commit -m "feat(307): peek held-claims-table component"
```

---

## Task 17: Peek payouts page — recent decisions list

**Files:**
- Create: `peek/src/components/payout-decisions-list.tsx`

- [ ] **Step 1: Implement the component**

Create `peek/src/components/payout-decisions-list.tsx`:

```tsx
import type { CSSProperties } from "react";
import type { PeekPayoutDecision } from "../server/db/queries/get-recent-payout-decisions";

export function PayoutDecisionsList({ rows }: { rows: ReadonlyArray<PeekPayoutDecision> }) {
  if (rows.length === 0) {
    return <p style={emptyStyle}>No payout decisions yet.</p>;
  }
  return (
    <ul style={listStyle}>
      {rows.map((row) => (
        <li key={row.id} style={liStyle}>
          <div style={headerStyle}>
            <span style={actionStyle}>{row.action}</span>
            <span style={timeStyle}>{row.createdAt}</span>
          </div>
          <div style={metaStyle}>
            actor: {row.actor ?? "—"} · target: {row.target ?? "—"}
          </div>
          {row.changes && row.changes.length > 0 && (
            <ul style={changesListStyle}>
              {row.changes.map((c, i) => (
                <li key={i} style={changeItemStyle}>
                  <code>{c.field}</code>: {String(c.before)} → {String(c.after)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

const emptyStyle: CSSProperties = { color: "#94a3b8", fontSize: "0.875rem" };
const listStyle: CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" };
const liStyle: CSSProperties = { padding: "0.6rem 0.75rem", borderRadius: "0.5rem", background: "#0f172a", border: "1px solid #1e293b" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: "0.8125rem" };
const actionStyle: CSSProperties = { fontFamily: "monospace", color: "#cbd5f5" };
const timeStyle: CSSProperties = { color: "#94a3b8", fontSize: "0.75rem" };
const metaStyle: CSSProperties = { color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.25rem" };
const changesListStyle: CSSProperties = { listStyle: "none", padding: 0, margin: "0.4rem 0 0 0", display: "grid", gap: "0.15rem" };
const changeItemStyle: CSSProperties = { fontFamily: "monospace", fontSize: "0.75rem", color: "#e2e8f0" };
```

- [ ] **Step 2: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/components/payout-decisions-list.tsx
git commit -m "feat(307): peek payout-decisions-list component"
```

---

## Task 18: Peek payouts page (FR-6)

**Files:**
- Create: `peek/app/operations/payouts/page.tsx`
- Modify: `peek/src/server/admin-shell-nav.ts`

- [ ] **Step 1: Implement the page**

Create `peek/app/operations/payouts/page.tsx`:

```tsx
// /operations/payouts — admin pause/threshold/review surface (spec 307 FR-6).
//
// Three sections:
//   - Controls strip (one card per claim_kind; today only `referral`)
//   - Held queue table (oldest-first, with approve/reject actions)
//   - Recent decisions (last 50 payout.* operator_events)

import type { CSSProperties } from "react";
import { HeldClaimsTable } from "../../../src/components/held-claims-table";
import { PayoutControlsCard } from "../../../src/components/payout-controls-card";
import { PayoutDecisionsList } from "../../../src/components/payout-decisions-list";
import { RouteAccessDenied } from "../../../src/components/route-access-denied";
import { listHeldClaims } from "../../../src/server/db/queries/get-held-claims";
import { listPayoutControls } from "../../../src/server/db/queries/get-payout-controls";
import { listRecentPayoutDecisions } from "../../../src/server/db/queries/get-recent-payout-decisions";
import { requirePeekRouteAccess } from "../../../src/server/route-access";

export const dynamic = "force-dynamic";

const ROUTE = "/operations/payouts";

export default async function OperationsPayoutsPage() {
  const access = await requirePeekRouteAccess(ROUTE);
  if (!access.ok) return <RouteAccessDenied title="Operations · Payouts" />;

  const [controls, held, decisions] = await Promise.all([
    listPayoutControls(),
    listHeldClaims(),
    listRecentPayoutDecisions(),
  ]);

  return (
    <main style={mainStyle}>
      <header>
        <h1>Operations · Payouts</h1>
        <p style={leadStyle}>
          Emergency pause and per-kind review threshold for claimable SOL
          payouts. Held claims appear in the review queue and clear only by
          explicit admin approval, rejection, or — for pause-held claims —
          when the global pause is turned off. Every action is recorded in
          the audit log.
        </p>
      </header>

      <section aria-labelledby="controls-heading" style={sectionStyle}>
        <h2 id="controls-heading" style={sectionHeadingStyle}>Controls</h2>
        <div style={controlsGridStyle}>
          {controls.map((row) => (
            <PayoutControlsCard key={row.claimKind} row={row} />
          ))}
        </div>
      </section>

      <section aria-labelledby="held-heading" style={sectionStyle}>
        <h2 id="held-heading" style={sectionHeadingStyle}>Held queue ({held.length})</h2>
        <HeldClaimsTable rows={held} />
      </section>

      <section aria-labelledby="decisions-heading" style={sectionStyle}>
        <h2 id="decisions-heading" style={sectionHeadingStyle}>Recent decisions</h2>
        <PayoutDecisionsList rows={decisions} />
      </section>
    </main>
  );
}

const mainStyle: CSSProperties = { display: "grid", gap: "1.5rem" };
const sectionStyle: CSSProperties = { display: "grid", gap: "0.75rem" };
const sectionHeadingStyle: CSSProperties = { margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 600, color: "#cbd5f5", textTransform: "uppercase", letterSpacing: "0.05em" };
const leadStyle: CSSProperties = { margin: "0.25rem 0 0", color: "#94a3b8" };
const controlsGridStyle: CSSProperties = { display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" };
```

- [ ] **Step 2: Add the page to admin-shell-nav**

Open `peek/src/server/admin-shell-nav.ts`. Find the Operations group (search for `/operations/queue`) and add a sibling entry:

```ts
{ href: "/operations/payouts", label: "Payouts", route: "/operations/payouts" },
```

(Match exact field names used by the file — they may be `path`/`title`/`pageId`. Inspect the file first.)

- [ ] **Step 3: Add route access for the new page**

Search for how `/operations/queue` is registered in `peek/src/server/route-access.ts` or `access-policy.ts`:

```bash
grep -n "operations/queue" /workspaces/rng-utopia/peek/src/server/access-policy.ts /workspaces/rng-utopia/peek/src/server/route-access.ts /workspaces/rng-utopia/peek/src/lib/access-policy.ts 2>/dev/null
```

Add an analogous entry for `/operations/payouts` so admins can reach it. Restrict to `admin` role only.

- [ ] **Step 4: Typecheck and lint**

```bash
cd peek && pnpm typecheck && pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Manual smoke (optional, skip if unavailable)**

```bash
cd peek && pnpm dev
```

Visit `http://localhost:3000/operations/payouts` (with `PEEK_DEV_ACCESS_EMAIL` set to a `@digitalmob.ro` address). Verify the page renders the controls card with `referral` row, an empty held queue, and an empty decisions list.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add app/operations/payouts/page.tsx src/server/admin-shell-nav.ts src/server/access-policy.ts src/lib/access-policy.ts src/server/route-access.ts
git commit -m "feat(307): peek /operations/payouts page + nav + route access"
```

(Stage only the access-policy/route-access files that you actually modified.)

---

## Task 19: Peek visual baseline for the new page

**Files:**
- Test: `peek/e2e/visual/operations-payouts.spec.ts` (create)

- [ ] **Step 1: Inspect an existing visual spec**

```bash
ls /workspaces/rng-utopia/peek/e2e/visual/ 2>/dev/null && head -50 /workspaces/rng-utopia/peek/e2e/visual/$(ls /workspaces/rng-utopia/peek/e2e/visual/ | head -1)
```

Read one existing spec to learn the project's Playwright + visual snapshot idiom.

- [ ] **Step 2: Write a visual spec for the new page**

Create `peek/e2e/visual/operations-payouts.spec.ts` (adapt to whatever idiom the existing visual specs use — same `test`/`expect` imports, same auth setup):

```ts
import { test, expect } from "@playwright/test";

test("operations/payouts renders controls + empty queue", async ({ page }) => {
  await page.goto("/operations/payouts");
  await expect(page.getByRole("heading", { name: "Operations · Payouts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /controls/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /held queue/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /recent decisions/i })).toBeVisible();
  await expect(page).toHaveScreenshot("operations-payouts.png", { fullPage: true });
});
```

- [ ] **Step 3: Generate the baseline**

```bash
cd peek && pnpm test:visual:update -g "operations/payouts"
```

(If the script name differs — check `peek/package.json` for `scripts.test:visual:update` — adjust accordingly.)

- [ ] **Step 4: Verify the baseline passes on a re-run**

```bash
cd peek && pnpm test:visual -g "operations/payouts"
```

Expected: PASS — no diff because we just regenerated.

- [ ] **Step 5: Manual review of the baseline image**

Use the Read tool on the generated PNG file under `peek/e2e/visual/__screenshots__/` (or wherever the baseline lands). Confirm the page looks right — controls card visible, empty states for queue and decisions, no broken layout.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add e2e/visual/operations-payouts.spec.ts e2e/visual/__screenshots__/
git commit -m "feat(307): peek operations/payouts visual baseline"
```

---

## Task 20: Tech debt note

**Files:**
- Modify: `docs/TECH_DEBT.md`

- [ ] **Step 1: Append the entry**

Open `docs/TECH_DEBT.md` and append at the end (preserving existing format — inspect first):

```markdown
- **307 — Single admin role for payout pause/approve/reject** (2026-05-04).
  Spec 307 ships with a single combined `admin` role that can pause payouts,
  edit the review threshold, and approve/reject held claims. The audit
  trail in `operator_events` is the safety net. Split into a dedicated
  `treasury_operator` sub-role if a concrete role-separation requirement
  appears (e.g., a non-admin operator who should only review held claims
  but not toggle the pause). See `docs/specs/307-payout-pause-and-review/spec.md`.
```

- [ ] **Step 2: Commit**

```bash
cd /workspaces/rng-utopia
git add docs/TECH_DEBT.md
git commit -m "docs(307): note single combined admin role tech debt"
```

---

## Task 21: Run full verify and update root submodule pointers

**Files:**
- All changed submodules + root

- [ ] **Step 1: Backend verify**

```bash
cd backend && pnpm lint && pnpm typecheck && pnpm vitest run
```

Expected: PASS — all three.

- [ ] **Step 2: Peek verify**

```bash
cd peek && pnpm verify
```

Expected: PASS.

- [ ] **Step 3: Cross-repo verify**

```bash
cd /workspaces/rng-utopia && ./scripts/verify
```

Expected: PASS exit 0.

- [ ] **Step 4: Bump root submodule pointers**

If `backend/` and `peek/` made commits, the root sees them as submodule pointer drift:

```bash
cd /workspaces/rng-utopia
git status
```

Expected: `modified: backend (new commits)` and `modified: peek (new commits)`.

```bash
git add backend peek
git commit -m "chore: advance backend + peek submodule refs — spec 307"
```

- [ ] **Step 5: Smoke test the end-to-end claim flow on devnet (manual)**

This step requires devnet keypair access. Skip if the agent cannot run it.

```bash
cd /workspaces/rng-utopia
# Create a test referral earning, request a claim, observe the flow:
# 1. Threshold above amount → claim completes normally.
# 2. Threshold below amount → claim is held with above_threshold; admin approves; SOL arrives.
# 3. Pause toggled → claim is held with global_pause; pause off; sweeper releases.
# 4. Claim rejected → user balance restored; user can re-claim.
```

Document any deviations in `docs/specs/307-payout-pause-and-review/history.md`.

---

## Self-Review Checklist (run before declaring done)

- [ ] Every spec FR has at least one task implementing it (FR-1 → Task 6; FR-2 → Task 7; FR-3 → Task 8; FR-4 → Tasks 1, 2, 3, 4; FR-5 → Task 9; FR-6 → Task 18; FR-7 → Tasks 13, 14; FR-8 → Tasks 10, 11, 12)
- [ ] Every System Invariant has at least one test asserting it (Invariant 1 → Task 7 test; Invariant 2 → Task 6 tests; Invariants 4 → Task 4 tests; Invariant 5 → covered by partial unique index in Task 1; Invariant 6 → registry/audit pattern in Tasks 13, 14; Invariant 9 → Task 7 tests; Invariant 10 → Task 9 tests)
- [ ] No `TODO`, `TBD`, or "implement later" anywhere in the plan
- [ ] All function/type/module names are consistent across tasks (`evaluateGate`, `runPayoutPauseSweeper`, `payoutPauseSetMutation`, `approveClaimMutation`, etc.)
- [ ] Migration number is `028` and matches the existing sequence (last is `027`)
- [ ] Every file path in this plan exists or is to be created in a referenced task

---
