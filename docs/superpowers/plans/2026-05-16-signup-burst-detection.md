# Signup Burst Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only **Signup bursts** tab to `/growth/referrals` in the peek admin that surfaces referral codes whose referees signed up in suspiciously bursty time patterns, so biz can manually exclude bot operators from the contest.

**Architecture:** One new SQL query module computes per-referrer burst metrics (max 5-min burst, min gap, median gap) over `referral_links.created_at` using Postgres window functions. One new server-rendered table reads those rows. The page at `peek/app/growth/referrals/page.tsx` grows a third tab id (`bursts`) that follows the existing "only query the active tab" pattern. No migrations, no new indexes (existing `idx_referral_links_referrer` is sufficient at current scale), no policy change (`/growth/*` is already open to the `business` role).

**Tech Stack:** Next.js 15 server components (peek), `postgres` (template literal SQL), vitest + Testing Library, Tailwind via the `@/components/ui/table` shadcn shell. Owned submodule at `peek/` on branch `dev`.

**Reference Spec:** `docs/specs/405-signup-burst-detection/spec.md`

---

## File Structure

**New files:**
- `peek/src/server/db/queries/get-signup-bursts.ts` — query function + limit constants
- `peek/src/server/db/queries/__tests__/get-signup-bursts.test.ts` — query unit tests
- `peek/src/components/signup-bursts-table.tsx` — readonly table component
- `peek/src/components/__tests__/signup-bursts-table.test.tsx` — table component tests

**Modified files:**
- `peek/src/lib/types/peek.ts` — add `PeekSignupBurstRow`, `PeekSignupBurstFilters`
- `peek/src/lib/growth-search-params.ts` — add `normalizeSignupBurstFiltersFromSearchParams`
- `peek/src/lib/__tests__/growth-search-params.test.ts` — add the shared normalizer test block
- `peek/app/growth/referrals/page.tsx` — extend tab id union, fetch + render the new tab
- `peek/e2e/visual/capture.spec.ts` — add a `growth-bursts` visual capture entry

Each task below is a discrete commit. The peek submodule lives at `/workspaces/rng-utopia/peek` and the working branch is `dev`. **All commands assume `cd /workspaces/rng-utopia/peek`.**

---

## Task 1: Add types

**Files:**
- Modify: `peek/src/lib/types/peek.ts` (insert near line 644, after `PeekTopReferrerFilters`)

- [ ] **Step 1: Read the existing referrer types** to confirm insertion point

Open `peek/src/lib/types/peek.ts` and locate the `PeekTopReferrerFilters` block ending around line 649. The new types go immediately after it so referrer-related types stay grouped.

- [ ] **Step 2: Add the two new exported types**

Insert the following after the `PeekTopReferrerFilters` block:

```ts
// One row in the Signup bursts tab on /growth/referrals — per-referrer
// time-pattern metrics derived from referral_links.created_at. min/median
// gaps are null when the referrer has only one referee. See spec 405.
export type PeekSignupBurstRow = {
  referrerUserId: string;
  username: string | null;
  wallet: string;
  referralCode: string | null;
  refereeCount: number;
  minGapSeconds: number | null;
  medianGapSeconds: number | null;
  maxBurst5Min: number;
  firstSignupAt: string;
  lastSignupAt: string;
};

export type PeekSignupBurstFilters = {
  minReferees: string | null;
  minMaxBurst: string | null;
  referrerUserId: string | null;
  wallet: string | null;
  referralCode: string | null;
  firstSignupFrom: string | null;
  firstSignupTo: string | null;
};
```

- [ ] **Step 3: Typecheck the change**

Run: `pnpm typecheck`
Expected: PASS — no new types referenced yet by consumers, so the only thing being checked is that the two new types parse cleanly.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/lib/types/peek.ts
git commit -m "feat(peek): add signup-burst row + filter types for /growth/referrals bursts tab (spec 405)"
```

---

## Task 2: Add the URL filter normalizer + tests (TDD)

**Files:**
- Modify: `peek/src/lib/growth-search-params.ts`
- Modify: `peek/src/lib/__tests__/growth-search-params.test.ts`

- [ ] **Step 1: Write the failing test block**

Add to `peek/src/lib/__tests__/growth-search-params.test.ts` (append to the file, after the rate-overrides `runSharedNormalizerTests` call):

```ts
import { normalizeSignupBurstFiltersFromSearchParams } from "../growth-search-params";
import type { PeekSignupBurstFilters } from "../types/peek";

