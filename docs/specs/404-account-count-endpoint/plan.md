# Account Count Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /accounts/count` to the backend — anonymous callers receive `{ count, rank: 0 }`; callers with a valid Bearer JWT receive `{ count, rank }` (1-indexed). Deliver on `main` first, cherry-pick to `dev`.

**Architecture:** A single small Hono OpenAPI route file (mirrors `routes/public-referral.ts`). Optional auth is implemented inline via `jose.jwtVerify` — no new middleware. One SQL round-trip per request via a new `ProfilesDb` method.

**Tech Stack:** Hono + `@hono/zod-openapi`, `jose` (HS256), `postgres` (raw SQL), vitest. pnpm workspace.

---

## Working location

All paths in this plan are relative to `backend/` inside the rng-utopia workspace, unless stated otherwise. The implementation happens on a feature branch off `origin/main` in the `backend` submodule.

## File structure

**Modify:**
- `backend/src/db/profiles.ts` — add `getAccountCount()` and `getAccountCountAndRank(userId)` methods to `ProfilesDb` (both interface + `createProfilesDb` implementation).
- `backend/src/index.ts` — add import + `app.route("/accounts", createAccountCountRoutes({ db, jwtSecret: config.jwtSecret }))`.
- `backend/src/index-waitlist.ts` — same mount; also extend the surface-comment header at the top of the file to list `GET /accounts/count`.
- `backend/src/__tests__/waitlist-contract.test.ts` — extend the `WAITLIST_CONTRACT` map with a new entry and mount the new route inside `buildSpecApp`.

**Create:**
- `backend/src/routes/account-count.ts` — the route file (= OpenAPI module, via `createOpenApiApp()`).
- `backend/src/__tests__/account-count.test.ts` — vitest coverage: anon, auth, tiebreak, invalid token.

No new env vars. No migrations. No new middleware.

---

## Task 1: Create the working branch off `main` in the backend submodule

**Files:**
- N/A (git only)

- [ ] **Step 1: From the workspace root, fetch and verify `origin/main`**

Run:
```bash
cd /workspaces/rng-utopia/backend
git fetch origin main
git log --oneline origin/main -3
```
Expected: latest commits on `origin/main` printed. No errors.

- [ ] **Step 2: Stash any in-progress changes (defensive)**

Run:
```bash
git status -s
```
If anything appears, ask the user before proceeding. The backend submodule should be clean — root has `?? peek` in the parent, which is unrelated.

- [ ] **Step 3: Create the feature branch off `origin/main`**

Run:
```bash
git checkout -b feat/accounts-count origin/main
```
Expected: `Switched to a new branch 'feat/accounts-count'`.

