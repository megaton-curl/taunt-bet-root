# Implementation History — 300-referral-system

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — 2026-03-24T21:27:27Z — OK

**Item**: [backend] Database migration `011_referral.sql`
**Status**: Done
**Changes**:
- Created `services/backend/migrations/011_referral.sql` with all 5 referral tables:
  - `referral_codes` — one code per wallet (UNIQUE on wallet + code)
  - `referral_links` — immutable referrer binding (UNIQUE on referee_wallet)
  - `referral_earnings` — per-game earnings with idempotency guard (UNIQUE on referee_wallet + round_id)
  - `referral_claims` — async payout tracking with status CHECK constraint (pending/processing/completed/failed)
  - `referral_kol_rates` — KOL custom rates (wallet PK)
- Indexes: referrer/referee wallet lookups on earnings, round_id, claims by wallet+date, partial index on pending/processing claims, referrer_wallet on links
- Follows existing migration patterns (IF NOT EXISTS, TIMESTAMPTZ, BIGINT for lamports, no foreign keys)
**Verification**: `pnpm lint` passed (18/18 tasks)
**Note**: Agent falsely claimed DONE after this single item. Loop accepted it (no guard).

## Gap Analysis — 2026-03-24T21:41:16Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

## Iteration 2 — 2026-03-25T08:54:27Z — FALSE DONE (rejected retroactively)
- **Agent claimed DONE** but only the migration was complete. Checklist was refined between runs.
- **Log**: iteration-002.log

## Iteration 3 — 2026-03-25T09:09:19Z — OK

**Item**: [backend] DB client methods in `db.ts`: `insertReferralCode`, `getReferralCodeByWallet`, `getReferralCodeByCode`, `upsertReferralCode` for code CRUD
**Status**: Done
**Changes**:
- Added `ReferralCode` interface to type section (id, wallet, code, created_at, updated_at)
- Added 4 method signatures to `Db` interface: `insertReferralCode`, `getReferralCodeByWallet`, `getReferralCodeByCode`, `upsertReferralCode`
- Implemented all 4 methods in `createDb()`:
  - `insertReferralCode`: INSERT with RETURNING *
  - `getReferralCodeByWallet`: SELECT by wallet, returns undefined if not found
  - `getReferralCodeByCode`: SELECT by code, returns undefined if not found
  - `upsertReferralCode`: INSERT ON CONFLICT (wallet) DO UPDATE — replaces code for existing wallet
**Verification**: `pnpm lint` passed (18/18 tasks)
**Note**: Agent falsely claimed DONE after this single item. Loop accepted it (no guard).

## Gap Analysis — 2026-03-25T09:26:04Z
- **Result**: Gap analysis report updated (post-iteration-3)
- **Report**: gap-analysis.md
- **Totals**: 15 SATISFIED, 0 DEFERRED, 75 GAP (90 total criteria)

## Iteration 4 — 2026-03-25 — OK

**Item**: [backend] DB client methods: `insertReferralLink`, `getReferralLinkByReferee`, referral link queries
**Status**: Done
**Changes**:
- Added `ReferralLink` interface to type section (id, referrer_wallet, referee_wallet, created_at)
- Added 3 method signatures to `Db` interface: `insertReferralLink`, `getReferralLinkByReferee`, `getReferralLinksByReferrer`
- Implemented all 3 methods in `createDb()`:
  - `insertReferralLink`: INSERT with RETURNING *
  - `getReferralLinkByReferee`: SELECT by referee_wallet, returns undefined if not found
  - `getReferralLinksByReferrer`: SELECT all links where wallet is referrer, ordered by created_at DESC
**Verification**: `pnpm lint` passed (18/18 tasks)

## Fix — 2026-03-25 — Loop signal detection bug
- **Problem**: Signal detection (`rg` on raw stream-json log) matched tag text inside tool results (files the agent read), not just agent output. History file containing the DONE tag as prose triggered false positive.
- **Fix**: Signal detection now extracts only assistant text via `jq` before searching for tags. Also added mandatory Checklist Audit step in prompt (agent must enumerate all items before claiming done).
- **Spec update**: Referral codes changed to always be player-chosen (3-16 chars, `[a-z0-9-]`). No auto-generation.

## Iteration 4 — 2026-03-25T10:22:52Z — FALSE DONE (signal detection bug)
- **Result**: Agent did NOT claim done (said "29 items remain"), but script matched DONE tag in history file tool result
- **Log**: iteration-004.log

## Devnet E2E — 2026-03-25T10:22:57Z
- **Result**: PASS

## Gap Analysis — 2026-03-25 (post-iteration-4)
- **Result**: Gap analysis report updated
- **Report**: gap-analysis.md
- **Totals**: 17 SATISFIED, 0 DEFERRED, 73 GAP (90 total criteria)
- **Changes vs previous**: +2 SATISFIED (link CRUD methods: `insertReferralLink`, `getReferralLinkByReferee`, `getReferralLinksByReferrer` added to db.ts; updated evidence for FR-2 criteria 2d, 2f)
- **Spec FR checkboxes**: Updated with evidence annotations

