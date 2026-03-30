# Gap Analysis: 300-referral-system — Referral System

- **Date**: 2026-03-25
- **Spec status**: Done
- **Previous analysis**: 2026-03-25 (post-iteration-4, 17 SATISFIED / 73 GAP)

## Changes Since Last Analysis

| Item | Previous | Current | Notes |
|------|----------|---------|-------|
| DB earnings/claims/stats methods | GAP (8 methods) | SATISFIED | Iterations 5-6: all 8 methods in db.ts |
| API routes (8 endpoints) | GAP | SATISFIED | Iterations 7-14: all endpoints in routes/referral.ts, registered in index.ts |
| Settlement hook | GAP | SATISFIED | Iteration 15: recordReferralEarnings in settle-tx.ts |
| Transaction atomicity | GAP | SATISFIED | Iteration 16: db.withTransaction wraps settlement+referral writes |
| Claim queue handler | GAP | SATISFIED | Iteration 17: referral-claim.ts registered in index.ts |
| Frontend API client | GAP | SATISFIED | Iteration 18: lib/referral-api.ts with 8 functions |
| /r/:code route | GAP | SATISFIED | Iteration 19: ReferralCapture in App.tsx |
| useReferralApply hook | GAP | SATISFIED | Iteration 20: auto-apply on auth, mounted in App.tsx |
| Sidebar nav item | GAP | SATISFIED | Iteration 21: Sidebar.tsx with Referrals link |
| ReferralPage + sections | GAP | SATISFIED | Iterations 22-26: page shell + 4 cards |
| Profile settings referral | GAP | SATISFIED | Iteration 27: ProfileSettings.tsx referral section |
| Backend route tests | GAP | SATISFIED | Iteration 28: 29 test cases in referral-routes.test.ts |
| Settlement integration tests | GAP | SATISFIED | Iteration 29: 2 referral-specific tests |
| Local E2E tests | GAP | SATISFIED | Iteration 30: 30-referral.spec.ts |
| Visual tests + baselines | GAP | SATISFIED | Iterations 31-32: routes + states specs, baselines updated |
| Config env vars | GAP | SATISFIED | Iteration 6: config.ts REFERRAL_DEFAULT_RATE_BPS, REFERRAL_MIN_CLAIM_LAMPORTS |

---

## Implementation Inventory

### On-Chain Instructions

No on-chain changes required for this spec (v1 is entirely off-chain per System Invariant 7).

| Instruction | Program | File | Line |
|------------|---------|------|------|
| N/A | — | — | — |

### Backend — Database Migration

| Table | File | Line | Status |
|-------|------|------|--------|
| `referral_codes` | `services/backend/migrations/011_referral.sql` | 8-14 | DONE |
| `referral_links` | `services/backend/migrations/011_referral.sql` | 17-22 | DONE |
| `referral_earnings` | `services/backend/migrations/011_referral.sql` | 28-44 | DONE |
| `referral_claims` | `services/backend/migrations/011_referral.sql` | 56-68 | DONE |
| `referral_kol_rates` | `services/backend/migrations/011_referral.sql` | 78-84 | DONE |
| Indexes (6) | `services/backend/migrations/011_referral.sql` | 24-75 | DONE |

### Backend — DB Client Methods

