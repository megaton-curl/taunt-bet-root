# Specification: [304] Response Envelope + Semantic HTTP Contract

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 26 |

---

## Overview

Unify every public JSON API response behind a single envelope shape and a single error-code catalog, while preserving semantic HTTP status codes.

The problem in the current backend is twofold:
1. Public routes return inconsistent body shapes on both success and failure.
2. Some normal read-side empty states have historically been modeled as errors, forcing clients into unnecessary `try/catch` and status-based special cases.

This spec fixes the body-shape inconsistency without flattening transport semantics. Public JSON responses should use one of two body shapes:

```ts
type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

interface ApiError {
  code: string;        // SCREAMING_SNAKE_CASE, stable across versions
  message: string;     // human-readable, may change
  retryable?: boolean; // whether retrying the same request may succeed
  details?: unknown;   // optional structured metadata (zod issues, limits, etc.)
}
```

HTTP status still carries meaning:
- `200` / `201` / `202` for successful outcomes
- `204` for explicit no-body success exceptions
- `400` / `422` for malformed or invalid requests
- `401` / `403` for auth and permission failures
- `404` for missing resources when absence is exceptional
- `409` for conflicts and invalid current state
- `429` for rate limits and cooldowns
- `5xx` for server faults

Only use `200` for an "empty" answer when that absence is itself the documented success case, such as "no referral code yet" or "no referrer linked yet."

### HTTP status rules

| Status | Meaning | Body shape |
|--------|---------|------------|
| `200` | Synchronous success, including documented empty-state reads | `{ ok: true, data }` |
| `201` | Resource created | `{ ok: true, data }` |
| `202` | Accepted async work | `{ ok: true, data }` |
| `204` | Success with no response body | No body |
| `400` | Malformed request or invalid identifier format | `{ ok: false, error }` |
| `401` | Missing/invalid/expired auth | `{ ok: false, error }` |
| `403` | Authenticated but forbidden | `{ ok: false, error }` |
| `404` | Resource not found | `{ ok: false, error }` |
| `405` | Method not allowed on unknown route shape | Hono default |
| `409` | Conflict or invalid current state | `{ ok: false, error }` |
| `422` | Request validation failed | `{ ok: false, error }` |
| `429` | Rate limit or cooldown | `{ ok: false, error }` |
| `5xx` | Server fault | Prefer `{ ok: false, error }` for handled cases; unhandled crashes may vary |

### What changes from the current spec

- Keep the envelope and stable `error.code` catalog.
- Do not convert domain failures to `200`.
- Do convert normal empty-state reads to `200` success envelopes where appropriate.
- Do update middleware and route handlers so explicit JSON responses use the same envelope body.

## User Stories

- As a frontend engineer, I want one response body shape so shared parsing is simple.
- As a frontend engineer, I still want meaningful HTTP statuses so generic fetch helpers, retries, and route-level behavior remain predictable.
- As a backend engineer, I want stable machine-readable `error.code` values instead of ad hoc strings.
- As an operator, I want `404`, `409`, `429`, and `5xx` metrics to keep their real meaning.
- As an SDK author, I want OpenAPI to describe both success and error bodies consistently without erasing transport semantics.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Cross-cutting backend API hardening; no new product capability.
- **Current baseline fit**: Partial. The codebase already moved some empty-state referral reads to success-style answers; this spec formalizes that direction and generalizes the body contract.
- **Planning bucket**: Core.

## Required Context Files

- `backend/src/contracts/api-errors.ts`
- `backend/src/contracts/validators.ts`
- `backend/src/openapi/hono.ts`
- `backend/src/routes/*.ts`
- `backend/src/middleware/jwt-auth.ts`
- `backend/src/middleware/rate-limit.ts`
- `backend/src/__tests__/waitlist-contract.test.ts`
- `waitlist/src/lib/auth-api.ts`
- `waitlist/src/lib/referral-api.ts`
- `waitlist/src/components/TelegramCard.tsx`
- `webapp/src/lib/api.ts`
- `webapp/src/lib/auth/api.ts`
- `webapp/src/lib/parse-transaction-error.ts`
- `webapp/src/pages/profile/profile-data.ts`
- `telegram/src/backend-client.ts`

## Contract Files

