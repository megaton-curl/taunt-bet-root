# Specification: [304] Response Envelope Contract

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 0 |

---

## Overview

Unify every public JSON API response behind a single **envelope shape**, decoupling HTTP status codes from application outcomes. HTTP status codes keep their transport-layer meaning (auth, route existence, rate limit, server crash); application outcomes — success, domain rejection, validation failure, resource-not-found-by-id — all ride inside the body of a `200 OK`.

Today the backend mixes two patterns:
1. HTTP-native status codes (404 for missing resource, 409 for conflict, 400 for validation, etc.) with handwritten body shapes per route.
2. An inconsistent partial envelope via `structuredErrorMessage()` that sometimes nests under `error`, sometimes is bare.

The consequence: frontend clients must carry per-route `try/catch` around reads that can legitimately return "nothing" (e.g. `GET /referral/code` when the user hasn't set one), and different routes have different error shapes. This spec formalizes a single contract: `{ ok: true, data } | { ok: false, error: { code, message, retryable?, details? } }` for every public route, with a narrow, documented list of HTTP-level exceptions.

### Target envelope

```ts
type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

interface ApiError {
  code: string;          // SCREAMING_SNAKE_CASE, stable across versions
  message: string;       // human-readable, may change
  retryable?: boolean;   // whether the same request could succeed on retry
  details?: unknown;     // optional structured payload (e.g. field-level validation errors)
}
```

### HTTP status rules

| Status | Meaning | Body shape |
|--------|---------|------------|
| `200` | App-level outcome (success OR rejection) | Envelope |
| `401` | Authentication middleware failed | `{ error: "Authentication required" }` (plain, legacy-compatible) |
| `404` | Route does not exist (Hono default) | Hono default |
| `405` | Method not allowed (Hono default) | Hono default |
| `429` | Rate limit (middleware) | `{ error: "Too many requests" }` |
| `5xx` | Server crash, unhandled exception | Varies |

Everything else — validation failure, not-found-by-id, business rejection, conflict, below-threshold, self-referral, etc. — is a `200` with `ok: false`.

## User Stories

- As a frontend engineer, I want one response shape across every endpoint so that I can write a single `apiCall()` helper instead of per-route error handling
- As a frontend engineer, I want "empty" answers (no code set, no referrer, no active claim) to be successful reads so that my console, Sentry, and error boundaries don't fire on normal flows
- As a backend engineer, I want a stable machine-readable `error.code` catalog so that clients can switch on specific cases without string-matching `message`
- As an operator, I want HTTP `4xx`/`5xx` counters to reflect transport/platform health only so that LB/CDN/monitoring alerts aren't noisy with legitimate business rejections
- As an SDK author, I want OpenAPI schemas to describe exactly one success response per route so that generated clients are simpler and type narrowing is automatic

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Cross-cutting backend API hardening (no new capability; improves the contract of existing ones).
- **Current baseline fit**: In Progress — partial hybrid today; backend `feat/hybrid-empty-states` branch flipped two empty-state referral reads to `200 { code: null }` / `200 { referrer: null, ... }`. This spec generalizes that pattern.
- **Planning bucket**: Core.

## Required Context Files

- `backend/src/contracts/api-errors.ts` — existing error helpers to replace
- `backend/src/contracts/validators.ts` — Zod response schemas to envelope-wrap
- `backend/src/openapi/hono.ts` — `createOpenApiApp` + `invalidRequestHook` (validation hook to update)
- `backend/src/routes/*.ts` — every route handler (migration target)
- `backend/src/__tests__/waitlist-contract.test.ts` — pinned contract for waitlist-consumed routes
- `backend/src/middleware/jwt-auth.ts` — auth middleware (must continue to return 401)
- `backend/src/middleware/rate-limit.ts` — rate limit middleware (must continue to return 429)
- `waitlist/src/lib/referral-api.ts` + `waitlist/src/lib/auth-api.ts` — client shape currently consumed (read-only reference; coordinated MR after backend ships)
- `docs/specs/300-referral-system/spec.md` — referral routes currently use mixed error shapes; baseline for FR-5

## Contract Files

- **New**: `backend/src/contracts/api-envelope.ts` — envelope type, `ok()`/`err()` helpers, `envelope(schema)` Zod builder
- **New**: `backend/src/contracts/api-errors.ts` (rewrite) — centralized `ApiErrorCode` enum / const catalog
- **Updated**: every route file's `createRoute({ responses: ... })` block
- **Updated**: `backend/src/__tests__/waitlist-contract.test.ts` — asserts envelope shape, not bare properties

---

## System Invariants

1. **One success shape.** Every OpenAPI-described public route declares exactly one `200` response with an envelope schema; no `4xx` responses are declared by handlers (except `401` for auth-required routes).
2. **Envelope is a discriminated union on `ok`.** Clients dispatch on `body.ok`; `data` and `error` are mutually exclusive.
3. **Error codes are stable.** `error.code` is SCREAMING_SNAKE_CASE and defined once in the catalog. Renaming an existing code is a breaking change requiring a spec iteration.
4. **HTTP codes mean transport, not business.** A handler never returns a non-200 for a domain outcome. `401`, `404` (route), `405`, `429`, `5xx` stay HTTP-native and bypass the envelope.
5. **Validation failures are enveloped.** The `defaultHook` for Zod request-parse failures returns `200 { ok: false, error: { code: "VALIDATION_FAILED", details: <zod issues> } }`.
6. **JSON only.** The envelope applies to `application/json` responses. Binary, streaming, and `text/*` responses are exempt (none exist in this codebase today; reserved for future endpoints).
7. **Internal / admin / webhook routes MAY opt out.** `/internal/*`, `/admin/*`, and service-auth webhook routes are not public OpenAPI and may keep their current shape; they are out of scope for this spec.
8. **OpenAPI discoverability.** The `ApiEnvelope<T>` schema is registered as a reusable component; route responses reference it via `envelope(SuccessSchema)`.

---

## Functional Requirements

<!-- FR acceptance criteria checkboxes are audited by /gap-analysis after completion.
     Each checkbox gets an HTML comment annotation: satisfied/deferred/gap with evidence.

     SCOPE NOTE: Frontend UI is handled by a separate team in a separate repo.
     This spec covers backend routing, contracts, and tests. Frontend client updates
     (waitlist, webapp, telegram) are documented as coordinated follow-ups in FR-15
     but are NOT implemented inside this spec loop. -->

### FR-1: Envelope primitives and helpers

Introduce the envelope type, runtime helpers for handlers, and a Zod schema builder for OpenAPI response declarations.

**Deliverable:** `backend/src/contracts/api-envelope.ts` exporting:

```ts
export interface ApiEnvelopeSuccess<T> { ok: true; data: T; }
export interface ApiEnvelopeError { ok: false; error: ApiError; }
export type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export function ok<T>(c: Context, data: T, status: 200 = 200): ReturnType<Context["json"]>;
export function err(
  c: Context,
  code: ApiErrorCode,
  message: string,
  opts?: { retryable?: boolean; details?: unknown },
  status: 200 = 200,
): ReturnType<Context["json"]>;

// Zod builder for route responses. Returns a discriminated union schema.
export function envelope<T extends z.ZodTypeAny>(dataSchema: T): z.ZodType<ApiEnvelope<z.infer<T>>>;
```

**Acceptance Criteria:**
- [ ] `api-envelope.ts` created with exactly the exports above (types, `ok`, `err`, `envelope`)
- [ ] `ok(c, data)` returns `c.json({ ok: true, data }, 200)`
- [ ] `err(c, code, message, opts?)` returns `c.json({ ok: false, error: { code, message, ...opts } }, 200)`
- [ ] `envelope(s)` produces a Zod discriminated union on `ok` with `data: s` on the true branch and the standard `ApiError` shape on the false branch
- [ ] Unit tests in `api-envelope.test.ts` cover: `ok()` success serialization, `err()` with and without `retryable`/`details`, Zod parsing round-trips both branches

### FR-2: Error code catalog

Centralize every `error.code` string in one place. Replace ad-hoc inline strings.

**Deliverable:** `backend/src/contracts/api-errors.ts` (rewritten):

```ts
export const API_ERROR_CODES = {
  // Validation
  VALIDATION_FAILED: "VALIDATION_FAILED",

  // Auth (app-level; JWT middleware still returns HTTP 401)
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  REFRESH_TOKEN_INVALID: "REFRESH_TOKEN_INVALID",

  // Referral
  CODE_ALREADY_SET: "CODE_ALREADY_SET",
  CODE_TAKEN: "CODE_TAKEN",
  CODE_NOT_FOUND: "CODE_NOT_FOUND",
  INVALID_CODE: "INVALID_CODE",
  SELF_REFERRAL: "SELF_REFERRAL",
  ALREADY_LINKED: "ALREADY_LINKED",
  ZERO_BALANCE: "ZERO_BALANCE",
  BELOW_THRESHOLD: "BELOW_THRESHOLD",
  CLAIM_NOT_FOUND: "CLAIM_NOT_FOUND",

  // Profile
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  USERNAME_COOLDOWN: "USERNAME_COOLDOWN",
  INVALID_USERNAME: "INVALID_USERNAME",

  // Game
  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",
  MATCH_PHASE_INVALID: "MATCH_PHASE_INVALID",
  ROUND_NOT_FOUND: "ROUND_NOT_FOUND",
  BET_TOO_SMALL: "BET_TOO_SMALL",
  BET_TOO_LARGE: "BET_TOO_LARGE",

  // Telegram
  TELEGRAM_NOT_LINKED: "TELEGRAM_NOT_LINKED",
  TELEGRAM_TOKEN_EXPIRED: "TELEGRAM_TOKEN_EXPIRED",

  // Generic
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];
```

**Acceptance Criteria:**
- [ ] Every existing inline error-code string in `backend/src/routes/*.ts` is replaced by a reference to `API_ERROR_CODES.*`
- [ ] `ApiErrorCode` is exported and used as the `code` type on `ApiError`
- [ ] Legacy exports `errorMessage()` and `structuredErrorMessage()` are removed from `api-errors.ts` (no callers remain after FR-4 through FR-12)
- [ ] `grep -r "\"NO_CODE\"\|\"NO_REFERRER\"\|\"CODE_TAKEN\"" backend/src` returns only the catalog file

### FR-3: Validation hook emits envelope

Update `createOpenApiApp`'s `defaultHook` so Zod request-parse failures return an enveloped `VALIDATION_FAILED` instead of `400 { error: "Invalid request" }`.

**Deliverable:** `backend/src/openapi/hono.ts` updated:

```ts
export function invalidRequestHook<E extends Env, P extends string>(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context<E, P>,
) {
  if (result.success) return;
  return err(c, API_ERROR_CODES.VALIDATION_FAILED, "Invalid request", {
    retryable: false,
    details: result.error.issues,
  });
}
```

**Acceptance Criteria:**
- [ ] `invalidRequestHook` returns a `200` enveloped response (not `400`)
- [ ] `details` contains the Zod issue list (path, message, code)
- [ ] Every OpenAPI route declared via `createOpenApiApp` gets the new hook automatically (no per-route override needed)
- [ ] An integration test submits an invalid body and asserts `status === 200 && body.ok === false && body.error.code === "VALIDATION_FAILED"`

### FR-4: OpenAPI envelope wrapper

Route declarations must use `envelope(SuccessSchema)` so generated OpenAPI describes the discriminated union, and the `ApiEnvelope` component is registered once, not inlined per route.

**Deliverable:** helper re-exported from `src/openapi/hono.ts`:

```ts
export { envelope } from "../contracts/api-envelope.js";
```

And a one-time registration in `createOpenApiApp`:

```ts
app.openAPIRegistry.register("ApiError", ApiErrorSchema);
// envelope() internally composes ApiError so all routes share the same component
```

**Acceptance Criteria:**
- [ ] Generated `openapi.json` contains `components.schemas.ApiError` exactly once
- [ ] Every converted route's `responses.200.content.application/json.schema` references the envelope shape (verified by asserting the schema has `oneOf` with `ok` discriminator in the generated spec)
- [ ] Per-route `ErrorResponseSchema` / `StructuredErrorResponseSchema` imports are removed after the final route conversion (FR-12)

### FR-5: Auth middleware retains HTTP 401 (no envelope)

Auth failure is a transport concern. The JWT middleware keeps returning `401` with a plain `{ error: "Authentication required" }` body. This is both the least-surprising behavior for browsers/proxies and backwards-compatible with existing `parseResponse()` callers.

**Acceptance Criteria:**
- [ ] `backend/src/middleware/jwt-auth.ts` unchanged in behavior: missing/invalid/expired token ⇒ `401`
- [ ] A routing test confirms: request with no `Authorization` header to a protected route returns `401` and NOT a `200` envelope
- [ ] `backend/CLAUDE.md` "Envelope contract" section explicitly documents that `401` bypasses the envelope

### FR-6: Rate limit middleware retains HTTP 429 (no envelope)

Same reasoning as FR-5. Load balancers, CDNs, and SDK retry logic expect `429` at the transport layer.

**Acceptance Criteria:**
- [ ] `backend/src/middleware/rate-limit.ts` unchanged in behavior: over-limit ⇒ `429`
- [ ] Existing rate-limit tests (if any) still pass unmodified
- [ ] `backend/CLAUDE.md` envelope section documents that `429` bypasses the envelope

### FR-7: Convert `/auth/*` routes

All four endpoints (`/challenge`, `/verify`, `/refresh`, `/logout`) return envelope on all outcomes. `/logout` currently returns `204 No Content`; keep `204` for logout (no body) — it's semantically "request fulfilled, nothing to tell you" and any FE consuming it doesn't parse a body.

Success bodies (`ChallengeNonceResponseSchema`, `TokenResponseSchema`) ride inside `data`. Domain errors like "challenge expired" / "bad signature" / "refresh token invalid" become `200 { ok: false, error: { code: "CHALLENGE_EXPIRED" | "INVALID_SIGNATURE" | "REFRESH_TOKEN_INVALID" } }`.

**Acceptance Criteria:**
- [ ] `POST /auth/challenge` returns `200` enveloped on success and on domain errors
- [ ] `POST /auth/verify` same; `INVALID_SIGNATURE` / `CHALLENGE_EXPIRED` now envelope-encoded instead of HTTP 400/401
- [ ] `POST /auth/refresh` returns `200` envelope or `REFRESH_TOKEN_INVALID` envelope
- [ ] `POST /auth/logout` continues to return `204` (documented exception)
- [ ] `waitlist-contract.test.ts` updated to assert envelope shape for the three enveloped auth routes
- [ ] Existing auth route tests in `backend/src/__tests__/auth-routes.test.ts` updated to assert envelope shape

### FR-8: Convert `/referral/*` routes

Completes the refactor started on `feat/hybrid-empty-states`. All eight endpoints envelope-wrap.

Notable: `POST /referral/claim` currently returns `202 Accepted`. Drop to `200` enveloped — the envelope's `data.status: "pending"` field already encodes "accepted, queued". HTTP `202` is not load-bearing for any current client.

**Acceptance Criteria:**
- [ ] `POST /referral/code` envelopes success + `CODE_ALREADY_SET` / `CODE_TAKEN` / validation errors
- [ ] `GET /referral/code` envelopes `{ code: string | null }` (retaining the nullable contract shipped on `feat/hybrid-empty-states`)
- [ ] `POST /referral/apply` envelopes success + `CODE_NOT_FOUND` / `SELF_REFERRAL` / `ALREADY_LINKED`
- [ ] `GET /referral/referrer` envelopes referrer-or-nulls payload
- [ ] `GET /referral/stats` envelopes stats
- [ ] `GET /referral/referrals` envelopes `{ items }`
- [ ] `GET /referral/earnings` envelopes paginated `{ items, pagination }`
- [ ] `POST /referral/claim` returns `200` envelope (not `202`); `ZERO_BALANCE` / `BELOW_THRESHOLD` are enveloped
- [ ] `GET /referral/claim/:claimId` envelopes `{ claimId, amountLamports, status, txSignature? }` or `CLAIM_NOT_FOUND`
- [ ] `src/__tests__/referral-routes.test.ts` updated for all converted endpoints

### FR-9: Convert `/profile/*` + `/public-profile/*` + `/public-referral/*` routes

**Acceptance Criteria:**
- [ ] `GET /profile/me` envelopes `PlayerProfileSchema`; `PROFILE_NOT_FOUND` enveloped
- [ ] `PUT /profile/username` envelopes `UsernameUpdateResponseSchema`; `USERNAME_TAKEN` / `USERNAME_COOLDOWN` / `INVALID_USERNAME` enveloped
- [ ] `GET /profile/transactions` envelopes `TransactionsPageResponseSchema`
- [ ] `POST /profile/confirm-tx` envelopes success + validation errors
- [ ] `GET /public-profile/:userId` envelopes `PublicPlayerProfileSchema`; missing profile returns `NOT_FOUND` envelope
- [ ] `GET /public-referral/code/:code` envelopes `{ exists: boolean }`
- [ ] Corresponding route tests updated

### FR-10: Convert game routes (`/flip-you/*`, `/pot-shot/*`, `/closecall/*`)

**Acceptance Criteria:**
- [ ] `POST /flip-you/create`, `GET /flip-you/by-id/:matchId`, `GET /flip-you/settle/*` enveloped; `MATCH_NOT_FOUND` / `MATCH_PHASE_INVALID` enveloped
- [ ] `POST /pot-shot/create`, `GET /pot-shot/current`, `GET /pot-shot/by-id/:matchId` enveloped
- [ ] `POST /closecall/bet` enveloped; `BET_TOO_SMALL` / `BET_TOO_LARGE` enveloped
- [ ] `GET /closecall/current`, `GET /closecall/by-id/:roundId`, `GET /closecall/history` enveloped; `ROUND_NOT_FOUND` enveloped
- [ ] Corresponding route tests updated

### FR-11: Convert `/challenges/*`, `/points/*`, `/crates/*`, `/dogpile/*`, `/leaderboard/*`, `/price/*` routes

**Acceptance Criteria:**
- [ ] Every read endpoint returns envelope
- [ ] Every write endpoint returns envelope
- [ ] Corresponding route tests updated
- [ ] No `createRoute()` block in any converted file declares a `4xx` response schema (only `401` for auth-required routes)

### FR-12: Convert `/telegram/generate-link` (public JWT-protected) + `/health` routes

`/telegram` service-auth routes (redeem-link, webhooks) stay out of scope (internal, not public OpenAPI). Only the JWT-protected `/telegram/generate-link` migrates.

`/health` is used by load balancer health checks; keep the current minimal body shape but envelope-wrap. LB probes check `200` status, not body structure, so enveloping is safe.

**Acceptance Criteria:**
- [ ] `POST /telegram/generate-link` enveloped; the two-branch response (already-linked vs new-token) becomes `data: AlreadyLinked | NewToken` with a discriminator field
- [ ] `waitlist-contract.test.ts`'s `POST /telegram/generate-link` test updated to assert envelope shape
- [ ] `GET /health` returns `200 { ok: true, data: { status, version, workerRunning } }`
- [ ] A devcontainer LB probe (curl `-f` / exit code) still succeeds against `/health`

### FR-13: Remove deprecated error helpers

Once every route is converted, delete `errorMessage()` and `structuredErrorMessage()` exports, and delete the legacy `ErrorResponseSchema` / `StructuredErrorResponseSchema` Zod schemas from `validators.ts`.

**Acceptance Criteria:**
- [ ] `errorMessage` and `structuredErrorMessage` are deleted from `src/contracts/api-errors.ts`
- [ ] `ErrorResponseSchema` and `StructuredErrorResponseSchema` are deleted from `src/contracts/validators.ts`
- [ ] `grep -r "errorMessage\|structuredErrorMessage\|ErrorResponseSchema\|StructuredErrorResponseSchema" backend/src` returns no results
- [ ] `pnpm typecheck` passes

### FR-14: Update waitlist contract test

`backend/src/__tests__/waitlist-contract.test.ts` currently asserts the top-level response keys of each waitlist-consumed route. After this spec, every 200 response has exactly two keys: `ok` + `data` (or `error`). Update the contract assertions to read the inner `data` schema.

**Deliverable:** new helper `function dataShapeKeys(spec, path, method): string[]` that resolves `responses.200.content.application/json.schema.oneOf[0].properties.data.properties`, and a contract entry format change from `response: ["code"]` to `response: ["code"]` but with the data-shape extraction applied. Per-endpoint contract entries stay alphabetized.

**Acceptance Criteria:**
- [ ] `waitlist-contract.test.ts` uses `dataShapeKeys()` to extract the envelope-wrapped data shape
- [ ] Every contract entry's `response` field still lists the inner domain keys (e.g. `["code"]` for `GET /referral/code`)
- [ ] A new assertion per route verifies the envelope: top-level keys `["data", "ok"]`
- [ ] The test comment header updated to reference this spec ID (`docs/specs/304-response-envelope/spec.md`)

### FR-15: Coordinated frontend client update — documentation only (out of implementation scope)

This spec does not modify `waitlist/`, `webapp/`, or `telegram/` client code — those repos are read-only from this workspace. Instead, this FR captures the exact client-side diff needed, so the coordinated MR can be cut cleanly.

**Deliverable:** `docs/specs/304-response-envelope/client-migration.md` enumerating:
1. Shape change: `ReferralCodeResponse` etc. become `ApiEnvelope<...>`
2. `parseResponse<T>()` helper updated to dispatch on `body.ok`, not `res.ok`
3. `401` handling preserved (HTTP-level)
4. Rollout order: ship tolerant client (reads both old and new shape) first, then ship envelope backend, then remove tolerance shim
5. Per-file delta for `waitlist/src/lib/referral-api.ts`, `waitlist/src/lib/auth-api.ts`, `waitlist/src/components/ReferralLinkCard.tsx`, `waitlist/src/components/ReferralCodeCard.tsx`, `waitlist/src/context/ReferralContext.tsx`

**Acceptance Criteria:**
- [ ] `client-migration.md` exists and lists the exact diff for each waitlist file
- [ ] Rollout order is documented (tolerant client ships before backend cutover)
- [ ] Document explicitly flags that the MR lives in `taunt-bet/waitlist.git`, not in this repo

### FR-16: Documentation

Update backend developer docs and add tech-debt entry for the coordinated rollout.

**Acceptance Criteria:**
- [ ] `backend/CLAUDE.md` gains an "## Envelope Contract" section summarizing FR-1 through FR-6 (the public rules, not the migration mechanics)
- [ ] OpenAPI `info.description` in `src/index.ts` mentions the envelope and links to this spec
- [ ] `docs/TECH_DEBT.md` gains a row: "2026-04-22 — Envelope rollout: waitlist prod client must be updated in lockstep with backend deploy; see spec 304."

---

## Success Criteria

- Every response body returned by a public OpenAPI-described route is either `{ ok: true, data: ... }` or `{ ok: false, error: { code, message, ... } }`, excepting `401`/`404-route`/`405`/`429`/`5xx`.
- A frontend can consume any public route with a single helper: `const body = await res.json(); if (!body.ok) handle(body.error.code); else use(body.data);`.
- `openapi.json` contains a reusable `ApiError` component and every path's `200` response references the envelope schema.
- Every `error.code` emitted by the backend is defined in `API_ERROR_CODES`.
- No `4xx` status (other than `401`) is emitted by any handler in `backend/src/routes/`.

## Dependencies

- `@hono/zod-openapi` — used as-is; discriminated unions are supported
- `zod` — `z.discriminatedUnion` for envelope schema

## Assumptions

- Current production waitlist deploy can tolerate a brief (single deploy cycle) mismatch because the tolerance-first rollout in FR-15 ships before the backend cutover.
- No non-JSON public endpoints exist today. (Verified: all `createRoute()` responses use `"application/json"`.)
- `202 Accepted` semantics are not relied on by any client; the only current `202` is `POST /referral/claim`, and it's safe to flatten to `200`.
- Hono's default `404` for unmatched routes is acceptable as-is; no client expects an enveloped body on unknown URLs.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|----------------------|-------------------|-------------------|
| 1 | Envelope primitives type-check | `pnpm typecheck` after FR-1 | Exit 0 |
| 2 | Envelope helpers serialize correctly | Unit test `api-envelope.test.ts` | 100% branch coverage of `ok`/`err`/`envelope` |
| 3 | Validation hook envelopes failures | Integration test in `invalid-request.test.ts` | POST with bad body → 200 envelope with `VALIDATION_FAILED` |
| 4 | Auth middleware still returns 401 | `auth-routes.test.ts` | Request without token → 401 (not envelope) |
| 5 | Every route returns envelope | Contract scan: `openapi.json` → every `responses["200"].content.application/json.schema` is a `oneOf` with `ok` discriminator | Generated OpenAPI + assertion |
| 6 | No handler emits non-401 4xx | AST grep / ripgrep: `rg "c\.json\(.+, (40[0-9]|41[0-9]|42[0-9])\)" backend/src/routes` (ignoring 401) | Empty result |
| 7 | Waitlist contract test passes on envelope shape | `pnpm test src/__tests__/waitlist-contract.test.ts` | Exit 0 |
| 8 | Full test suite green | `./scripts/verify` | Exit 0 |
| 9 | Client migration doc complete | Manual read-through against read-only `waitlist/` source | `client-migration.md` covers every file in `waitlist/src/lib/` that calls backend |

---

## Completion Signal

### Implementation Checklist

<!-- Ordered: infrastructure first, then route conversions (parallelizable once infra lands), then cleanup + docs. -->

- [ ] [backend] Create `src/contracts/api-envelope.ts` with `ApiEnvelopeSuccess`, `ApiEnvelopeError`, `ApiError`, `ok()`, `err()`, `envelope()` exports; export `ApiErrorSchema` Zod schema
- [ ] [test] Add `src/__tests__/api-envelope.test.ts` covering `ok()` / `err()` serialization and `envelope()` discriminated-union round-trip; verify test fails before implementation, passes after
- [ ] [backend] Rewrite `src/contracts/api-errors.ts` to export the `API_ERROR_CODES` const object and `ApiErrorCode` type; keep `errorMessage` / `structuredErrorMessage` temporarily re-exported as deprecated shims that `throw` at runtime so any lingering caller explodes loudly (removed in a later step)
- [ ] [backend] Update `src/openapi/hono.ts` `invalidRequestHook` to emit envelope `VALIDATION_FAILED` with Zod issue details, and register the `ApiError` component once on `createOpenApiApp()`
- [ ] [test] Add `src/__tests__/invalid-request-hook.test.ts`: POST a route with an invalid body, assert `status === 200 && body.ok === false && body.error.code === "VALIDATION_FAILED" && Array.isArray(body.error.details)`
- [ ] [backend] Convert `src/routes/auth.ts`: every endpoint returns envelope via `ok()`/`err()`; keep `POST /auth/logout` at `204`; `createRoute().responses` blocks drop all `4xx` entries except `401` on auth-required routes (auth has none)
- [ ] [test] Update `src/__tests__/auth-routes.test.ts` to assert envelope shape on success + `INVALID_SIGNATURE` / `CHALLENGE_EXPIRED` / `REFRESH_TOKEN_INVALID` paths; run and verify pass
- [ ] [backend] Convert `src/routes/referral.ts`: all eight endpoints envelope; `POST /referral/claim` drops from `202` to `200`; replace every inline code string with `API_ERROR_CODES.*`
- [ ] [test] Update `src/__tests__/referral-routes.test.ts` to assert envelope shape for all converted endpoints; run and verify pass
- [ ] [backend] Convert `src/routes/profile.ts`: `/me`, `/username`, `/transactions`, `/confirm-tx` envelope; drop per-route `ErrorResponseSchema` imports
- [ ] [test] Update `src/__tests__/profile-routes.test.ts`; run and verify pass
- [ ] [backend] Convert `src/routes/public-profile.ts` + `src/routes/public-referral.ts`; `GET /public-referral/code/:code` returns envelope with `{ exists }` payload
- [ ] [test] Update `src/__tests__/public-profile-routes.test.ts` + `src/__tests__/public-referral-routes.test.ts`; run and verify pass
- [ ] [backend] Convert `src/routes/create.ts` (FlipYou) + `src/routes/potshot-create.ts`; round-lookup and settle endpoints envelope; replace `MATCH_NOT_FOUND` / `MATCH_PHASE_INVALID` strings with `API_ERROR_CODES.*`
- [ ] [test] Update FlipYou + PotShot route tests; run and verify pass
- [ ] [backend] Convert `src/routes/closecall.ts`: `/bet`, `/current`, `/by-id/:roundId`, `/history` envelope; `BET_TOO_SMALL` / `BET_TOO_LARGE` / `ROUND_NOT_FOUND` via catalog
- [ ] [test] Update `src/__tests__/closecall-routes.test.ts`; run and verify pass
- [ ] [backend] Convert `src/routes/challenges.ts`, `src/routes/points.ts`, `src/routes/dogpile.ts` (crates live inside challenges or points module — convert in place)
- [ ] [test] Update challenge / points / crate / dogpile route tests; run and verify pass
- [ ] [backend] Convert `src/routes/leaderboard.ts` + `src/routes/price.ts`
- [ ] [test] Update leaderboard + price route tests; run and verify pass
- [ ] [backend] Convert `src/routes/health.ts`: `GET /health` returns envelope; confirm LB probe (curl `-fsS http://localhost:3100/health`) still returns exit 0
- [ ] [test] Update `src/__tests__/health-routes.test.ts`; run and verify pass
- [ ] [backend] Convert `src/routes/telegram-link.ts` public JWT-protected endpoint `POST /telegram/generate-link`; service-auth webhook routes stay as-is
- [ ] [test] Update `src/__tests__/telegram-link-routes.test.ts`; run and verify pass
- [ ] [backend] Delete `errorMessage` and `structuredErrorMessage` from `src/contracts/api-errors.ts`; delete `ErrorResponseSchema` + `StructuredErrorResponseSchema` from `src/contracts/validators.ts`; run `pnpm typecheck` to confirm zero callers remain
- [ ] [test] Update `src/__tests__/waitlist-contract.test.ts`: add `dataShapeKeys()` helper, update every `WAITLIST_CONTRACT` entry's assertions to read the envelope's `data` shape, assert top-level envelope keys on every enveloped route
- [ ] [test] Add new `src/__tests__/envelope-contract.test.ts`: iterates every path in the generated `openapi.json`, asserts the `200` response schema is an envelope `oneOf` on `ok`, and asserts no handler declares a `4xx` response other than `401`
- [ ] [backend] Verify no non-401 4xx emission: `rg "c\.json\(.+, (400|402|403|404|405|409|422|429)\)" backend/src/routes` returns empty; commit a CI-run script `scripts/check-envelope.sh` that runs this grep + exits non-zero if matches found
- [ ] [docs] Add "## Envelope Contract" section to `backend/CLAUDE.md` summarizing the rules from System Invariants (1)–(8)
- [ ] [docs] Update `src/index.ts` OpenAPI `info.description` to mention the envelope contract and link to spec 304
- [ ] [docs] Add tech-debt row to `docs/TECH_DEBT.md` for the coordinated waitlist rollout
- [ ] [docs] Write `docs/specs/304-response-envelope/client-migration.md` with per-file waitlist diff and rollout order (tolerant client first, then backend cutover, then tolerance removal)
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) — **N/A**: this is a cross-cutting backend contract change with no new user flows; verification lives in backend integration tests + the envelope-contract scan
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes — **N/A**: no UI change in this repo; frontend visual regression is deferred until the frontend repo is established
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason) — **N/A**: no new provider integration; envelope is purely a response-shape contract

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for envelope primitives + validation hook + envelope-contract scan
- [ ] No lint errors (`pnpm lint` exit 0)

#### Functional Verification
- [ ] Every public OpenAPI route returns envelope on success
- [ ] Every public OpenAPI route returns envelope on domain/validation error
- [ ] Only `401` bypasses the envelope (asserted by `envelope-contract.test.ts`)
- [ ] `scripts/check-envelope.sh` exits 0 (no non-401 4xx emissions)

#### Integration Verification
- [ ] Devnet E2E passes — `pnpm test:e2e:devnet` (if running; envelope is observed via existing waitlist-smoke.spec.ts which treats `res.ok` at transport level)
- [ ] OpenAPI schema generates cleanly (`curl localhost:3100/openapi.json | jq .` with a dev `ADMIN_TOKEN`)
- [ ] `./scripts/verify` exits 0

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs `/gap-analysis 304-response-envelope --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/304-response-envelope/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
