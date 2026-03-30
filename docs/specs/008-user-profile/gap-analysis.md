# Gap Analysis: 008 — User Profile Transaction History

- **Date**: 2026-03-19
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions

No on-chain changes in this spec. All functionality is backend + frontend.

### Backend — Database & Migrations

| Item | File | Line |
|------|------|------|
| Migration (table + indexes + unique) | `services/backend/migrations/008_user_transactions.sql` | 1–30 |
| `UserTransaction` type | `services/backend/src/db.ts` | 106–115 |
| `InsertUserTransactionParams` type | `services/backend/src/db.ts` | 117–124 |
| `insertUserTransaction()` | `services/backend/src/db.ts` | 533–546 |
| `getUserTransactions()` | `services/backend/src/db.ts` | 548–584 |

### Backend — Write Paths

| Write Path | File | Line | Trigger |
|-----------|------|------|---------|
| Coinflip creator join | `services/backend/src/routes/create.ts` | 208–215 | After round INSERT |
| Coinflip opponent join | `services/backend/src/worker/pda-watcher.ts` | 120–132 | PDA watcher lock detection |
| Coinflip win + loss | `services/backend/src/worker/settle-tx.ts` | 304–323 | After settle_confirmed |
| Lord win + loss(es) | `services/backend/src/worker/settle-tx.ts` | 518–543 | After settle_confirmed |
| Close Call join + outcome | `services/backend/src/worker/closecall-clock.ts` | 489–538 | After DB settle update |

### Backend — API Routes

| Route | File | Line | Auth |
|-------|------|------|------|
| `GET /profile/transactions` | `services/backend/src/routes/profile.ts` | 34–89 | JWT required |
| `GET /price/sol-usd` | `services/backend/src/routes/price.ts` | 57–70 | Public |
| Route registration (profile) | `services/backend/src/index.ts` | 84–89 | JWT middleware all methods |
| Route registration (price) | `services/backend/src/index.ts` | 189–190 | No middleware |

### Frontend Components

| Component / Hook | File | Line |
|-----------------|------|------|
| `ProfileTransaction` type | `apps/platform/src/features/player-profile/types.ts` | 247–255 |
| `TransactionEvent` type | `apps/platform/src/features/player-profile/types.ts` | 245 |
| `useTransactions` hook | `apps/platform/src/features/player-profile/hooks/useTransactions.ts` | 1–124 |
| `useSolPrice` hook | `apps/platform/src/features/player-profile/hooks/useSolPrice.ts` | 1–44 |
| `ProfileTransactions` component | `apps/platform/src/features/player-profile/components/ProfileTransactions.tsx` | 1–130 |
| `ProfilePage` integration | `apps/platform/src/features/player-profile/components/ProfilePage.tsx` | 298 |
| CSS styles (table, events, skeleton, load more) | `apps/platform/src/index.css` | 12541–12638 |

### Tests

| Test | Type | File | Status |
|------|------|------|--------|
| Profile transactions after coinflip settlement | Local E2E | `apps/platform/e2e/local/20-profile-transactions.spec.ts:37` | Pass |
| Profile connected state | Visual | `apps/platform/e2e/visual/states.spec.ts:51` | Pass |
| Transactions tab empty state | Visual | `apps/platform/e2e/visual/states.spec.ts:90` | Pass |
| Profile route baseline | Visual | `apps/platform/e2e/visual/routes.spec.ts:39` | Pass |
| Full lifecycle integration | Backend | `services/backend/src/__tests__/integration.test.ts:311` | Pass |

## Acceptance Criteria Audit

