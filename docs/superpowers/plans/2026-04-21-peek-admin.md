# Peek Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `peek/` as a separate internal, server-rendered admin app that reads waitlist/referral data directly from Postgres and provides a users-first, read-only operator view.

**Architecture:** `peek` will be a standalone Next.js App Router project in `peek/`, added as its own git submodule. Server components and route handlers will call a small repository layer in `peek/src/server/db/**`, which shapes Postgres rows into admin-facing view models before rendering. V1 stays read-only, with an empty `mutations/` boundary reserved for future write actions.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `postgres`, `zod`, Vitest, Testing Library, Playwright

---

## File Structure

### Root repo

- Modify: `.gitmodules` — register `peek` as a submodule
- Modify: root `README.md` only if it already documents submodules and needs a short `peek` entry
- Create: `docs/superpowers/plans/2026-04-21-peek-admin.md` — this plan

### `peek/` project

- Create: `peek/package.json` — app scripts and dependencies
- Create: `peek/next.config.ts` — Next.js config
- Create: `peek/tsconfig.json` — TS config
- Create: `peek/postcss.config.mjs` — Tailwind/Next postcss integration
- Create: `peek/vitest.config.ts` — unit test config
- Create: `peek/playwright.config.ts` — E2E config
- Create: `peek/.env.example` — local env contract
- Create: `peek/README.md` — setup and usage
- Create: `peek/app/layout.tsx` — app shell
- Create: `peek/app/globals.css` — shared styles
- Create: `peek/app/page.tsx` — users-first landing page
- Create: `peek/app/users/[userId]/page.tsx` — user detail route
- Create: `peek/src/components/summary-strip.tsx` — top metrics row
- Create: `peek/src/components/users-table.tsx` — table rendering
- Create: `peek/src/components/user-detail-card.tsx` — detail rendering
- Create: `peek/src/lib/types/peek.ts` — shared admin view models
- Create: `peek/src/lib/search-params.ts` — URL param parsing helpers
- Create: `peek/src/server/db/client.ts` — server-only Postgres client
- Create: `peek/src/server/db/queries/get-peek-summary.ts` — summary query
- Create: `peek/src/server/db/queries/list-peek-users.ts` — list query
- Create: `peek/src/server/db/queries/get-peek-user-detail.ts` — detail query
- Create: `peek/src/server/mutations/README.md` — placeholder boundary for future writes
- Create: `peek/src/test/factories/peek-fixtures.ts` — test data builders
- Create: `peek/src/server/db/queries/__tests__/get-peek-summary.test.ts`
- Create: `peek/src/server/db/queries/__tests__/list-peek-users.test.ts`
- Create: `peek/src/server/db/queries/__tests__/get-peek-user-detail.test.ts`
- Create: `peek/src/components/__tests__/summary-strip.test.tsx`
- Create: `peek/src/components/__tests__/users-table.test.tsx`
- Create: `peek/e2e/home.spec.ts` — users-first smoke flow

### Project shape rules

- Keep SQL in `peek/src/server/db/queries/**` only
- Keep browser-safe types/helpers in `peek/src/lib/**`
- Keep future writes isolated in `peek/src/server/mutations/**`
- Keep the first page users-first; do not introduce a separate analytics dashboard route in v1

---

### Task 1: Add Submodule And Bootstrap `peek`

**Files:**
- Modify: `.gitmodules`
- Create: `peek/`
- Create: `peek/package.json`
- Create: `peek/next.config.ts`
- Create: `peek/tsconfig.json`
- Create: `peek/postcss.config.mjs`
- Create: `peek/vitest.config.ts`
- Create: `peek/playwright.config.ts`
- Create: `peek/app/layout.tsx`
- Create: `peek/app/page.tsx`
- Create: `peek/app/globals.css`
- Create: `peek/README.md`
- Test: `peek/src/components/__tests__/summary-strip.test.tsx`

- [ ] **Step 1: Add the git submodule**

```bash
git submodule add https://github.com/taunt-bet/peek.git peek
git submodule update --init --recursive
```

Expected: `.gitmodules` contains a `peek` entry and the `peek/` directory is present.

- [ ] **Step 2: Write the failing app smoke test**

