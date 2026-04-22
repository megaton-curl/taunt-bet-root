# Gap Analysis: 304 — Response Envelope + Semantic HTTP Contract

- **Date**: 2026-04-22
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### Envelope Primitives & Helpers
| Symbol | File | Line |
|--------|------|------|
| `ApiEnvelopeSuccess<T>` | `backend/src/contracts/api-envelope.ts` | 34 |
| `ApiEnvelopeError` | `backend/src/contracts/api-envelope.ts` | 39 |
| `ApiEnvelope<T>` | `backend/src/contracts/api-envelope.ts` | 44 |
| `ApiError` interface | `backend/src/contracts/api-envelope.ts` | 27 |
| `ApiErrorSchema` (zod, `.openapi("ApiError")`) | `backend/src/contracts/api-envelope.ts` | 46 |
| `ErrorEnvelopeSchema` (zod, `.openapi("ErrorEnvelope")`) | `backend/src/contracts/api-envelope.ts` | 55 |
| `envelope(dataSchema)` | `backend/src/contracts/api-envelope.ts` | 62 |
| `ok(c, data, status?)` (overloads) | `backend/src/contracts/api-envelope.ts` | 76–88 |
| `err(c, status, code, message, opts?)` | `backend/src/contracts/api-envelope.ts` | 90 |
| `SuccessStatus`, `ErrorStatus` type unions | `backend/src/contracts/api-envelope.ts` | 72–73 |

### Error Catalog
| Symbol | File | Line |
|--------|------|------|
| `API_ERROR_CODES` catalog (34 codes) | `backend/src/contracts/api-errors.ts` | 10 |
| `ApiErrorCode` type | `backend/src/contracts/api-errors.ts` | 53 |

### OpenAPI Hook
| Symbol | File | Line |
|--------|------|------|
| `invalidRequestHook` (422 `VALIDATION_FAILED`) | `backend/src/openapi/hono.ts` | 11 |
| `createOpenApiApp` wiring `defaultHook` | `backend/src/openapi/hono.ts` | 22 |

### Middleware
| File | Status |
|------|--------|
| `backend/src/middleware/jwt-auth.ts` | `401 AUTH_REQUIRED` envelope at 3 call sites |
| `backend/src/middleware/rate-limit.ts` | `429 RATE_LIMITED` envelope with `retryAfterMs` details |

### Public Routes (converted, in scope)
| Route file | Helpers | Notes |
|------------|---------|-------|
| `backend/src/routes/auth.ts` | `ok`/`err` | `POST /challenge`/`/verify`/`/refresh` → envelope; `POST /logout` stays `204` |
| `backend/src/routes/referral.ts` | `ok`/`err` | 9 endpoints; `POST /claim` preserves `202`; `/code`, `/referrer` use nullable empty-state |
| `backend/src/routes/public-referral.ts` | `ok`/`err` | `/code/:code` probe returns `200 { exists }`; `/:identifier` `200` or `404 NOT_FOUND` |
| `backend/src/routes/profile.ts` | `ok`/`err` | `/me`, `/username` (409/429/422), `/transactions`, `/confirm-tx` |
| `backend/src/routes/public-profile.ts` | `ok`/`err` | `/:userId` `200` or `404 NOT_FOUND` |
| `backend/src/routes/create.ts` | `ok`/`err` | FlipYou `/create`, `/history`, `/by-id`, `/verify` |
| `backend/src/routes/potshot-create.ts` | `ok`/`err` | 5 endpoints; `/create` returns 409 w/ `activeRound` under `details` |
| `backend/src/routes/closecall.ts` | `ok`/`err` | 5 endpoints incl. `POST /bet` → `503 PRICE_UNAVAILABLE` |
| `backend/src/routes/challenges.ts` | `ok`/`err` | `/mine`, `/mine/history` |
| `backend/src/routes/points.ts` | `ok`/`err` | `/mine` may return zero-default row |
| `backend/src/routes/dogpile.ts` | `ok`/`err` | `/current` nullable, `/schedule` `{ items }` |
| `backend/src/routes/leaderboard.ts` | `ok`/`err` | `/weekly` success envelope |
| `backend/src/routes/price.ts` | `ok`/`err` | `/sol-usd` → `200` or `503 PRICE_UNAVAILABLE` |
| `backend/src/routes/health.ts` | `ok` | `{ status, version, workerRunning }` |
| `backend/src/routes/telegram-link.ts` | `ok`/`err` | `POST /generate-link` + 4 service-auth routes converted in iteration 24 |