runSharedNormalizerTests<PeekSignupBurstFilters>({
  describeName:
    "normalizeSignupBurstFiltersFromSearchParams (shared URL coercion contract)",
  normalize: normalizeSignupBurstFiltersFromSearchParams,
  fields: [
    { name: "minReferees", paramKey: "burstMinReferees", sampleValue: "5" },
    { name: "minMaxBurst", paramKey: "burstMinMaxBurst", sampleValue: "10" },
    { name: "referrerUserId", paramKey: "burstReferrerUserId" },
    { name: "wallet", paramKey: "burstReferrerWallet" },
    { name: "referralCode", paramKey: "burstReferralCode" },
    {
      name: "firstSignupFrom",
      paramKey: "burstFirstSignupFrom",
      sampleValue: "2026-05-01",
    },
    {
      name: "firstSignupTo",
      paramKey: "burstFirstSignupTo",
      sampleValue: "2026-05-16",
    },
  ],
});
```

Also extend the existing top-level import block in this file so the new normalizer is imported alongside the other normalizers (place beside `normalizeTopReferrerFiltersFromSearchParams`):

```ts
import {
  PEEK_REFERRAL_CLAIM_STATUSES,
  normalizeRateOverridePerformanceFiltersFromSearchParams,
  normalizeReferralClaimFiltersFromSearchParams,
  normalizeSignupBurstFiltersFromSearchParams,
  normalizeTopReferrerFiltersFromSearchParams,
} from "../growth-search-params";
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm exec vitest run src/lib/__tests__/growth-search-params.test.ts`
Expected: FAIL — `normalizeSignupBurstFiltersFromSearchParams` not exported.

- [ ] **Step 3: Implement the normalizer**

Append to `peek/src/lib/growth-search-params.ts`:

```ts
import type { PeekSignupBurstFilters } from "./types/peek";

export function normalizeSignupBurstFiltersFromSearchParams(
  input: Record<string, string | string[] | null | undefined>,
): PeekSignupBurstFilters {
  return {
    minReferees: unsignedIntOrNull(readSingleValue(input.burstMinReferees)),
    minMaxBurst: unsignedIntOrNull(readSingleValue(input.burstMinMaxBurst)),
    referrerUserId: trimOrNull(readSingleValue(input.burstReferrerUserId)),
    wallet: trimOrNull(readSingleValue(input.burstReferrerWallet)),
    referralCode: trimOrNull(readSingleValue(input.burstReferralCode)),
    firstSignupFrom: coerceIsoDateOrNull(
      readSingleValue(input.burstFirstSignupFrom),
    ),
    firstSignupTo: coerceIsoDateOrNull(
      readSingleValue(input.burstFirstSignupTo),
    ),
  };
}
```

The `PeekSignupBurstFilters` import goes at the top of the file, joining the existing types-from-`./types/peek` import block:

```ts
import type {
  PeekRateOverridePerformanceFilters,
  PeekReferralClaimFilters,
  PeekSignupBurstFilters,
  PeekTopReferrerFilters,
} from "./types/peek";
```

- [ ] **Step 4: Run the test again**

Run: `pnpm exec vitest run src/lib/__tests__/growth-search-params.test.ts`
Expected: PASS — the shared normalizer contract suite for all four normalizers (claims, top, overrides, **bursts**) is green.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/lib/growth-search-params.ts src/lib/__tests__/growth-search-params.test.ts
git commit -m "feat(peek): URL normalizer for signup-bursts filters (spec 405)"
```

---

## Task 3: Add the query module (TDD)

**Files:**
- Create: `peek/src/server/db/queries/get-signup-bursts.ts`
- Create: `peek/src/server/db/queries/__tests__/get-signup-bursts.test.ts`

This task is split into two commits — first failing test + limit-clamp contract (Task 3a), then the SQL implementation (Task 3b). The query body itself is tested in Task 3c with seeded behaviour assertions.

### Task 3a: Stub the function and add the limit-clamp test

- [ ] **Step 1: Create the empty module**

Create `peek/src/server/db/queries/get-signup-bursts.ts`:

```ts
// Signup burst-detection query for the /growth/referrals "Signup bursts"
// tab. Returns per-referrer time-pattern metrics over referral_links —
// max rolling 5-minute window count, min consecutive inter-arrival gap,
// median inter-arrival gap, and bounding signup timestamps. Read-only,
// no new persisted state, single SQL call. See spec 405.

import type { Sql } from "postgres";
import type {
  PeekSignupBurstFilters,
  PeekSignupBurstRow,
} from "../../../lib/types/peek";
import { getSqlClient } from "../client";

export const PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_LIMIT = 50;
export const PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT = 250;
export const PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_MIN_REFEREES = 5;

export type ListSignupBurstsOptions = {
  sql?: Sql;
  limit?: number;
  filters?: Partial<PeekSignupBurstFilters>;
};

function clampLimit(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const floored = Math.floor(raw);
  if (floored <= 0) return 1;
  return Math.min(max, floored);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unsignedIntOrNull(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value);
  return trimmed && /^[0-9]+$/u.test(trimmed) ? trimmed : null;
}

export async function listSignupBursts(
  options: ListSignupBurstsOptions = {},
): Promise<ReadonlyArray<PeekSignupBurstRow>> {
  const sql = options.sql ?? (getSqlClient() as unknown as Sql);
  const limit = clampLimit(
    options.limit,
    PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_LIMIT,
    PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT,
  );
  const filters = options.filters ?? {};
  const minReferees =
    unsignedIntOrNull(filters.minReferees) ??
    String(PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_MIN_REFEREES);
  const minMaxBurst = unsignedIntOrNull(filters.minMaxBurst);
  const userId = trimOrNull(filters.referrerUserId);
  const wallet = trimOrNull(filters.wallet);
  const referralCode = trimOrNull(filters.referralCode);
  const firstFrom = trimOrNull(filters.firstSignupFrom);
  const firstTo = trimOrNull(filters.firstSignupTo);

  // SQL filled in by Task 3b.
  void sql;
  void limit;
  void minReferees;
  void minMaxBurst;
  void userId;
  void wallet;
  void referralCode;
  void firstFrom;
  void firstTo;
  return [];
}
```