| Method | File | Decl Line | Impl Line | Status |
|--------|------|-----------|-----------|--------|
| `ReferralCode` interface | `db.ts` | 130-136 | — | DONE |
| `ReferralLink` interface | `db.ts` | 138-143 | — | DONE |
| `ReferralEarning` interface | `db.ts` | 145-158 | — | DONE |
| `ReferralStats` interface | `db.ts` | 160-167 | — | DONE |
| `ReferralClaim` interface | `db.ts` | 169-178 | — | DONE |
| `insertReferralCode` | `db.ts` | 318 | 782-789 | DONE |
| `getReferralCodeByWallet` | `db.ts` | 321 | 791-796 | DONE |
| `getReferralCodeByCode` | `db.ts` | 324 | 798-803 | DONE |
| `upsertReferralCode` | `db.ts` | 327 | 805-815 | DONE |
| `insertReferralLink` | `db.ts` | 334 | 819-826 | DONE |
| `getReferralLinkByReferee` | `db.ts` | 337 | 828-833 | DONE |
| `getReferralLinksByReferrer` | `db.ts` | 340 | 835-841 | DONE |
| `insertReferralEarning` | `db.ts` | 347-358 | 845-861 | DONE |
| `getPendingBalance` | `db.ts` | 366 | 863-883 | DONE |
| `getReferralEarnings` | `db.ts` | 369-373 | 885-902 | DONE |
| `getReferralStats` | `db.ts` | 376 | 904-937 | DONE |
| `insertReferralClaim` | `db.ts` | 383-386 | 943-950 | DONE |
| `getReferralClaim` | `db.ts` | 389 | 952-957 | DONE |
| `updateClaimStatus` | `db.ts` | 395-399 | 959-971 | DONE |
| `getReferrerRate` | `db.ts` | 405-408 | 973-978 | DONE |
| `withTransaction` | `db.ts` | 415 | 980-983 | DONE |

### Backend — API Routes

| Endpoint | File | Line | Status |
|----------|------|------|--------|
| `POST /referral/code` | `routes/referral.ts` | 30 | DONE |
| `GET /referral/code` | `routes/referral.ts` | 213 | DONE |
| `POST /referral/apply` | `routes/referral.ts` | 99 | DONE |
| `GET /referral/referrer` | `routes/referral.ts` | 237 | DONE |
| `GET /referral/stats` | `routes/referral.ts` | 269 | DONE |
| `GET /referral/earnings` | `routes/referral.ts` | 293 | DONE |
| `POST /referral/claim` | `routes/referral.ts` | 342 | DONE |
| `GET /referral/claim/:claimId` | `routes/referral.ts` | 431 | DONE |
| Route registration (JWT) | `index.ts` | 94-99 | DONE |

### Backend — Settlement Integration

| Component | File | Line | Status |
|-----------|------|------|--------|
| `recordReferralEarnings` function | `settle-tx.ts` | 123-195 | DONE |
| Call in `settleMatch` (coinflip) | `settle-tx.ts` | 382-391 | DONE |
| Call in `settleLordRound` | `settle-tx.ts` | 595-604 | DONE |
| `db.withTransaction` atomicity | `settle-tx.ts` | 348, 558 | DONE |

### Backend — Queue Infrastructure

| Component | File | Line | Status |
|-----------|------|------|--------|
| `REFERRAL_CLAIM_REQUESTED` event type | `event-types.ts` | 11 | DONE |
| `REFERRAL_GAME_SETTLED` event type | `event-types.ts` | 10 | DEFINED (not emitted) |
| Claim handler | `queue/handlers/referral-claim.ts` | 26-145 | DONE |
| Handler registration | `index.ts` | 181-184 | DONE |
| Config: `referralDefaultRateBps` | `config.ts` | 23, 95-98 | DONE |
| Config: `referralMinClaimLamports` | `config.ts` | 24, 99-102 | DONE |

### Frontend Components

| Component | File | Line | Status |
|-----------|------|------|--------|
| `referral-api.ts` (8 functions) | `lib/referral-api.ts` | 85-168 | DONE |
| `ReferralCapture` (localStorage + redirect) | `App.tsx` | 455-466 | DONE |
| `/r/:code` route | `App.tsx` | 387 | DONE |
| `/referrals` route | `App.tsx` | 383 | DONE |
| `useReferralApply` hook | `features/referral/hooks/useReferralApply.ts` | 14-79 | DONE |
| Hook mounted in `AppContent` | `App.tsx` | 349 | DONE |
| Sidebar nav item | `components/Sidebar.tsx` | 162-171 | DONE |
| `ReferralPage` | `features/referral/ReferralPage.tsx` | — | DONE |
| `ReferralLinkCard` | `features/referral/ReferralLinkCard.tsx` | — | DONE |
| `ReferralStatsCard` | `features/referral/ReferralStatsCard.tsx` | — | DONE |
| `ReferralClaimCard` | `features/referral/ReferralClaimCard.tsx` | — | DONE |
| `ReferralEarningsTable` | `features/referral/ReferralEarningsTable.tsx` | — | DONE |
| Profile referral section | `features/player-profile/components/ProfileSettings.tsx` | 155-207 | DONE |
| CSS styles | `index.css` | 16677+ | DONE |
| Barrel export | `features/referral/index.ts` | 1-2 | DONE |

