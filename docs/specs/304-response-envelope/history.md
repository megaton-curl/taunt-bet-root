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

## Iteration 7 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/referral.ts` to envelope responses; update `referral-routes.test.ts`.
- **Changes**:
  - Rewrote all nine referral routes in `backend/src/routes/referral.ts`:
    - `POST /code`: success → `ok(c, { code })`; `401 AUTH_REQUIRED`; `404 PROFILE_NOT_FOUND`; `409 CODE_ALREADY_SET` / `CODE_TAKEN` (with retryable:false); `500 PRECONDITION_FAILED`. Custom invalid-request hook now returns `422 INVALID_CODE` (was `400 INVALID_CODE`) and passes Zod issues in `details`.
    - `POST /apply`: success → `ok(c, { referrerUserId, benefit })`; `401 AUTH_REQUIRED`; `404 PROFILE_NOT_FOUND` / `CODE_NOT_FOUND`; **`409 SELF_REFERRAL`** (was 400) / `409 ALREADY_LINKED`; `422 INVALID_CODE` for invalid body (was 400); `500 PRECONDITION_FAILED`.
    - `GET /code`: success → `ok(c, { code: row?.code ?? null })`; `401 AUTH_REQUIRED`.
    - `GET /referrer`: success → `ok(c, { referrerUserId, referrerUsername, referrerCode, linkedAt })` with all-null empty-state; `401 AUTH_REQUIRED`; `500 PRECONDITION_FAILED`.
    - `GET /stats`: success → `ok(c, stats)` with zero-default fields; `401`; `500`.
    - `GET /referrals`: success → `ok(c, { items })`; `401`; `500`.
    - `GET /earnings`: success → `ok(c, { items, pagination })`; removed dead `INVALID_PARAMS` 400 branch (Zod `z.coerce.number().int().min(1).default(1)` guarantees non-NaN after validation, and the default 422 hook already covers invalid query params). `401`; `422`; `500`.
    - `POST /claim`: success → `ok(c, { claimId, amountLamports, status }, 202)` (preserves 202); `401`; `404 PROFILE_NOT_FOUND`; **`422 ZERO_BALANCE` / `422 BELOW_THRESHOLD`** (was 400); `500 PRECONDITION_FAILED`.
    - `GET /claim/:claimId`: success → `ok(c, {...})`; `401`; `404 CLAIM_NOT_FOUND` (both missing claim and wrong-owner cases); `500`.
  - All response schemas now use `envelope(SuccessSchema)` for 2xx and `ErrorEnvelopeSchema` for 4xx/5xx. Removed imports of `errorMessage`/`structuredErrorMessage`/`ErrorResponseSchema`/`StructuredErrorResponseSchema` from `api-errors.ts` and `validators.ts` (legacy helpers still live there for the cleanup iteration).
  - Inlined `EarningsResponseSchema` locally (was an inline `z.object(...)` in the route responses map).
  - Renamed `catch (err)` bindings to `catch (insertError|fetchError|claimError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/referral-routes.test.ts`:
    - All success assertions destructure `body.data`, assert `body.ok === true`.
    - `POST /code` invalid-format tests: status 400 → 422.
    - `POST /apply` self-referral test: status 400 → 409, renamed to "rejects self-referral with 409".
    - `POST /apply` empty code test: status 400 → 422, renamed to "rejects empty code with 422".
    - `POST /claim` zero-balance / below-threshold / double-claim tests: status 400 → 422.
    - `GET /claim/:claimId` 404 assertions now check `body.error.code === "CLAIM_NOT_FOUND"`.
  - Updated `backend/src/__tests__/waitlist-contract.test.ts` `arrayItemKeys` helper — now routes through `unwrapEnvelope` before descending into the array property, so envelope-wrapped list responses (now `GET /referrals`) match the waitlist contract.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/referral-routes.test.ts` → 29/29 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/waitlist-contract.test.ts` → 41/41 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 7 — 2026-04-22T09:56:24Z — OK
- **Log**: iteration-007.log

