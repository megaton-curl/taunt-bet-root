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