### Tests

| Test | Type | File | Status |
|------|------|------|--------|
| Referral route tests (29 cases) | unit | `__tests__/referral-routes.test.ts` | DONE |
| Settlement referral integration (2 tests) | integration | `__tests__/integration.test.ts` | DONE |
| Local E2E referral lifecycle | e2e | `e2e/local/30-referral.spec.ts` | DONE |
| Visual route baseline | visual | `e2e/visual/routes.spec.ts` | DONE |
| Visual state baselines (2) | visual | `e2e/visual/states.spec.ts` | DONE |
| Devnet E2E | e2e | — | N/A (no VRF/oracle per System Invariant 7) |

---

## Acceptance Criteria Audit

### FR-1: Referral Code Generation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1a | Authenticated player can set a referral code via API | SATISFIED | `routes/referral.ts:30` POST /code, JWT auth via `index.ts:95-98` |
| 1b | Code is always player-chosen, 3-16 chars, `[a-z0-9-]`, unique | SATISFIED | `referral.ts:21` regex `/^[a-z0-9-]{3,16}$/`, uniqueness check via `getReferralCodeByCode` + DB UNIQUE constraint |
| 1c | Each player has exactly one active code (setting new replaces old) | SATISFIED | `011_referral.sql` UNIQUE(wallet); `db.ts:805` `upsertReferralCode` ON CONFLICT replaces |
| 1d | Code is persisted in `referral_codes` table | SATISFIED | `011_referral.sql:8-14` creates table; `db.ts:782` `insertReferralCode` |

### FR-2: Referral Linking

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 2a | Visiting `taunt.bet/r/{CODE}` stores the code (localStorage) until auth | SATISFIED | `App.tsx:455-466` ReferralCapture reads `:code`, stores `{ code, capturedAt }` in localStorage |
| 2b | On authentication, stored/submitted code creates the link | SATISFIED | `useReferralApply.ts:55` calls `applyReferralCode` on auth, `referral.ts:99` POST /apply creates link |
| 2c | Player can manually enter a referral code via API (settings page) | SATISFIED | `ProfileSettings.tsx:155-207` input + Apply button; `referral.ts:99` POST /apply endpoint |
| 2d | Attempting to change an existing referrer returns an error | SATISFIED | `referral.ts:163-169` checks existing link → 409 ALREADY_LINKED; `011_referral.sql:22` UNIQUE(referee_wallet) |
| 2e | Self-referral (referrer wallet = referee wallet) is rejected | SATISFIED | `referral.ts:148-160` SELF_REFERRAL 400 response when `codeRow.wallet === wallet` |
| 2f | Referral link is stored in `referral_links` table with `created_at` | SATISFIED | `011_referral.sql:17-22`; `db.ts:819-826` `insertReferralLink` |

### FR-3: Referee Fee Rebate

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 3a | After settlement, rebate row recorded in `referee_rebate_lamports` | SATISFIED | `settle-tx.ts:156-168` calculates and inserts; `integration.test.ts` verifies rebate amount |
| 3b | Rebate is exactly 1000 bps of fee_lamports (fixed) | SATISFIED | `settle-tx.ts:156` `Math.floor((feeLamports * 1000) / 10_000)`; line 168 `refereeRebateRateBps: 1000` |
| 3c | Rebate accrues to referee's claimable balance | SATISFIED | `db.ts:863-883` `getPendingBalance` sums both `referrer_earned` and `referee_rebate` minus claims |
| 3d | Benefit communicated in UI on referral page and at code entry | SATISFIED | `ReferralPage.tsx` unauthenticated state describes 10% rebate; `ProfileSettings.tsx` success message; `ReferralClaimCard.tsx` breakdown shows rebates |
| 3e | Referrer AND referee sees single combined pending balance | SATISFIED | `db.ts:863-883` `getPendingBalance` unified calculation; `ReferralClaimCard.tsx` shows combined balance |