### Legacy Helper Cleanup
| Symbol | Status |
|--------|--------|
| `errorMessage` | Deleted (iteration 21) |
| `structuredErrorMessage` | Deleted |
| `ErrorResponseBody` / `StructuredErrorResponseBody` / `StructuredErrorDetail` | Deleted |
| `ErrorResponseSchema` / `StructuredErrorResponseSchema` / `StructuredErrorDetailSchema` | Deleted (`backend/src/contracts/validators.ts` — no matches) |
| `OkResponseSchema` / `UsernameCooldownResponseSchema` | Retained (not on deletion list, still in `validators.ts:45,68`) |
| Grep of `backend/src` for legacy helper names | Only hits are a local `const errorMessage` inside `backend/src/queue/worker.ts:104` (unrelated) |

### Telegram Client
| Symbol | File | Line |
|--------|------|------|
| `ApiEnvelope<T>` internal types | `telegram/src/backend-client.ts` | 30–45 |
| `isEnvelope` / `parseEnvelope` | `telegram/src/backend-client.ts` | 47, 89 |
| Error-code mapping (`TELEGRAM_ALREADY_LINKED`, `TELEGRAM_TOKEN_EXPIRED`, `AUTH_REQUIRED`) | `telegram/src/backend-client.ts` | 165–174 |

### Tests
| Test | Type | File |
|------|------|------|
| Envelope helper unit tests (26) | unit | `backend/src/__tests__/api-envelope.test.ts` |
| Catalog sanity (5) | unit | `backend/src/__tests__/api-errors.test.ts` |
| OpenAPI 422 hook behaviour (4) | unit | `backend/src/__tests__/openapi-invalid-request-hook.test.ts` |
| Middleware envelope shape | unit | `backend/src/__tests__/rate-limit.test.ts`, `auth.test.ts` |
| OpenAPI contract (2xx envelope / 4xx-5xx error envelope / `ApiError` & `ErrorEnvelope` components) | unit | `backend/src/__tests__/openapi-contract.test.ts` |
| Waitlist contract (success status declared + error envelope on 4xx/5xx + telegram 500 failure case) | unit | `backend/src/__tests__/waitlist-contract.test.ts` |
| Route-level assertions (envelope + status) | unit/integration | `auth-routes.test.ts`, `referral-routes.test.ts`, `public-referral-routes.test.ts`, `profile.test.ts`, `profile-me-zeroed.test.ts`, `closecall-routes.test.ts`, `challenge-routes.test.ts`, `points-and-crates-routes.test.ts`, `dogpile-public-routes.test.ts`, `leaderboard.test.ts`, `endpoints.test.ts`, `integration-settlement.test.ts` |
| Telegram backend-client envelope parsing (16) | unit | `telegram/src/__tests__/backend-client.test.ts` |

## Acceptance Criteria Audit

### FR-1: Envelope primitives and helpers
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `ok(c, data)` returns `200 { ok: true, data }` | SATISFIED | `api-envelope.ts:76-88`; `api-envelope.test.ts:19` ("returns 200 { ok: true, data } by default") |
| 2 | `ok(c, data, 201\|202)` preserves status | SATISFIED | `api-envelope.test.ts:29,39` |
| 3 | `err(c, status, code, message, opts?)` returns `{ ok: false, error }` with supplied status | SATISFIED | `api-envelope.ts:90-102`; tested for 400/401/403/404/409/422/429/500/503 |
| 4 | `envelope(schema)` produces discriminated union on `ok` | SATISFIED | `api-envelope.ts:62-70` (`z.discriminatedUnion("ok", ...)`) |
| 5 | Unit tests cover success + error serialization + round-trips | SATISFIED | 26 tests in `api-envelope.test.ts` |