- **New**: `backend/src/contracts/api-envelope.ts`
- **Updated**: `backend/src/contracts/api-errors.ts`
- **Updated**: `backend/src/openapi/hono.ts`
- **Updated**: every public route file in `backend/src/routes/`
- **Updated**: route tests + contract tests for affected consumers

---

## System Invariants

1. **One body contract.** Every declared public JSON response uses the envelope shape, except explicit `204` responses and framework-generated unmatched-route `404/405`.
2. **Semantic HTTP is preserved.** Status codes keep their transport and application meaning; route authors do not collapse handled domain failures into `200`.
3. **`ok` is the discriminator.** Success responses are `{ ok: true, data }`; error responses are `{ ok: false, error }`.
4. **Error codes are stable.** Every emitted `error.code` is defined once in the central catalog. Renaming a shipped code is a breaking change.
5. **Validation is not success.** OpenAPI/Zod request validation failures return `422`, not `200`.
6. **Empty-state reads are documented success.** A route may return `200` with `null`, empty arrays, or default-zero values only when that absence is the intended success answer.
7. **Async acceptance stays async.** Endpoints that enqueue or hand off work may use `202 { ok: true, data }`.
8. **Cooldowns and rate limits stay `429`.** Do not hide these behind `200`.
9. **Auth and permission stay `401/403`.** Do not hide these behind `200`.
10. **OpenAPI is explicit.** Public route declarations must describe success envelopes and error envelopes at their real statuses.

---

## Functional Requirements

### FR-1: Envelope primitives and helpers

Introduce shared types, schemas, and helpers for success and error envelopes.

**Deliverable:** `backend/src/contracts/api-envelope.ts` exporting:

```ts
export interface ApiEnvelopeSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiEnvelopeError {
  ok: false;
  error: ApiError;
}

export type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export const ApiErrorSchema: z.ZodType<ApiError>;
export const ErrorEnvelopeSchema: z.ZodType<ApiEnvelopeError>;

export function ok<T>(
  c: Context,
  data: T,
  status?: 200 | 201 | 202,
): ReturnType<Context["json"]>;

export function err(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
  code: ApiErrorCode,
  message: string,
  opts?: { retryable?: boolean; details?: unknown },
): ReturnType<Context["json"]>;

export function envelope<T extends z.ZodTypeAny>(
  dataSchema: T,
): z.ZodType<ApiEnvelope<z.infer<T>>>;
```

**Acceptance Criteria:**
- [ ] `ok(c, data)` returns `200 { ok: true, data }`
- [ ] `ok(c, data, 201|202)` preserves the supplied success status
- [ ] `err(c, status, code, message, opts?)` returns `{ ok: false, error }` with the supplied non-2xx status
- [ ] `envelope(schema)` produces a discriminated union on `ok`
- [ ] Unit tests cover success and error serialization plus schema round-trips

### FR-2: Centralized error-code catalog

Every emitted `error.code` must come from one shared catalog.

**Deliverable:** `backend/src/contracts/api-errors.ts` exports a central catalog and type:

```ts
export const API_ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_PARAMS: "INVALID_PARAMS",

  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  REFRESH_TOKEN_INVALID: "REFRESH_TOKEN_INVALID",

  CODE_ALREADY_SET: "CODE_ALREADY_SET",
  CODE_TAKEN: "CODE_TAKEN",
  CODE_NOT_FOUND: "CODE_NOT_FOUND",
  INVALID_CODE: "INVALID_CODE",
  SELF_REFERRAL: "SELF_REFERRAL",
  ALREADY_LINKED: "ALREADY_LINKED",
  ZERO_BALANCE: "ZERO_BALANCE",
  BELOW_THRESHOLD: "BELOW_THRESHOLD",
  CLAIM_NOT_FOUND: "CLAIM_NOT_FOUND",

  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  USERNAME_COOLDOWN: "USERNAME_COOLDOWN",
  INVALID_USERNAME: "INVALID_USERNAME",

  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",
  MATCH_PHASE_INVALID: "MATCH_PHASE_INVALID",
  ROUND_NOT_FOUND: "ROUND_NOT_FOUND",
  BET_TOO_SMALL: "BET_TOO_SMALL",
  BET_TOO_LARGE: "BET_TOO_LARGE",

  TELEGRAM_NOT_LINKED: "TELEGRAM_NOT_LINKED",
  TELEGRAM_ALREADY_LINKED: "TELEGRAM_ALREADY_LINKED",
  TELEGRAM_TOKEN_EXPIRED: "TELEGRAM_TOKEN_EXPIRED",

  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];
```