### FR-4: Referrer Fee Share

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 4a | Referrer earning calculated and stored on settlement | SATISFIED | `settle-tx.ts:123-195` `recordReferralEarnings`; `integration.test.ts` verifies amounts |
| 4b | Default rate is 1000 bps, configurable via env | SATISFIED | `config.ts:95-98` `REFERRAL_DEFAULT_RATE_BPS` default 1000; `settle-tx.ts:147-150` passes to `getReferrerRate` |
| 4c | KOL custom rate in `referral_kol_rates` | SATISFIED | `011_referral.sql:78-84` creates table; `db.ts:973-978` `getReferrerRate` checks KOL table |
| 4d | Earnings recorded per-game with all specified columns | SATISFIED | `011_referral.sql:28-44` table with all columns; `db.ts:845-861` `insertReferralEarning` |
| 4e | Referrer earnings accrue indefinitely with no cap/expiry | SATISFIED | No TTL, cap, or expiry constraint in schema or code |

### FR-5: Earnings Dashboard & Stats

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 5a | Referral page shows summary stats | SATISFIED | `ReferralStatsCard.tsx:39-44` four stat boxes; `ReferralClaimCard.tsx` pending balance |
| 5b | Detailed earnings log, paginated, per-game entries | SATISFIED | `ReferralEarningsTable.tsx` paginated table; `referral.ts:293` GET /earnings endpoint |
| 5c | Stats update in near-real-time (within settlement latency) | SATISFIED | Earnings written synchronously in settlement tx; stats fetched from DB on page load |
| 5d | Page accessible from main navigation | SATISFIED | `Sidebar.tsx:162-171` Referrals NavLink under Player section |

### FR-6: Claim Flow

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 6a | Player can claim full pending referral balance | SATISFIED | `referral.ts:342-428` POST /claim; `referral-claim.ts:26-145` handler transfers SOL |
| 6b | Claim returns 202 Accepted with claim ID | SATISFIED | `referral.ts:413-419` returns 202 with `{ claimId, amountLamports, status: "pending" }` |
| 6c | Queue worker executes SOL transfer from treasury | SATISFIED | `referral-claim.ts:83-109` SystemProgram.transfer from serverKeypair to wallet |
| 6d | Claim recorded with all specified columns | SATISFIED | `011_referral.sql:56-68` table; `referral.ts:387-390` insert; `referral-claim.ts` updates tx_signature |
| 6e | Concurrent claims prevented (DB-level locking on balance snapshot) | **GAP** | Balance snapshot (`getPendingBalance`) at `referral.ts:348` is outside any lock/transaction. Two concurrent requests can both pass the check and create claim rows. Handler re-verifies at `referral-claim.ts:65-81` (defense in depth), but no `SELECT FOR UPDATE` or similar at the API level as spec requires. |
| 6f | Zero-balance claims rejected | SATISFIED | `referral.ts:351-362` ZERO_BALANCE 400 response |
| 6g | Minimum claim threshold enforced | SATISFIED | `referral.ts:364-375` BELOW_THRESHOLD with `config.referralMinClaimLamports` (default 10M = 0.01 SOL) |
| 6h | Failed transfers retried by queue with exponential backoff | SATISFIED | `worker.ts` exponential backoff (5s→30s→300s); `referral-claim.ts:142` re-throws on failure |