## Gap Analysis — 2026-03-25T10:43:21Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

## Iteration 5 — 2026-03-25 — OK

**Item**: [backend] DB client methods: `insertReferralEarning`, `getPendingBalance`, `getReferralEarnings`, `getReferralStats`
**Status**: Done
**Changes**:
- Added `ReferralEarning` interface (id, referrer_wallet, referee_wallet, round_id, game_type, wager_lamports, fee_lamports, referrer_earned_lamports, referrer_rate_bps, referee_rebate_lamports, referee_rebate_rate_bps, created_at)
- Added `ReferralStats` interface (referred_count, active_count, total_volume_lamports, total_earned_lamports, pending_lamports)
- Added `normalizeReferralEarning()` helper to convert BIGINT columns to JS numbers
- Added 4 method signatures to `Db` interface + implementations in `createDb()`:
  - `insertReferralEarning(params)`: INSERT with all earning fields, RETURNING *, normalized
  - `getPendingBalance(wallet)`: SUM(referrer_earned where referrer) + SUM(referee_rebate where referee) - SUM(completed/pending/processing claims). Returns lamport string
  - `getReferralEarnings(wallet, page, limit)`: paginated SELECT by referrer_wallet, newest first, with totalPages count
  - `getReferralStats(wallet)`: single query returning referred_count, active_count (7d), total_volume, total_earned, pending_lamports
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 5 — 2026-03-25T11:43:58Z — OK
- **Log**: iteration-005.log

## Iteration 6 — 2026-03-25 — OK

**Item**: [backend] DB client methods: `insertReferralClaim`, `getReferralClaim`, `updateClaimStatus`, `getReferrerRate(wallet)`
**Status**: Done
**Changes**:
- Added `ReferralClaim` interface (id, wallet, amount_lamports, status, tx_signature, error, requested_at, processed_at)
- Added 4 method signatures to `Db` interface + implementations in `createDb()`:
  - `insertReferralClaim(wallet, amountLamports)`: INSERT with status='pending', RETURNING *
  - `getReferralClaim(claimId)`: SELECT by UUID id, returns undefined if not found
  - `updateClaimStatus(claimId, status, meta?)`: UPDATE status + optional tx_signature/error, sets processed_at on completed/failed
  - `getReferrerRate(wallet, defaultRateBps)`: SELECT from referral_kol_rates, falls back to defaultRateBps param
- Added `referralDefaultRateBps` and `referralMinClaimLamports` to Config interface + loadConfig() (env vars `REFERRAL_DEFAULT_RATE_BPS` default 1000, `REFERRAL_MIN_CLAIM_LAMPORTS` default 10000000)
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 6 — 2026-03-25T11:50:09Z — OK
- **Log**: iteration-006.log

## Iteration 7 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `POST /referral/code` — set player-chosen code
**Status**: Done
**Changes**:
- Created `services/backend/src/routes/referral.ts` with `createReferralRoutes({ db })` factory
- Implemented `POST /code` endpoint:
  - Requires JWT auth (wallet from context)
  - Validates code format: 3-16 chars, `[a-z0-9-]` regex
  - Checks code uniqueness via `db.getReferralCodeByCode()` before upsert
  - Uses `db.upsertReferralCode(wallet, code)` to set/replace
  - Returns `{ code, url }` where url is `https://taunt.bet/r/{code}`
  - Error responses: 400 (invalid body/code format), 409 (code taken), 500 (unexpected)
  - Handles race condition on duplicate code with catch on constraint violation
- Follows existing patterns: Hono factory, AppEnv type, logger(message, fields)
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 7 — 2026-03-25T11:55:22Z — OK
- **Log**: iteration-007.log

## Iteration 8 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `GET /referral/code` — return current code for authenticated wallet, or 404
**Status**: Done
**Changes**:
- Added `GET /code` endpoint to `services/backend/src/routes/referral.ts`
  - Reads wallet from JWT auth context (`c.get("wallet")`)
  - Calls `db.getReferralCodeByWallet(wallet)` to look up existing code
  - Returns `{ code, url }` if found (url = `https://taunt.bet/r/{code}`)
  - Returns 404 with `{ error: { code: "NO_CODE", message: "..." } }` if no code set
  - Follows same patterns as existing `POST /code` endpoint (auth check, error shape, REFERRAL_BASE_URL)
**Verification**: `pnpm lint` passed (18/18)

## Iteration 8 — 2026-03-25T11:57:51Z — OK
- **Log**: iteration-008.log

