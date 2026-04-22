# Implementation History — 304-response-envelope

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 0 — 2026-04-22T06:57:47Z — BLOCKED
- **Blocker**: Spec is still Draft. Run '/refine 304-response-envelope' to break down the checklist.

## Iteration 1 — 2026-04-22 — DONE
- **Item**: [contracts] Create `backend/src/contracts/api-envelope.ts` + unit tests.
- **Changes**:
  - Added `backend/src/contracts/api-envelope.ts` exporting envelope primitives (`ApiEnvelopeSuccess`, `ApiEnvelopeError`, `ApiEnvelope`, `ApiError`), zod schemas (`ApiErrorSchema`, `ErrorEnvelopeSchema`, `envelope(dataSchema)`), and helpers `ok(c, data, status?)` / `err(c, status, code, message, opts?)`.
  - `ApiErrorCode` temporarily typed as `string`; will be narrowed to the `API_ERROR_CODES` union when `api-errors.ts` is rewritten in the next iteration.
  - Added `backend/src/__tests__/api-envelope.test.ts` — 26 tests covering success serialization (200/201/202), error serialization for all nine declared error statuses (400/401/403/404/409/422/429/500/503), schema round-trips, and discriminated-union parsing.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - `pnpm vitest run --config vitest.unit.config.ts src/__tests__/api-envelope.test.ts` → 26/26 passed
  - Full unit suite (`pnpm test:unit:self`) → 205/205 passed, 18 files

## Iteration 1 — 2026-04-22T09:15:17Z — OK
- **Log**: iteration-001.log

## Iteration 2 — 2026-04-22 — DONE
- **Item**: [contracts] Rewrite `backend/src/contracts/api-errors.ts` to export `API_ERROR_CODES` + `ApiErrorCode` type; keep legacy helpers for the cleanup iteration; add a unit test.
- **Changes**:
  - Rewrote `backend/src/contracts/api-errors.ts`: added the `API_ERROR_CODES` constant (34 codes from FR-2) and derived `ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES]`. Kept legacy exports (`errorMessage`, `structuredErrorMessage`, `ErrorResponseBody`, `StructuredErrorResponseBody`, `StructuredErrorDetail`) intact — they are still consumed by 10 route files and the OpenAPI hook, and will be deleted in the cleanup iteration.
  - Narrowed `ApiErrorCode` in `backend/src/contracts/api-envelope.ts` from the temporary `string` alias to a re-export of the catalog-derived union. `err()` callers are now type-checked against the catalog.
  - Added `backend/src/__tests__/api-errors.test.ts` — 5 tests asserting the catalog is the single source of truth: every key equals its value, values are SCREAMING_SNAKE_CASE, values are unique, the type derives correctly, and every FR-2 code is present.
  - Updated `backend/src/__tests__/api-envelope.test.ts` to use a real catalog code (`NOT_FOUND`) in the generic error-status test instead of the placeholder `"SOME_CODE"` string literal (now rejected by the narrowed type).
- **Verification**:
  - `tsc --noEmit` → exit 0
  - `eslint src ...` → exit 0
  - Targeted: `vitest run src/__tests__/api-errors.test.ts src/__tests__/api-envelope.test.ts` → 31/31 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 210/210 passed across 19 files

## Iteration 2 — 2026-04-22T09:20:18Z — OK
- **Log**: iteration-002.log

## Iteration 3 — 2026-04-22 — DONE
- **Item**: [openapi] Update `invalidRequestHook` in `backend/src/openapi/hono.ts` to return `422` envelope with `VALIDATION_FAILED` + Zod issue list; add hook test.
- **Changes**:
  - Rewrote `backend/src/openapi/hono.ts`: hook now accepts `{ success: true } | { success: false; error: z.ZodError }`, returns `err(c, 422, API_ERROR_CODES.VALIDATION_FAILED, "Invalid request", { retryable: false, details: result.error.issues })`. Removed legacy `errorMessage` import (will be deleted in cleanup iteration).
  - Added `backend/src/__tests__/openapi-invalid-request-hook.test.ts` — 4 tests: 422 status + VALIDATION_FAILED envelope + retryable:false; Zod issue list includes all failing paths; body round-trips through `ErrorEnvelopeSchema`; valid requests still succeed.
  - Updated `backend/src/__tests__/auth-routes.test.ts` — two tests that asserted 400 + `{ error: "Invalid request" }` now assert 422 + envelope shape (the `/auth/challenge` route converts in a later iteration; only the hook-level assertion changed).
  - Updated `backend/src/__tests__/leaderboard.test.ts` — same assertion shift for the legacy game-alias test.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - `pnpm vitest run --config vitest.unit.config.ts` → 214/214 passed (20 files, +4 new hook tests)

## Iteration 3 — 2026-04-22T09:25:50Z — OK
- **Log**: iteration-003.log

## Iteration 4 — 2026-04-22 — DONE
- **Item**: [middleware] Convert `backend/src/middleware/jwt-auth.ts` to return `401 { ok: false, error: { code: "AUTH_REQUIRED", ... } }` envelopes; update `auth.test.ts` assertions.
- **Changes**:
  - Rewrote `backend/src/middleware/jwt-auth.ts`: replaced three `c.json({ error: ... }, 401)` call sites with `err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, <message>)`. Imported `err` from `../contracts/api-envelope.js` and `API_ERROR_CODES` from `../contracts/api-errors.js`. Renamed the `catch (err)` binding to `catch (verifyError)` to avoid shadowing the imported helper.
  - Updated `backend/src/__tests__/auth.test.ts`: the four 401 rejection tests now assert envelope shape (`body.ok === false`, `body.error.code === "AUTH_REQUIRED"`) in addition to status. The two message-specific tests assert the exact message for the two distinct 401 paths ("Missing or invalid Authorization header" and "Invalid or expired token").
  - `auth-routes.test.ts` intentionally left unchanged: its 401 cases come from the auth routes themselves (challenge/verify/refresh), not the JWT middleware. Those routes are converted in a later iteration (per checklist) — updating them now would break tests against still-legacy route handlers.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - `pnpm vitest run --config vitest.unit.config.ts` → 214/214 passed across 20 files

