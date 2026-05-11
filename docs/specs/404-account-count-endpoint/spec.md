# Specification: 404 Account Count Endpoint

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P2 |
| Track | Extended |
| NR_OF_TRIES | 0 |

---

## Overview

A single, optionally-authenticated public endpoint that returns the total number of created accounts and — when the caller is authenticated — that user's 1-indexed position in the chronological signup order. Powers a "join count + your rank" badge on the waitlist site.

The endpoint must be deployable to both production (`main` branch) and dev (`dev` branch); the change is delivered on `main` first and cherry-picked to `dev` as a single self-contained commit.

## User Stories

- As a waitlist visitor, I want to see how many people have already joined so that the page has some social proof.
- As an authenticated waitlist user, I want to see my position in the signup queue so that I have a sense of where I stand.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Public backend API surface for the waitlist cut (`backend/src/index-waitlist.ts`).
- **Current baseline fit**: New small public read endpoint; no schema changes.
- **Planning bucket**: Extended.

## Required Context Files

- `backend/src/index.ts` — full prod entrypoint (where the new route is mounted).
- `backend/src/index-waitlist.ts` — waitlist-only entrypoint (also mounts the route; surface comment header updated).
- `backend/src/middleware/jwt-auth.ts` — reference implementation for JWT parse/verify. The new handler does the same `jose.jwtVerify` call inline because the existing middleware is mandatory-only.
- `backend/src/contracts/api-envelope.ts` — `ok()` / `err()` helpers and `envelope(...)` schema wrapper used for the OpenAPI response.
- `backend/src/contracts/api-errors.ts` — `API_ERROR_CODES.AUTH_REQUIRED` for 401 responses.
- `backend/src/db/profiles.ts` — `player_profiles` table is the source of truth; existing methods may be extended or a new method added.
- `backend/src/__tests__/waitlist-contract.test.ts` — contract pin file that must include the new endpoint.

## Contract Files

- `backend/src/contracts/api-envelope.ts` — envelope shape.
- New OpenAPI path module colocated with the route (see `backend/src/openapi/`).

---

## Functional Requirements

### FR-1: Endpoint mounted at `GET /accounts/count` on both entrypoints

The route is reachable at `GET /accounts/count` in `index.ts` and `index-waitlist.ts`. Identical handler behavior in both surfaces.

**Acceptance Criteria:**
- [ ] `GET /accounts/count` returns 200 from the full entrypoint.
- [ ] `GET /accounts/count` returns 200 from the waitlist entrypoint.
- [ ] The path is included in the waitlist contract pin (`waitlist-contract.test.ts`).
- [ ] The surface comment header at the top of `index-waitlist.ts` lists the new path.

### FR-2: Anonymous response returns total account count with `rank: 0`

When the request has no `Authorization` header, the endpoint returns the total `player_profiles` row count and a sentinel `rank: 0`. Response is wrapped in the standard success envelope.

**Acceptance Criteria:**
- [ ] No `Authorization` header → 200 with body `{ ok: true, data: { count: <int>, rank: 0 } }`.
- [ ] `count` equals `SELECT COUNT(*) FROM player_profiles` at query time.
- [ ] `rank` field is always present and equals `0` for anonymous callers.

### FR-3: Authenticated response returns total count and the caller's 1-indexed rank

When a valid `Authorization: Bearer <jwt>` is present and the JWT decodes to a known `user_id`, the response includes the caller's 1-indexed rank among all `player_profiles` rows ordered by `(created_at ASC, id ASC)`. Ties on `created_at` are broken by `id` so the result is deterministic.

**Acceptance Criteria:**
- [ ] Valid token for an existing profile → `{ ok: true, data: { count, rank } }` with `rank >= 1` and `rank <= count`.
- [ ] First chronological signup gets `rank = 1`.
- [ ] Two profiles sharing `created_at` produce distinct, deterministic ranks (lower `id` ranks first).
- [ ] If the token is valid but no `player_profiles` row exists for that `user_id` (edge case), respond as anonymous: `rank: 0`. This is logged at `warn` level for observability but is not an error.