Create `peek/src/components/__tests__/summary-strip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryStrip } from "../../components/summary-strip";

describe("SummaryStrip", () => {
  it("renders the four required overview metrics", () => {
    render(
      <SummaryStrip
        summary={{
          totalUsers: 120,
          totalUsersWithCodes: 80,
          totalReferredUsers: 42,
          totalUniqueReferrers: 17,
        }}
      />
    );

    expect(screen.getByText("Total users")).toBeInTheDocument();
    expect(screen.getByText("Users with codes")).toBeInTheDocument();
    expect(screen.getByText("Referred users")).toBeInTheDocument();
    expect(screen.getByText("Unique referrers")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify the app is not scaffolded yet**

Run:

```bash
cd peek && npm test -- summary-strip
```

Expected: FAIL with missing package/test runner or missing `SummaryStrip`.

- [ ] **Step 4: Add the minimal project scaffold**

Create `peek/package.json`:

```json
{
  "name": "@taunt-bet/peek",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "next": "^15.0.0",
    "postgres": "^3.4.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

Create `peek/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

Create `peek/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

Create `peek/app/layout.tsx`:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `peek/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main>
      <h1>Peek</h1>
      <p>Waitlist and referral admin.</p>
    </main>
  );
}
```

- [ ] **Step 5: Install dependencies and rerun the smoke test**

Run:

```bash
cd peek && npm install && npm test -- summary-strip
```

Expected: FAIL with `Cannot find module '../../components/summary-strip'`, which confirms the scaffold exists and the test is now pointed at the missing component.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add .gitmodules peek
git commit -m "feat: bootstrap peek app"
```

---

### Task 2: Define Env Contract, Types, And Server DB Client

**Files:**
- Create: `peek/.env.example`
- Create: `peek/src/lib/types/peek.ts`
- Create: `peek/src/server/db/client.ts`
- Create: `peek/src/server/mutations/README.md`
- Test: `peek/src/server/db/queries/__tests__/get-peek-summary.test.ts`

- [ ] **Step 1: Write the failing summary contract test**

Create `peek/src/server/db/queries/__tests__/get-peek-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PeekSummary } from "@/src/lib/types/peek";