- [ ] **Step 2: Create the test file with the limit-clamp contract**

Create `peek/src/server/db/queries/__tests__/get-signup-bursts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_LIMIT,
  PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_MIN_REFEREES,
  PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT,
  listSignupBursts,
} from "../get-signup-bursts";

type SqlCall = {
  text: string;
  values: ReadonlyArray<unknown>;
};

type ResponseValue = ReadonlyArray<Record<string, unknown>> | Error;

function createSqlMock(responses: ReadonlyArray<ResponseValue>) {
  const calls: SqlCall[] = [];
  let cursor = 0;

  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = [...strings].join("?");
    calls.push({ text, values: [...values] });
    const next = responses[cursor++];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  };

  return { sql: fn as unknown as Sql, calls };
}

describe("listSignupBursts limit-clamp contract", () => {
  it("clamps over-max to MAX, non-positive to 1, NaN to default; returns [] when SQL responds empty", async () => {
    for (const { given, expected } of [
      { given: PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT + 100, expected: PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT },
      { given: 0, expected: 1 },
      { given: Number.NaN, expected: PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_LIMIT },
    ]) {
      const { sql, calls } = createSqlMock([[]]);
      const rows = await listSignupBursts({ sql, limit: given });
      expect(rows).toEqual([]);
      const lastValues = calls.at(-1)?.values ?? [];
      // The clamped limit lands in the SQL call's values somewhere; assert it
      // is present (the position varies with WHERE-clause shape, so look in
      // the whole values array).
      expect(lastValues).toContain(expected);
    }
  });

  it("defaults minReferees to 5 when filter is missing or blank", async () => {
    const { sql, calls } = createSqlMock([[]]);
    await listSignupBursts({ sql });
    const values = calls.at(-1)?.values ?? [];
    expect(values).toContain(String(PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_MIN_REFEREES));
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run src/server/db/queries/__tests__/get-signup-bursts.test.ts`
Expected: First test FAILS (no SQL call yet — `calls.at(-1)` is undefined, `values` is `[]`, `toContain` fails). Second test FAILS for the same reason. This is the failing baseline.

- [ ] **Step 4: Commit the stub**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/get-signup-bursts.ts src/server/db/queries/__tests__/get-signup-bursts.test.ts
git commit -m "test(peek): scaffold listSignupBursts module + failing limit-clamp tests (spec 405)"
```

### Task 3b: Implement the SQL

- [ ] **Step 1: Replace the stub body with the real SQL**

In `peek/src/server/db/queries/get-signup-bursts.ts`, replace the `void` block at the end of `listSignupBursts` (the placeholder from Task 3a) with the real query:

```ts
  const referralCodeUpper = referralCode ? referralCode.toUpperCase() : null;

  return sql<Array<PeekSignupBurstRow>>`
    with sorted as (
      select
        rl.referrer_user_id,
        rl.referrer_wallet,
        rl.created_at,
        extract(epoch from rl.created_at - lag(rl.created_at) over (
          partition by rl.referrer_user_id order by rl.created_at
        )) as gap_seconds
      from referral_links rl
    ),
    bursts as (
      select
        referrer_user_id,
        created_at,
        count(*) over (
          partition by referrer_user_id
          order by created_at
          range between interval '5 minutes' preceding and current row
        )::int as burst_5m
      from sorted
    ),
    agg as (
      select
        s.referrer_user_id,
        max(s.referrer_wallet) as referrer_wallet,
        count(*)::int as referee_count,
        min(s.gap_seconds) as min_gap_seconds,
        percentile_cont(0.5) within group (order by s.gap_seconds) as median_gap_seconds,
        max(b.burst_5m)::int as max_burst_5min,
        min(s.created_at) as first_signup_at,
        max(s.created_at) as last_signup_at
      from sorted s
      join bursts b
        on b.referrer_user_id = s.referrer_user_id
       and b.created_at = s.created_at
      group by s.referrer_user_id
    )
    select
      agg.referrer_user_id                                   as "referrerUserId",
      pp.username                                            as "username",
      agg.referrer_wallet                                    as "wallet",
      rc.code                                                as "referralCode",
      agg.referee_count                                      as "refereeCount",
      agg.min_gap_seconds::float8                            as "minGapSeconds",
      agg.median_gap_seconds::float8                         as "medianGapSeconds",
      agg.max_burst_5min                                     as "maxBurst5Min",
      agg.first_signup_at::text                              as "firstSignupAt",
      agg.last_signup_at::text                               as "lastSignupAt"
    from agg
    left join player_profiles pp on pp.user_id = agg.referrer_user_id
    left join referral_codes rc  on rc.user_id = agg.referrer_user_id
    where agg.referee_count >= ${minReferees}::int
      and (${minMaxBurst === null} or agg.max_burst_5min >= ${minMaxBurst ?? "0"}::int)
      and (${userId === null} or agg.referrer_user_id = ${userId ?? ""})
      and (${wallet === null} or agg.referrer_wallet = ${wallet ?? ""})
      and (${referralCodeUpper === null} or upper(rc.code) = ${referralCodeUpper ?? ""})
      and (${firstFrom}::timestamptz is null or agg.first_signup_at >= ${firstFrom}::timestamptz)
      and (${firstTo}::timestamptz is null or agg.first_signup_at < ${firstTo}::timestamptz)
    order by
      agg.max_burst_5min desc,
      agg.min_gap_seconds asc nulls last,
      agg.referrer_user_id asc
    limit ${limit}
  `;