### FR-4: Invalid / expired token returns 401

When `Authorization: Bearer <jwt>` is present but the token fails `jose.jwtVerify` (bad signature, wrong algorithm, expired, missing `sub`), the endpoint returns `401` with the standard error envelope. Do not silently downgrade to the anonymous path.

**Acceptance Criteria:**
- [ ] Malformed bearer token → `401` with `{ ok: false, error: { code: "AUTH_REQUIRED", ... } }`.
- [ ] Expired token → `401`.
- [ ] Token missing `sub` claim → `401`.
- [ ] Header present but not starting with `Bearer ` → `401`.

### FR-5: SQL is a single round-trip per call

The handler issues exactly one query against `player_profiles` per request.

**Acceptance Criteria:**
- [ ] Anonymous path: one `SELECT COUNT(*)::int FROM player_profiles` query.
- [ ] Authenticated path: one query that returns both the total `count` and the caller's `rank` (e.g. via two correlated subqueries in one statement).
- [ ] Rank query orders by `(created_at, id)` with the `id` tiebreak.

### FR-6: Standard envelope and OpenAPI registration

The response uses the shared envelope helpers; the route is registered in OpenAPI per the backend contract rules.

**Acceptance Criteria:**
- [ ] Success responses go through `ok(c, ...)` from `contracts/api-envelope.ts`.
- [ ] Error responses go through `err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, ...)`.
- [ ] A matching OpenAPI path module exists for the new route file (per `backend/CLAUDE.md` rule: "Every new public route file should have a matching OpenAPI path module.").
- [ ] 2xx response declared as `envelope(SuccessSchema)`; 4xx declared as `ErrorEnvelopeSchema`.
- [ ] `openapi-contract.test.ts` and `waitlist-contract.test.ts` still pass.

### FR-7: Rate limiting reuses the existing per-IP middleware

The new mount is wrapped by the existing `createRateLimitMiddleware` so the endpoint cannot be hammered by an anonymous client.

**Acceptance Criteria:**
- [ ] The mount applies the existing rate-limit middleware (the same one already used on `/auth/*`, with parameters appropriate for a polling read endpoint — e.g. `perWallet: 60, global: config.rateLimitGlobal, windowMs: 60_000`, or the closest existing knob).
- [ ] No new middleware file or new rate-limit infra is added.

### FR-8: Delivery on `main` first, cherry-picked to `dev`

The change is implemented as a single commit on a branch off `origin/main`, merged into `main`, and that exact commit is cherry-picked onto `dev` without modification.