**Acceptance Criteria:**
- [ ] Public routes no longer inline ad hoc `code` strings
- [ ] `ApiError.code` is typed as `ApiErrorCode`
- [ ] Legacy `errorMessage()` and `structuredErrorMessage()` are removed after route conversion

### FR-3: Validation hook emits `422` error envelope

Update the OpenAPI invalid-request hook so schema validation failures return a structured envelope at `422`.

**Deliverable:** `backend/src/openapi/hono.ts`:

```ts
export function invalidRequestHook<E extends Env, P extends string>(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context<E, P>,
) {
  if (result.success) return;
  return err(
    c,
    422,
    API_ERROR_CODES.VALIDATION_FAILED,
    "Invalid request",
    {
      retryable: false,
      details: result.error.issues,
    },
  );
}
```

**Acceptance Criteria:**
- [ ] OpenAPI/Zod parse failures return `422`
- [ ] The body is `{ ok: false, error: { code: "VALIDATION_FAILED", details } }`
- [ ] `details` contains the Zod issue list

### FR-4: OpenAPI describes real status codes plus shared envelopes

Public route declarations must describe enveloped success and error responses at their real statuses.

**Acceptance Criteria:**
- [ ] `200` / `201` / `202` JSON responses use `envelope(SuccessSchema)`
- [ ] `400` / `401` / `403` / `404` / `409` / `422` / `429` JSON responses use `ErrorEnvelopeSchema`
- [ ] Generated OpenAPI contains reusable `ApiError` and `ErrorEnvelope` components exactly once
- [ ] No converted route declares a bare `{ error: string }` JSON schema

### FR-5: Auth and permission keep `401` / `403`

Auth and permission failures must stay transport-visible.

**Acceptance Criteria:**
- [ ] Missing/invalid/expired token returns `401 { ok: false, error }`
- [ ] Wallet mismatch / forbidden action returns `403 { ok: false, error }`
- [ ] Clients may still branch on status for auth flows

### FR-6: Rate limits and cooldowns keep `429`

Rate limit and cooldown responses must remain `429`, with the envelope body.

**Acceptance Criteria:**
- [ ] `backend/src/middleware/rate-limit.ts` returns `429 { ok: false, error: { code: "RATE_LIMITED", ... } }`
- [ ] Username cooldown in `/profile/username` remains `429`
- [ ] Existing tests are updated to assert both status and envelope shape

### FR-7: Normal empty-state reads stay `200`

When "nothing there" is the intended success answer, model it as a success envelope.

**Acceptance Criteria:**
- [ ] `GET /referral/code` returns `200 { ok: true, data: { code: string | null } }`
- [ ] `GET /referral/referrer` returns `200` with all nullable fields when no referrer is linked
- [ ] `GET /points/mine` may return `200` zero values when the player has no points row
- [ ] `GET /public-referral/code/:code` remains a probe-style `200 { exists: boolean }`

### FR-8: Convert `/auth/*`

**Acceptance Criteria:**
- [ ] `POST /auth/challenge` returns `200` success envelope
- [ ] `POST /auth/verify` returns `200` success envelope or `401` error envelope for `INVALID_SIGNATURE` / `CHALLENGE_EXPIRED`
- [ ] `POST /auth/refresh` returns `200` success envelope or `401` error envelope for `REFRESH_TOKEN_INVALID`
- [ ] `POST /auth/logout` remains `204 No Content`

### FR-9: Convert `/referral/*`

**Acceptance Criteria:**
- [ ] `POST /referral/code`: `200` success, `409` for `CODE_ALREADY_SET` / `CODE_TAKEN`, `422` for invalid code format
- [ ] `GET /referral/code`: `200` success with nullable code
- [ ] `POST /referral/apply`: `200` success, `404` for `CODE_NOT_FOUND`, `409` for `SELF_REFERRAL` / `ALREADY_LINKED`, `422` for invalid code format
- [ ] `GET /referral/referrer`, `GET /referral/stats`, `GET /referral/referrals`, `GET /referral/earnings`: success envelopes at `200`
- [ ] `POST /referral/claim`: `202` success envelope, `422` for `ZERO_BALANCE` / `BELOW_THRESHOLD`
- [ ] `GET /referral/claim/:claimId`: `200` success or `404` `CLAIM_NOT_FOUND`