```

Also delete the unused `void` block plus the `void` variable references — the SQL now consumes all locals.

- [ ] **Step 2: Run the test suite**

Run: `pnpm exec vitest run src/server/db/queries/__tests__/get-signup-bursts.test.ts`
Expected: PASS — the clamped limit is now in `values`, the default minReferees `"5"` is present.

- [ ] **Step 3: Run the full peek unit-test suite to confirm no regressions**

Run: `pnpm exec vitest run`
Expected: PASS (entire suite green).

- [ ] **Step 4: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/get-signup-bursts.ts
git commit -m "feat(peek): listSignupBursts SQL — rolling 5-min window + gap stats per referrer (spec 405)"
```

### Task 3c: Behavioural test for filters

This adds higher-value tests that lock in filter semantics (still using SQL mock — the seeded-DB integration is out of scope for v1 since peek has no integration-test harness for these query modules; the existing `get-growth-referrals.test.ts` follows the same mock-SQL pattern).

- [ ] **Step 1: Append filter behaviour cases**

Append to `peek/src/server/db/queries/__tests__/get-signup-bursts.test.ts`:

```ts
describe("listSignupBursts filter wiring", () => {
  it("forwards referrer userId, wallet, and uppercased code into the SQL call", async () => {
    const { sql, calls } = createSqlMock([[]]);
    await listSignupBursts({
      sql,
      filters: {
        referrerUserId: "u-77",
        wallet: "wallet-77",
        referralCode: "abc",
      },
    });
    const values = calls.at(-1)?.values ?? [];
    expect(values).toContain("u-77");
    expect(values).toContain("wallet-77");
    // Code is uppercased before comparison.
    expect(values).toContain("ABC");
  });

  it("forwards minMaxBurst and firstSignupFrom/firstSignupTo when present", async () => {
    const { sql, calls } = createSqlMock([[]]);
    await listSignupBursts({
      sql,
      filters: {
        minMaxBurst: "8",
        firstSignupFrom: "2026-05-01",
        firstSignupTo: "2026-05-16",
      },
    });
    const values = calls.at(-1)?.values ?? [];
    expect(values).toContain("8");
    expect(values).toContain("2026-05-01");
    expect(values).toContain("2026-05-16");
  });

  it("returns rows verbatim when SQL responds with a populated array", async () => {
    const row = {
      referrerUserId: "u-1",
      username: "alice",
      wallet: "wallet-1",
      referralCode: "ALICE",
      refereeCount: 12,
      minGapSeconds: 3.2,
      medianGapSeconds: 11.4,
      maxBurst5Min: 12,
      firstSignupAt: "2026-05-16T10:00:00.000Z",
      lastSignupAt: "2026-05-16T10:04:30.000Z",
    };
    const { sql } = createSqlMock([[row]]);
    const rows = await listSignupBursts({ sql });
    expect(rows).toEqual([row]);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm exec vitest run src/server/db/queries/__tests__/get-signup-bursts.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/server/db/queries/__tests__/get-signup-bursts.test.ts
git commit -m "test(peek): listSignupBursts filter-wiring assertions (spec 405)"
```

---

## Task 4: Add the SignupBurstsTable component (TDD)

**Files:**
- Create: `peek/src/components/signup-bursts-table.tsx`
- Create: `peek/src/components/__tests__/signup-bursts-table.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `peek/src/components/__tests__/signup-bursts-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignupBurstsTable } from "../signup-bursts-table";
import type { PeekSignupBurstRow } from "../../lib/types/peek";

const BURSTY: PeekSignupBurstRow = {
  referrerUserId: "u-bot",
  username: "BotMaster",
  wallet: "wallet-bot",
  referralCode: "BOT1",
  refereeCount: 12,
  minGapSeconds: 3.2,
  medianGapSeconds: 4.1,
  maxBurst5Min: 12,
  firstSignupAt: "2026-05-16T10:00:00.000Z",
  lastSignupAt: "2026-05-16T10:04:30.000Z",
};