- [ ] **Step 4: Confirm branch state**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git rev-parse origin/main
git rev-parse HEAD
```
Expected: branch name is `feat/accounts-count`; the second and third hashes are identical.

---

## Task 2: Add `getAccountCount` + `getAccountCountAndRank` to `ProfilesDb` (TDD)

**Files:**
- Modify: `backend/src/db/profiles.ts`
- Test: `backend/src/__tests__/account-count.test.ts` (new file — used by this task and Task 3)

The DB methods are pure functions of `player_profiles` rows. They can be tested directly against the integration test DB (same harness used by `public-referral-routes.test.ts`).

- [ ] **Step 1: Create the failing test file with DB-method tests**

Create `backend/src/__tests__/account-count.test.ts` with the following content. This file is later extended in Task 3 — keep these tests at the top so the file grows additively.

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db.js";
import {
  closeIntegrationDb,
  openIntegrationDb,
  resetIntegrationState,
  type IntegrationDbContext,
  type TestSql,
} from "./integration-test-helpers.js";

describe("ProfilesDb account count + rank", () => {
  let ctx: IntegrationDbContext;
  let rawSql: TestSql;
  let db: Db;

  beforeAll(async () => {
    ctx = await openIntegrationDb();
    rawSql = ctx.rawSql;
    db = ctx.db;
  });

  afterAll(async () => {
    await closeIntegrationDb(ctx);
  });

  beforeEach(async () => {
    await resetIntegrationState(rawSql);
  });

  async function seedProfile(
    userId: string,
    wallet: string,
    username: string,
    createdAt: string,
  ) {
    await rawSql`
      INSERT INTO player_profiles (user_id, wallet, username, created_at)
      VALUES (${userId}, ${wallet}, ${username}, ${createdAt})
    `;
  }

  it("getAccountCount returns 0 on an empty table", async () => {
    const count = await db.getAccountCount();
    expect(count).toBe(0);
  });

  it("getAccountCount returns the row count", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    await seedProfile("usr_b", "w_b", "bob", "2026-01-02T00:00:00Z");
    await seedProfile("usr_c", "w_c", "carol", "2026-01-03T00:00:00Z");

    const count = await db.getAccountCount();
    expect(count).toBe(3);
  });

  it("getAccountCountAndRank returns 1-indexed rank for the earliest signup", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    await seedProfile("usr_b", "w_b", "bob", "2026-01-02T00:00:00Z");
    await seedProfile("usr_c", "w_c", "carol", "2026-01-03T00:00:00Z");

    const result = await db.getAccountCountAndRank("usr_a");
    expect(result).toEqual({ count: 3, rank: 1 });
  });

  it("getAccountCountAndRank returns 1-indexed rank for a middle signup", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    await seedProfile("usr_b", "w_b", "bob", "2026-01-02T00:00:00Z");
    await seedProfile("usr_c", "w_c", "carol", "2026-01-03T00:00:00Z");

    const result = await db.getAccountCountAndRank("usr_b");
    expect(result).toEqual({ count: 3, rank: 2 });
  });

  it("getAccountCountAndRank tiebreaks on id when created_at is identical", async () => {
    const ts = "2026-01-01T00:00:00Z";
    await seedProfile("usr_a", "w_a", "alice", ts);
    await seedProfile("usr_b", "w_b", "bob", ts);
    await seedProfile("usr_c", "w_c", "carol", ts);

    // Insertion order determines id (BIGINT GENERATED ALWAYS AS IDENTITY).
    const a = await db.getAccountCountAndRank("usr_a");
    const b = await db.getAccountCountAndRank("usr_b");
    const c = await db.getAccountCountAndRank("usr_c");

    expect(a).toEqual({ count: 3, rank: 1 });
    expect(b).toEqual({ count: 3, rank: 2 });
    expect(c).toEqual({ count: 3, rank: 3 });
  });

  it("getAccountCountAndRank returns null rank when user_id is unknown", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    const result = await db.getAccountCountAndRank("usr_ghost");
    expect(result).toEqual({ count: 1, rank: null });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/account-count.test.ts
```
Expected: tests fail with `db.getAccountCount is not a function` / `db.getAccountCountAndRank is not a function`.

- [ ] **Step 3: Extend the `ProfilesDb` interface**

In `backend/src/db/profiles.ts`, locate the `export interface ProfilesDb { ... }` block and add the following methods near the other read methods (after `getProfileAvatarState`, before any write methods — keep grouped with reads):

```typescript
  /**
   * Total number of player profiles. Used by the unauthenticated
   * /accounts/count endpoint to surface signup volume on the waitlist.
   */
  getAccountCount(): Promise<number>;

  /**
   * Total profile count and the caller's 1-indexed rank in the signup order
   * (created_at ASC, id ASC). Returns `{ count, rank: null }` when the user_id
   * has no profile row (caller is authenticated but their profile is missing —
   * an edge case the route translates to `rank: 0`).
   */
  getAccountCountAndRank(
    userId: string,
  ): Promise<{ count: number; rank: number | null }>;
```

- [ ] **Step 4: Implement the methods inside `createProfilesDb(sql)`**