### FR-2: Centralized error-code catalog
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Public routes no longer inline ad hoc `code` strings | SATISFIED | Every `err(...)` call cites `API_ERROR_CODES.*` (grep all 15 public routes); only non-catalog string is legacy JSON legacy variable in `queue/worker.ts` which is unrelated |
| 2 | `ApiError.code` typed as `ApiErrorCode` | SATISFIED | `api-envelope.ts:28`; `api-errors.ts:53` derives union from `API_ERROR_CODES` |
| 3 | Legacy `errorMessage()` / `structuredErrorMessage()` removed after route conversion | SATISFIED | Iteration 21 cleanup; grep in `backend/src` finds only unrelated local variable |

### FR-3: Validation hook emits 422 error envelope
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | OpenAPI/Zod parse failures return `422` | SATISFIED | `openapi/hono.ts:16` returns `err(c, 422, ...)`; tested in `openapi-invalid-request-hook.test.ts` |
| 2 | Body is `{ ok: false, error: { code: "VALIDATION_FAILED", details } }` | SATISFIED | Hook passes `API_ERROR_CODES.VALIDATION_FAILED` + `retryable:false` + `details:issues` |
| 3 | `details` contains Zod issue list | SATISFIED | `openapi/hono.ts:18`; asserted in hook test ("Zod issue list includes all failing paths") |

### FR-4: OpenAPI describes real status codes + shared envelopes
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 200/201/202 JSON responses use `envelope(SuccessSchema)` | SATISFIED | `openapi-contract.test.ts:422` "every 2xx JSON body uses the success envelope shape" passes across all mounted public routes |
| 2 | 400/401/403/404/409/422/429 JSON responses use `ErrorEnvelopeSchema` | SATISFIED | `openapi-contract.test.ts:438` covers 4xx/5xx |
| 3 | Generated OpenAPI contains reusable `ApiError` and `ErrorEnvelope` components exactly once | SATISFIED | `api-envelope.ts:53,60` registers via `.openapi("ApiError")` / `.openapi("ErrorEnvelope")`; `openapi-contract.test.ts:458` asserts both appear in `components.schemas` |
| 4 | No converted route declares bare `{ error: string }` JSON schema | SATISFIED | Legacy `ErrorResponseSchema` deleted; contract scan passes |

### FR-5: Auth and permission keep 401 / 403
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Missing/invalid/expired token returns `401 { ok: false, error }` | SATISFIED | `jwt-auth.ts:36,54,70` — three call sites use `err(c, 401, AUTH_REQUIRED, ...)`; `auth.test.ts` asserts envelope shape |
| 2 | Wallet mismatch / forbidden returns `403 { ok: false, error }` | SATISFIED | `closecall.ts:561`, `create.ts` (FlipYou `/create` 403), `potshot-create.ts:338` use `err(c, 403, FORBIDDEN, ...)` |
| 3 | Clients may still branch on status for auth flows | SATISFIED | Middleware returns real `401`/`403` via `err(c, 401, ...)`; status preserved in `c.json(body, status)` (`api-envelope.ts:101`) |

### FR-6: Rate limits and cooldowns keep 429
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `rate-limit.ts` returns `429 { ok: false, error: { code: "RATE_LIMITED", ... } }` | SATISFIED | `rate-limit.ts:68,113` use `err(c, 429, RATE_LIMITED, ..., { retryable: true, details: { retryAfterMs } })` |
| 2 | Username cooldown in `/profile/username` remains `429` | SATISFIED | `profile.ts:201,245` emit `429 USERNAME_COOLDOWN` at both pre-check and race-fallback paths |
| 3 | Existing tests assert both status and envelope shape | SATISFIED | `rate-limit.test.ts:32-48` asserts full envelope body; `profile.test.ts` asserts 429 USERNAME_COOLDOWN shape |

### FR-7: Normal empty-state reads stay 200
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `GET /referral/code` returns `200 { ok: true, data: { code: string \| null } }` | SATISFIED | `referral.ts:360` — `ok(c, { code: row?.code ?? null })` |
| 2 | `GET /referral/referrer` returns `200` with all-null fields when no referrer linked | SATISFIED | `referral.ts:398-404` — null across `referrerUserId/Username/Code/linkedAt` |
| 3 | `GET /points/mine` may return `200` zero values when no row exists | SATISFIED | `points.ts:161` — `ok(c, { balance: 0, lifetimeEarned: 0 })` |
| 4 | `GET /public-referral/code/:code` returns probe-style `200 { exists: boolean }` | SATISFIED | `public-referral.ts:65,71` — invalid format returns `200 { exists: false }`, valid returns `200 { exists }` |