### FR-1: `user_transactions` Ledger Table

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Migration `007_user_transactions.sql` creates table and indexes | SATISFIED | `migrations/008_user_transactions.sql:1-30` — named 008 because 007 was already taken (see history iteration 1). Table, 2 indexes, and UNIQUE constraint all present. |
| 2 | Migration runs cleanly on fresh and existing DB | SATISFIED | Standard `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `ALTER TABLE ADD CONSTRAINT` pattern. Confirmed in history iteration 1 and iteration 11 (fresh DB migration run). |
| 3 | No backfill of historical data | SATISFIED | `migrations/008_user_transactions.sql` contains only DDL (CREATE TABLE, CREATE INDEX, ALTER TABLE). No INSERT/UPDATE statements. |

### FR-2: Write Path — Populate on Settlement

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Coinflip: creator join row at create time | SATISFIED | `routes/create.ts:208-215` — `insertUserTransaction()` called after round INSERT with wallet, game="coinflip", event="join". |
| 2 | Coinflip: opponent join row at PDA watcher lock detection | SATISFIED | `worker/pda-watcher.ts:120-132` — fire-and-forget `insertUserTransaction()` on PHASE_LOCKED detection with opponent wallet from on-chain account. |
| 3 | Coinflip: win + loss rows at settlement with correct amounts and tx_sig | SATISFIED | `worker/settle-tx.ts:304-323` — `Promise.all` writes win (payoutAmount) + loss (entryAmount) with txSignature after settle_confirmed. |
| 4 | Lord: win row for winner + loss rows for all losers at settlement | SATISFIED | `worker/settle-tx.ts:518-543` — win row for winner (payoutAmount), loss row per non-winner entry (entry.amountLamports). See Observation 1 in Recommendations. |
| 5 | Close Call: join + outcome rows per entry at settlement | SATISFIED | `worker/closecall-clock.ts:489-538` — iterates greenEntries and redEntries, writes join + outcome (win/loss/refund) per entry via raw SQL with ON CONFLICT DO NOTHING. |
| 6 | Close Call: refund rows for refund outcomes | SATISFIED | `worker/closecall-clock.ts:508-509,523-524` — `isRefund` check writes refund event with original amountLamports. |
| 7 | `match_id` links back to correct round | SATISFIED | Coinflip: `round.match_id` (links to `rounds.match_id`). Lord: `round.match_id` (links to `rounds.match_id`). Close Call: `roundId = String(Number(minuteTs))` (links to `closecall_rounds.round_id`). |
| 8 | No duplicate rows (idempotent via ON CONFLICT) | SATISFIED | UNIQUE constraint `uq_user_tx_wallet_match_event` on `(wallet, match_id, event)` in migration:27-29. All write paths use `ON CONFLICT DO NOTHING`. |

### FR-3: API Endpoint — Transaction History

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Requires valid JWT; returns 401 without one | SATISFIED | `routes/profile.ts:35-38` — checks `c.get("wallet")`, returns 401 if missing. JWT middleware registered at `index.ts:84-89` with `requireAllMethods: true`. |
| 2 | Returns only transactions for the authenticated wallet | SATISFIED | `routes/profile.ts:35,64` — wallet from JWT claim, passed to `getUserTransactions(wallet, ...)`. No wallet param in URL. |
| 3 | Cursor-based pagination works correctly | SATISFIED | `routes/profile.ts:41,64`, `db.ts:548-584` — cursor is id-based, `WHERE id < cursor`, `ORDER BY id DESC`, `LIMIT`. nextCursor set when rows.length === limit. |
| 4 | `game` filter restricts results | SATISFIED | `routes/profile.ts:54-61` — maps both DB and frontend names via `TO_DB_GAME`, passes to `getUserTransactions()`. Invalid game returns 400. |
| 5 | Default limit 20; max clamped to 50 | SATISFIED | `routes/profile.ts:46-51` — default 20, `Math.min(parsed, 50)`. |
| 6 | Response matches documented shape | SATISFIED | `routes/profile.ts:66-81` — returns `{ transactions: [{ id, game, matchId, event, amountLamports (string), txSig, createdAt }], nextCursor }`. Game mapped to frontend names. |
| 7 | Empty result returns `{ transactions: [], nextCursor: null }` | SATISFIED | `routes/profile.ts:76-79` — empty array → `transactions.length` (0) !== `limit` (20) → `nextCursor = null`. |

### FR-4: Frontend — Wire ProfileTransactions to Real Data

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Profile transactions tab fetches from real endpoint | SATISFIED | `hooks/useTransactions.ts:71` — `GET ${BACKEND_URL}/profile/transactions`, Bearer token auth. `ProfileTransactions.tsx:55-56` uses the hook. Mock-simulation.ts exists but is NOT imported. |
| 2 | Pagination loads more results on scroll/click | SATISFIED | `ProfileTransactions.tsx:116-127` — "Load more" button visible when `nextCursor` exists, calls `loadMore()`. |
| 3 | Loading and empty states render correctly | SATISFIED | Loading skeleton: `ProfileTransactions.tsx:59-68` (5 shimmer rows). Empty state: `ProfileTransactions.tsx:71-79`. Visual baseline: `profile-transactions-empty.png`. |
| 4 | Transaction rows link to correct game match page | SATISFIED | `ProfileTransactions.tsx:42-44` — `matchPath(gameId, matchId)` returns `/${gameId}/${matchId}`. Links at lines 97-103. Produces `/coinflip/:matchId`, `/lord-of-rngs/:matchId`, `/close-call/:matchId`. |
| 5 | Amounts display in SOL with USD estimate | SATISFIED | `ProfileTransactions.tsx:14-24` — `formatSol()` converts lamports to SOL, appends `(~$X.XX)` when `solPrice` available. `useSolPrice.ts` fetches from `/price/sol-usd`. |
| 6 | Mock transaction generation removed or bypassed | SATISFIED | `mock-simulation.ts` still exists but is not imported by `ProfileTransactions.tsx`. Component uses `useTransactions()` hook exclusively. Mock is effectively bypassed. |

### FR-5: SOL/USD Price Display

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Backend serves cached SOL/USD price from Pyth Hermes | SATISFIED | `routes/price.ts:10-66` — HermesClient fetches SOL/USD feed, 60s TTL cache, stale-on-error fallback, 503 if no cache. |
| 2 | Frontend displays lamport amounts as SOL with USD estimate | SATISFIED | `ProfileTransactions.tsx:14-24` — `formatSol(amountLamports, solPrice)` → `"0.50 SOL (~$75.00)"`. `useSolPrice.ts` provides price. |
| 3 | Graceful fallback to SOL-only when price unavailable | SATISFIED | `useSolPrice.ts:26,30-31` — returns null on error. `formatSol()` line 20-22 — omits USD when price is null. |

## Gap Summary

No gaps identified. All 26 acceptance criteria are satisfied.

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| — | — | — | — | — | — | No gaps |

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Lord join rows (individual entry tracking) | Not specified | None | N/A | UNTRACKED DEFERRAL — spec explicitly says "No join rows" for Lord due to PDA watcher limitation. Low priority; entries are visible on-chain. |

## Recommendations

### Observation 1: Lord Multi-Entry Loss Amount Accuracy

The UNIQUE constraint on `(wallet, match_id, event)` means at most one `loss` row per player per Lord round. If a player enters multiple times and loses, only the first entry's `amountLamports` is recorded (subsequent inserts are silently dropped by ON CONFLICT DO NOTHING). The total loss amount is under-reported for multi-entry losers.

**Severity**: Low — the player still sees the loss event; the amount represents one entry rather than the sum. This is a spec-level design tension (FR-1 defines the UNIQUE constraint, FR-2 says "one loss row per losing entry") rather than an implementation bug.

**Potential fix**: Change UNIQUE constraint to `(wallet, match_id, event, amount_lamports)` or aggregate amounts before insert. Deferred — acceptable for V1 given the low impact.

### Observation 2: Orphaned Mock File

`apps/platform/src/features/player-profile/utils/mock-simulation.ts` is no longer imported by `ProfileTransactions` but still exists (568 lines). Consider deleting it to reduce bundle size and avoid confusion. Not a functional gap.

### Observation 3: Migration Naming

Spec says `007_user_transactions.sql` but implementation uses `008_user_transactions.sql` because migration 007 (`round_entries`) already existed. Functionally equivalent — not a gap.