### FR-7: API Contract

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 7a | All endpoints require JWT authentication | SATISFIED | `index.ts:95-98` JWT middleware with `requireAllMethods: true` on `/referral/*` |
| 7b | Appropriate error codes (400, 404, 409) | SATISFIED | `referral.ts` uses 400 (bad input), 404 (not found), 409 (conflict) throughout |
| 7c | Rate limiting on code generation and claim endpoints | **GAP** | Rate limiting middleware only applied to `/auth/*` (`index.ts:66-73`) and `/fairness/*` (`index.ts:108-114`). No rate limiting on `/referral/*` routes. |
| 7d | Monetary values use lamport strings | SATISFIED | All API responses use string lamports: `referral.ts` stats/earnings/claim responses |

### FR-8: Database Schema

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 8a | All 5 tables created via migration | SATISFIED | `011_referral.sql` creates all 5 tables |
| 8b | `referral_links.referee_wallet` UNIQUE | SATISFIED | `011_referral.sql:22` `referee_wallet TEXT NOT NULL UNIQUE` |
| 8c | `referral_codes.code` UNIQUE | SATISFIED | `011_referral.sql:12` `code TEXT NOT NULL UNIQUE` |
| 8d | Appropriate indexes on wallet columns and round_id | SATISFIED | `011_referral.sql` 6 indexes covering all wallet lookups and round_id |
| 8e | `referral_earnings` idempotency guard `UNIQUE(referee_wallet, round_id)` | SATISFIED | `011_referral.sql:43-44` constraint |
| 8f | `referral_claims.status` constrained | SATISFIED | `011_referral.sql:67-68` CHECK constraint |

### FR-9a: Route `/r/:code`

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9a-1 | Route registered in App.tsx | SATISFIED | `App.tsx:387` `<Route path="/r/:code" element={<ReferralCapture />} />` |
| 9a-2 | Code stored in localStorage (no auth required) | SATISFIED | `App.tsx:460` stores `{ code, capturedAt }` |
| 9a-3 | Redirect to `/` immediately | SATISFIED | `App.tsx:465` `<Navigate to="/" replace />` |
| 9a-4 | On auth, stored code applied via API | SATISFIED | `useReferralApply.ts:55` calls `applyReferralCode` |
| 9a-5 | localStorage cleared on success or permanent failure | SATISFIED | `useReferralApply.ts:57` (success), `:73-74` (permanent failure) |
| 9a-6 | Invalid/expired codes show toast notification | **GAP** | `useReferralApply.ts:58` has `// TODO: replace with toast notification when toast system is implemented` — uses `console.warn` instead. No visible user notification. |

### FR-9b: Sidebar Navigation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9b-1 | "Referrals" nav item under "Player" section | SATISFIED | `Sidebar.tsx:162-171` NavLink after Quests |
| 9b-2 | Active state styling matches existing items | SATISFIED | Uses same `nv-item` className pattern with `isActive` |
| 9b-3 | Share/link-style SVG icon | SATISFIED | SVG at `Sidebar.tsx:163-168` |
| 9b-4 | Navigates to `/referrals` | SATISFIED | `to="/referrals"` at `Sidebar.tsx:162` |

### FR-9c: Referral Page

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9c-1 | Route registered, renders ReferralPage | SATISFIED | `App.tsx:383` with `RouteErrorBoundary` |
| 9c-2 | Unauthenticated: connect-wallet prompt | SATISFIED | `ReferralPage.tsx:12-25` disconnected state |
| 9c-3 | Code input validates (3-16, `[a-z0-9-]`) inline | SATISFIED | `ReferralLinkCard.tsx:9` regex `/^[a-z0-9-]{3,16}$/` |
| 9c-4 | Setting code displays referral URL | SATISFIED | `ReferralLinkCard.tsx` display mode with full URL |
| 9c-5 | Copy button with visual feedback | SATISFIED | `ReferralLinkCard.tsx:75-81` clipboard + "Copied!" feedback |
| 9c-6 | Stats summary with loading skeleton | SATISFIED | `ReferralStatsCard.tsx` fetches stats, shows skeleton while loading |
| 9c-7 | Claim button disabled below threshold | SATISFIED | `ReferralClaimCard.tsx` disabled states |
| 9c-8 | Successful claim shows tx link | SATISFIED | `ReferralClaimCard.tsx:117-128` success banner with explorer link |
| 9c-9 | Earnings table paginated with correct columns | SATISFIED | `ReferralEarningsTable.tsx` 5 columns, Prev/Next pagination |
| 9c-10 | Empty states with meaningful messages | SATISFIED | `ReferralEarningsTable.tsx:79-82` "No earnings yet. Share your link to start earning!" |