## Iteration 9 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `POST /referral/apply` — link referee to referrer
**Status**: Done
**Changes**:
- Added `POST /apply` endpoint to `services/backend/src/routes/referral.ts`
  - Requires JWT auth (wallet from context)
  - Validates code is non-empty string
  - Looks up referral code via `db.getReferralCodeByCode(code)` — returns 404 if not found
  - Self-referral check: rejects if `codeRow.wallet === wallet` (400, SELF_REFERRAL)
  - Existing referrer check: calls `db.getReferralLinkByReferee(wallet)` — returns 409 if already linked
  - Creates link via `db.insertReferralLink(referrerWallet, wallet)`
  - Returns `{ referrer: wallet, benefit: "10% fee rebate on all games" }`
  - Race condition handling: catches unique constraint violation on concurrent insert → 409
  - Error shape follows spec: `{ error: { code, message, retryable? } }`
**Verification**: `pnpm lint` passed (18/18)

## Iteration 9 — 2026-03-25T12:01:01Z — OK
- **Log**: iteration-009.log

## Iteration 10 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `GET /referral/stats` — referral summary stats endpoint
**Status**: Done
**Changes**:
- Added `GET /stats` endpoint to `services/backend/src/routes/referral.ts`
  - Requires JWT auth (wallet from context)
  - Calls `db.getReferralStats(wallet)` which returns snake_case `ReferralStats`
  - Maps to camelCase API response: `referredCount`, `activeCount`, `totalVolumeLamports`, `totalEarnedLamports`, `pendingLamports`
  - All monetary values are lamport strings (not floats)
  - Error handling: catches and logs failures, returns 500
  - Follows existing endpoint patterns (auth check, error shape, logger)
**Verification**: `pnpm lint` passed (18/18)

## Iteration 10 — 2026-03-25T12:03:21Z — OK
- **Log**: iteration-010.log

## Iteration 11 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `GET /referral/earnings` — paginated per-game earnings log
**Status**: Done
**Changes**:
- Added `GET /earnings` endpoint to `services/backend/src/routes/referral.ts`
  - Requires JWT auth (wallet from context)
  - Query params: `page` (default 1), `limit` (default 20, max 100)
  - Validates page/limit are positive integers, returns 400 on NaN
  - Calls `db.getReferralEarnings(wallet, page, limit)` for paginated data
  - Maps snake_case DB fields to camelCase API response: `roundId`, `gameType`, `refereeWallet`, `wagerLamports`, `earnedLamports`, `createdAt`
  - All monetary values returned as lamport strings (not numbers)
  - `createdAt` as ISO-8601 string
  - Response includes `pagination: { page, totalPages }` per FR-7 contract
  - Error handling: catches and logs failures, returns 500
**Verification**: `pnpm lint` passed (18/18)

## Iteration 11 — 2026-03-25T12:05:34Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `POST /referral/claim` — async claim request with queue event
**Status**: Done
**Changes**:
- Extended `ReferralRoutesDeps` interface to include `sql: postgres.Sql` and `config: Config` (needed for transactional claim and min threshold)
- Added imports: `postgres`, `Config`, `emitEvent`, `EventTypes`
- Added `POST /claim` endpoint to `services/backend/src/routes/referral.ts`:
  - Requires JWT auth (wallet from context)
  - Snapshots pending balance via `db.getPendingBalance(wallet)`
  - Rejects zero balance (400, ZERO_BALANCE)
  - Rejects below threshold (400, BELOW_THRESHOLD) using `config.referralMinClaimLamports`
  - Uses `sql.begin()` for atomicity: inserts claim row + emits `referral.claim_requested` event in same DB transaction
  - Event payload: `{ claimId, wallet, amountLamports, requestedAt }`
  - Returns 202 with `{ claimId, amountLamports, status: "pending" }` per FR-7 contract
  - Error handling: catches and logs failures, returns 500
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 12 — 2026-03-25T12:11:41Z — OK
- **Log**: iteration-012.log

## Iteration 13 — 2026-03-25 — OK

**Item**: [backend] `routes/referral.ts`: `GET /referral/claim/:claimId` — poll claim status
**Status**: Done
**Changes**:
- Added `GET /claim/:claimId` endpoint to `services/backend/src/routes/referral.ts`
  - Requires JWT auth (wallet from context)
  - Looks up claim by UUID via `db.getReferralClaim(claimId)`
  - Returns 404 if claim not found OR if claim belongs to a different wallet (prevents enumeration)
  - Returns `{ claimId, amountLamports, status, txSignature? }` per FR-7 contract
  - `txSignature` only included when present (completed claims)
  - `amountLamports` returned as string (lamports-only accounting)
  - Error handling: catches and logs failures, returns 500
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 13 — 2026-03-25T12:14:13Z — OK
- **Log**: iteration-013.log

## Iteration 14 — 2026-03-25 — OK

**Item**: [backend] Register referral routes in `index.ts`, mount at `/referral` prefix with JWT auth middleware
**Status**: Done
**Changes**:
- Added `import { createReferralRoutes } from "./routes/referral.js"` to `services/backend/src/index.ts`
- Added JWT auth middleware for `/referral/*` with `requireAllMethods: true` (ensures auth on GET + POST)
- Mounted routes with `app.route("/referral", createReferralRoutes({ db, sql, config }))` after profile routes
- Passes all 3 deps required by `ReferralRoutesDeps`: `db` (from createDb), `sql` (raw postgres connection), `config` (from loadConfig)
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 14 — 2026-03-25T12:17:10Z — OK
- **Log**: iteration-014.log