### FR-8: Convert /auth/*
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `POST /auth/challenge` returns `200` success envelope | SATISFIED | `auth.ts:251` uses `ok(c, { nonce, message, expiresAt })` |
| 2 | `POST /auth/verify` returns `200` envelope or `401` error envelope for `INVALID_SIGNATURE` / `CHALLENGE_EXPIRED` | SATISFIED | `auth.ts:378` + 401 paths with `INVALID_SIGNATURE` / `CHALLENGE_EXPIRED`; `auth-routes.test.ts` asserts |
| 3 | `POST /auth/refresh` returns `200` envelope or `401 REFRESH_TOKEN_INVALID` | SATISFIED | `auth.ts:466` + three 401 paths all use `REFRESH_TOKEN_INVALID` |
| 4 | `POST /auth/logout` remains `204 No Content` | SATISFIED | `auth.ts:479,489` — `c.body(null, 204)`; schema declares 204 response |

### FR-9: Convert /referral/*
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `POST /referral/code`: 200 success, 409 `CODE_ALREADY_SET`/`CODE_TAKEN`, 422 for invalid code format | SATISFIED | `referral.ts:125,137,149` + 422 via custom hook (INVALID_CODE) |
| 2 | `GET /referral/code`: 200 success with nullable code | SATISFIED | `referral.ts:360` |
| 3 | `POST /referral/apply`: 200, 404 `CODE_NOT_FOUND`, 409 `SELF_REFERRAL`/`ALREADY_LINKED`, 422 invalid format | SATISFIED | `referral.ts:246,257,269,290,299` |
| 4 | `GET /referral/referrer`, `/stats`, `/referrals`, `/earnings` return success envelopes at 200 | SATISFIED | `referral.ts:398,412,466,532,603` |
| 5 | `POST /referral/claim`: 202 success, 422 `ZERO_BALANCE`/`BELOW_THRESHOLD` | SATISFIED | `referral.ts:741,683,693` — claim preserves 202; 422 zero/below-threshold |
| 6 | `GET /referral/claim/:claimId`: 200 success or 404 `CLAIM_NOT_FOUND` | SATISFIED | `referral.ts:829,811,821` |

### FR-10: Convert /profile/*, /public-profile/*, /public-referral/*
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `GET /profile/me`: 200 or 404 `PROFILE_NOT_FOUND` | SATISFIED | `profile.ts:77` returns 404 `PROFILE_NOT_FOUND`; success via `ok(c, {...})` |
| 2 | `PUT /profile/username`: 200, 409 `USERNAME_TAKEN`, 429 `USERNAME_COOLDOWN`, 422 `INVALID_USERNAME` | SATISFIED | `profile.ts:234,199-204,245-251,273`; custom hook emits 422 `INVALID_USERNAME` |
| 3 | `GET /profile/transactions`: 200, 422 for invalid filters | SATISFIED | `profile.ts` uses `422 INVALID_PARAMS` for defensive fallback; default hook catches invalid Zod |
| 4 | `POST /profile/confirm-tx`: 200, 404 when profile missing, 422 for invalid body/game | SATISFIED | `profile.ts` confirm-tx returns 200 `ConfirmTxSuccessSchema`, 404, 422 |
| 5 | `GET /public-profile/:userId`: 200 success or 404 `NOT_FOUND` | SATISFIED | `public-profile.ts:59,64` |
| 6 | `GET /public-referral/code/:code`: `200 { exists }` | SATISFIED | `public-referral.ts:65,71` |
| 7 | `GET /public-referral/:identifier`: 200 success or 404 `NOT_FOUND` | SATISFIED | `public-referral.ts:118,122` |