### FR-10: Convert `/profile/*`, `/public-profile/*`, `/public-referral/*`

**Acceptance Criteria:**
- [ ] `GET /profile/me`: `200` success or `404` `PROFILE_NOT_FOUND`
- [ ] `PUT /profile/username`: `200` success, `409` `USERNAME_TAKEN`, `429` `USERNAME_COOLDOWN`, `422` `INVALID_USERNAME`
- [ ] `GET /profile/transactions`: `200` success, `422` for invalid filters
- [ ] `POST /profile/confirm-tx`: `200` success, `404` when profile is missing, `422` for invalid body or invalid game
- [ ] `GET /public-profile/:userId`: `200` success or `404` `NOT_FOUND`
- [ ] `GET /public-referral/code/:code`: `200 { exists }`
- [ ] `GET /public-referral/:identifier`: `200` success or `404` `NOT_FOUND`

### FR-11: Convert game routes

This includes FlipYou, PotShot, and CloseCall public routes.

**Acceptance Criteria:**
- [ ] Invalid wallet / malformed identifiers return `400` or `422` with the error envelope
- [ ] Wallet/auth mismatch returns `403`
- [ ] Missing round or match returns `404`
- [ ] Conflict and invalid phase cases return `409`
- [ ] Bet bounds and similar domain validation failures return `422`
- [ ] Success responses remain `200` or `201` as appropriate

### FR-12: Convert `/challenges/*`, `/points/*`, `/dogpile/*`, `/leaderboard/*`, `/price/*`, `/health`, and `POST /telegram/generate-link`

**Acceptance Criteria:**
- [ ] Read endpoints return success envelopes
- [ ] `GET /health` returns `200 { ok: true, data: { status, version, workerRunning } }`
- [ ] `GET /price/sol-usd` returns `503` error envelope when unavailable
- [ ] `POST /telegram/generate-link` returns `200` success envelope for both the already-linked and new-token branches
- [ ] Service-auth Telegram webhook routes may remain out of scope

### FR-13: Remove deprecated response helpers

**Acceptance Criteria:**
- [ ] `errorMessage` and `structuredErrorMessage` are deleted
- [ ] Legacy `ErrorResponseSchema` and `StructuredErrorResponseSchema` are deleted
- [ ] Public routes emit only envelope bodies for declared JSON responses

### FR-14: Update contract and route tests

**Acceptance Criteria:**
- [ ] `backend/src/__tests__/waitlist-contract.test.ts` extracts the inner `data` shape from success envelopes
- [ ] The contract test also asserts the expected success status (`200` or `202`) per endpoint
- [ ] Route tests assert both status and envelope body for representative error paths
- [ ] A new OpenAPI contract test asserts every declared public JSON response is an envelope at its declared status

### FR-15: Client compatibility and rollout

This change affects real clients in this repository and cannot be treated as backend-only.

**Deliverable:** `docs/specs/304-response-envelope/client-migration.md` covering:
1. Shared body parsing for `waitlist/`, `webapp/`, and `telegram/`
2. Existing status-based logic that must remain intact
3. Any tolerant parsing shim needed for staged rollout
4. Rollout order

**Acceptance Criteria:**
- [ ] The doc explicitly covers `waitlist/src/lib/auth-api.ts`
- [ ] The doc explicitly covers `waitlist/src/lib/referral-api.ts`
- [ ] The doc explicitly covers `waitlist/src/components/TelegramCard.tsx`
- [ ] The doc explicitly covers `webapp/src/lib/api.ts`
- [ ] The doc explicitly covers `webapp/src/lib/auth/api.ts`
- [ ] The doc explicitly covers `webapp/src/lib/parse-transaction-error.ts`
- [ ] The doc explicitly covers `webapp/src/pages/profile/profile-data.ts`
- [ ] The doc explicitly covers `telegram/src/backend-client.ts`
- [ ] Rollout order preserves compatibility for deployed clients

### FR-16: Documentation