## Iteration 15 — 2026-03-25 — OK

**Item**: [backend] Settlement hook in `settle-tx.ts`: referral earnings recording after game settlement
**Status**: Done
**Changes**:
- Added `referralDefaultRateBps: number` to `SettleTxDeps` interface
- Added `recordReferralEarnings()` helper function in `settle-tx.ts`:
  - Takes roundId, gameType, feeBps, referralDefaultRateBps, and player list
  - Deduplicates players (handles Lord of RNGs multiple entries per player)
  - For each player: checks `getReferralLinkByReferee()` → if referrer exists, gets rate via `getReferrerRate()` (KOL override)
  - Calculates `referrerEarned = feeLamports * referrerRateBps / 10000` and `refereeRebate = feeLamports * 1000 / 10000` (fixed 10%)
  - Inserts via `db.insertReferralEarning()` with all economic inputs preserved
  - Error handling: duplicate key (idempotent skip), other errors logged but don't fail settlement
- Called `recordReferralEarnings()` at end of `settleMatch()` (coinflip — 2 players) and `settleLordRound()` (lord — N players)
- Updated caller in `index.ts` to pass `referralDefaultRateBps: config.referralDefaultRateBps`
- Updated integration test to pass `referralDefaultRateBps: 1000` in SettleTxDeps
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 15 — 2026-03-25T12:25:43Z — OK
- **Log**: iteration-015.log

## Iteration 16 — 2026-03-25 — OK

**Item**: [backend] Wrap settlement DB writes in `sql.transaction()` for atomicity
**Status**: Done
**Changes**:
- Added `withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T>` method to `Db` interface in `db.ts`
- Refactored `createDb()` to accept an optional `_txSql` parameter for transaction injection. When provided, the sql object is used directly (no new connection). `close()` is guarded to only close owned connections.
- `withTransaction` implementation uses `sql.begin()` to create a transaction scope and passes a transactional `Db` (via recursive `createDb(databaseUrl, txSql)`) to the callback
- In `settle-tx.ts` `settleMatch()`: wrapped all post-confirmation DB writes (updateRoundPhase, updateRoundEntries, insertOperatorEvent, insertTransaction, recordReferralEarnings) in `db.withTransaction()`
- In `settle-tx.ts` `settleLordRound()`: same wrapping for Lord of RNGs settlement writes
- All writes within the transaction use `txDb` instead of `db`, ensuring they share the same transaction connection
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 16 — 2026-03-25T12:37:33Z — OK
- **Log**: iteration-016.log

## Iteration 17 — 2026-03-25 — OK

**Item**: [backend] Register `referral.claim_requested` handler in queue registry
**Status**: Done
**Changes**:
- Created `services/backend/src/queue/handlers/referral-claim.ts` with `createClaimHandler()` factory
  - Accepts `ClaimHandlerDeps`: db, connection, serverKeypair
  - Returns an `EventHandler` function for the queue worker
  - Idempotent: skips if claim status is already `completed` or `failed`
  - Flow: load claim → update to `processing` → re-verify pending balance >= claim amount → build SystemProgram.transfer tx → send + confirm → update to `completed` with tx_signature
  - On insufficient balance: updates to `failed` with descriptive error (no re-throw, terminal)
  - On transfer failure: updates to `failed` + re-throws so queue worker retries with exponential backoff
  - Uses web3.js v1 patterns consistent with settle-tx.ts (Transaction, sign, sendRawTransaction, confirmTransaction)
- Updated `services/backend/src/index.ts`:
  - Imported `registerHandler`, `EventTypes` from queue, and `createClaimHandler` from handler
  - Registered handler before event worker starts: `registerHandler(EventTypes.REFERRAL_CLAIM_REQUESTED, createClaimHandler({ db, connection, serverKeypair }))`
**Verification**: `pnpm lint` passed (18/18). Backend typecheck has 1 pre-existing error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 17 — 2026-03-25T12:47:48Z — OK
- **Log**: iteration-017.log

## Iteration 18 — 2026-03-25 — OK

**Item**: [frontend] `lib/referral-api.ts` — 7 typed fetch wrappers with JWT Bearer auth
**Status**: Done
**Changes**:
- Created `apps/platform/src/lib/referral-api.ts` following `auth-api.ts` pattern
- Response type interfaces: `ReferralCodeResponse`, `ApplyReferralResponse`, `ReferralStatsResponse`, `ReferralEarningItem`, `ReferralEarningsResponse`, `ClaimResponse`
- Shared `parseResponse<T>()` utility with error extraction from `{ error: { message } }` shape
- `authHeaders(token)` helper for `Authorization: Bearer` + `Content-Type: application/json`
- 7 exported async functions: `setReferralCode`, `getReferralCode`, `applyReferralCode`, `getReferralStats`, `getReferralEarnings` (with optional page/limit query params), `requestReferralClaim`, `pollClaimStatus`
- All monetary values typed as `string` (lamports-only accounting)
- Fixed lint error: replaced `URLSearchParams` (not in ESLint globals) with manual query string construction
**Verification**: `pnpm lint` passed (18/18)