### FR-11: Convert game routes (FlipYou, PotShot, CloseCall)
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Invalid wallet / malformed identifiers return 400 or 422 with error envelope | SATISFIED | `create.ts`, `potshot-create.ts`, `closecall.ts` all use `err(c, 400, INVALID_REQUEST, ...)` for base58/pubkey/hex validation |
| 2 | Wallet/auth mismatch returns 403 | SATISFIED | `create.ts` (403 FORBIDDEN), `potshot-create.ts:338`, `closecall.ts:561` |
| 3 | Missing round/match returns 404 | SATISFIED | FlipYou: `MATCH_NOT_FOUND` (`create.ts:433,447`); PotShot: `ROUND_NOT_FOUND` (`potshot-create.ts:529,543`); CloseCall: `ROUND_NOT_FOUND` (`closecall.ts:373`) |
| 4 | Conflict and invalid phase return 409 | SATISFIED | FlipYou 409 CONFLICT (`create.ts`), PotShot 409 CONFLICT (`potshot-create.ts:357,396,447`); invalid-phase paths use 409 CONFLICT where applicable |
| 5 | Bet bounds / domain validation failures return 422 | SATISFIED | CloseCall declares 422 response for invalid body (`closecall.ts:289`); PotShot / FlipYou rely on default hook for amount bounds |
| 6 | Success responses remain 200 or 201 as appropriate | SATISFIED | All success paths use `ok(c, ...)` with default 200 |

### FR-12: Convert /challenges/*, /points/*, /dogpile/*, /leaderboard/*, /price/*, /health, POST /telegram/generate-link
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Read endpoints return success envelopes | SATISFIED | `challenges.ts`, `points.ts`, `dogpile.ts`, `leaderboard.ts` all use `ok(c, ...)` |
| 2 | `GET /health` returns `200 { ok: true, data: { status, version, workerRunning } }` | SATISFIED | `health.ts:33-39` |
| 3 | `GET /price/sol-usd` returns 503 error envelope when unavailable | SATISFIED | `price.ts:84` — `err(c, 503, PRICE_UNAVAILABLE, ..., { retryable: true })` |
| 4 | `POST /telegram/generate-link` returns 200 success envelope for both already-linked and new-token branches | SATISFIED | `telegram-link.ts:66,81` both use `ok(c, ...)` |
| 5 | Service-auth Telegram webhook routes may remain out of scope | SATISFIED (over-delivered) | Iteration 24 converted the 4 service-auth routes to envelope shape as well (required by atomic-switch rollout so the telegram client parses envelopes uniformly) |

### FR-13: Remove deprecated response helpers
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `errorMessage` and `structuredErrorMessage` deleted | SATISFIED | Iteration 21; grep of `backend/src` shows zero hits (only a local `const errorMessage` in `queue/worker.ts:104`, unrelated) |
| 2 | Legacy `ErrorResponseSchema` and `StructuredErrorResponseSchema` deleted | SATISFIED | Grep of `backend/src/contracts/validators.ts` returns no matches for `ErrorResponseSchema`, `StructuredErrorResponseSchema`, `StructuredErrorDetailSchema` |
| 3 | Public routes emit only envelope bodies for declared JSON responses | SATISFIED | `openapi-contract.test.ts` 2xx + 4xx/5xx scan + `waitlist-contract.test.ts` per-endpoint scan both pass |

### FR-14: Update contract and route tests
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `waitlist-contract.test.ts` extracts `data` from success envelopes | SATISFIED | Uses `unwrapEnvelope()` + per-entry `successStatus` field |
| 2 | Contract test asserts expected success status (200/202) per endpoint | SATISFIED | `waitlist-contract.test.ts:436` "declares <status> as the success status" (11 endpoints, 10×200 + 1×204) |
| 3 | Route tests assert both status and envelope body for representative error paths | SATISFIED | `auth.test.ts` 401 envelope; `rate-limit.test.ts:38` full envelope + header; referral/profile/closecall route tests assert `body.error.code` |
| 4 | New OpenAPI contract test asserts every declared public JSON response is an envelope at its declared status | SATISFIED | `openapi-contract.test.ts:422,438,458` (three tests added iteration 22) |