**Acceptance Criteria:**
- [ ] `backend/CLAUDE.md` gains an "Envelope Contract" section explaining body shape plus status semantics
- [ ] OpenAPI `info.description` mentions the envelope contract and links to this spec
- [ ] `docs/TECH_DEBT.md` records any temporary client/backend compatibility shim required during rollout

---

## Success Criteria

- Every declared public JSON response body is either `{ ok: true, data: ... }` or `{ ok: false, error: ... }`, except explicit `204` responses and framework-generated unmatched-route `404/405`.
- HTTP status codes remain semantically meaningful.
- Empty-state reads that are truly normal return `200` success envelopes instead of faux errors.
- Handled validation failures return `422`, handled conflicts return `409`, handled missing resources return `404`, handled auth failures return `401/403`, handled cooldown/rate limits return `429`.
- Generated OpenAPI documents both success and error envelopes at their real statuses.
- Waitlist, webapp, and Telegram clients can adopt one body parser without losing their current status-based behavior.

## Dependencies

- `@hono/zod-openapi`
- `zod`

## Assumptions

- Current clients already branch on `res.ok`, `response.status`, or `ApiError.status`; this spec intentionally preserves that behavior.
- The main contract win comes from uniform response bodies and stable `error.code`, not from flattening status codes.
- No non-JSON public endpoints currently require special handling beyond `204` logout.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|----------------------|-------------------|-------------------|
| 1 | Envelope helpers serialize correctly | Unit tests for `ok()` / `err()` / `envelope()` | Green test run |
| 2 | Validation failures use `422` | Integration test with invalid request | `422` + `VALIDATION_FAILED` + Zod issues |
| 3 | Auth and permission stay semantic | Route tests | `401` / `403` with error envelope |
| 4 | Cooldowns and rate limits stay semantic | Route tests | `429` with error envelope |
| 5 | Empty-state reads stay success | Route tests | `200` success envelopes with nullable/default data |
| 6 | OpenAPI stays consistent | Contract scan of `openapi.json` | Every declared JSON response uses envelope schema |
| 7 | Clients remain compatible | Manual audit of waitlist/webapp/telegram helpers | Migration doc references real files and logic |
| 8 | Legacy helpers fully removed | `rg` against backend sources | No legacy helper/schema hits |
| 9 | Full regression suite passes | `./scripts/verify` | Exit 0 |

---

## Completion Signal

### Implementation Checklist

> Refinement decisions (2026-04-22):
> - **Rollout**: atomic switch, no tolerant shim, no feature flag.
> - **Client scope**: backend + telegram client in-repo; waitlist + webapp handled via migration doc only (FE is a separate project, per CLAUDE.md).
> - **Granularity**: one iteration per route file.
> - **Out of scope for this spec**: `backend/src/routes/admin.ts` (tracked in 303-peek-admin) and `backend/src/routes/internal.ts` (service-auth webhooks).

#### Foundations (must land first)

- [x] [contracts] Create `backend/src/contracts/api-envelope.ts` exporting `ApiEnvelopeSuccess<T>`, `ApiEnvelopeError`, `ApiEnvelope<T>`, `ApiError`, `ApiErrorSchema`, `ErrorEnvelopeSchema`, `envelope(dataSchema)`, `ok(c, data, status?)`, `err(c, status, code, message, opts?)`. Add unit tests covering serialization of success (200/201/202), error (400/401/403/404/409/422/429/500/503), and schema round-trip of discriminated-union envelopes. (done: iteration 1)
- [x] [contracts] Rewrite `backend/src/contracts/api-errors.ts` to export the `API_ERROR_CODES` catalog listed in FR-2 plus the `ApiErrorCode` type. Keep legacy `errorMessage`/`structuredErrorMessage`/`ErrorResponseBody`/`StructuredErrorResponseBody` exports in place for now (they will be deleted in the cleanup iteration). Add a unit test asserting the catalog is the single source of truth. (done: iteration 2)
- [x] [openapi] Update `invalidRequestHook` in `backend/src/openapi/hono.ts` to return `422 { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid request", retryable: false, details: result.error.issues } }`. Add a test via any OpenAPI-validated route that asserts status 422 + envelope body + Zod issue list. (done: iteration 3)

#### Middleware

