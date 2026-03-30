# Implementation History — 008-user-profile

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Migration + DB functions

**Item**: [engine] Migration + `insertUserTransaction` / `getUserTransactions`

**Changes**:
- Created `services/backend/migrations/008_user_transactions.sql` (named 008 since 007 already existed for `round_entries`). Table schema: `id BIGSERIAL PK`, `wallet TEXT`, `game TEXT`, `match_id TEXT`, `event TEXT`, `amount_lamports BIGINT`, `tx_sig TEXT`, `created_at TIMESTAMPTZ`. Indexes: `idx_user_tx_wallet_created`, `idx_user_tx_match_id`. UNIQUE constraint on `(wallet, match_id, event)` for ON CONFLICT DO NOTHING idempotency.
- Added to `db.ts`: types `UserTransactionEvent`, `UserTransaction`, `InsertUserTransactionParams`. Functions `insertUserTransaction()` (INSERT ... ON CONFLICT DO NOTHING) and `getUserTransactions()` (cursor-based pagination, optional game filter, max limit 50).

**Check**: `pnpm typecheck` and `pnpm lint` — both pass.

## Iteration 1 — 2026-03-19T18:43:27Z — OK
- **Log**: iteration-001.log

## Iteration 2 — Coinflip write paths

**Item**: [engine] Coinflip write paths — creator join, opponent join, win+loss at settlement

**Changes**:
- `services/backend/src/routes/create.ts`: Added `insertUserTransaction()` call after round INSERT to write creator `join` row (wallet, game="coinflip", matchId, amountLamports).
- `services/backend/src/worker/pda-watcher.ts`: Added `db: Db` to `PdaWatcherDeps` interface. In `handleCoinflipChange()`, after lock detection, fire-and-forget write of opponent `join` row using decoded match data (opponent wallet, entryAmount, matchId from on-chain account).
- `services/backend/src/worker/settle-tx.ts`: In `settleMatch()`, after `settle_confirmed` operator event, write `win` row (payoutAmount, txSig) and `loss` row (original entryAmount, txSig) in parallel via `Promise.all`. Loser derived as the non-winner of creator/opponent.
- `services/backend/src/index.ts`: Pass `db` to `createPdaWatcher()` call.

**Check**: Backend `tsc --noEmit` — pass. `pnpm lint` — pass. Pre-existing typecheck error in `CloseCallRoundPage.tsx` (not related to changes).

## Iteration 2 — 2026-03-19T18:48:15Z — OK
- **Log**: iteration-002.log

## Iteration 3 — Lord of the RNGs write paths

**Item**: [engine] Lord of the RNGs write paths — win + loss rows at settlement