## Iteration 18 — 2026-03-25T12:52:39Z — OK
- **Log**: iteration-018.log

## Iteration 19 — 2026-03-25 — OK

**Item**: [frontend] `/r/:code` route in `App.tsx` — capture code to localStorage, redirect to `/`
**Status**: Done
**Changes**:
- Added `Navigate` and `useParams` imports from `react-router-dom` in `App.tsx`
- Created `ReferralCapture` component:
  - Reads `:code` from URL params via `useParams()`
  - Stores `{ code, capturedAt }` as JSON in `localStorage` key `referral_code`
  - Gracefully handles localStorage unavailability (private browsing, storage full)
  - Returns `<Navigate to="/" replace />` for immediate redirect
- Added `<Route path="/r/:code" element={<ReferralCapture />} />` before the catch-all `*` route
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 19 — 2026-03-25T12:58:52Z — OK
- **Log**: iteration-019.log

## Iteration 20 — 2026-03-25 — OK

**Item**: [frontend] `useReferralApply` hook — auto-apply stored referral code on authentication
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/hooks/useReferralApply.ts`:
  - Watches `isAuthenticated`, `accessToken`, `address` from session/wallet hooks
  - Reads `referral_code` from localStorage (set by `/r/:code` ReferralCapture)
  - Calls `applyReferralCode(token, code)` on authentication
  - Clears localStorage on success or permanent failure (ALREADY_LINKED, SELF_REFERRAL, NOT_FOUND, INVALID)
  - Keeps localStorage on transient failure (network error, 500) for retry on next auth
  - Uses `appliedRef` to prevent duplicate calls within same auth session
  - Handles corrupt/missing localStorage data gracefully
- Created `apps/platform/src/features/referral/index.ts` barrel export
- Updated `App.tsx`: imported `useReferralApply`, called in `AppContent` (inside auth provider tree)
**Verification**: `pnpm lint` passed (18/18, 0 errors). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 20 — 2026-03-25T13:06:04Z — OK
- **Log**: iteration-020.log

## Iteration 21 — 2026-03-25 — OK

**Item**: [frontend] Sidebar nav item "Referrals" in Player section of `Sidebar.tsx`
**Status**: Done
**Changes**:
- Added `NavLink` to `/referrals` in `Sidebar.tsx` after "Quests" and before the "Platform" section
- Uses `--nc: var(--color-green)` matching spec requirement
- SVG icon: external link/share icon (17x17 viewBox, stroke-only, matching sidebar icon patterns)
  - Rectangle with open top-right corner (page/window) + arrow pointing out (external link metaphor)
- Follows exact same NavLink pattern as all other sidebar items: className function with isActive, nv-item/nv-ico/nv-lbl classes
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 21 — 2026-03-25T13:09:56Z — OK
- **Log**: iteration-021.log

## Iteration 22 — 2026-03-25 — OK

**Item**: [frontend] `/referrals` route + `ReferralPage` shell with unauthenticated/authenticated states
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/ReferralPage.tsx`:
  - Unauthenticated state: shows referral program description (10% fee share for referrers, 10% fee rebate for referees) + "Connect your wallet to get started" prompt
  - Authenticated state: page shell with header ("Referrals" title, subtitle) and content area with placeholder comments for §1-§4 sections (to be filled in by subsequent iterations)
  - Uses `useSession().isAuthenticated` and `useWallet().connected` for auth check
- Updated `features/referral/index.ts`: added `ReferralPage` to barrel export
- Updated `App.tsx`:
  - Added `ReferralPage` to the `useReferralApply, ReferralPage` import from `./features/referral`
  - Added `<Route path="/referrals" element={<RouteErrorBoundary label="Referrals"><ReferralPage /></RouteErrorBoundary>} />` after the fairness route
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 22 — 2026-03-25T13:14:57Z — OK
- **Log**: iteration-022.log

## Iteration 23 — 2026-03-25 — OK