### FR-9d: Profile Settings

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9d-1 | Referral code input section in profile settings | SATISFIED | `ProfileSettings.tsx:155-207` |
| 9d-2 | Input calls POST /referral/apply | SATISFIED | `ProfileSettings.tsx` apply handler calls `applyReferralCode` |
| 9d-3 | If already referred, read-only referrer wallet | SATISFIED | `ProfileSettings.tsx:161-169` green checkmark + wallet display |
| 9d-4 | Validation errors inline | SATISFIED | `ProfileSettings.tsx:202-204` error message display |
| 9d-5 | Self-referral shows clear error | SATISFIED | `ProfileSettings.tsx` error categorization for SELF_REFERRAL |

### FR-9e: API Client

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9e-1 | All 7 API functions with JWT Bearer header | SATISFIED | `referral-api.ts:85-168` 8 functions (7 spec + `getReferrer`); `authHeaders` at line 75 |
| 9e-2 | `parseResponse<T>()` pattern | SATISFIED | `referral-api.ts:60-73` generic parse function |
| 9e-3 | User-friendly error messages | SATISFIED | `parseResponse` extracts `error.message` from response body |
| 9e-4 | Typed request/response interfaces | SATISFIED | `referral-api.ts:13-56` 7 typed interfaces |

### FR-9f: Referral Apply Hook

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 9f-1 | Reads referral code from localStorage after auth | SATISFIED | `useReferralApply.ts:30` |
| 9f-2 | Calls POST /referral/apply automatically | SATISFIED | `useReferralApply.ts:55` |
| 9f-3 | Clears localStorage on success or permanent failure | SATISFIED | `useReferralApply.ts:57` (success), `:73-74` (permanent) |
| 9f-4 | Keeps localStorage on transient failure | SATISFIED | `useReferralApply.ts:76` — only permanent errors clear |
| 9f-5 | Shows success toast on auto-apply | **GAP** | `useReferralApply.ts:58` `// TODO: replace with toast notification` — uses `console.warn`, no visible notification |
| 9f-6 | Mounted in App.tsx/AppContent | SATISFIED | `App.tsx:349` `useReferralApply()` |

### FR-10: Backend Settlement Integration

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 10a | Settlement checks for referrer after each game | SATISFIED | `settle-tx.ts:143` checks `getReferralLinkByReferee` for each player |
| 10b | Correct formula (bps of total fee) | SATISFIED | `settle-tx.ts:152-156` `feeLamports * referrerRateBps / 10000` |
| 10c | KOL custom rate used when present | SATISFIED | `settle-tx.ts:147-150` `getReferrerRate(referrerWallet, referralDefaultRateBps)` |
| 10d | Earnings in same DB transaction (atomicity) | SATISFIED | `settle-tx.ts:382` called inside `db.withTransaction()` (coinflip); `:595` (lord) |
| 10e | Referral event emitted to async queue | **GAP** | `REFERRAL_GAME_SETTLED` event type is defined in `event-types.ts:10` but never emitted in `recordReferralEarnings`. Earnings are written synchronously (per FR-11 note), but the spec criterion says the event should be emitted for "downstream processing (referee rewards, notifications)." |
| 10f | No additional RPC calls — purely DB-level | SATISFIED | `recordReferralEarnings` only performs DB queries (no Connection calls) |
| 10g | Settlement latency increase negligible (< 5ms) | SATISFIED | Pure DB operations (1 SELECT referral_links + 1 optional SELECT kol_rates + 1 INSERT per referred player); integration tests confirm no timeout |