**Changes**:
- `services/backend/src/worker/settle-tx.ts`: In `settleLordRound()`, after `settle_confirmed` operator event, added user transaction writes. One `win` row for the winner (amountLamports = payoutAmount, txSig) and one `loss` row per losing entry from `roundData.entries` (amountLamports = entry's individual amount, txSig). Game = "lord". Uses `Promise.all` for parallel writes. ON CONFLICT DO NOTHING handles duplicate entries for same player.

**Check**: `pnpm lint` — pass. `pnpm typecheck` — backend passes. Pre-existing platform typecheck error in `CloseCallRoundPage.tsx` (not related to changes).

## Iteration 3 — 2026-03-19T18:50:30Z — OK
- **Log**: iteration-003.log

## Iteration 4 — Close Call write paths

**Item**: [engine] Close Call write paths — join + outcome rows per entry at settlement

**Changes**:
- `services/backend/src/worker/closecall-clock.ts`: In `settleRound()`, after the DB settlement update, added user transaction writes using raw `sql` tagged template (consistent with file's existing pattern — this worker receives `sql` not the `Db` object). For each entry in `greenEntries` and `redEntries`: (a) one `join` row (amount = entry.amountLamports), (b) one outcome row — `win` with payout = `floor((entryAmount / sidePool) * netPool)` if on winning side, `loss` with original amount if on losing side, or `refund` with original amount if `isRefund`. Game = "closecall", match_id = round_id (minute timestamp). All writes use `ON CONFLICT DO NOTHING` for idempotency. Inserts are parallelized via `Promise.all`.

**Check**: `pnpm lint` — pass. `pnpm typecheck` — backend passes. Pre-existing platform typecheck error in `CloseCallRoundPage.tsx` (not related to changes).

## Iteration 4 — 2026-03-19T18:53:47Z — OK
- **Log**: iteration-004.log

## Iteration 5 — API route GET /profile/transactions

**Item**: [engine] API route `GET /profile/transactions`

**Changes**:
- `services/backend/src/middleware/jwt-auth.ts`: Added `requireAllMethods?: boolean` config option. When true, JWT verification applies to all HTTP methods (not just POST). Backward compatible — defaults to false.
- Created `services/backend/src/routes/profile.ts`: New route handler with `GET /transactions`. Extracts wallet from JWT `c.get("wallet")`. Supports query params: `cursor` (pagination by id), `limit` (default 20, max 50), `game` (accepts both DB names like `lord` and frontend names like `lord-of-rngs`). Maps response: `game` → frontend names (`lord` → `lord-of-rngs`, `closecall` → `close-call`), `amountLamports` as string, `matchId` camelCase, `createdAt` ISO string. Returns `{ transactions: [...], nextCursor: string | null }`.
- `services/backend/src/index.ts`: Registered profile routes at `/profile` with `requireAllMethods: true` JWT middleware.

**Check**: `pnpm lint` — pass. Backend `tsc --noEmit` — pass. Pre-existing platform typecheck error in `CloseCallRoundPage.tsx` (not related).

## Iteration 5 — 2026-03-19T18:57:43Z — OK
- **Log**: iteration-005.log

## Iteration 6 — SOL/USD price endpoint

**Item**: [engine] SOL/USD price endpoint — `GET /price/sol-usd`

**Changes**:
- Created `services/backend/src/routes/price.ts`: New route handler with `GET /sol-usd`. Uses `@pythnetwork/hermes-client` HermesClient to fetch SOL/USD price (feed ID `0xef0d8b...`). In-memory cache with 60s TTL — returns stale cache on fetch error (graceful degradation). Response: `{ price: number, expo: number, updatedAt: string }`. Returns 503 if no price available at all.
- `services/backend/src/index.ts`: Imported `createPriceRoutes`, registered at `/price` with no auth middleware (public endpoint).

**Check**: `pnpm lint` — pass (0 errors). Backend `tsc --noEmit` — pass. Pre-existing platform typecheck error in `CloseCallRoundPage.tsx` (not related).

## Iteration 6 — 2026-03-19T19:05:00Z — OK
- **Log**: iteration-006.log

## Iteration 6 — 2026-03-19T19:00:41Z — OK
- **Log**: iteration-006.log

## Iteration 7 — Wire ProfileTransactions to real API

**Item**: [frontend] Wire `ProfileTransactions` to real API

**Changes**:
- `apps/platform/src/features/player-profile/types.ts`: Updated `ProfileTransaction` type to match API shape — added `TransactionEvent` type (`join`/`win`/`loss`/`refund`), replaced `outcome`/`wagerAmount`/`payoutAmount`/`netResult`/`timestamp` fields with `event`/`amountLamports`/`txSig`/`createdAt`.
- `apps/platform/src/features/player-profile/utils/mock-simulation.ts`: Updated `recordTransaction()` to produce new-shaped `ProfileTransaction` objects (join + outcome rows per game result, amounts in lamports-as-string).
- Created `apps/platform/src/features/player-profile/hooks/useTransactions.ts`: New hook that fetches from `GET /profile/transactions` with JWT Bearer auth, supports cursor-based pagination and game filter, handles abort cleanup.
- `apps/platform/src/features/player-profile/components/ProfileTransactions.tsx`: Rewrote to use `useTransactions` hook. Removed mock `getTransactions` import. New columns: Time, Game (linked to match page), Event (color-coded), Amount (SOL). Added loading skeleton (shimmer animation), empty state, and "Load more" button for pagination.
- `apps/platform/src/features/player-profile/components/ProfilePage.tsx`: Removed `address` prop from `<ProfileTransactions>` (now uses JWT, not address).
- `apps/platform/src/features/player-profile/hooks/index.ts`: Exported `useTransactions` hook.
- `apps/platform/src/features/player-profile/index.ts`: Exported `TransactionEvent` type.
- `apps/platform/src/index.css`: Replaced old outcome/net styles with event type styles (win=green, loss=pink, join=muted, refund=blue), added match link hover, loading skeleton shimmer animation, load more button styles.

**Check**: `pnpm lint` — 0 errors (145 pre-existing warnings). `tsc --noEmit` — only pre-existing CloseCallRoundPage error (not related).

## Iteration 7 — 2026-03-19T19:09:37Z — OK
- **Log**: iteration-007.log

## Iteration 8 — SOL amount display with USD estimate

**Item**: [frontend] SOL amount display with USD estimate

**Changes**:
- Created `apps/platform/src/features/player-profile/hooks/useSolPrice.ts`: New hook that fetches `GET /price/sol-usd` from backend, caches price in React state, refreshes every 60s. Returns `number | null` — null when unavailable (graceful degradation).
- `apps/platform/src/features/player-profile/hooks/index.ts`: Exported `useSolPrice` hook.
- `apps/platform/src/features/player-profile/components/ProfileTransactions.tsx`: Updated `formatSol()` to accept optional `solUsdPrice` param. When price is available, displays `"0.50 SOL (~$75.00)"`. When null, shows SOL only. Added `useSolPrice()` call in component, passed to all amount cells.

**Check**: `pnpm lint` — 0 errors. `pnpm typecheck` — only pre-existing CloseCallRoundPage error (not related).

## Iteration 8 — 2026-03-19T19:11:52Z — OK
- **Log**: iteration-008.log

## Iteration 9 — Local E2E test for profile transactions

**Item**: [test] Add local deterministic E2E coverage for primary user flow(s)

**Changes**:
- Created `apps/platform/e2e/local/20-profile-transactions.spec.ts`: New Playwright test that exercises the full profile transactions flow. Plays a coinflip match (create → join → settle) to generate backend transaction rows, then navigates to /profile, waits for JWT auth restore (via `waitForResponse` on `/auth/`), clicks "Transactions" tab, and verifies: (a) exactly 2 rows appear (creator join + win/loss), (b) game name shows "Flip You", (c) event types include JOIN and WIN/LOSS, (d) amounts display in SOL, (e) match deep-links point to `/coinflip/:matchId`. Uses serial mode and existing dual-player fixture.

**Check**: `pnpm lint` — 0 errors. `pnpm typecheck` — only pre-existing CloseCallRoundPage error (not related).

## Iteration 9 — 2026-03-19T19:21:49Z — OK
- **Log**: iteration-009.log

## Iteration 10 — Visual test coverage for profile transactions

**Item**: [test] Add visual route/state coverage in `e2e/visual/**`

**Changes**:
- `apps/platform/e2e/visual/states.spec.ts`: Added "transactions tab — empty state" test to Profile page section. Connects wallet, clicks Transactions tab, waits for `.profile-transactions__empty` selector, takes fullPage screenshot with 0.03 maxDiffPixelRatio (avatar SVG variance). Existing route baseline (`profile.png`) covers disconnected state, existing state baseline (`profile-connected.png`) covers connected Statistics tab — new test adds coverage for the Transactions tab empty state introduced by this spec.
- `apps/platform/e2e/__snapshots__/visual/states.spec.ts/profile-transactions-empty.png`: New baseline — profile page with Transactions tab active showing "No transactions yet. Start playing to build your history!" empty state.

**Check**: `pnpm test:visual` — 26 passed (25 existing + 1 new), 0 failed. All existing baselines unchanged.

## Iteration 10 — OK
- **Log**: iteration-010.log

## Iteration 10 — 2026-03-19T19:33:10Z — OK
- **Log**: iteration-010.log

## Iteration 11 — Visual baselines + final verification

**Item**: [test] Update visual baselines for profile transactions page + [test] N/A external provider

**Changes**:
- Ran `pnpm test:visual` — all 26 tests pass, 0 failures. Baselines already up-to-date from iteration 10 (profile-transactions-empty.png). No baseline updates needed. **PASS** — only expected areas, no regressions.
- Marked N/A item for external provider/oracle/VRF integration (not in scope).
- Fixed pre-existing typecheck error in `CloseCallRoundPage.tsx:90` — added `as keyof typeof OUTCOME_COLORS` type assertion for `round.outcome` indexing.
- Fixed pre-existing test failure: ran pending DB migrations (005-008) so backend integration tests can access `entries` column on `rounds` table.
- Fixed pre-existing test failure: added `getBlockTime()` to MockConnection in `integration.test.ts` — settlement worker calls it but mock didn't implement it.
- **TS verification**: `./scripts/verify --ts` passes (lint + typecheck + build + test + visual).
- **Full verification**: `./scripts/verify` fails on 22 pre-existing Anchor test failures (platform `createPlayerProfile` removed 2026-03-12, lord `forceClose` issues). Zero Anchor/Solana changes in spec 008.

**Check**: `./scripts/verify --ts` — **PASS**. All 26 visual tests pass. All 49 backend tests pass (48 pass + 1 pre-existing skip resolved). Typecheck clean.

## Iteration 11 — 2026-03-19T20:25:00Z — OK
- **Log**: iteration-011.log

## Iteration 11 — 2026-03-19T21:49:08Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-011.log

## Devnet E2E — 2026-03-19T21:49:08Z
- **Result**: PASS

## Gap Analysis — 2026-03-19T21:56:06Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