**Item**: [frontend] Referral page §1: "Your Referral Link" card
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/ReferralLinkCard.tsx`:
  - Three states: loading (skeleton), no-code (input form), code-exists (display + copy)
  - Custom code input with `taunt.bet/r/` prefix, validates 3-16 chars `[a-z0-9-]` inline
  - "Set Code" button calls `setReferralCode()` API, shows "Saving..." during request
  - Display mode shows full URL in read-only input + "Copy Link" button with "Copied!" feedback (2s)
  - "Change code" link enters inline edit mode with current code pre-filled + Cancel button
  - Error handling: inline error message for validation failures and API errors (e.g., code taken)
  - Fetches existing code on mount via `getReferralCode()`, handles 404 gracefully
- Updated `ReferralPage.tsx`: imported `ReferralLinkCard`, replaced §1 placeholder comment
- Added CSS in `index.css`: `.referral-page` layout + `.ref-link-card` card styles (dark card, green accents, JetBrains Mono for URLs, consistent with site theme)
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 23 — 2026-03-25T13:20:54Z — OK
- **Log**: iteration-023.log

## Iteration 24 — 2026-03-25 — OK

**Item**: [frontend] Referral page §2: Stats summary card
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/ReferralStatsCard.tsx`:
  - Fetches stats on mount via `getReferralStats(accessToken)` with cancellation guard
  - Four stat boxes in a grid: Referred Players, Active (7d), Total Volume (SOL), Total Earned (SOL)
  - `formatSol()` helper: lamports string → SOL with compact display (1.2k, 1M) for large values, 4 decimal places for small
  - Loading state: skeleton placeholders per stat box (28px height, pulse animation)
  - Error handling: silently falls back to zeros on fetch failure
- Updated `ReferralPage.tsx`: imported `ReferralStatsCard`, replaced §2 placeholder comment
- Added CSS in `index.css`: `.ref-stats-card` styles (card, 4-column grid, JetBrains Mono values, responsive 2-column at 600px)
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps) — not introduced by this change.

## Iteration 24 — 2026-03-25T13:26:36Z — OK
- **Log**: iteration-024.log

## Iteration 25 — 2026-03-25 — OK