## Iteration 8 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/public-referral.ts` to envelope responses; update `public-referral-routes.test.ts`.
- **Changes**:
  - Rewrote both public-referral routes in `backend/src/routes/public-referral.ts`:
    - `GET /code/:code`: success → `ok(c, { exists })` (200); invalid-format input still returns `200 { ok: true, data: { exists: false } }` (probe-style, per FR-7); failure path now uses `err(c, 500, PRECONDITION_FAILED, ...)`.
    - `GET /:identifier`: success → `ok(c, { userId, username, referralCode })` with nullable `referralCode`; missing profile returns `err(c, 404, NOT_FOUND, "Profile not found")`; failure path uses `err(c, 500, PRECONDITION_FAILED, ...)`.
    - 200 responses now declare `envelope(SuccessSchema)`; 404/500 declare `ErrorEnvelopeSchema`. Removed imports of `errorMessage` (from `api-errors.ts`) and `ErrorResponseSchema` (from `validators.ts`) — legacy helpers still live there for the cleanup iteration.
    - Renamed `catch (err)` bindings to `catch (lookupError)` in both handlers to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/public-referral-routes.test.ts`:
    - Success assertions destructure `body.data` and assert `body.ok === true`.
    - 404 assertion now checks `body.error.code === "NOT_FOUND"` instead of the legacy `{ error: "NOT_FOUND" }` shape.
    - `/code/:code` equality assertions updated to the full envelope shape `{ ok: true, data: { exists } }`.
    - Dogpile passthrough test left unchanged (dogpile routes are converted in a later iteration).
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/public-referral-routes.test.ts` → 7/7 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/waitlist-contract.test.ts` → 41/41 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 8 — 2026-04-22T09:59:36Z — OK
- **Log**: iteration-008.log

## Iteration 9 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/profile.ts` to envelope responses; update `profile.test.ts` and `profile-me-zeroed.test.ts`.
- **Changes**:
  - Rewrote all four profile routes in `backend/src/routes/profile.ts`:
    - `GET /me`: success → `ok(c, { userId, username, ..., telegramLinked })`; `401 AUTH_REQUIRED`; `404 PROFILE_NOT_FOUND`; `500 PRECONDITION_FAILED`.
    - `PUT /username`: success → `ok(c, { username, nextEditAvailableAt })`; `401 AUTH_REQUIRED`; `404 PROFILE_NOT_FOUND`; `409 USERNAME_TAKEN` (retryable:false); **`429 USERNAME_COOLDOWN`** (retryable:true, `details.nextEditAvailableAt`) replaces the legacy `COOLDOWN_ACTIVE` payload; `422 INVALID_USERNAME` from the custom hook (with Zod issues in `details`); `500 PRECONDITION_FAILED`. Both pre-check and race-fallback cooldown paths now emit the same envelope shape.
    - `GET /transactions`: success → `ok(c, { transactions, nextCursor })`; `401 AUTH_REQUIRED`; **`422 INVALID_PARAMS`** (was 400) for the defensive `toDbGameId` fallback; `500 PRECONDITION_FAILED`.
    - `POST /confirm-tx`: success → `ok(c, { recorded: true })` (new inner schema `ConfirmTxSuccessSchema` replaces `OkResponseSchema`, which was returning the confusing nested `{ ok: true, data: { ok: true } }`); `401`; `404 PROFILE_NOT_FOUND`; **`422 INVALID_PARAMS`** (was 400) for the defensive `toDbGameId` fallback; **`422 VALIDATION_FAILED`** (was 400 "Missing or invalid fields") from the custom hook (with Zod issues in `details`); `500 PRECONDITION_FAILED`.
  - All 2xx response schemas now use `envelope(SuccessSchema)`; all 4xx/5xx use `ErrorEnvelopeSchema`. Removed imports of `errorMessage` (from `api-errors.ts`) and `ErrorResponseSchema` / `OkResponseSchema` / `UsernameCooldownResponseSchema` (from `validators.ts`) — legacy helpers still live there for the cleanup iteration.
  - Renamed `catch (err)` bindings to `catch (fetchError|updateError|queryError|insertError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/profile.test.ts`:
    - Success assertions now destructure `.data` from envelopes (challenge/verify, `/profile/me`, `PUT /username`, `/public-profile/:userId` still unwrapped since that route converts in a later iteration).
    - 409 USERNAME_TAKEN: asserts `body.ok === false` + `body.error.code === "USERNAME_TAKEN"`.
    - 429 cooldown: asserts envelope shape, `body.error.code === "USERNAME_COOLDOWN"`, `retryable: true`, and `details.nextEditAvailableAt` present.
    - Invalid-format username tests: status 400 → 422 (both "too short" and "missing body"); `body.error.code === "INVALID_USERNAME"`; `details` is the Zod issue array.
    - `POST /confirm-tx` missing body: status 400 → 422; `body.error.code === "VALIDATION_FAILED"`.
    - Renamed the two "returns 400 for ..." tests to "returns 422 for ..." to match the new behavior.
  - Updated `backend/src/__tests__/profile-me-zeroed.test.ts`: `toMatchObject` now wraps the expected shape in `{ ok: true, data: {...} }`.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/profile-me-zeroed.test.ts` → 1/1 passed
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/profile.test.ts` → 13/13 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 9 — 2026-04-22T10:05:51Z — OK
- **Log**: iteration-009.log