const CLEAN: PeekSignupBurstRow = {
  referrerUserId: "u-clean",
  username: null,
  wallet: "wallet-clean",
  referralCode: null,
  refereeCount: 6,
  minGapSeconds: null,
  medianGapSeconds: null,
  maxBurst5Min: 1,
  firstSignupAt: "2026-04-01T08:00:00.000Z",
  lastSignupAt: "2026-05-10T19:00:00.000Z",
};

describe("SignupBurstsTable", () => {
  it("populated: renders headers, formatted numbers, em-dash for null gaps, and a drill-down link", () => {
    render(<SignupBurstsTable rows={[BURSTY, CLEAN]} />);

    for (const header of [
      "Referrer",
      "Code",
      "Referees",
      "Max burst (5 min)",
      "Min gap (s)",
      "Median gap (s)",
      "First signup",
      "Last signup",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    // Drill-down link points at the Top referrers tab pre-filtered on the user.
    const link = screen.getByRole("link", { name: "BotMaster" });
    expect(link).toHaveAttribute(
      "href",
      "/growth/referrals?tab=top&referrerUserId=u-bot",
    );

    // Username-less row falls back to userId as link label.
    expect(screen.getByRole("link", { name: "u-clean" })).toBeInTheDocument();

    // Null gaps render as em-dash.
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(2);

    // Numeric values render.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3.2")).toBeInTheDocument();
    expect(screen.getByText("4.1")).toBeInTheDocument();
  });

  it("empty: renders an accessible status block", () => {
    render(<SignupBurstsTable rows={[]} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/No referrers match these filters/i);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("error: renders an accessible alert and no table", () => {
    render(<SignupBurstsTable rows={[]} error="boom" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run src/components/__tests__/signup-bursts-table.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `peek/src/components/signup-bursts-table.tsx`:

```tsx
// Read-only Signup bursts table for /growth/referrals (spec 405).
//
// Dense row per referrer surfacing burst metrics — max rolling 5-minute
// signup count, smallest consecutive gap, and median gap — over
// referral_links. Drill-down links jump to the Top referrers tab
// pre-filtered on the same user id so an operator can pivot to earnings
// context with one click.
import Link from "next/link";
import type { PeekSignupBurstRow } from "../lib/types/peek";
import { truncateMiddle } from "../lib/format-address";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export type SignupBurstsTableProps = {
  rows: ReadonlyArray<PeekSignupBurstRow>;
  error?: string | null;
};

export function SignupBurstsTable({
  rows,
  error = null,
}: SignupBurstsTableProps) {
  if (error) {
    return (
      <div
        role="alert"
        className="m-0 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        Signup bursts unavailable: {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="grid gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-6"
      >
        <p className="m-0 text-base font-semibold text-foreground">
          No referrers match these filters.
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          No referrer in <code>referral_links</code> meets the current
          minimum-referee floor. Lower it to widen the result set.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Referrer</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead className="text-right">Referees</TableHead>
            <TableHead className="text-right">Max burst (5 min)</TableHead>
            <TableHead className="text-right">Min gap (s)</TableHead>
            <TableHead className="text-right">Median gap (s)</TableHead>
            <TableHead>First signup</TableHead>
            <TableHead>Last signup</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.referrerUserId}>
              <TableCell>
                <Link
                  href={`/growth/referrals?tab=top&referrerUserId=${encodeURIComponent(row.referrerUserId)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {row.username ?? row.referrerUserId}
                </Link>
                {row.username ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {row.referrerUserId}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">
                {row.referralCode ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                <span title={row.wallet}>{truncateMiddle(row.wallet)}</span>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {row.refereeCount}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {row.maxBurst5Min}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatGap(row.minGapSeconds)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatGap(row.medianGapSeconds)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatTs(row.firstSignupAt)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatTs(row.lastSignupAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatGap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  // One decimal place — sub-second gaps are the headline tell; large gaps
  // stay readable without thousands-separator noise.
  return value.toFixed(1);
}

function formatTs(value: string): string {
  // Defensive against an empty string the DB cast might emit on a null.
  if (!value) return "—";
  // Render the ISO timestamp's first 19 chars (YYYY-MM-DD HH:MM:SS) trimming
  // sub-second precision — the operator wants ordering, not millisecond
  // resolution. Keeps parity with how growth-claims-table renders timestamps.
  return value.replace("T", " ").slice(0, 19);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run src/components/__tests__/signup-bursts-table.test.tsx`
Expected: PASS — all three component tests green.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add src/components/signup-bursts-table.tsx src/components/__tests__/signup-bursts-table.test.tsx
git commit -m "feat(peek): SignupBurstsTable component with empty/error/populated states (spec 405)"
```

---

## Task 5: Wire the new tab into `/growth/referrals/page.tsx`

**Files:**
- Modify: `peek/app/growth/referrals/page.tsx`

- [ ] **Step 1: Extend imports**

Replace the existing import block near the top with this expanded version. The additions are: `SignupBurstsTable`, `listSignupBursts`, `normalizeSignupBurstFiltersFromSearchParams`, `PeekSignupBurstRow`.

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs } from "@/components/ui/tabs";
import { ExportActionLink } from "../../../src/components/export-action-link";
import { GrowthClaimsFilterBar } from "../../../src/components/growth-claims-filter-bar";
import { GrowthClaimsTable } from "../../../src/components/growth-claims-table";
import { GrowthReferrersTable } from "../../../src/components/growth-referrers-table";
import { MetricStrip } from "../../../src/components/metric-strip";
import { RouteAccessDenied } from "../../../src/components/route-access-denied";
import { SignupBurstsTable } from "../../../src/components/signup-bursts-table";
import { buildExportHref } from "../../../src/lib/export-href";
import { buildReferrerFromRawParams } from "../../../src/lib/filter-referrer";
import {
  normalizeReferralClaimFiltersFromSearchParams,
  normalizeSignupBurstFiltersFromSearchParams,
  normalizeTopReferrerFiltersFromSearchParams,
} from "../../../src/lib/growth-search-params";
import type {
  PeekGrowthClaimRow,
  PeekGrowthOverview,
  PeekSignupBurstRow,
  PeekTopReferrerRow,
} from "../../../src/lib/types/peek";
import {
  getGrowthReferralOverview,
  listReferralClaims,
  listTopReferrers,
} from "../../../src/server/db/queries/get-growth-referrals";
import { listSignupBursts } from "../../../src/server/db/queries/get-signup-bursts";
import { isPeekAuditConfigured } from "../../../src/server/exports";
import { requirePeekRouteAccess } from "../../../src/server/route-access";
```

- [ ] **Step 2: Extend the tab id union**

Locate this block (around line 34):

```ts
const TAB_IDS = ["claims", "top"] as const;
type TabId = (typeof TAB_IDS)[number];
```

Replace with:

```ts
const TAB_IDS = ["claims", "top", "bursts"] as const;
type TabId = (typeof TAB_IDS)[number];
```

- [ ] **Step 3: Add bursts state, filters, and data fetch alongside the existing per-tab branches**

Locate the block that declares the per-tab state slots:

```ts
  let overview: PeekGrowthOverview = {
    generatedAt: new Date().toISOString(),
    metrics: [],
  };
  let topReferrers: ReadonlyArray<PeekTopReferrerRow> = [];
  let claims: ReadonlyArray<PeekGrowthClaimRow> = [];
  let overviewError: string | null = null;
  let topReferrersError: string | null = null;
  let claimsError: string | null = null;
```

Add two new slots so the file declares:

```ts
  let overview: PeekGrowthOverview = {
    generatedAt: new Date().toISOString(),
    metrics: [],
  };
  let topReferrers: ReadonlyArray<PeekTopReferrerRow> = [];
  let claims: ReadonlyArray<PeekGrowthClaimRow> = [];
  let bursts: ReadonlyArray<PeekSignupBurstRow> = [];
  let overviewError: string | null = null;
  let topReferrersError: string | null = null;
  let claimsError: string | null = null;
  let burstsError: string | null = null;
```

Add filter parsing alongside `topReferrerFilters`:

```ts
  const topReferrerFilters = normalizeTopReferrerFiltersFromSearchParams(params);
  const burstFilters = normalizeSignupBurstFiltersFromSearchParams(params);
```

Replace the existing per-tab `if (tabId === "top") { … } else { … }` block with a three-way `if/else if/else`:

```ts
  if (tabId === "top") {
    try {
      topReferrers = await listTopReferrers({ filters: topReferrerFilters });
    } catch (error) {
      topReferrersError =
        error instanceof Error
          ? error.message
          : "Top referrers could not be loaded.";
    }
  } else if (tabId === "bursts") {
    try {
      bursts = await listSignupBursts({ filters: burstFilters });
    } catch (error) {
      burstsError =
        error instanceof Error
          ? error.message
          : "Signup bursts could not be loaded.";
    }
  } else {
    try {
      claims = await listReferralClaims({ filters });
    } catch (error) {
      claimsError =
        error instanceof Error
          ? error.message
          : "Referral claims could not be loaded.";
    }
  }
```

- [ ] **Step 4: Add the new tab + filter form + table to the JSX**

Locate the `<Tabs … tabs={[…]}>` element and extend the array:

```tsx
        <Tabs
          current={tabId}
          tabs={[
            {
              id: "claims",
              label: "Referral claims",
              href: `${ROUTE}?tab=claims`,
            },
            {
              id: "top",
              label: "Top referrers",
              href: `${ROUTE}?tab=top`,
            },
            {
              id: "bursts",
              label: "Signup bursts",
              href: `${ROUTE}?tab=bursts`,
            },
          ]}
        />
```

Locate the ternary that switches on `tabId === "claims"`. Replace the entire ternary expression (the `{tabId === "claims" ? (…) : (…)}` block) with this three-way conditional:

```tsx
        {tabId === "claims" ? (
          <div className="grid gap-3" id="claims">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-xs text-muted-foreground">
                Filterable by status, user, amount, requested date, tx
                signature, and error text. URL-addressable so internal
                investigations can be shared.
              </p>
              <ExportActionLink
                href={claimsExportHref}
                label="Export filtered CSV"
                enabled={claimsExportEnabled}
                disabledReason={claimsExportDisabledReason}
              />
            </div>
            <GrowthClaimsFilterBar filters={filters} action={ROUTE} />
            <GrowthClaimsTable rows={claims} error={claimsError} />
          </div>
        ) : tabId === "top" ? (
          <div className="grid gap-3" id="top-referrers">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-xs text-muted-foreground">
                Filterable by referrer, wallet, referral code, and minimum
                earned lamports. Default 50 rows · sorted by referrer earnings
                · server-side capped at 250.
              </p>
              <ExportActionLink
                href={referrersExportHref}
                label="Export filtered CSV"
                enabled={referrersExportEnabled}
                disabledReason={referrersExportDisabledReason}
              />
            </div>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="top" />
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="referrerUserId">Referrer user id</Label>
                <Input
                  id="referrerUserId"
                  defaultValue={topReferrerFilters.userId ?? ""}
                  name="referrerUserId"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="referrerWallet">Wallet</Label>
                <Input
                  id="referrerWallet"
                  defaultValue={topReferrerFilters.wallet ?? ""}
                  name="referrerWallet"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="referrerCode">Referral code</Label>
                <Input
                  id="referrerCode"
                  defaultValue={topReferrerFilters.referralCode ?? ""}
                  name="referrerCode"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="referrerMinEarned">Min earned lamports</Label>
                <Input
                  id="referrerMinEarned"
                  defaultValue={topReferrerFilters.minEarnedLamports ?? ""}
                  inputMode="numeric"
                  name="referrerMinEarned"
                />
              </div>
              <Button type="submit">Apply</Button>
            </form>
            <GrowthReferrersTable
              rows={topReferrers}
              error={topReferrersError}
              referrer={buildReferrerFromRawParams(ROUTE, params)}
            />
          </div>
        ) : (
          <div className="grid gap-3" id="bursts">
            <p className="m-0 text-xs text-muted-foreground">
              Referrers ranked by largest rolling 5-minute signup burst,
              tiebroken by smallest consecutive signup gap. Default 50 rows ·
              minimum 5 referees · server-side capped at 250.
            </p>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="bursts" />
              <div className="grid gap-1.5 flex-1 min-w-[140px] max-w-xs">
                <Label htmlFor="burstMinReferees">Min referees</Label>
                <Input
                  id="burstMinReferees"
                  defaultValue={burstFilters.minReferees ?? "5"}
                  inputMode="numeric"
                  name="burstMinReferees"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[140px] max-w-xs">
                <Label htmlFor="burstMinMaxBurst">Min max-burst</Label>
                <Input
                  id="burstMinMaxBurst"
                  defaultValue={burstFilters.minMaxBurst ?? ""}
                  inputMode="numeric"
                  name="burstMinMaxBurst"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="burstReferrerUserId">Referrer user id</Label>
                <Input
                  id="burstReferrerUserId"
                  defaultValue={burstFilters.referrerUserId ?? ""}
                  name="burstReferrerUserId"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="burstReferrerWallet">Wallet</Label>
                <Input
                  id="burstReferrerWallet"
                  defaultValue={burstFilters.wallet ?? ""}
                  name="burstReferrerWallet"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="burstReferralCode">Referral code</Label>
                <Input
                  id="burstReferralCode"
                  defaultValue={burstFilters.referralCode ?? ""}
                  name="burstReferralCode"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="burstFirstSignupFrom">First signup from</Label>
                <Input
                  id="burstFirstSignupFrom"
                  defaultValue={burstFilters.firstSignupFrom ?? ""}
                  name="burstFirstSignupFrom"
                  type="date"
                />
              </div>
              <div className="grid gap-1.5 flex-1 min-w-[160px] max-w-xs">
                <Label htmlFor="burstFirstSignupTo">First signup to</Label>
                <Input
                  id="burstFirstSignupTo"
                  defaultValue={burstFilters.firstSignupTo ?? ""}
                  name="burstFirstSignupTo"
                  type="date"
                />
              </div>
              <Button type="submit">Apply</Button>
            </form>
            <SignupBurstsTable rows={bursts} error={burstsError} />
          </div>
        )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm verify:fast`
Expected: PASS — lint clean, tsc clean.

- [ ] **Step 6: Run the full unit-test suite**

Run: `pnpm test`
Expected: PASS — all peek tests green (component, query, normalizer, page renders are server-only and don't need a special test).

- [ ] **Step 7: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add app/growth/referrals/page.tsx
git commit -m "feat(peek): wire Signup bursts tab into /growth/referrals page (spec 405)"
```

---

## Task 6: Add visual capture entry

**Files:**
- Modify: `peek/e2e/visual/capture.spec.ts`

- [ ] **Step 1: Append the new state entry**

In `peek/e2e/visual/capture.spec.ts`, locate the `states` array and add a new entry next to the existing growth captures:

```ts
  { name: "growth-claims", url: "/growth/referrals?tab=claims" },
  { name: "growth-top", url: "/growth/referrals?tab=top" },
  { name: "growth-bursts", url: "/growth/referrals?tab=bursts" },
  { name: "growth-overrides", url: "/growth/overrides" },
```

- [ ] **Step 2: Commit**

```bash
cd /workspaces/rng-utopia/peek
git add e2e/visual/capture.spec.ts
git commit -m "test(peek): add visual capture for /growth/referrals?tab=bursts (spec 405)"
```

> **Note on visual baselines:** Per `/workspaces/rng-utopia/CLAUDE.md` and project memory (`feedback_visual_snapshots.md`), only update baselines when a task involves intentional visual changes. This task **does** add a new page state, so adding the capture is appropriate, but actually running `pnpm test:visual` and updating baselines is left to the human review step — the implementer should not auto-update baselines because the new state has never had a baseline. A reviewer (or the visual gate in CI) will produce the first baseline.

---

## Task 7: Final verification + root submodule pointer bump

**Files:**
- Modify (root): submodule pointer for `peek`

- [ ] **Step 1: Run the full peek verify**

Run: `pnpm verify` (from `peek/`)
Expected: PASS — lint, typecheck, tests, build all green.

- [ ] **Step 2: Push the peek branch**

```bash
cd /workspaces/rng-utopia/peek
git push origin dev
```

Expected: push succeeds; CI on peek should run and stay green.

- [ ] **Step 3: Bump the root submodule pointer**

```bash
cd /workspaces/rng-utopia
git add peek
git status   # peek pointer is the only intended change; webapp + scheduled_tasks.lock stay unstaged
git commit -m "chore(submodule): bump peek for /growth/referrals signup-bursts tab (spec 405)"
```

> Per `push-sub` skill convention, root touches **only** the peek pointer. `webapp` and `.claude/scheduled_tasks.lock` are pre-existing dirt and must not be bundled into this commit.

- [ ] **Step 4: Push root**

```bash
cd /workspaces/rng-utopia
git push origin dev
```

Expected: dev branch updated with the new peek pointer.

- [ ] **Step 5: Smoke check (manual)**

Locally (or on the dev deployment, since peek auto-deploys on push to `dev`) navigate to `/growth/referrals?tab=bursts`. Expected:
- Tab is visible alongside Referral claims and Top referrers.
- Filter form renders with all seven inputs and a default of `5` in "Min referees".
- Either a populated table or the "No referrers match these filters." status block shows (the latter is fine — current waitlist data may have no referrer with 5+ referees).
- Drill-down link on a referrer row jumps to `…?tab=top&referrerUserId=…` and selects the Top referrers tab pre-filtered to that user.

---

## Plan Self-Review

Run through every FR in the spec and confirm each one is implemented by a task:

| Spec FR | Implementing task(s) |
|---|---|
| FR-1 query function with filters, ordering, limits | Task 3a (stub + limits), Task 3b (SQL), Task 3c (filter wiring) |
| FR-2 types + URL normalizer | Task 1 (types), Task 2 (normalizer + tests) |
| FR-3 new tab on `/growth/referrals` | Task 5 |
| FR-4 `SignupBurstsTable` component | Task 4 |
| FR-5 unit tests (query, normalizer, component) | Task 2, Task 3a/3c, Task 4 |

Placeholder scan: no "TBD", no "add appropriate error handling", every step contains the actual code.

Type / name consistency:
- `PeekSignupBurstRow` properties used in Task 1 (declaration), Task 3b (SQL aliases), Task 4 (component reads), Task 5 (page passes the array through). Spot-checked: `referrerUserId`, `username`, `wallet`, `referralCode`, `refereeCount`, `minGapSeconds`, `medianGapSeconds`, `maxBurst5Min`, `firstSignupAt`, `lastSignupAt` — same in all four.
- `PeekSignupBurstFilters` keys used in Task 1, Task 2 (normalizer output), Task 3a/3b (filter destructure), Task 5 (filter form `defaultValue` lookups). Spot-checked: `minReferees`, `minMaxBurst`, `referrerUserId`, `wallet`, `referralCode`, `firstSignupFrom`, `firstSignupTo` — same in all.
- URL param keys: `burstMinReferees`, `burstMinMaxBurst`, `burstReferrerUserId`, `burstReferrerWallet`, `burstReferralCode`, `burstFirstSignupFrom`, `burstFirstSignupTo`. Same in the normalizer test, the normalizer impl, and the page form's `name="…"` attributes.
- `listSignupBursts` function name: same in Task 3a stub, Task 3c tests, Task 5 import.
- `SignupBurstsTable` component name: same in Task 4 file, Task 5 import.

No spec requirement is left without a task.