Inside the returned object in `createProfilesDb`, add the two implementations next to the other read methods. Use the existing `sql` template tag (mirrors the file's existing patterns).

```typescript
    async getAccountCount(): Promise<number> {
      const rows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::bigint AS count FROM player_profiles
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async getAccountCountAndRank(
      userId: string,
    ): Promise<{ count: number; rank: number | null }> {
      const rows = await sql<{ count: string; rank: string | null }[]>`
        SELECT
          (SELECT COUNT(*)::bigint FROM player_profiles) AS count,
          (
            SELECT COUNT(*)::bigint
            FROM player_profiles p2
            WHERE (p2.created_at, p2.id) <= (p.created_at, p.id)
          ) AS rank
        FROM player_profiles p
        WHERE p.user_id = ${userId}
      `;

      if (rows.length === 0) {
        const fallback = await sql<{ count: string }[]>`
          SELECT COUNT(*)::bigint AS count FROM player_profiles
        `;
        return { count: Number(fallback[0]?.count ?? 0), rank: null };
      }

      return {
        count: Number(rows[0].count),
        rank: rows[0].rank === null ? null : Number(rows[0].rank),
      };
    },
```

Notes:
- `COUNT(*)` returns `bigint`, which `postgres` returns as a string by default; explicit `Number(...)` conversion is required.
- The `(created_at, id) <= (p.created_at, p.id)` row-comparison gives the deterministic tiebreak by `id`.
- The "no profile row" fallback issues a second query so the anonymous count is still correct.

- [ ] **Step 5: Run the test again — confirm pass**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/account-count.test.ts
```
Expected: all 6 tests in the `ProfilesDb account count + rank` describe block pass.

- [ ] **Step 6: Commit the DB layer**

Run:
```bash
cd /workspaces/rng-utopia/backend
git add src/db/profiles.ts src/__tests__/account-count.test.ts
git commit -m "feat(accounts-count): add getAccountCount + getAccountCountAndRank to ProfilesDb"
```

---

## Task 3: Add the `/accounts/count` route file (TDD)

**Files:**
- Create: `backend/src/routes/account-count.ts`
- Modify: `backend/src/__tests__/account-count.test.ts` (append route-level tests)

- [ ] **Step 1: Add the route-level imports to the top of the test file**

In `backend/src/__tests__/account-count.test.ts`, add these three imports to the existing import block at the top of the file (next to the imports added in Task 2):

```typescript
import { Hono } from "hono";
import { SignJWT } from "jose";
import { createAccountCountRoutes } from "../routes/account-count.js";
```

- [ ] **Step 2: Append the failing route-level describe block**

Append the following describe block to the end of `backend/src/__tests__/account-count.test.ts` (after the `ProfilesDb account count + rank` block from Task 2). These tests build a small Hono app per test, sign real JWTs via `jose.SignJWT`, and hit `app.request("/accounts/count", ...)`.

```typescript
describe("GET /accounts/count route", () => {
  let ctx: IntegrationDbContext;
  let rawSql: TestSql;
  let db: Db;
  let app: Hono;
  const jwtSecret = new TextEncoder().encode("test-secret-account-count");

  beforeAll(async () => {
    ctx = await openIntegrationDb();
    rawSql = ctx.rawSql;
    db = ctx.db;
  });

  afterAll(async () => {
    await closeIntegrationDb(ctx);
  });

  beforeEach(async () => {
    await resetIntegrationState(rawSql);
    app = new Hono();
    app.route("/accounts", createAccountCountRoutes({ db, jwtSecret }));
  });

  async function signToken(userId: string, opts?: { expSecondsFromNow?: number }) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (opts?.expSecondsFromNow ?? 300);
    return await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(jwtSecret);
  }

  async function seedProfile(
    userId: string,
    wallet: string,
    username: string,
    createdAt: string,
  ) {
    await rawSql`
      INSERT INTO player_profiles (user_id, wallet, username, created_at)
      VALUES (${userId}, ${wallet}, ${username}, ${createdAt})
    `;
  }

  it("anonymous request returns count with rank: 0", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    await seedProfile("usr_b", "w_b", "bob", "2026-01-02T00:00:00Z");

    const res = await app.request("/accounts/count");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body).toEqual({ ok: true, data: { count: 2, rank: 0 } });
  });

  it("authenticated request returns 1-indexed rank", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");
    await seedProfile("usr_b", "w_b", "bob", "2026-01-02T00:00:00Z");
    await seedProfile("usr_c", "w_c", "carol", "2026-01-03T00:00:00Z");

    const token = await signToken("usr_b");
    const res = await app.request("/accounts/count", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body).toEqual({ ok: true, data: { count: 3, rank: 2 } });
  });

  it("valid token but missing profile returns rank: 0 (not an error)", async () => {
    await seedProfile("usr_a", "w_a", "alice", "2026-01-01T00:00:00Z");

    const token = await signToken("usr_ghost");
    const res = await app.request("/accounts/count", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, any>;
    expect(body).toEqual({ ok: true, data: { count: 1, rank: 0 } });
  });

  it("malformed bearer token returns 401", async () => {
    const res = await app.request("/accounts/count", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);

    const body = (await res.json()) as Record<string, any>;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("token signed with the wrong secret returns 401", async () => {
    const wrongSecret = new TextEncoder().encode("nope");
    const badToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("usr_a")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(wrongSecret);

    const res = await app.request("/accounts/count", {
      headers: { Authorization: `Bearer ${badToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("expired token returns 401", async () => {
    const token = await signToken("usr_a", { expSecondsFromNow: -10 });
    const res = await app.request("/accounts/count", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("header present but not Bearer-prefixed returns 401", async () => {
    const res = await app.request("/accounts/count", {
      headers: { Authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/account-count.test.ts
```
Expected: the new `GET /accounts/count route` describe block fails with `Cannot find module '../routes/account-count.js'` (or the equivalent import error). The earlier DB tests still pass.

- [ ] **Step 4: Create the route file**

Create `backend/src/routes/account-count.ts` with the following content. The pattern mirrors `routes/public-referral.ts`.

```typescript
/**
 * Account count + caller rank.
 *
 * Anonymous callers receive { count, rank: 0 }. Callers presenting a valid
 * Bearer JWT receive { count, rank } where rank is the 1-indexed position
 * of their profile in player_profiles ordered by (created_at, id).
 *
 * WAITLIST-CONTRACT: shape pinned in `__tests__/waitlist-contract.test.ts`.
 * Keep the waitlist consumer in lockstep with any change to the response keys.
 *
 * Auth is optional, so this route decodes the JWT inline rather than relying
 * on `createJwtAuthMiddleware` (which is mandatory-only).
 */

import { createRoute, z } from "@hono/zod-openapi";
import { jwtVerify } from "jose";
import type { Db } from "../db.js";
import { API_ERROR_CODES } from "../contracts/api-errors.js";
import {
  envelope,
  ErrorEnvelopeSchema,
  ok,
  err,
} from "../contracts/api-envelope.js";
import { logger } from "../logger.js";
import { createOpenApiApp } from "../openapi/hono.js";

export interface AccountCountRoutesDeps {
  db: Db;
  jwtSecret: Uint8Array;
}

const AccountCountResponseSchema = z
  .object({
    count: z.number().int().nonnegative().openapi({
      description: "Total number of player profiles ever created",
    }),
    rank: z.number().int().nonnegative().openapi({
      description:
        "1-indexed signup rank of the authenticated caller, or 0 when unauthenticated",
    }),
  })
  .openapi("AccountCountResponse");

export function createAccountCountRoutes(deps: AccountCountRoutesDeps) {
  const { db, jwtSecret } = deps;
  const app = createOpenApiApp();

  const route = createRoute({
    method: "get",
    path: "/count",
    tags: ["Accounts"],
    summary: "Total account count, plus the caller's signup rank when authenticated",
    responses: {
      200: {
        content: {
          "application/json": { schema: envelope(AccountCountResponseSchema) },
        },
        description: "Account count and optional rank",
      },
      401: {
        content: { "application/json": { schema: ErrorEnvelopeSchema } },
        description: "Authorization header present but invalid",
      },
      500: {
        content: { "application/json": { schema: ErrorEnvelopeSchema } },
        description: "Failed to compute account count",
      },
    },
  });

  app.openapi(route, async (c) => {
    const authHeader = c.req.header("Authorization");

    // Header present → must be a valid Bearer JWT or we 401. We do NOT
    // silently downgrade to the anonymous path; that would be surprising
    // and mask client bugs.
    if (authHeader !== undefined) {
      if (!authHeader.startsWith("Bearer ")) {
        return err(
          c,
          401,
          API_ERROR_CODES.AUTH_REQUIRED,
          "Missing or invalid Authorization header",
        );
      }

      const token = authHeader.slice(7);
      let userId: string;
      try {
        const { payload } = await jwtVerify(token, jwtSecret, {
          algorithms: ["HS256"],
        });
        if (typeof payload.sub !== "string") {
          return err(
            c,
            401,
            API_ERROR_CODES.AUTH_REQUIRED,
            "Invalid token: missing subject",
          );
        }
        userId = payload.sub;
      } catch (verifyError) {
        logger.warn("accounts/count: token verification failed", {
          error:
            verifyError instanceof Error ? verifyError.message : "Unknown error",
        });
        return err(
          c,
          401,
          API_ERROR_CODES.AUTH_REQUIRED,
          "Invalid or expired token",
        );
      }

      try {
        const result = await db.getAccountCountAndRank(userId);
        // rank === null → JWT was valid but no profile row exists for this
        // userId. Surface as the anonymous shape (rank: 0) and log; this is
        // an edge case (profile rows are created on /auth/verify) but worth
        // observing if it ever happens.
        if (result.rank === null) {
          logger.warn("accounts/count: no profile for authenticated user_id", {
            userId,
          });
          return ok(c, { count: result.count, rank: 0 });
        }
        return ok(c, { count: result.count, rank: result.rank });
      } catch (queryError) {
        logger.error("accounts/count: rank query failed", {
          error:
            queryError instanceof Error ? queryError.message : "Unknown error",
        });
        return err(
          c,
          500,
          API_ERROR_CODES.PRECONDITION_FAILED,
          "Failed to compute account count",
        );
      }
    }

    // Anonymous path
    try {
      const count = await db.getAccountCount();
      return ok(c, { count, rank: 0 });
    } catch (queryError) {
      logger.error("accounts/count: count query failed", {
        error:
          queryError instanceof Error ? queryError.message : "Unknown error",
      });
      return err(
        c,
        500,
        API_ERROR_CODES.PRECONDITION_FAILED,
        "Failed to compute account count",
      );
    }
  });

  return app;
}
```

- [ ] **Step 5: Run the tests — confirm they pass**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/account-count.test.ts
```
Expected: all tests in both describe blocks pass.

- [ ] **Step 6: Commit the route**

Run:
```bash
cd /workspaces/rng-utopia/backend
git add src/routes/account-count.ts src/__tests__/account-count.test.ts
git commit -m "feat(accounts-count): add GET /accounts/count route with optional auth"
```

---

## Task 4: Mount the route in both entrypoints and pin it in the waitlist contract

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/index-waitlist.ts`
- Modify: `backend/src/__tests__/waitlist-contract.test.ts`

- [ ] **Step 1: Mount in `index.ts`**

In `backend/src/index.ts`, locate the existing line `import { createPublicReferralRoutes } from "./routes/public-referral.js";` (around line 15) and add directly after it:

```typescript
import { createAccountCountRoutes } from "./routes/account-count.js";
```

Then locate the mount line `app.route("/public-referral", createPublicReferralRoutes({ db }));` (around line 122) and add directly after it:

```typescript
app.route(
  "/accounts",
  createAccountCountRoutes({ db, jwtSecret: config.jwtSecret }),
);
```

- [ ] **Step 2: Mount in `index-waitlist.ts`**

In `backend/src/index-waitlist.ts`, add the import alongside the existing public-referral import:

```typescript
import { createAccountCountRoutes } from "./routes/account-count.js";
```

Add the mount alongside the existing public-referral mount (search for `app.route("/public-referral", createPublicReferralRoutes({ db }));`):

```typescript
app.route(
  "/accounts",
  createAccountCountRoutes({ db, jwtSecret: config.jwtSecret }),
);
```

- [ ] **Step 3: Update the surface-comment header in `index-waitlist.ts`**

At the top of `backend/src/index-waitlist.ts`, the doc-comment lists the mounted surface. Insert a new bullet for the new endpoint. Find this block:

```
 *   GET  /health
 *   POST /auth/{challenge,verify,refresh,logout}
 *   GET  /public-referral/code/{code}
```

Replace it with (adding the new line directly under `/health`):

```
 *   GET  /health
 *   GET  /accounts/count
 *   POST /auth/{challenge,verify,refresh,logout}
 *   GET  /public-referral/code/{code}
```

- [ ] **Step 4: Extend the waitlist contract pin**

In `backend/src/__tests__/waitlist-contract.test.ts`, add an entry to the `WAITLIST_CONTRACT` map. Find the `// ── Public referral ──` section block (around line 87 with `"GET /public-referral/code/{code}"`) and insert a new section directly above it:

```typescript
  // ── Accounts ─────────────────────────────────────────────────────────
  "GET /accounts/count": {
    requestBody: null,
    response: ["count", "rank"],
    successStatus: "200",
    authRequired: false, // endpoint is callable without auth
  },
```

Then extend `buildSpecApp()` to mount the new route. Find the line `app.route("/public-referral", createPublicReferralRoutes({ db: stubDb }));` (or `createPublicReferralRoutes({ db })` — match the local variable name in that function) and add directly after it:

```typescript
  app.route(
    "/accounts",
    createAccountCountRoutes({
      db,
      jwtSecret: new TextEncoder().encode("test"),
    }),
  );
```

Add the import at the top of the file alongside the other route imports:

```typescript
import { createAccountCountRoutes } from "../routes/account-count.js";
```

- [ ] **Step 5: Run the waitlist contract test**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/waitlist-contract.test.ts
```
Expected: all tests pass, including the new pin.

If the test fails because the response-key list does not match, re-check that the route's response schema exposes exactly `count` and `rank` (no extra fields).

- [ ] **Step 6: Run the OpenAPI contract test**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/openapi-contract.test.ts
```
Expected: passes — confirms the envelope-conformance rules hold for the new route.

- [ ] **Step 7: Commit the mounts and contract pin**

Run:
```bash
cd /workspaces/rng-utopia/backend
git add src/index.ts src/index-waitlist.ts src/__tests__/waitlist-contract.test.ts
git commit -m "feat(accounts-count): mount /accounts on both entrypoints and pin in waitlist contract"
```

---

## Task 5: Targeted verify

**Files:**
- N/A

- [ ] **Step 1: Run the full backend test suite**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm test
```
Expected: all tests pass. Pay attention to anything that touches `player_profiles` (none should change semantics).

- [ ] **Step 2: Lint**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm lint
```
Expected: exit 0, no warnings introduced. If `eslint` complains about `any` in the new test file, the `eslint-disable @typescript-eslint/no-explicit-any` comment at the top of the file (mirrored from `public-referral-routes.test.ts`) covers it.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 4: Smoke-run the waitlist entrypoint locally (optional but recommended)**

In one terminal:
```bash
cd /workspaces/rng-utopia/backend
pnpm dev:waitlist
```

In another terminal:
```bash
curl -s http://localhost:3000/accounts/count | jq
```
Expected: `{ "ok": true, "data": { "count": <int>, "rank": 0 } }`. Stop the dev server when done (Ctrl-C).

If you don't have a local DB configured for this devcontainer, skip Step 4 — the vitest integration suite already exercises the route end-to-end.

---

## Task 6: Squash to a single self-contained commit and push to `main`

The three commits from Tasks 2/3/4 are convenient during development, but they need to land on `main` as one commit so the cherry-pick onto `dev` is atomic (FR-8).

**Files:**
- N/A (git only)

- [ ] **Step 1: Inspect the commit list**

Run:
```bash
cd /workspaces/rng-utopia/backend
git log --oneline origin/main..HEAD
```
Expected: three commits — the DB layer, the route, and the mount/contract update.

- [ ] **Step 2: Soft-reset onto `origin/main` and recommit as one**

Run:
```bash
cd /workspaces/rng-utopia/backend
git reset --soft origin/main
git status -s
```
Expected: all of `src/db/profiles.ts`, `src/routes/account-count.ts`, `src/index.ts`, `src/index-waitlist.ts`, `src/__tests__/account-count.test.ts`, `src/__tests__/waitlist-contract.test.ts` listed as modified/new and staged.

- [ ] **Step 3: Create the consolidated commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
feat(accounts-count): add GET /accounts/count public endpoint

Unauthenticated callers receive { count, rank: 0 }; callers with a valid
Bearer JWT receive { count, rank } where rank is the 1-indexed position of
their profile in player_profiles ordered by (created_at, id). Tiebreak on
id keeps the result deterministic when timestamps collide.

Mounted in both the full entrypoint and the waitlist entrypoint. No new
middleware, no migrations, no new env vars. Pinned in the waitlist
contract test so the consumer side stays in lockstep.

Spec: docs/specs/404-account-count-endpoint/spec.md
EOF
)"
```

- [ ] **Step 4: Push the branch**

Run:
```bash
cd /workspaces/rng-utopia/backend
git push -u origin feat/accounts-count
```
Expected: branch pushed; CI starts.

- [ ] **Step 5: Open a PR into `main` and merge**

Run:
```bash
cd /workspaces/rng-utopia/backend
gh pr create --base main --title "feat(accounts-count): add GET /accounts/count public endpoint" --body "$(cat <<'EOF'
## Summary
- New `GET /accounts/count` endpoint. Anonymous → `{ count, rank: 0 }`. Bearer JWT → `{ count, rank }` (1-indexed).
- Mounted on both `index.ts` (full) and `index-waitlist.ts` (waitlist mode).
- No new middleware, no migrations, no env-var changes.
- Pinned in `waitlist-contract.test.ts`.

## Spec
- `docs/specs/404-account-count-endpoint/spec.md`

## Test plan
- [ ] CI green on `feat/accounts-count`
- [ ] Smoke `curl /accounts/count` against the dev deployment after this is cherry-picked to `dev`
EOF
)"
```

After CI passes, merge the PR via the team's normal flow. **Use a merge that produces exactly one commit on `main`** (squash-merge, or — since this is already one commit — a fast-forward / rebase merge). This is essential for the cherry-pick in Task 7.

- [ ] **Step 6: Record the commit SHA on `main`**

After merge:
```bash
cd /workspaces/rng-utopia/backend
git fetch origin main
git log --oneline origin/main -1
```
Record the SHA at the top of `origin/main` — call it `$MAIN_SHA`. Used in the next task.

---

## Task 7: Cherry-pick onto `dev`

**Files:**
- N/A (git only)

- [ ] **Step 1: Check out `dev` and fast-forward**

Run:
```bash
cd /workspaces/rng-utopia/backend
git fetch origin dev
git checkout dev
git merge --ff-only origin/dev
```
Expected: `dev` is now at `origin/dev`.

- [ ] **Step 2: Cherry-pick the merged commit**

Run (substituting the SHA you recorded):
```bash
cd /workspaces/rng-utopia/backend
git cherry-pick <MAIN_SHA>
```
Expected: clean cherry-pick. If there is a conflict, **stop**: that means `main` and `dev` have diverged on one of the touched files. Investigate the conflict and resolve it carefully — do not blindly accept either side.

- [ ] **Step 3: Re-run the relevant tests on dev**

Run:
```bash
cd /workspaces/rng-utopia/backend
pnpm vitest run src/__tests__/account-count.test.ts src/__tests__/waitlist-contract.test.ts src/__tests__/openapi-contract.test.ts
pnpm typecheck
pnpm lint
```
Expected: all pass.

- [ ] **Step 4: Push `dev`**

Run:
```bash
cd /workspaces/rng-utopia/backend
git push origin dev
```
Expected: push succeeds; the dev backend deploy pipeline picks up the new commit.

---

## Task 8: Update the root submodule pointer

**Files:**
- Modify: root repo's tracked backend submodule pointer

Per project convention (see `docs/CLAUDE.md` and the project memory), root tracks `dev`; the backend submodule pointer in root should advance to the cherry-pick commit on `dev`.

- [ ] **Step 1: Return to root and inspect the submodule pointer**

Run:
```bash
cd /workspaces/rng-utopia
git -C backend rev-parse HEAD
git submodule status backend
```
Expected: the `HEAD` of `backend` matches the cherry-picked commit on `dev`. `git submodule status backend` may show a `+` prefix indicating the working tree is ahead of the recorded pointer.

- [ ] **Step 2: Stage the pointer bump**

Run:
```bash
cd /workspaces/rng-utopia
git add backend
git status -s
```
Expected: `backend` shown as modified (pointer-only change).

- [ ] **Step 3: Commit the pointer bump**

Run:
```bash
cd /workspaces/rng-utopia
git commit -m "$(cat <<'EOF'
chore(submodule): bump backend to include GET /accounts/count

Adds the unauthenticated /accounts/count endpoint (with optional 1-indexed
rank for authenticated callers). Lives in both the full and waitlist
entrypoints. Spec: docs/specs/404-account-count-endpoint/spec.md.
EOF
)"
```

- [ ] **Step 4: Push root**

Run:
```bash
cd /workspaces/rng-utopia
git push origin dev
```
Expected: push succeeds.

---

## Done criteria

- [ ] `GET /accounts/count` reachable on the dev deployment, returns `{ ok: true, data: { count, rank: 0 } }` for anonymous callers.
- [ ] Authenticated callers (with a fresh JWT obtained via `POST /auth/verify`) receive `{ count, rank }` with `rank >= 1`.
- [ ] The same commit hash is reachable from both `main` and `dev` in the `backend` submodule.
- [ ] Root submodule pointer on `dev` points at the cherry-picked commit.
- [ ] All targeted tests pass (`account-count.test.ts`, `waitlist-contract.test.ts`, `openapi-contract.test.ts`, full `pnpm test`).
- [ ] `pnpm lint` and `pnpm typecheck` clean.