## Iteration 10 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/public-profile.ts` to envelope responses; update profile test coverage.
- **Changes**:
  - Rewrote `GET /{identifier}` in `backend/src/routes/public-profile.ts`:
    - Success → `ok(c, { userId, username, avatarUrl, heatMultiplier, stats, createdAt })`.
    - Missing profile → `err(c, 404, API_ERROR_CODES.NOT_FOUND, "Profile not found")`.
    - Lookup failure → `err(c, 500, API_ERROR_CODES.PRECONDITION_FAILED, "Failed to fetch profile")`.
    - Response schemas use `envelope(PublicPlayerProfileSchema)` for 200 and `ErrorEnvelopeSchema` for 404/500.
    - Removed imports of `errorMessage` (from `api-errors.ts`) and `ErrorResponseSchema` (from `validators.ts`) — legacy helpers still live there for the cleanup iteration.
    - Renamed `catch (err)` binding to `catch (lookupError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/profile.test.ts`:
    - `GET /public-profile/:username` success test: destructures `body.data` from envelope (`body.ok === true`).
    - `GET /public-profile/:user_id` success test: asserts envelope shape, accesses fields via `body.data.userId` / `body.data.username`.
    - `GET /public-profile/:identifier` 404 test: now asserts `body.ok === false` and `body.error.code === "NOT_FOUND"` (was `body.error === "NOT_FOUND"`).
    - The "no wallet field" test is text-based and continues to pass unchanged.