## Iteration 4 — 2026-04-22T09:28:56Z — OK
- **Log**: iteration-004.log

## Iteration 5 — 2026-04-22 — DONE
- **Item**: [middleware] Convert `backend/src/middleware/rate-limit.ts` to `429` envelope with `RATE_LIMITED` code; update `rate-limit.test.ts` to assert envelope body.
- **Changes**:
  - Rewrote `backend/src/middleware/rate-limit.ts`: both 429 call sites (global-limit and per-identity-limit) now use `err(c, 429, API_ERROR_CODES.RATE_LIMITED, "Too many requests", { retryable: true, details: { retryAfterMs: config.windowMs } })`. `Retry-After` header is preserved. Imported `err` from `../contracts/api-envelope.js` and `API_ERROR_CODES` from `../contracts/api-errors.js`.
  - Updated `backend/src/__tests__/rate-limit.test.ts`: the per-wallet 429 test and the global 429 test now assert the full envelope body (`{ ok: false, error: { code: "RATE_LIMITED", message, retryable: true, details: { retryAfterMs } } }`). The 30-second-window test also asserts `details.retryAfterMs === 30_000`. Retry-After header assertions preserved.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - `pnpm vitest run --config vitest.unit.config.ts src/__tests__/rate-limit.test.ts` → 7/7 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 5 — 2026-04-22T09:32:36Z — OK
- **Log**: iteration-005.log

## Iteration 6 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/auth.ts` to envelope responses; update `auth-routes.test.ts`.
- **Changes**:
  - Rewrote all four auth routes in `backend/src/routes/auth.ts`:
    - `POST /challenge`: success → `ok(c, { nonce, message, expiresAt })`; declared 200 response now uses `envelope(ChallengeNonceResponseSchema)`; legacy 400 replaced with `422 ErrorEnvelopeSchema` (matches real hook behavior from iteration 3).
    - `POST /verify`: success → `ok(c, tokens)`; 401 errors use `err(c, 401, INVALID_SIGNATURE | CHALLENGE_EXPIRED, ...)`; the 500 profile-establish path uses `PRECONDITION_FAILED` (closest catalog fit for "required state couldn't be established"); declared 400/500 schemas replaced with `ErrorEnvelopeSchema`, added `422 ErrorEnvelopeSchema`.
    - `POST /refresh`: success → `ok(c, tokens)`; all three 401 paths (invalid, reuse, expired) use `err(c, 401, REFRESH_TOKEN_INVALID, ...)`; 400 replaced with `422 ErrorEnvelopeSchema`.
    - `POST /logout`: unchanged — still returns `204` with no body.
    - Removed `ErrorResponseSchema` import (kept `ChallengeNonceResponseSchema` + `TokenResponseSchema` as the inner data schemas inside `envelope(...)`).
  - Updated `backend/src/contracts/api-envelope.ts` to unblock route handler typing:
    - Added overload signatures on `ok<T>(c, data)` → `ok<T, S>(c, data, status)` so the handler return type narrows to the specific `200 | 201 | 202` literal the route declared (TypeScript inference would otherwise widen to the `SuccessStatus` union and fail the hono-zod-openapi `Handler` constraint).
    - Made `err<S extends ErrorStatus>(c, status, code, message, opts?)` generic on status for the same reason.
    - Introduced `ApiErrorDetails = any` alias for `ApiError.details` and `err(opts.details)`. Hono's `TypedResponse` narrows `unknown` to `JSONValue` in the inferred route response, which caused a type mismatch against a fully-typed `unknown`. `any` is the pragmatic fit — runtime values remain JSON-serializable (Zod issues, limits, etc.) and the schema-level `z.unknown().optional()` is unchanged.
    - Added `/* eslint-disable no-redeclare, no-undef */` around the overloaded `ok`/`err` block (overloads trigger base `no-redeclare`; `Response` intersection type triggers `no-undef` since ESLint doesn't know the global). typescript-eslint's own no-redeclare is overload-aware but isn't enabled in the shared config.
  - Updated `backend/src/__tests__/auth-routes.test.ts`:
    - Every success assertion now destructures `{ ok, data }` from the envelope.
    - 401 assertions now check `body.ok === false` and `body.error.code` equals the exact catalog code: `REFRESH_TOKEN_INVALID` (replay, post-logout, invalid-token), `INVALID_SIGNATURE` (wrong wallet, wrong signature), `CHALLENGE_EXPIRED` (already-used nonce).
  - Updated `backend/src/__tests__/waitlist-contract.test.ts` `responseKeys` helper — added `unwrapEnvelope()` that detects an envelope `oneOf` variant with `ok: true` and descends into the `data` schema's properties. Non-enveloped legacy routes (referral/*, public-referral/*) still work via fall-through. This makes the waitlist-contract test pass for the auth routes right now and will keep passing as other routes convert in later iterations.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - Targeted: `vitest run src/__tests__/auth-routes.test.ts src/__tests__/auth.test.ts src/__tests__/rate-limit.test.ts` → 22/22 passed
  - Targeted: `vitest run src/__tests__/api-envelope.test.ts src/__tests__/openapi-invalid-request-hook.test.ts src/__tests__/waitlist-contract.test.ts` → 71/71 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 6 — 2026-04-22T09:47:44Z — OK
- **Log**: iteration-006.log