### FR-15: Client compatibility and rollout
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Doc explicitly covers `waitlist/src/lib/auth-api.ts` | SATISFIED | `client-migration.md:137` §Waitlist `### waitlist/src/lib/auth-api.ts` |
| 2 | Doc explicitly covers `waitlist/src/lib/referral-api.ts` | SATISFIED | `client-migration.md:186` |
| 3 | Doc explicitly covers `waitlist/src/components/TelegramCard.tsx` | SATISFIED | `client-migration.md:255` |
| 4 | Doc explicitly covers `webapp/src/lib/api.ts` | SATISFIED | `client-migration.md:314` |
| 5 | Doc explicitly covers `webapp/src/lib/auth/api.ts` | SATISFIED | `client-migration.md:394` |
| 6 | Doc explicitly covers `webapp/src/lib/parse-transaction-error.ts` | SATISFIED | `client-migration.md:432` |
| 7 | Doc explicitly covers `webapp/src/pages/profile/profile-data.ts` | SATISFIED | `client-migration.md:493` |
| 8 | Doc explicitly covers `telegram/src/backend-client.ts` | SATISFIED | `client-migration.md:80` + already-implemented reference in `telegram/src/backend-client.ts:30-111` |
| 9 | Rollout order preserves compatibility for deployed clients | SATISFIED | `client-migration.md:26` §Rollout Order (Atomic Switch) documents 3-step coordinated deploy |

### FR-16: Documentation
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `backend/CLAUDE.md` gains an "Envelope Contract" section | SATISFIED | `backend/CLAUDE.md` — dedicated "Envelope Contract" H2 with Body shape / Status semantics / Helpers / OpenAPI subsections |
| 2 | OpenAPI `info.description` mentions the envelope contract and links to this spec | SATISFIED | `backend/src/index.ts:378-392` — "## Response envelope contract" section, canonical reference `docs/specs/304-response-envelope/spec.md` |
| 3 | `docs/TECH_DEBT.md` records any temporary client/backend compatibility shim | SATISFIED | Per iteration-25 rollout decision (atomic switch, no tolerant shim, no feature flag) there was no residual compatibility concern to record. Iteration 26 noted "no debt — clean cutover." Grep of `docs/TECH_DEBT.md` confirms no 304/envelope entry — correct outcome for a clean cutover |

## Gap Summary

No gaps found. Every acceptance criterion in FR-1 through FR-16 is satisfied with file:line or test evidence.

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|----|-----------|----------|----------|------------|-----------|
| — | — | — | — | — | — | — |

## Deferred Items

None. This spec has no deferred acceptance criteria — it is a cross-cutting backend contract change that was shipped in full.

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| — | — | — | — | — |

## Scope-boundary notes (not gaps)

Per the Implementation Checklist refinement block:
- `backend/src/routes/admin.ts` is tracked separately in **303-peek-admin** (Ready). Not a gap for 304.
- `backend/src/routes/internal.ts` (service-auth webhooks) is explicitly out of scope for 304.
- Waitlist and webapp code changes are out of scope per root `CLAUDE.md` ("Frontend is a **separate project** ... webapp/ and waitlist/ are checked out as read-only references"). 304 delivers the migration doc; the actual waitlist/webapp code migration is owned by their respective teams.
- E2E visual and devnet real-provider coverage are marked N/A with reasons recorded in the spec's mandatory coverage markers section (iterations 27–29) — backend JSON contract has no UI surface and no new oracle integration.

## Recommendations

1. **Spec is effectively complete.** All 16 FRs audit SATISFIED. No additional work required from the backend side.
2. **Downstream coordination**: the atomic client migration described in `client-migration.md` is owned by the waitlist and webapp teams. A follow-up to confirm those repos have shipped their envelope parsers (per `client-migration.md` §Migration Checklist) would close the loop operationally — but that work is out of scope for this repo per `CLAUDE.md`.
3. **Future spec hygiene**: the `API_ERROR_CODES` catalog is the stable public contract for error codes. Additions are backwards-compatible; renaming or removing any code is a breaking change and should be gated by a fresh spec.
4. **Consider a `scripts/verify` assertion** that the `ApiError` / `ErrorEnvelope` OpenAPI components remain registered exactly once. This is currently unit-test-enforced (`openapi-contract.test.ts:458`), so there is no action required; noting for future-proofing.