- [x] [middleware] Convert `backend/src/middleware/jwt-auth.ts` to return `401 { ok: false, error: { code: "AUTH_REQUIRED", ... } }` envelopes for missing/invalid/expired tokens. Update `backend/src/__tests__/auth.test.ts` and `auth-routes.test.ts` assertions to match envelope shape. (done: iteration 4)
- [x] [middleware] Convert `backend/src/middleware/rate-limit.ts` to return `429 { ok: false, error: { code: "RATE_LIMITED", retryable: true, details: { retryAfterMs? } } }`. Update `rate-limit.test.ts` to assert both status and envelope body. (done: iteration 5)

#### Public route conversion (one iteration per file)

- [x] [routes] Convert `backend/src/routes/auth.ts` — `POST /challenge`, `POST /verify`, `POST /refresh` use success envelopes; error paths use `401 INVALID_SIGNATURE` / `401 CHALLENGE_EXPIRED` / `401 REFRESH_TOKEN_INVALID`; `POST /logout` remains `204`. Update `auth-routes.test.ts` to assert envelope shape and preserved statuses. (done: iteration 6)
- [x] [routes] Convert `backend/src/routes/referral.ts` — all nine endpoints. Preserve `409 CODE_ALREADY_SET` / `CODE_TAKEN` / `SELF_REFERRAL` / `ALREADY_LINKED`, `404 CODE_NOT_FOUND` / `CLAIM_NOT_FOUND`, `422 BELOW_THRESHOLD` / `ZERO_BALANCE`, `202` for `POST /claim`. Empty-state GETs return `200 { ok: true, data: { ... nullable fields ... } }`. Update `referral-routes.test.ts`. (done: iteration 7)
- [x] [routes] Convert `backend/src/routes/public-referral.ts` — `GET /code/:code` returns `200 { ok: true, data: { exists: boolean } }`; `GET /:identifier` returns `200` or `404 NOT_FOUND`. Update `public-referral-routes.test.ts`. (done: iteration 8)
- [x] [routes] Convert `backend/src/routes/profile.ts` — `GET /me` (`200` or `404 PROFILE_NOT_FOUND`), `PUT /username` (`200` or `409 USERNAME_TAKEN` / `429 USERNAME_COOLDOWN` / `422 INVALID_USERNAME`), `GET /transactions` (`200` or `422`), `POST /confirm-tx` (`200` / `404` / `422`). Update `profile.test.ts` and `profile-me-zeroed.test.ts`. (done: iteration 9)
- [x] [routes] Convert `backend/src/routes/public-profile.ts` — `GET /:userId` returns `200` or `404 NOT_FOUND`. Update/extend existing test coverage as needed. (done: iteration 10)
- [x] [routes] Convert `backend/src/routes/create.ts` (FlipYou public entry) — success envelopes; domain failures mapped to `400` / `403` / `404` / `409` / `422` per FR-11. Update any FlipYou route-level tests. (done: iteration 11)
- [x] [routes] Convert `backend/src/routes/potshot-create.ts` — same envelope + status mapping as FR-11. (done: iteration 12)
- [x] [routes] Convert `backend/src/routes/closecall.ts` — `/current-round`, `/history`, `/by-id/:roundId`, `/bet` follow FR-11 conventions. Update `closecall-routes.test.ts`. (done: iteration 13)
- [x] [routes] Convert `backend/src/routes/challenges.ts` — read endpoints return success envelopes. Update `challenge-routes.test.ts`. (done: iteration 14)
- [x] [routes] Convert `backend/src/routes/points.ts` — `GET /mine` may return `200` with zero-value envelope data when no row exists. Update `points-and-crates-routes.test.ts`. (done: iteration 15)
- [x] [routes] Convert `backend/src/routes/dogpile.ts` — `/current`, `/schedule` return success envelopes, null/empty as documented success. Update `dogpile-public-routes.test.ts`. (done: iteration 16)
- [x] [routes] Convert `backend/src/routes/leaderboard.ts` — `GET /` returns success envelope. Update `leaderboard.test.ts`. (done: iteration 17)
- [x] [routes] Convert `backend/src/routes/price.ts` — `GET /sol-usd` returns `200` success envelope or `503 { ok: false, error: { code: "PRICE_UNAVAILABLE", retryable: true } }`. (done: iteration 18)
- [x] [routes] Convert `backend/src/routes/health.ts` — `GET /` returns `200 { ok: true, data: { status, version, workerRunning } }`. (done: iteration 19)
- [x] [routes] Convert `backend/src/routes/telegram-link.ts` — `POST /generate-link` returns `200 { ok: true, data: { deepLink, alreadyLinked } }` for both already-linked and new-token branches. Service-auth Telegram webhook routes (if any in this file) remain out of scope. (done: iteration 20)