**Item**: [frontend] Referral page §3: Pending balance card with claim flow
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/ReferralClaimCard.tsx`:
  - Fetches stats on mount via `getReferralStats()` for pending balance + breakdown
  - Displays unified pending balance prominently (2rem, JetBrains Mono, bold)
  - Breakdown rows: "From referrals: X SOL" + "From fee rebates: Y SOL" using `totalEarnedLamports` and `totalRebateLamports`
  - Claim button: disabled below threshold (0.01 SOL), shows "Claiming..." during request, "Processing..." while polling
  - Polls `GET /referral/claim/:claimId` every 3s until terminal status
  - Success state: green banner with amount + "View transaction" link to Solana Explorer via `explorerTxUrl()`
  - Error state: red banner with retry guidance
  - Loading skeleton while stats fetch in progress
- Added `totalRebateLamports` to `ReferralStats` interface in `db.ts` + stats query + route response + frontend API type
- Updated `ReferralPage.tsx`: imported `ReferralClaimCard`, replaced §3 placeholder comment
- Added CSS in `index.css`: `.ref-claim-card` styles (card, balance, breakdown, success/error banners, button states)
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps in endpoints.test.ts) — no new errors introduced.

## Iteration 25 — 2026-03-25T13:32:26Z — OK
- **Log**: iteration-025.log

## Iteration 26 — 2026-03-25 — OK

**Item**: [frontend] Referral page §4: Earnings history table
**Status**: Done
**Changes**:
- Created `apps/platform/src/features/referral/ReferralEarningsTable.tsx`:
  - Fetches paginated earnings on mount via `getReferralEarnings(accessToken, page, PAGE_SIZE)`
  - Table columns: Date (MM/DD HH:MM), Game (formatted), Referee (truncated wallet), Wager (SOL), Your Earning (+SOL, green)
  - Empty state: "No earnings yet. Share your link to start earning!"
  - Loading state: 3 skeleton rows with pulse animation
  - Pagination controls: Prev/Next buttons with "page / totalPages" display, disabled at bounds
  - `truncateWallet()`: "Ab12...Xy9z" format for compact display
  - `formatGameType()`: maps `coinflip` → "Coinflip", `lord_of_rngs` → "Lord of RNGs"
  - Overflow-x scrollable table wrapper for mobile
- Updated `ReferralPage.tsx`: imported `ReferralEarningsTable`, replaced §4 placeholder comment
- Added CSS in `index.css`: `.ref-earnings` styles (card, table, pagination, skeleton, empty state, monospace cells, green earning highlight)
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps in endpoints.test.ts) — not introduced by this change.

## Iteration 26 — 2026-03-25T13:37:08Z — OK
- **Log**: iteration-026.log

## Iteration 27 — 2026-03-25 — OK

**Item**: [frontend] Profile settings: "Referral Code" section in profile settings tab
**Status**: Done
**Changes**:
- Added `GET /referrer` endpoint to `services/backend/src/routes/referral.ts`:
  - Returns `{ referrerWallet, linkedAt }` if user has a referrer, 404 otherwise
  - Uses existing `db.getReferralLinkByReferee(wallet)` method
- Added `ReferrerResponse` type + `getReferrer(token)` function to `apps/platform/src/lib/referral-api.ts`
- Updated `ProfileSettings.tsx` (`features/player-profile/components/ProfileSettings.tsx`):
  - Fetches referrer status on mount via `getReferrer()`
  - If referrer exists: read-only "Referred by: [truncated wallet]" with link icon (green, monospace)
  - If no referrer: input field + "Apply" button calling `POST /referral/apply`
  - Success state: green confirmation message about 10% fee rebate
  - Inline error states: self-referral, already linked, code not found, generic errors
  - Loading skeleton while referrer status fetches
- Added CSS in `index.css`: referral section styles (skeleton, linked state, hint, error, success, disabled button)
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps in endpoints.test.ts) — not introduced by this change.

## Iteration 27 — 2026-03-25T13:43:13Z — OK
- **Log**: iteration-027.log

## Iteration 28 — 2026-03-25 — OK

**Item**: [test] Backend unit tests for referral routes
**Status**: Done
**Changes**:
- Created `services/backend/src/__tests__/referral-routes.test.ts` with 29 test cases covering all referral route endpoints:
  - POST /referral/code: happy path, short/long/invalid code validation, uniqueness (409), same-wallet update
  - GET /referral/code: happy path, 404 when no code set
  - POST /referral/apply: happy path, self-referral (400), already linked (409), non-existent code (404), empty code (400)
  - GET /referral/stats: zeroed stats, referred count after linking
  - GET /referral/earnings: empty results, single earning, pagination with page/limit
  - POST /referral/claim: zero balance (400), below threshold (400), valid claim (202), double-claim prevention, event queue verification
  - GET /referral/claim/:claimId: owner access, 404 for non-existent, 404 for non-owner (prevents enumeration)
  - GET /referral/referrer: 404 when not referred, returns referrer after linking
  - Authentication: 401 without JWT
- Uses real Postgres (same pattern as auth-routes.test.ts) with TRUNCATE between tests
- Handles Unix socket fallback for dev container connectivity
**Verification**: `pnpm lint` passed (18/18). All 29 tests pass.

## Iteration 28 — 2026-03-25T13:53:56Z — OK
- **Log**: iteration-028.log

## Iteration 29 — 2026-03-25 — OK

**Item**: [test] Backend integration test: settle a game for a referred player → verify referral_earnings row with correct referrer_earned + referee_rebate amounts
**Status**: Done
**Changes**:
- Added 2 integration tests to `services/backend/src/__tests__/integration.test.ts`:
  - "settlement records referral earnings for referred player": sets up referral link (referrer → opponent), creates + settles coinflip match, verifies `referral_earnings` row with correct amounts (wager=5M, fee=250K, referrer_earned=25K at 1000 bps, referee_rebate=25K at 1000 bps)
  - "settlement uses KOL custom rate for referrer earnings": same flow but with KOL rate override (2000 bps), verifies referrer_earned=50K while referee_rebate stays at 25K (fixed 10%)
- Fixed pre-existing integration test bug: added PlatformConfig mock account setup (settlement reads fee_bps from PlatformConfig PDA, not CoinflipConfig PDA). All 4 original tests were silently broken by this.
- Added `buildPlatformConfigData()` helper to construct mock PlatformConfig account data (8-byte disc + 32-byte authority + 32-byte treasury + 2-byte fee_bps)
- Added `resetPlatformConfigCache()` export to `platform-config.ts` for test isolation
- Added Unix socket fallback via `makeSql()` helper (same pattern as referral-routes.test.ts)
- Added referral migration execution in `beforeAll` (idempotent)
- Added referral tables to TRUNCATE in `beforeEach` for isolation
**Verification**: `pnpm lint` passed (18/18). All 6 integration tests pass (4 original + 2 new).

## Iteration 29 — 2026-03-25T14:07:02Z — OK
- **Log**: iteration-029.log

## Iteration 30 — 2026-03-25 — OK

**Item**: [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**`
**Status**: Done
**Changes**:
- Created `apps/platform/e2e/local/30-referral.spec.ts` with Playwright test covering the primary referral user flow:
  - Player A navigates to `/referrals`, sets custom referral code "e2e-ref-test", verifies URL display mode
  - Verifies all page sections render (stats card, claim card, earnings table with empty state)
  - Player B visits `/r/e2e-ref-test` → ReferralCapture stores code in localStorage → redirects to `/` → `useReferralApply` hook auto-applies on auth
  - Waits for `POST /referral/apply` response (200) to confirm apply succeeded
  - Player B navigates to `/profile` → Settings tab → verifies "Referred by:" linked status
  - Player A refreshes `/referrals` → stats show "1" referred player
  - Verifies sidebar nav has Referrals link (`a[href="/referrals"]`)
  - Console error tracking on both players (assertClean)
- Uses dual-player fixtures (playerAPage/playerBPage) with deterministic keypairs
- Serial test mode, `beforeAll` with `fundTestWallets()` + `initializeLocalnet()`
- Auth-aware: uses `waitForResponse` for `/auth/` before interacting with auth-gated UI
**Verification**: `pnpm lint` passed (18/18). Platform typecheck passed. Pre-existing backend typecheck error (HealthDeps in endpoints.test.ts) — not introduced by this change.