**Acceptance Criteria:**
- [ ] Branch is created from `origin/main`.
- [ ] PR merges into `main` (or the change lands on `main` via the team's normal flow).
- [ ] The same commit hash range is reachable from `dev` via `git cherry-pick`.
- [ ] After cherry-pick, `dev` builds and its targeted tests pass.
- [ ] Root submodule pointer is updated only after `dev` has the commit (root tracks `dev` for backend per project convention).

---

## Success Criteria

- A waitlist visitor calling `GET /accounts/count` with no auth gets `{ count, rank: 0 }` and the `count` matches the real row count of `player_profiles`.
- A signed-in waitlist user gets `{ count, rank }` with `rank` deterministic and 1-indexed.
- The endpoint adds no migrations, no new env vars, no new middleware, and no changes to existing routes.
- The change exists on both `main` (prod) and `dev` (dev deploy) with identical behavior.

---

## Dependencies

- Existing `player_profiles` table and its `created_at` / `id` columns (no schema change required).
- Existing JWT signing config and `jose.jwtVerify` toolchain.
- Existing envelope / OpenAPI / rate-limit infrastructure.

## Assumptions

- "Account joined" is operationally equivalent to "row in `player_profiles`", which is INSERTed by `auth.ts` on first successful `/auth/verify` for a wallet. Confirmed during brainstorming.
- The waitlist site is the primary consumer; expected request volume is low enough that a naive `COUNT(*)` is acceptable for the foreseeable waitlist period.
- No caching is in scope. If the endpoint becomes hot, an in-memory short-TTL cache can be added later.
- The same JWT secret/algorithm is used in waitlist mode and full mode (existing fact).

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|----------------------|-------------------|-------------------|
| 1 | Anonymous → `rank: 0` | `vitest` unit test calling the handler without a bearer header | Test passes; assertion on `data.rank === 0` and `data.count === <seeded row count>` |
| 2 | Authenticated → correct 1-indexed rank | `vitest` test that seeds N profiles with controlled `created_at`, signs a JWT for the k-th, and asserts `rank === k` | Test passes |
| 3 | Tiebreak deterministic | `vitest` test that inserts two profiles with identical `created_at` and asserts the lower-`id` row ranks first | Test passes |
| 4 | Invalid token → 401 | `vitest` test with a malformed bearer token | 401 + `AUTH_REQUIRED` envelope |
| 5 | Mounted on both entrypoints | `vitest` against each app instance | Both return 200 |
| 6 | Waitlist contract pin includes it | `waitlist-contract.test.ts` | Test passes after extension |
| 7 | OpenAPI conformance | `openapi-contract.test.ts` | Test passes |
| 8 | Cherry-pick is clean | Manual: `git cherry-pick <sha>` on `dev` after merge to `main` | No conflicts; identical diff |

---

## Completion Signal

### Implementation Checklist
- [ ] New route file `backend/src/routes/account-count.ts` exporting `createAccountCountRoutes({ db, jwtSecret })`.
- [ ] New OpenAPI path module for the route (matches existing pattern under `backend/src/openapi/`).
- [ ] Mount in `backend/src/index.ts` with the existing rate-limit middleware.
- [ ] Mount in `backend/src/index-waitlist.ts` with the existing rate-limit middleware; update the file's surface-comment header to list `GET /accounts/count`.
- [ ] DB layer: either a new method on `Db` / `ProfilesDb` (e.g. `getAccountCountAndRank(userId)`) or inline SQL in the route — preference for a DB method so the SQL is testable in isolation.
- [ ] New tests in `backend/src/__tests__/account-count.test.ts` covering FR-2/3/4/5.
- [ ] Extend `backend/src/__tests__/waitlist-contract.test.ts` to pin the new endpoint shape.
- [ ] Branch off `origin/main`, implement, merge to `main`, cherry-pick to `dev`.
- [ ] Update root submodule pointer (root tracks `dev`).
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` — **N/A**: backend-only public read endpoint; vitest contract + unit coverage is the equivalent for backend specs.
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` — **N/A**: no UI in scope (frontend is out of scope; waitlist team consumes the contract).
- [ ] [test] If external provider/oracle/VRF integration is included, add devnet real-provider E2E coverage in `e2e/devnet/**` — **N/A**: no external provider involved.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass (`cd backend && pnpm test`)
- [ ] New tests added for new functionality
- [ ] No lint errors (`cd backend && pnpm lint`)
- [ ] Typecheck clean (`cd backend && pnpm typecheck`)

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled (missing profile for valid token, invalid token, header without `Bearer ` prefix)
- [ ] Error states handled (DB errors propagate as 500 via existing handler convention)

#### Integration Verification
- [ ] Devnet E2E passes (if applicable) — **N/A** for this endpoint
- [ ] API contracts documented (OpenAPI path module + envelope conformance)
- [ ] Both entrypoints (`pnpm dev` and `pnpm dev:waitlist`) serve the endpoint identically

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After completion, run `/gap-analysis 404` to audit every FR acceptance criterion against the codebase.