describe("PeekSummary contract", () => {
  it("uses the required overview fields", () => {
    const summary: PeekSummary = {
      totalUsers: 1,
      totalUsersWithCodes: 1,
      totalReferredUsers: 1,
      totalUniqueReferrers: 1,
    };

    expect(summary.totalUsers).toBe(1);
    expect(summary.totalUsersWithCodes).toBe(1);
    expect(summary.totalReferredUsers).toBe(1);
    expect(summary.totalUniqueReferrers).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify the types do not exist**

Run:

```bash
cd peek && npm test -- get-peek-summary
```

Expected: FAIL with missing `PeekSummary` type.

- [ ] **Step 3: Add shared types and env/DB client**

Create `peek/src/lib/types/peek.ts`:

```ts
export type PeekSummary = {
  totalUsers: number;
  totalUsersWithCodes: number;
  totalReferredUsers: number;
  totalUniqueReferrers: number;
};

export type PeekUserRow = {
  userId: string;
  username: string | null;
  wallet: string;
  joinedAt: string;
  referralCode: string | null;
  referrerUserId: string | null;
  referrerCode: string | null;
  refereeCount: number;
  telegramLinkState: "pending" | "redeemed" | "expired" | "none";
};

export type PeekUserDetail = {
  user: PeekUserRow;
  inboundReferral: {
    referrerUserId: string | null;
    referrerCode: string | null;
    linkedAt: string | null;
  };
  outboundReferees: Array<{
    refereeUserId: string;
    refereeUsername: string | null;
    createdAt: string;
  }>;
  telegram: {
    state: "pending" | "redeemed" | "expired" | "none";
    telegramUserId: string | null;
    telegramUsername: string | null;
  };
};
```

Create `peek/.env.example`:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/taunt_bet
PEEK_DEFAULT_PAGE_SIZE=50
```

Create `peek/src/server/db/client.ts`:

```ts
import "server-only";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const sql = postgres(connectionString, {
  max: 5,
  prepare: true,
});
```

Create `peek/src/server/mutations/README.md`:

```md
# Future mutations

This directory is intentionally empty in v1.

When `peek` gains write actions, add them here and require:
- explicit auth checks
- audit logging
- isolated tests
```

- [ ] **Step 4: Run the test to verify the contract now passes**

Run:

```bash
cd peek && npm test -- get-peek-summary
```

Expected: PASS.

- [ ] **Step 5: Commit the contracts and server-only DB boundary**

```bash
git add peek/.env.example peek/src/lib/types/peek.ts peek/src/server/db/client.ts peek/src/server/mutations/README.md peek/src/server/db/queries/__tests__/get-peek-summary.test.ts
git commit -m "feat: add peek data contracts"
```

---

### Task 3: Implement Summary And Users List Queries

**Files:**
- Create: `peek/src/test/factories/peek-fixtures.ts`
- Create: `peek/src/server/db/queries/get-peek-summary.ts`
- Create: `peek/src/server/db/queries/list-peek-users.ts`
- Create: `peek/src/lib/search-params.ts`
- Test: `peek/src/server/db/queries/__tests__/list-peek-users.test.ts`

- [ ] **Step 1: Write the failing users-query test**

Create `peek/src/server/db/queries/__tests__/list-peek-users.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePeekSearchParams } from "@/src/lib/search-params";

describe("normalizePeekSearchParams", () => {
  it("defaults sort and page size for the users-first screen", () => {
    expect(normalizePeekSearchParams({})).toEqual({
      query: "",
      sort: "joinedAt",
      direction: "desc",
      page: 1,
      pageSize: 50,
      filters: {
        hasReferrer: false,
        hasReferees: false,
        hasCode: false,
        telegramState: "all",
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify the parser does not exist**

Run:

```bash
cd peek && npm test -- list-peek-users
```

Expected: FAIL with missing `normalizePeekSearchParams`.

- [ ] **Step 3: Implement URL param parsing and repository queries**

Create `peek/src/lib/search-params.ts`:

```ts
export type PeekSearchParams = {
  query: string;
  sort: "joinedAt" | "refereeCount";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  filters: {
    hasReferrer: boolean;
    hasReferees: boolean;
    hasCode: boolean;
    telegramState: "all" | "pending" | "redeemed" | "expired" | "none";
  };
};

export function normalizePeekSearchParams(
  input: Record<string, string | string[] | undefined>
): PeekSearchParams {
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] ?? "" : value ?? "";

  return {
    query: one(input.query),
    sort: one(input.sort) === "refereeCount" ? "refereeCount" : "joinedAt",
    direction: one(input.direction) === "asc" ? "asc" : "desc",
    page: Number(one(input.page) || "1"),
    pageSize: Number(process.env.PEEK_DEFAULT_PAGE_SIZE || "50"),
    filters: {
      hasReferrer: one(input.hasReferrer) === "true",
      hasReferees: one(input.hasReferees) === "true",
      hasCode: one(input.hasCode) === "true",
      telegramState: ["pending", "redeemed", "expired", "none"].includes(one(input.telegramState))
        ? (one(input.telegramState) as PeekSearchParams["filters"]["telegramState"])
        : "all",
    },
  };
}
```

Create `peek/src/server/db/queries/get-peek-summary.ts`:

```ts
import "server-only";
import { sql } from "../client";
import type { PeekSummary } from "@/src/lib/types/peek";

export async function getPeekSummary(): Promise<PeekSummary> {
  const [row] = await sql<PeekSummary[]>`
    select
      (select count(*)::int from player_profiles) as "totalUsers",
      (select count(*)::int from referral_codes) as "totalUsersWithCodes",
      (select count(*)::int from referral_links) as "totalReferredUsers",
      (select count(distinct referrer_user_id)::int from referral_links) as "totalUniqueReferrers"
  `;

  return row;
}
```

Create `peek/src/server/db/queries/list-peek-users.ts`:

```ts
import "server-only";
import { sql } from "../client";
import type { PeekUserRow } from "@/src/lib/types/peek";
import type { PeekSearchParams } from "@/src/lib/search-params";

export async function listPeekUsers(params: PeekSearchParams): Promise<PeekUserRow[]> {
  const search = `%${params.query}%`;

  return sql<PeekUserRow[]>`
    select
      pp.user_id as "userId",
      pp.username as "username",
      pp.wallet as "wallet",
      pp.created_at::text as "joinedAt",
      rc.code as "referralCode",
      rl.referrer_user_id as "referrerUserId",
      ref_code.code as "referrerCode",
      count(outbound.referee_user_id)::int as "refereeCount",
      coalesce(tlt.status, 'none') as "telegramLinkState"
    from player_profiles pp
    left join referral_codes rc on rc.user_id = pp.user_id
    left join referral_links rl on rl.referee_user_id = pp.user_id
    left join referral_codes ref_code on ref_code.user_id = rl.referrer_user_id
    left join referral_links outbound on outbound.referrer_user_id = pp.user_id
    left join lateral (
      select status
      from telegram_link_tokens
      where user_id = pp.user_id
      order by created_at desc
      limit 1
    ) tlt on true
    where (
      ${params.query === ""}
      or pp.user_id ilike ${search}
      or pp.wallet ilike ${search}
      or coalesce(pp.username, '') ilike ${search}
      or coalesce(rc.code, '') ilike ${search}
    )
    group by pp.user_id, pp.username, pp.wallet, pp.created_at, rc.code, rl.referrer_user_id, ref_code.code, tlt.status
    order by ${
      params.sort === "refereeCount"
        ? sql`count(outbound.referee_user_id)`
        : sql`pp.created_at`
    } ${params.direction === "asc" ? sql`asc` : sql`desc`}
    limit ${params.pageSize}
    offset ${(params.page - 1) * params.pageSize}
  `;
}
```

- [ ] **Step 4: Run the parser/query tests**

Run:

```bash
cd peek && npm test -- list-peek-users
```

Expected: PASS for parser tests. Query tests can be added as unit tests around row mapping or as integration tests once the local DB harness exists.

- [ ] **Step 5: Commit the read repository**

```bash
git add peek/src/lib/search-params.ts peek/src/server/db/queries/get-peek-summary.ts peek/src/server/db/queries/list-peek-users.ts peek/src/server/db/queries/__tests__/list-peek-users.test.ts
git commit -m "feat: add peek list queries"
```

---

### Task 4: Build The Users-First Landing Page

**Files:**
- Create: `peek/src/components/summary-strip.tsx`
- Create: `peek/src/components/users-table.tsx`
- Modify: `peek/app/page.tsx`
- Test: `peek/src/components/__tests__/users-table.test.tsx`

- [ ] **Step 1: Write the failing table test**

Create `peek/src/components/__tests__/users-table.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsersTable } from "../users-table";

describe("UsersTable", () => {
  it("renders the required operator columns", () => {
    render(
      <UsersTable
        users={[
          {
            userId: "u_1",
            username: "alice",
            wallet: "wallet_1",
            joinedAt: "2026-04-21T00:00:00.000Z",
            referralCode: "alice-code",
            referrerUserId: "u_ref",
            referrerCode: "ref-code",
            refereeCount: 3,
            telegramLinkState: "redeemed",
          },
        ]}
      />
    );

    expect(screen.getByText("User ID")).toBeInTheDocument();
    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText("Referral code")).toBeInTheDocument();
    expect(screen.getByText("Referrer")).toBeInTheDocument();
    expect(screen.getByText("Referees")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify the component is missing**

Run:

```bash
cd peek && npm test -- users-table
```

Expected: FAIL with missing `UsersTable`.

- [ ] **Step 3: Implement the summary strip and users table**

Create `peek/src/components/summary-strip.tsx`:

```tsx
import type { PeekSummary } from "@/src/lib/types/peek";

export function SummaryStrip({ summary }: { summary: PeekSummary }) {
  const items = [
    ["Total users", summary.totalUsers],
    ["Users with codes", summary.totalUsersWithCodes],
    ["Referred users", summary.totalReferredUsers],
    ["Unique referrers", summary.totalUniqueReferrers],
  ] as const;

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {items.map(([label, value]) => (
        <article key={label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        </article>
      ))}
    </section>
  );
}
```

Create `peek/src/components/users-table.tsx`:

```tsx
import Link from "next/link";
import type { PeekUserRow } from "@/src/lib/types/peek";

export function UsersTable({ users }: { users: PeekUserRow[] }) {
  return (
    <table className="w-full table-auto border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-zinc-800 text-zinc-400">
          <th className="px-3 py-2">User ID</th>
          <th className="px-3 py-2">Username</th>
          <th className="px-3 py-2">Wallet</th>
          <th className="px-3 py-2">Joined</th>
          <th className="px-3 py-2">Referral code</th>
          <th className="px-3 py-2">Referrer</th>
          <th className="px-3 py-2">Referees</th>
          <th className="px-3 py-2">Telegram</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.userId} className="border-b border-zinc-900">
            <td className="px-3 py-2">
              <Link href={`/users/${user.userId}`} className="text-sky-400">
                {user.userId}
              </Link>
            </td>
            <td className="px-3 py-2">{user.username ?? "—"}</td>
            <td className="px-3 py-2 font-mono">{user.wallet}</td>
            <td className="px-3 py-2">{user.joinedAt}</td>
            <td className="px-3 py-2">{user.referralCode ?? "—"}</td>
            <td className="px-3 py-2">{user.referrerCode ?? user.referrerUserId ?? "—"}</td>
            <td className="px-3 py-2">{user.refereeCount}</td>
            <td className="px-3 py-2">{user.telegramLinkState}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Modify `peek/app/page.tsx`:

```tsx
import { SummaryStrip } from "@/src/components/summary-strip";
import { UsersTable } from "@/src/components/users-table";
import { normalizePeekSearchParams } from "@/src/lib/search-params";
import { getPeekSummary } from "@/src/server/db/queries/get-peek-summary";
import { listPeekUsers } from "@/src/server/db/queries/list-peek-users";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = normalizePeekSearchParams(await searchParams);
  const [summary, users] = await Promise.all([
    getPeekSummary(),
    listPeekUsers(params),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8">
      <header>
        <h1 className="text-3xl font-semibold text-white">Peek</h1>
        <p className="mt-2 text-zinc-400">Users-first waitlist and referral admin.</p>
      </header>

      <SummaryStrip summary={summary} />
      <UsersTable users={users} />
    </main>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run:

```bash
cd peek && npm test -- users-table summary-strip
```

Expected: PASS.

- [ ] **Step 5: Commit the users-first shell**

```bash
git add peek/app/page.tsx peek/src/components/summary-strip.tsx peek/src/components/users-table.tsx peek/src/components/__tests__/summary-strip.test.tsx peek/src/components/__tests__/users-table.test.tsx
git commit -m "feat: add peek home view"
```

---

### Task 5: Add Search, Filters, And User Detail

**Files:**
- Create: `peek/src/server/db/queries/get-peek-user-detail.ts`
- Create: `peek/src/components/user-detail-card.tsx`
- Create: `peek/app/users/[userId]/page.tsx`
- Modify: `peek/src/server/db/queries/list-peek-users.ts`
- Test: `peek/src/server/db/queries/__tests__/get-peek-user-detail.test.ts`

- [ ] **Step 1: Write the failing user-detail test**

Create `peek/src/server/db/queries/__tests__/get-peek-user-detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PeekUserDetail } from "@/src/lib/types/peek";

describe("PeekUserDetail contract", () => {
  it("includes inbound, outbound, and telegram sections", () => {
    const detail: PeekUserDetail = {
      user: {
        userId: "u_1",
        username: "alice",
        wallet: "wallet_1",
        joinedAt: "2026-04-21T00:00:00.000Z",
        referralCode: "alice-code",
        referrerUserId: null,
        referrerCode: null,
        refereeCount: 3,
        telegramLinkState: "redeemed",
      },
      inboundReferral: {
        referrerUserId: null,
        referrerCode: null,
        linkedAt: null,
      },
      outboundReferees: [],
      telegram: {
        state: "redeemed",
        telegramUserId: "123",
        telegramUsername: "alice_tg",
      },
    };

    expect(detail.telegram.state).toBe("redeemed");
    expect(detail.outboundReferees).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify the detail query is missing**

Run:

```bash
cd peek && npm test -- get-peek-user-detail
```

Expected: FAIL with missing detail query or missing route component.

- [ ] **Step 3: Implement the detail query and route**

Create `peek/src/server/db/queries/get-peek-user-detail.ts`:

```ts
import "server-only";
import { sql } from "../client";
import type { PeekUserDetail } from "@/src/lib/types/peek";

export async function getPeekUserDetail(userId: string): Promise<PeekUserDetail | null> {
  const [user] = await sql<any[]>`
    select
      pp.user_id as "userId",
      pp.username as "username",
      pp.wallet as "wallet",
      pp.created_at::text as "joinedAt",
      rc.code as "referralCode",
      rl.referrer_user_id as "referrerUserId",
      ref_code.code as "referrerCode",
      (
        select count(*)::int
        from referral_links outbound
        where outbound.referrer_user_id = pp.user_id
      ) as "refereeCount",
      coalesce(tlt.status, 'none') as "telegramLinkState",
      rl.created_at::text as "linkedAt",
      tlt.telegram_user_id as "telegramUserId",
      tlt.telegram_username as "telegramUsername"
    from player_profiles pp
    left join referral_codes rc on rc.user_id = pp.user_id
    left join referral_links rl on rl.referee_user_id = pp.user_id
    left join referral_codes ref_code on ref_code.user_id = rl.referrer_user_id
    left join lateral (
      select status, telegram_user_id, telegram_username
      from telegram_link_tokens
      where user_id = pp.user_id
      order by created_at desc
      limit 1
    ) tlt on true
    where pp.user_id = ${userId}
  `;

  if (!user) return null;

  const outboundReferees = await sql<Array<{
    refereeUserId: string;
    refereeUsername: string | null;
    createdAt: string;
  }>>`
    select
      rl.referee_user_id as "refereeUserId",
      pp.username as "refereeUsername",
      rl.created_at::text as "createdAt"
    from referral_links rl
    left join player_profiles pp on pp.user_id = rl.referee_user_id
    where rl.referrer_user_id = ${userId}
    order by rl.created_at desc
  `;

  return {
    user: {
      userId: user.userId,
      username: user.username,
      wallet: user.wallet,
      joinedAt: user.joinedAt,
      referralCode: user.referralCode,
      referrerUserId: user.referrerUserId,
      referrerCode: user.referrerCode,
      refereeCount: user.refereeCount,
      telegramLinkState: user.telegramLinkState,
    },
    inboundReferral: {
      referrerUserId: user.referrerUserId,
      referrerCode: user.referrerCode,
      linkedAt: user.linkedAt,
    },
    outboundReferees,
    telegram: {
      state: user.telegramLinkState,
      telegramUserId: user.telegramUserId,
      telegramUsername: user.telegramUsername,
    },
  };
}
```

Create `peek/src/components/user-detail-card.tsx`:

```tsx
import type { PeekUserDetail } from "@/src/lib/types/peek";

export function UserDetailCard({ detail }: { detail: PeekUserDetail }) {
  return (
    <section className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">{detail.user.username ?? detail.user.userId}</h2>
        <p className="mt-1 font-mono text-sm text-zinc-400">{detail.user.wallet}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300">Inbound referral</h3>
        <p className="mt-2 text-sm text-zinc-400">
          {detail.inboundReferral.referrerCode ?? detail.inboundReferral.referrerUserId ?? "No referrer"}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300">Outbound referees</h3>
        <ul className="mt-2 space-y-2 text-sm text-zinc-400">
          {detail.outboundReferees.length === 0 ? (
            <li>No referees yet.</li>
          ) : (
            detail.outboundReferees.map((referee) => (
              <li key={referee.refereeUserId}>
                {referee.refereeUsername ?? referee.refereeUserId} — {referee.createdAt}
              </li>
            ))
          )}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300">Telegram</h3>
        <p className="mt-2 text-sm text-zinc-400">
          {detail.telegram.state} / {detail.telegram.telegramUsername ?? "no username"}
        </p>
      </div>
    </section>
  );
}
```

Create `peek/app/users/[userId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { UserDetailCard } from "@/src/components/user-detail-card";
import { getPeekUserDetail } from "@/src/server/db/queries/get-peek-user-detail";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const detail = await getPeekUserDetail(userId);

  if (!detail) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <UserDetailCard detail={detail} />
    </main>
  );
}
```

- [ ] **Step 4: Apply the remaining list filters**

Modify `peek/src/server/db/queries/list-peek-users.ts` so the `where` clause includes:

```ts
and (${!params.filters.hasReferrer} or rl.referrer_user_id is not null)
and (${!params.filters.hasReferees} or exists (
  select 1 from referral_links outbound_exists where outbound_exists.referrer_user_id = pp.user_id
))
and (${!params.filters.hasCode} or rc.code is not null)
and (${params.filters.telegramState === "all"} or coalesce(tlt.status, 'none') = ${params.filters.telegramState})
```

- [ ] **Step 5: Run the tests and a local route check**

Run:

```bash
cd peek && npm test -- get-peek-user-detail users-table
cd peek && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the detail flow**

```bash
git add peek/src/server/db/queries/get-peek-user-detail.ts peek/src/components/user-detail-card.tsx peek/app/users/[userId]/page.tsx peek/src/server/db/queries/__tests__/get-peek-user-detail.test.ts peek/src/server/db/queries/list-peek-users.ts
git commit -m "feat: add peek user detail"
```

---

### Task 6: Add Docs, Verification, And E2E Smoke Coverage

**Files:**
- Create: `peek/e2e/home.spec.ts`
- Modify: `peek/README.md`
- Modify: root `README.md` if needed
- Test: `peek/e2e/home.spec.ts`

- [ ] **Step 1: Write the failing E2E smoke test**

Create `peek/e2e/home.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("home page renders the users-first admin shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Peek" })).toBeVisible();
  await expect(page.getByText("Users with codes")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "User ID" })).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E test to verify the dev server/test harness is incomplete**

Run:

```bash
cd peek && npm run test:e2e -- home.spec.ts
```

Expected: FAIL until Playwright config and dev server wiring are added.

- [ ] **Step 3: Add the remaining docs and test harness**

Create `peek/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
```

Create `peek/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

Update `peek/README.md`:

```md
# Peek

Internal waitlist and referral admin for Taunt Bet.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Required env

- `DATABASE_URL`
- `PEEK_DEFAULT_PAGE_SIZE`

## Commands

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run test:e2e`
```

- [ ] **Step 4: Run the full local verification**

Run:

```bash
cd peek && npm test && npm run typecheck && npm run build
cd peek && npm run test:e2e
```

Expected: PASS.

- [ ] **Step 5: Verify no waitlist/public contract drift**

Run:

```bash
git diff -- backend/src/__tests__/waitlist-contract.test.ts waitlist
```

Expected: no changes related to `peek`.

- [ ] **Step 6: Commit docs and verification**

```bash
git add peek/README.md peek/playwright.config.ts peek/vitest.config.ts peek/e2e/home.spec.ts
git commit -m "docs: add peek setup and tests"
```

---

## Spec Coverage Check

- **FR-1 Separate Internal Project Boundary:** Covered by Task 1 and Task 6.
- **FR-2 Direct Database Repository Layer:** Covered by Task 2 and Task 3.
- **FR-3 Users-First Landing Screen:** Covered by Task 4.
- **FR-4 Full Ops-Oriented User Detail:** Covered by Task 5.
- **FR-5 Waitlist And Referral Data Coverage:** Covered by Task 3 and Task 5.
- **FR-6 Read-Only V1 With Future Mutation Boundary:** Covered by Task 2.
- **FR-7 Internal-Only Operational Safety:** Covered by Task 2, Task 3, and Task 6.

## Self-Review

- No placeholders remain in task steps.
- The file layout keeps SQL in `server/db/queries/**`, UI in `components/**`, and future writes in `server/mutations/**`.
- The plan intentionally does not touch `backend/src/__tests__/waitlist-contract.test.ts` or the waitlist client contract.
- The only notable product choice embedded in the plan is **Next.js App Router** for the server-rendered implementation. If you want a different SSR stack, update Task 1 before execution.