## Iteration 30 — 2026-03-25T14:18:54Z — OK
- **Log**: iteration-030.log

## Iteration 31 — 2026-03-25 — OK

**Item**: [test] Add visual route/state coverage in `e2e/visual/**`
**Status**: Done
**Changes**:
- Added `/referrals` route baseline test to `e2e/visual/routes.spec.ts` (between leaderboard and 404)
- Added "Referrals page" state variants to `e2e/visual/states.spec.ts`:
  - "wallet disconnected": clears localStorage, navigates to `/referrals`, waits for `.referral-page__connect`, captures screenshot
  - "wallet connected": connects wallet, waits for `.referral-page__content`, re-freezes animations, captures screenshot
- Follows existing patterns: `stablePage` fixture, `addInitScript` for localStorage, animation freeze CSS re-injection, 300ms settle time
- `pnpm test:visual` run results: 22 passed, 7 failed:
  - 3 expected failures: new referral tests need baselines generated (referrals.png, referrals-disconnected.png, referrals-connected.png)
  - 4 expected failures: coinflip tests have sidebar height delta from new "Referrals" nav item (intentional change from iteration 21)
**Verification**: `pnpm lint` passed (18/18). Tests are properly structured and discoverable (29 tests in 2 files). Baseline generation deferred to next checklist item.

## Iteration 31 — 2026-03-25T14:33:09Z — OK
- **Log**: iteration-031.log

## Iteration 32 — 2026-03-25 — OK

**Item**: [test] Update visual baselines for `/referrals` page (new page) and sidebar (new nav item)
**Status**: Done
**Changes**:
- Fixed `referrals-connected` visual test: added `addInitScript`-based fetch mock for auth (`/auth/challenge`, `/auth/verify`) and referral API endpoints (`/referral/code`, `/referral/stats`, `/referral/earnings`). The ReferralPage requires `isAuthenticated` which needs backend JWT auth — mock mode has no backend, so the test previously timed out waiting for `.referral-page__content`.
- Generated new baseline `referrals-connected.png`: shows authenticated referral page with code input, zero-value stats, empty earnings table, disabled claim button.
- Regenerated 5 baselines with sidebar height changes from new "Referrals" nav item (added in iteration 21): `coinflip.png`, `home-disconnected.png`, `coinflip-disconnected.png`, `coinflip-connected.png`, `coinflip-error-toast-position.png`.
- Existing baselines `referrals.png` and `referrals-disconnected.png` were already up-to-date.
- Visual evaluation: **PASS** — all changes match spec intent (new referral page + sidebar nav item).
**Verification**: `pnpm lint` passed (18/18). `pnpm test:visual` passed (29/29). Baseline stable across 3 consecutive runs.

## Iteration 32 — 2026-03-25T15:18:13Z — OK
- **Log**: iteration-032.log

## Iteration 33 — 2026-03-25 — OK

**Item**: [test] Devnet real-provider E2E coverage (mark N/A)
**Status**: Done (N/A)
**Changes**:
- Marked checklist item N/A: spec 300 is entirely off-chain per System Invariant 7 — no VRF, oracle, or external provider integration exists in this spec
- Fixed pre-existing `HealthDeps` typecheck error in `endpoints.test.ts`: added missing `sql: rawSql` parameter to `createHealthRoutes()` call (the `sql` property was added to `HealthDeps` interface by spec 301 event queue but the test wasn't updated)
- Updated spec Meta Status to `Done`
**Verification**: `pnpm lint` passed (18/18). `pnpm typecheck` passed (18/18). `pnpm build` fails pre-existing (vite-plugin-node-polyfills/shims/buffer in game-engine — confirmed identical failure on stashed/clean state, unrelated to spec 300).

## Iteration 33 — 2026-03-25T15:24:24Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-033.log

## Devnet E2E — 2026-03-25T15:24:25Z
- **Result**: PASS

## Gap Analysis — 2026-03-25 (post-completion)
- **Result**: Gap analysis report generated (full post-completion audit)
- **Report**: gap-analysis.md
- **Totals**: 84 SATISFIED, 0 DEFERRED, 6 GAP (90 total criteria)
- **Gaps**:
  1. FR-6: Concurrent claims — no DB-level locking on balance snapshot (moderate)
  2. FR-7: Rate limiting not applied to /referral/* routes (moderate)
  3. FR-9a: Toast notification for invalid/expired codes — uses console.warn (low)
  4. FR-9f: Success toast on auto-apply — uses console.warn (low)
  5. FR-10: referral.game_settled event not emitted in settlement (low)
  6. FR-11: Malformed payloads cause retry instead of dead-letter (low)
- **Spec FR checkboxes**: Updated with evidence annotations (84 satisfied, 6 gaps annotated)

## Gap Analysis — 2026-03-25T15:37:56Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