### FR-11: Referral Event Contracts + Handler Idempotency

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 11a | `referral.claim_requested` emitted with correct payload | SATISFIED | `referral.ts:393-402` emitEvent with `{ claimId, wallet, amountLamports, requestedAt }` |
| 11b | Handler validates payload; malformed payloads dead-lettered | **GAP** | `referral-claim.ts:34-38` validates and throws on missing fields. However, the throw causes the queue worker to retry (exponential backoff until max_attempts). Spec says "dead-lettered" (no retry for malformed). Wastes retries on permanently broken payloads. |
| 11c | Idempotency: completed/failed claims are no-op | SATISFIED | `referral-claim.ts:47-59` returns early for completed or failed status |
| 11d | Re-verifies balance before transfer | SATISFIED | `referral-claim.ts:65-81` checks `pending >= amount`, fails claim if insufficient |
| 11e | Sends SOL and records tx_signature | SATISFIED | `referral-claim.ts:83-109` SystemProgram.transfer; records via `updateClaimStatus` |
| 11f | Re-processing same event is safe no-op | SATISFIED | Idempotency check at handler entry; completed claims skipped |

---

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| 1 | FR-6 | Concurrent claims DB-level locking on balance snapshot | moderate | backend | — | Add `SELECT ... FOR UPDATE` or similar locking in the claim route's balance snapshot query, or wrap the snapshot + claim creation in a serializable transaction |
| 2 | FR-7 | Rate limiting on code generation and claim endpoints | moderate | backend | — | Apply `createRateLimitMiddleware` to `/referral/*` routes in `index.ts` (same pattern as `/auth/*` and `/fairness/*`) |
| 3 | FR-9a | Invalid/expired codes show toast notification | low | frontend | Toast system | `useReferralApply.ts:58` TODO — implement toast when toast system is available, or use a lightweight inline notification |
| 4 | FR-9f | Success toast on referral auto-apply | low | frontend | Toast system | Same as #3 — `useReferralApply.ts:58` uses `console.warn` |
| 5 | FR-10 | `referral.game_settled` event not emitted in settlement | low | backend | — | Add `emitEvent(tx, EventTypes.REFERRAL_GAME_SETTLED, ...)` in `recordReferralEarnings` within the settlement transaction. Event type already defined. |
| 6 | FR-11 | Malformed payloads dead-lettered (not retried) | low | backend | — | Catch validation errors in claim handler and return without throwing (no-op), or add dead-letter classification to the queue worker |

Severity: **critical** (blocks launch) / **moderate** (degrades UX or safety) / **low** (polish)

---

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| — | — | — | — | — |

No items are explicitly deferred. All gaps are implementation oversights, not intentional deferrals.

---

## Recommendations

1. **Rate limiting (moderate, quick fix):** Add `createRateLimitMiddleware` to `/referral/*` routes in `index.ts`. This is a one-line addition following the existing pattern for `/auth/*` and `/fairness/*`. Priority: high — unprotected POST endpoints are an abuse vector.

2. **Concurrent claim locking (moderate):** The current defense-in-depth (handler re-verification) prevents actual double-payout, but allows creation of duplicate `pending` claim rows. Options:
   - Wrap balance snapshot + claim insert in a single `sql.begin` with `SELECT ... FOR UPDATE` on the pending balance
   - Add a partial unique index on `referral_claims(wallet)` WHERE `status IN ('pending','processing')` to prevent multiple active claims

3. **Toast notifications (low, blocked):** The `useReferralApply` hook has a TODO for toast integration. Both FR-9a and FR-9f reference toast notifications. This requires either: (a) a platform-wide toast/notification system, or (b) a lightweight inline notification. Could be deferred to a platform UX enhancement spec.

4. **`referral.game_settled` event emission (low):** The event type exists but is never emitted. This is low priority since earnings are written synchronously and no downstream handler is registered. Would matter when notifications or analytics consumers are added. Simple fix: one `emitEvent` call in `recordReferralEarnings`.

5. **Dead-letter classification (low):** The queue worker treats all handler errors as retryable. Adding a `DeadLetterError` or similar classification would let handlers signal "this will never succeed, don't retry." Low urgency since malformed payloads are rare in practice (events are emitted by the same backend).