#### Cleanup

- [x] [contracts] Delete legacy helpers: `errorMessage`, `structuredErrorMessage`, `ErrorResponseBody`, `StructuredErrorResponseBody`, `StructuredErrorDetail` from `api-errors.ts` and `ErrorResponseSchema` / `StructuredErrorDetailSchema` / `StructuredErrorResponseSchema` from `validators.ts`. Grep the full backend (`backend/src/**`) to confirm zero remaining imports before deleting. `./scripts/verify` must pass. (done: iteration 21)

#### Tests + OpenAPI contract

- [x] [test] Extend `backend/src/__tests__/openapi-contract.test.ts` to scan every declared public JSON response in the generated OpenAPI document and assert: (a) 2xx JSON bodies use `envelope(SuccessSchema)`; (b) 4xx/5xx JSON bodies use `ErrorEnvelopeSchema`; (c) `ApiError` and `ErrorEnvelope` components appear exactly once. Admin/internal/service-auth routes explicitly excluded. (done: iteration 22)
- [x] [test] Update `backend/src/__tests__/waitlist-contract.test.ts` to extract `.data` from success envelopes, assert the expected success status (`200`/`201`/`202`) per endpoint, and assert error envelope shape on representative failure paths. (done: iteration 23)

#### Telegram client

- [x] [telegram] Update `telegram/src/backend-client.ts` to parse envelopes: on success pull `.data`; on failure pull `.error.code`/`.error.message`. Update telegram tests. Run `cd telegram && pnpm verify` and ensure exit 0. (done: iteration 24)

#### Docs

- [x] [docs] Write `docs/specs/304-response-envelope/client-migration.md` covering: `waitlist/src/lib/auth-api.ts`, `waitlist/src/lib/referral-api.ts`, `waitlist/src/components/TelegramCard.tsx`, `webapp/src/lib/api.ts`, `webapp/src/lib/auth/api.ts`, `webapp/src/lib/parse-transaction-error.ts`, `webapp/src/pages/profile/profile-data.ts`, `telegram/src/backend-client.ts` — with concrete before/after snippets and the atomic rollout order. (done: iteration 25)
- [x] [docs] Add an "Envelope Contract" section to `backend/CLAUDE.md` describing body shape + status semantics, update OpenAPI `info.description` to mention the contract and link this spec, and add a `docs/TECH_DEBT.md` entry only if any residual compatibility concern remains after the atomic switch (otherwise note "no debt — clean cutover"). (done: iteration 26)

#### Mandatory coverage markers

- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in e2e/local/** (or mark N/A with reason for non-web/non-interactive specs) — **N/A**: this is a backend JSON contract spec with no interactive frontend flow introduced; route-level tests in `backend/src/__tests__/` cover the full request/response contract.
- [ ] [test] Add visual route/state coverage in e2e/visual/**; run pnpm test:visual and update baselines only for intentional UI changes — **N/A**: backend-only spec, and per the `/refine` skill visual regression is deferred until the frontend repo is established.
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in e2e/devnet/** with env validation + retry/backoff (or mark N/A with reason) — **N/A**: this spec only reshapes existing response bodies; no new provider/oracle/VRF integration is added. Existing Pyth-backed `/price/sol-usd` keeps its current integration, only its error body changes shape.

### Testing Requirements

- [ ] All existing tests pass
- [ ] New envelope helper tests pass
- [ ] New validation-hook tests pass
- [ ] Route tests assert both status and envelope body
- [ ] OpenAPI contract scan passes
- [ ] `./scripts/verify` exits 0

### Iteration Instructions

If any check fails:
1. Identify the mismatch between status semantics and envelope semantics.
2. Fix the route/helper/schema.
3. Re-run the relevant tests.
4. Re-verify the full contract scan.

**Only when all checks pass, output:** `<promise>DONE</promise>`