- **Verification**:
  - `pnpm typecheck:self` → exit 0
  - `pnpm lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/profile.test.ts` → 13/13 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/waitlist-contract.test.ts` → 41/41 passed
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 10 — 2026-04-22T10:09:13Z — OK
- **Log**: iteration-010.log

## Iteration 11 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/create.ts` (FlipYou public entry) to envelope responses; update endpoint-level FlipYou tests and the shared OpenAPI contract helper.
- **Changes**:
  - Rewrote all four FlipYou routes in `backend/src/routes/create.ts`:
    - `POST /create`: success → `ok(c, { transaction, matchPda, matchId, commitment, lastValidBlockHeight })`; `400 INVALID_REQUEST` for bad base58 wallet or non-pubkey wallet (preserves current HTTP status for malformed identifiers, per FR-11 "400 or 422" wording); `403 FORBIDDEN` for wallet/profile mismatch; `409 CONFLICT` for duplicate match PDA (both pre-insert and race-fallback paths, now retryable:true); `500 PRECONDITION_FAILED` for transaction-build failure. 422 declared for Zod-validation failures via the default hook.
    - `GET /history`: success → `ok(c, { rounds })`; no error responses needed (empty list is the documented success).
    - `GET /by-id/{matchId}`: success → `ok(c, round)`; `400 INVALID_REQUEST` for non-hex matchId; `404 MATCH_NOT_FOUND` for missing or wrong-game match.
    - `GET /verify/{pda}`: success → `ok(c, round)`; `404 MATCH_NOT_FOUND`.
  - All 2xx response schemas now use `envelope(SuccessSchema)`; all 4xx/5xx use `ErrorEnvelopeSchema`. Removed imports of `errorMessage` (from `api-errors.ts`) and `ErrorResponseSchema` (from `validators.ts`) — legacy helpers still live there for the cleanup iteration.
  - Renamed `catch (err)` bindings to `catch (buildError|insertError|entryError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/openapi-contract.test.ts`: added the same `unwrapEnvelope` helper used in the waitlist contract test, and rerouted `getJsonResponseSchema` through it so schema-descent checks see the inner `data` payload. Required because the `/flip-you/verify/{pda}` 200 body is now an envelope `oneOf`; the existing `resolveSchema` only unwrapped `allOf` / `anyOf`.
  - Updated `backend/src/__tests__/endpoints.test.ts` FlipYou suites:
    - `POST /flipyou/create` 200 test: destructures `body.data`, asserts `body.ok === true`; commitment length check moved onto `data.commitment`.
    - `POST /flipyou/create` 401 tests (missing / expired JWT): assert `body.ok === false` and `body.error.code === "AUTH_REQUIRED"`.
    - `POST /flipyou/create` 403 test: asserts `body.error.code === "FORBIDDEN"`.
    - `POST /flipyou/create` 409 collision test: asserts envelope shape, `error.code === "CONFLICT"`, preserved human-readable message.
    - Both rate-limit tests: assert `body.error.code === "RATE_LIMITED"`.
    - `GET /flipyou/verify/:pda` and `/by-id/:matchId` success tests: destructure `body.data`.
    - `GET /flipyou/by-id/:matchId` 404 test: asserts `error.code === "MATCH_NOT_FOUND"`.
    - `GET /flipyou/history`: asserts envelope `body.data.rounds === []`.
    - `POST /pot-shot/create` + verify/by-id for pot-shot left unchanged (pot-shot routes convert in iteration 12).
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts` → 8/8 passed
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/endpoints.test.ts` → 14/14 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/waitlist-contract.test.ts` → 41/41 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 11 — 2026-04-22T10:18:22Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/potshot-create.ts` (Pot Shot public entry) to envelope responses; update endpoint-level Pot Shot tests.
- **Changes**:
  - Rewrote all five Pot Shot routes in `backend/src/routes/potshot-create.ts`:
    - `GET /current`: success → `ok(c, { round })` with `round: T | null`. All four branches (no active DB round, on-chain-enriched, DB-only fallback, exception) now emit the envelope. 200 schema uses `envelope(roundEnvelopeResponseSchema("round", PotShotRoundSchema, { nullable: true }))`. Per FR-7, the exception-fallback path keeps `200 { round: null }` as documented success.
    - `POST /create`: success → `ok(c, { transaction, roundPda, matchId, commitment, lastValidBlockHeight })`; `400 INVALID_REQUEST` for bad base58 wallet and non-pubkey wallet; `403 FORBIDDEN` for wallet/profile mismatch; **`409 CONFLICT` for already-active round** (preserved `activeRound: { matchId, pda }` under `details.activeRound`, `retryable: false`); `409 CONFLICT` for PDA collision and duplicate-insert race (both `retryable: true`); `500 PRECONDITION_FAILED` for transaction build failure. `422` declared for default-hook validation failures.
    - `GET /history`: success → `ok(c, { rounds })`; no error responses (empty list is the documented success).
    - `GET /by-id/{matchId}`: success → `ok(c, round)`; `400 INVALID_REQUEST` for non-hex matchId; **`404 ROUND_NOT_FOUND`** (using the round-specific catalog code, unlike FlipYou which uses `MATCH_NOT_FOUND`) for missing or wrong-game round.
    - `GET /verify/{pda}`: success → `ok(c, round)`; `404 ROUND_NOT_FOUND`.
  - All 2xx response schemas now use `envelope(SuccessSchema)`; all 4xx/5xx use `ErrorEnvelopeSchema`. Removed the legacy `PotShotCreateConflictResponseSchema` union (the `activeRound` payload now lives inside `error.details`) and dropped imports of `errorMessage` (from `api-errors.ts`) and `ErrorResponseSchema` (from `validators.ts`) — legacy helpers still live there for the cleanup iteration.
  - Renamed `catch (err)` bindings to `catch (fetchError|queryError|buildError|insertError|entryError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/endpoints.test.ts`:
    - `POST /pot-shot/create` 200 test: destructures `body.data`, asserts `body.ok === true`; all field checks now probe `data.*`.
    - The `GET /flipyou/verify/:pda` "returns 404 for a PotShot PDA" test: destructures `body.data` from the pot-shot create envelope before reading `data.roundPda`.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 49/49 passed
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/endpoints.test.ts` → 14/14 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 12 — 2026-04-22T10:23:53Z — OK
- **Log**: iteration-012.log

## Iteration 13 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/closecall.ts` (Close Call public entry) to envelope responses; update endpoint-level Close Call tests.
- **Changes**:
  - Rewrote all five Close Call routes in `backend/src/routes/closecall.ts`:
    - `GET /current-round`: success → `ok(c, { round })` with `round: T | null`. All three branches (current-minute PDA, previous-minute open PDA, empty) use the envelope. Exception-fallback keeps `200 { round: null }` as documented success. 200 schema uses `envelope(roundEnvelopeResponseSchema("round", CloseCallRoundSchema, { nullable: true }))`.
    - `GET /history`: success → `ok(c, { rounds })`; no error responses (empty list is documented success).
    - `GET /by-id/{roundId}`: success → `ok(c, response)`; `400 INVALID_REQUEST` for non-numeric roundId (retryable:false); **`404 ROUND_NOT_FOUND`** for missing round (mirroring Pot Shot's use of the round-specific catalog code).
    - `GET /candles`: success → `ok(c, { candles, currentOpenPrice, currentMinuteTs })`; exception-fallback preserves empty-state `200` envelope (documented success). Inlined the candles response schema as `CloseCallCandlesResponseSchema`.
    - `POST /bet`: success → `ok(c, { transaction, minuteTs, roundPda })`; `400 INVALID_REQUEST` for bad base58 / non-pubkey wallet; `401 AUTH_REQUIRED` for defense-in-depth missing userId; `403 FORBIDDEN` for wallet/profile mismatch; `404 PROFILE_NOT_FOUND` for missing profile; **`503 PRICE_UNAVAILABLE`** (retryable:true) for missing boundary price; `500 PRECONDITION_FAILED` for tx-build failure. `422` declared for default-hook validation failures (amount bounds, shape).
  - All 2xx response schemas now use `envelope(SuccessSchema)`; all 4xx/5xx use `ErrorEnvelopeSchema`. Removed the `ErrorResponseSchema` import from `validators.ts`. Dropped `decodeCloseCallRound` / boundary-price / etc. unchanged.
  - Renamed `catch (err)` bindings to `catch (fetchError|queryError|buildError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/closecall-routes.test.ts`:
    - 403 wallet-mismatch test: now asserts `body.ok === false`, `body.error.code === "FORBIDDEN"`, and preserves the original human-readable message.
    - 404 missing-profile test: now asserts `body.error.code === "PROFILE_NOT_FOUND"` and the preserved message.
  - `backend/src/__tests__/openapi-contract.test.ts` already uses the shared `unwrapEnvelope` helper from iteration 11, so the `/closecall/by-id/{roundId}` 200-schema descent keeps working automatically.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/closecall-routes.test.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 51/51 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 13 — 2026-04-22T10:28:25Z — OK
- **Log**: iteration-013.log

## Iteration 14 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/challenges.ts` to envelope responses; update `challenge-routes.test.ts`.
- **Changes**:
  - Rewrote both challenge routes in `backend/src/routes/challenges.ts`:
    - `GET /mine`: success → `ok(c, { daily, weekly, onboarding })`; `401 AUTH_REQUIRED` for missing userId; `500 PRECONDITION_FAILED` for unexpected DB errors. Empty challenges/bonus/onboarding defaults (e.g., `onboarding: null` when all steps are completed) remain `200` envelopes per FR-7.
    - `GET /mine/history`: success → `ok(c, { items, nextCursor })`; `401 AUTH_REQUIRED`; `500 PRECONDITION_FAILED`. Empty history returns `200 { ok: true, data: { items: [], nextCursor: null } }`.
  - Both 2xx response schemas now use `envelope(SuccessSchema)`; 4xx/5xx use `ErrorEnvelopeSchema`. Dropped the `ErrorResponseSchema` import from `validators.ts` (legacy schema still lives there for the cleanup iteration).
  - Renamed `catch (err)` bindings to `catch (fetchError|queryError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/challenge-routes.test.ts`:
    - All four success assertions (two `/mine` tests, two `/mine/history` tests) now assert `body.ok === true` and destructure `body.data`.
    - The "expired assignments are marked expired on read" test continues to assert only DB state (no body inspection), so it works unchanged.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/challenge-routes.test.ts` → 5/5 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 49/49 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 14 — 2026-04-22T10:31:41Z — OK
- **Log**: iteration-014.log

## Iteration 15 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/points.ts` to envelope responses; update `points-and-crates-routes.test.ts`.
- **Changes**:
  - Rewrote all three routes in `backend/src/routes/points.ts`:
    - `GET /points/mine`: success → `ok(c, { balance, lifetimeEarned })`. Empty ledger row → `200 { ok: true, data: { balance: 0, lifetimeEarned: 0 } }` (FR-7 documented empty-state success). `401 AUTH_REQUIRED`; `500 PRECONDITION_FAILED`.
    - `GET /points/mine/history`: success → `ok(c, { items, nextCursor })`. Empty results → `200 { ok: true, data: { items: [], nextCursor: null } }`. `401 AUTH_REQUIRED`; `500 PRECONDITION_FAILED`.
    - `GET /crates/mine`: success → `ok(c, { items, nextCursor })`. Empty results → `200` envelope. `401 AUTH_REQUIRED`; `500 PRECONDITION_FAILED`.
  - All 2xx schemas now use `envelope(SuccessSchema)`; all 4xx/5xx use `ErrorEnvelopeSchema`. Dropped `ErrorResponseSchema` import from `validators.ts` (legacy schema still lives there for the cleanup iteration).
  - Renamed `catch (err)` bindings to `catch (fetchError|queryError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/points-and-crates-routes.test.ts`: all six success assertions now assert `body.ok === true` and destructure `body.data`. Cursor chaining (points history + crates history) updated to read `body1.data.nextCursor` instead of `body1.nextCursor`.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/points-and-crates-routes.test.ts` → 6/6 passed
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 49/49 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 15 — 2026-04-22T10:35:17Z — OK
- **Log**: iteration-015.log

## Iteration 16 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/dogpile.ts` to envelope responses; update `dogpile-public-routes.test.ts` and the dogpile passthrough test in `public-referral-routes.test.ts`.
- **Changes**:
  - Rewrote both dogpile routes in `backend/src/routes/dogpile.ts`:
    - `GET /current`: success → `ok(c, <event-or-null>)`. All three branches (active, scheduled, empty) now emit the envelope. Empty case returns `200 { ok: true, data: null }` per FR-7 (documented success with null payload). 200 schema uses `envelope(DogpileCurrentResponseSchema)` — the inner schema is already `.nullable()`, so `data: <event | null>` falls out naturally without a wrapping object. `500 PRECONDITION_FAILED` for DB failures.
    - `GET /schedule`: success → `ok(c, { items })` with empty array being documented success. `500 PRECONDITION_FAILED` for DB failures.
  - Both 2xx schemas now use `envelope(SuccessSchema)`; all 5xx use `ErrorEnvelopeSchema`. Dropped the `errorMessage` import from `api-errors.ts` and the `ErrorResponseSchema` import from `validators.ts` (legacy helpers still live there for the cleanup iteration).
  - Renamed `catch (err)` bindings to `catch (queryError)` to avoid shadowing the imported `err` helper.
  - Updated `backend/src/__tests__/dogpile-public-routes.test.ts`: all five tests now assert `body.ok === true` and destructure `body.data` (including the null-return case: `body.data === null`).
  - Updated `backend/src/__tests__/public-referral-routes.test.ts` — the "GET /dogpile/current remains public" passthrough test now asserts envelope shape and reads fields via `body.data.*`.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/dogpile-public-routes.test.ts src/__tests__/public-referral-routes.test.ts` → 12/12 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 16 — 2026-04-22T10:38:47Z — OK
- **Log**: iteration-016.log

## Iteration 17 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/leaderboard.ts` to envelope responses; confirm `leaderboard.test.ts` coverage.
- **Changes**:
  - Rewrote `GET /weekly` in `backend/src/routes/leaderboard.ts`:
    - Success → `ok(c, { game, weekStart, weekEnd, entries })`. Response schema now uses `envelope(LeaderboardResponseSchema)`.
    - Defensive `toDbGameId` fallback (unreachable behind the `PublicGameIdSchema` Zod enum) → `422 INVALID_PARAMS` envelope, matching the pattern established for `profile.ts` in iteration 9.
    - Query failure → `err(c, 500, PRECONDITION_FAILED, "Failed to fetch leaderboard")` with `ErrorEnvelopeSchema`.
    - Removed legacy `errorMessage` and `ErrorResponseSchema` imports (legacy helpers still live there for the cleanup iteration).
    - Renamed `catch (err)` binding to `catch (queryError)` to avoid shadowing the imported `err` helper.
  - `backend/src/__tests__/leaderboard.test.ts` already asserts envelope shape on the `422 VALIDATION_FAILED` route-validation test (added in iteration 3). All other tests exercise `db.getWeeklyLeaderboard` directly (no HTTP body assertions), so no further test changes were needed.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/leaderboard.test.ts` → 8/8 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 17 — 2026-04-22T10:42:29Z — OK
- **Log**: iteration-017.log

## Iteration 18 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/price.ts` to envelope responses.
- **Changes**:
  - Rewrote `GET /sol-usd` in `backend/src/routes/price.ts`:
    - Success → `ok(c, { price, updatedAt })`. 200 response schema now uses `envelope(PriceResponseSchema)`.
    - Price unavailable → `err(c, 503, API_ERROR_CODES.PRICE_UNAVAILABLE, "Price unavailable", { retryable: true })`. 503 response schema now uses `ErrorEnvelopeSchema`.
    - Removed the `errorMessage` import (from `api-errors.ts`) and the `ErrorResponseSchema` import (from `validators.ts`); legacy helpers still live there for the cleanup iteration.
    - Renamed the `catch (err)` binding in `fetchSolPrice` to `catch (fetchError)` to avoid shadowing the imported `err` helper (even though the current module doesn't yet use it inside that catch, this keeps the file consistent with the other converted routes).
  - No dedicated `price-routes.test.ts` exists; the `/price/sol-usd` endpoint is covered by `openapi-contract.test.ts` which asserts it remains mounted as a public (no-security) route. That assertion still passes against the new envelope schema since `resolveSchema`/`unwrapEnvelope` already handles the `envelope(...)` 200 body.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 49/49 passed
  - (Full unit suite re-run attempted but shell became unresponsive mid-session with exit 127 for all commands, including `echo`. The targeted checks above covered the affected surface and the price route has no dedicated test file.)

## Iteration 18 — 2026-04-22T10:45:00Z — OK
- **Log**: iteration-018.log

## Iteration 18 — 2026-04-22T10:45:57Z — OK
- **Log**: iteration-018.log

## Iteration 19 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/health.ts` to envelope responses.
- **Changes**:
  - Rewrote `GET /` in `backend/src/routes/health.ts`:
    - Success → `ok(c, { status: "ok", version: "0.1.0", workerRunning: isWorkerRunning() })`. 200 response schema now uses `envelope(HealthResponseSchema)`.
    - No error paths — health is a cheap process-local probe with no failure modes.
  - Updated `backend/src/__tests__/endpoints.test.ts` `GET /health` test:
    - Success assertion now asserts `body.ok === true` and destructures `body.data.status` / `body.data.version` / `body.data.workerRunning`.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` → 49/49 passed
  - Targeted: `vitest run --config vitest.integration.config.ts src/__tests__/endpoints.test.ts` → 14/14 passed

## Iteration 19 — 2026-04-22T10:48:19Z — OK
- **Log**: iteration-019.log

## Iteration 20 — 2026-04-22 — DONE
- **Item**: [routes] Convert `backend/src/routes/telegram-link.ts` — `POST /generate-link` to envelope responses; service-auth webhook routes stay out of scope.
- **Changes**:
  - Rewrote `POST /generate-link` in `backend/src/routes/telegram-link.ts`:
    - Missing userId → `err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required")` (defense-in-depth; JWT middleware is applied upstream in `index.ts` / `index-waitlist.ts`).
    - Already-linked branch → `ok(c, { alreadyLinked: true, telegramUserId, telegramUsername, linkedAt, botUrl, communityUrl })`.
    - New-token branch → `ok(c, { token, deepLink, expiresAt, botUrl, communityUrl })`.
    - Exception path → `err(c, 500, API_ERROR_CODES.PRECONDITION_FAILED, "Failed to generate link token")`.
    - Renamed the `catch (err)` binding to `catch (generateError)` to avoid shadowing the imported `err` helper.
  - Service-auth routes (`POST /redeem-link`, `GET /linked-user`, `GET /referral-info`, `GET /referral-leaderboard`, and the inline `serviceAuth` middleware) left untouched per the checklist note — Telegram webhook routes are explicitly out of scope.
  - Updated `backend/src/__tests__/waitlist-contract.test.ts`:
    - Both `POST /telegram/generate-link` branches now assert `body.ok === true` and extract `body.data` before comparing keys against `TELEGRAM_GENERATE_LINK_CONTRACT.{newTokenResponse,alreadyLinkedResponse}`.
    - The already-linked assertion now reads `data.alreadyLinked === true` (was `body.alreadyLinked`).
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/waitlist-contract.test.ts` → 41/41 passed
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 20 — 2026-04-22T10:51:17Z — OK
- **Log**: iteration-020.log

## Iteration 21 — 2026-04-22 — DONE
- **Item**: [contracts] Delete legacy helpers from `api-errors.ts` and `validators.ts`.
- **Changes**:
  - Deleted from `backend/src/contracts/api-errors.ts`: `ErrorResponseBody` interface, `StructuredErrorDetail` interface, `StructuredErrorResponseBody` interface, `errorMessage()` function, `structuredErrorMessage()` function, and the accompanying "Legacy helpers" comment block.
  - Deleted from `backend/src/contracts/validators.ts`: `ErrorResponseSchema`, `StructuredErrorDetailSchema`, `StructuredErrorResponseSchema`.
  - Pre-deletion grep (`backend/src/**`) confirmed zero remaining import sites for any of the eight symbols — only the definitions themselves still referenced them. All public routes were migrated to the envelope helpers (`ok` / `err` / `envelope` / `ErrorEnvelopeSchema`) during iterations 4–20, so this is a clean cutover.
  - `OkResponseSchema` and `UsernameCooldownResponseSchema` kept in `validators.ts` — not on the deletion list for this iteration and still part of the validators namespace.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Full unit suite (`pnpm vitest run --config vitest.unit.config.ts`) → 214/214 passed across 20 files

## Iteration 21 — 2026-04-22T10:53:37Z — OK
- **Log**: iteration-021.log

## Iteration 22 — 2026-04-22 — DONE
- **Item**: [test] Extend `backend/src/__tests__/openapi-contract.test.ts` to scan every declared public JSON response in the generated OpenAPI doc and assert envelope shape for 2xx and error-envelope shape for 4xx/5xx, plus exactly-once registration of `ApiError` and `ErrorEnvelope` components.
- **Changes**:
  - Registered `ApiErrorSchema` as the `ApiError` OpenAPI component and `ErrorEnvelopeSchema` as the `ErrorEnvelope` OpenAPI component in `backend/src/contracts/api-envelope.ts` by switching the `zod` import to `@hono/zod-openapi`'s augmented `z` and adding `.openapi("ApiError")` / `.openapi("ErrorEnvelope")` chain calls. Every 4xx/5xx inline `ErrorEnvelopeSchema` reference now serializes as `{ $ref: "#/components/schemas/ErrorEnvelope" }` with `ApiError` referenced in turn, so the error envelope is defined once and reused across the spec.
  - Extended `backend/src/__tests__/openapi-contract.test.ts` `buildSpecApp()` to mount every OpenAPI-backed public route factory (auth, referral, public-profile, public-referral, challenges, points, crates, dogpile) in addition to the existing health/price/leaderboard/profile/flip-you/pot-shot/closecall set, so the spec scan covers the full declared public surface. Admin and internal routes remain excluded (plain Hono with no OpenAPI schemas).
  - Added three new tests:
    - "every 2xx JSON body uses the success envelope shape" — iterates every `application/json` response with a 2xx status and asserts the schema is a `oneOf` containing a success variant (`{ok: {enum:[true]}, data}`) and an error variant (`{ok: {enum:[false]}, error}` or a `$ref` to `#/components/schemas/ErrorEnvelope`).
    - "every 4xx/5xx JSON body uses the error envelope shape" — accepts either a direct `$ref` to `#/components/schemas/ErrorEnvelope` or an inline error envelope shape.
    - "ApiError and ErrorEnvelope appear exactly once in components.schemas" — asserts both components are registered and checks the expected structural fields (`code`, `message`, `ok`, `error`).
  - Added helpers `isErrorEnvelope`, `isSuccessEnvelopeVariant`, `isEnvelopeSchema`, and `iterPublicJsonResponses` inside the existing `describe` block.
- **Verification**:
  - `pnpm -C backend typecheck:self` → exit 0
  - `pnpm -C backend lint:self` → exit 0
  - Targeted: `vitest run --config vitest.unit.config.ts src/__tests__/openapi-contract.test.ts` → 11/11 passed (8 prior + 3 new)
  - Full unit suite (`vitest run --config vitest.unit.config.ts`) → 217/217 passed across 20 files (+3 vs baseline 214)

## Iteration 22 — 2026-04-22T11:02:49Z — OK
- **Log**: iteration-022.log

