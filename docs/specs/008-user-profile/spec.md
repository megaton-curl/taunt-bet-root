# Specification: 008 User Profile — Transaction History

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P1 |
| Phase | 3 |
| NR_OF_TRIES | 11 |

---

## Overview

First iteration of player profiles. Players can view a chronological list of
their own game transactions — joins, wins, losses, and refunds — across all
games (Coinflip, Lord of the RNGs, Close Call). Data is stored in a new
backend ledger table and served via an authenticated API endpoint. The
existing mock-driven `ProfileTransactions` frontend component is wired to the
real data.

No on-chain footprint. No aggregate stats, XP, levels, or social features in
this iteration.

## User Stories

- As a player, I want to see every game transaction tied to my wallet so I can
  track what I wagered, won, or lost.
- As a player, I want the list to update automatically after a game settles so
  I don't have to refresh.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Phase 3 — "Basic player profile/history from
  indexed data"; Launch checklist — "Basic profile/history available and
  accurate"
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 3

## Required Context Files

- `services/backend/src/db.ts` — DB client & query functions
- `services/backend/src/worker/settle-tx.ts` — settlement write path (coinflip + lord)
- `services/backend/src/worker/closecall-clock.ts` — closecall settlement write path (settleRound function)
- `services/backend/src/routes/` — existing route patterns
- `services/backend/migrations/` — migration files (see Developer Reference below)
- `apps/platform/src/features/player-profile/` — mock profile system + components

## Contract Files

- `apps/platform/src/features/player-profile/types.ts` — `ProfileTransaction` type (frontend shape)
- `apps/platform/src/features/player-profile/components/ProfileTransactions.tsx` — table component to wire

---

## Functional Requirements

### FR-1: `user_transactions` Ledger Table

A new PostgreSQL table that stores one row per user-visible game event.

**Schema:**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `BIGSERIAL` | PK | Auto-increment |
| `wallet` | `TEXT` | NOT NULL | Player wallet address |
| `game` | `TEXT` | NOT NULL | `coinflip`, `lord`, `closecall` |
| `match_id` | `TEXT` | NOT NULL | Links to rounds/closecall_rounds |
| `event` | `TEXT` | NOT NULL | `join`, `win`, `loss`, `refund` |
| `amount_lamports` | `BIGINT` | NOT NULL | Wager (join) or payout (win) or refund amount |
| `tx_sig` | `TEXT` | | On-chain transaction signature (nullable until confirmed) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Event timestamp |

**Indexes:**
- `idx_user_tx_wallet_created` on `(wallet, created_at DESC)` — paginated history
- `idx_user_tx_match_id` on `(match_id)` — dedup / lookup

**Acceptance Criteria:**
- [x] Migration `007_user_transactions.sql` creates the table and indexes <!-- satisfied: migrations/008_user_transactions.sql:1-30 (named 008 because 007 was taken) — table, 2 indexes, UNIQUE constraint -->
- [x] Migration runs cleanly on a fresh DB and on an existing DB <!-- satisfied: standard IF NOT EXISTS DDL pattern; confirmed in history iterations 1 + 11 -->
- [x] No backfill of historical data (table starts empty) <!-- satisfied: migrations/008_user_transactions.sql contains only DDL, no INSERT/UPDATE -->

### FR-2: Write Path — Populate on Settlement

The settlement worker writes to `user_transactions` when a round settles.
All writes use `ON CONFLICT DO NOTHING` on `(wallet, match_id, event)` for
idempotency.

**Coinflip** (commit-reveal, 1v1):
- **Join — creator**: Written when the create route inserts the round into DB
  (creator wallet is known at create time).
- **Join — opponent**: Written when PDA watcher detects phase change to LOCKED
  (opponent wallet readable from on-chain account).
- **Win + Loss**: On `settle_confirmed` in `settle-tx.ts`, insert two rows.
  `win.amount_lamports` = payout (after fees). `loss.amount_lamports` =
  original wager.

**Lord of the RNGs** (commit-reveal, multi-player):
- **No join rows** — the PDA watcher sees the round state change but not
  individual entries. Join visibility is deferred.
- **Win + Loss**: On `settle_confirmed` in `settle-tx.ts`, insert one `win`
  row for the winner and one `loss` row per losing entry. Entries array is
  available from on-chain round data at settlement time.

**Close Call** (pari-mutuel):
- **All rows at settlement**: When `settleRound()` in `closecall-clock.ts`
  completes, write one `join` + one outcome (`win`/`loss`/`refund`) row per
  entry. Entries are in the round's `green_entries`/`red_entries` JSONB.
- **Refund rows**: Only Close Call has backend-processed refunds (one-sided
  rounds, single player, equal price). Coinflip/Lord refunds are
  permissionless on-chain timeout — the backend doesn't process them.

**Game name mapping**: DB stores `coinflip`, `lord`, `closecall`. API maps to
frontend `GameId`: `lord` → `lord-of-rngs`, `closecall` → `close-call`.

**Acceptance Criteria:**
- [x] Coinflip: creator join row written at create time <!-- satisfied: routes/create.ts:208-215 — insertUserTransaction after round INSERT -->
- [x] Coinflip: opponent join row written at PDA watcher lock detection <!-- satisfied: worker/pda-watcher.ts:120-132 — fire-and-forget on PHASE_LOCKED -->
- [x] Coinflip: win + loss rows written at settlement with correct amounts and tx_sig <!-- satisfied: worker/settle-tx.ts:304-323 — Promise.all win(payoutAmount)+loss(entryAmount) with txSignature -->
- [x] Lord: win row for winner + loss rows for all losers at settlement <!-- satisfied: worker/settle-tx.ts:518-543 — win(payoutAmount) + loss per non-winner entry -->
- [x] Close Call: join + outcome rows per entry at settlement <!-- satisfied: worker/closecall-clock.ts:489-538 — iterates green/red entries, join+outcome per entry -->
- [x] Close Call: refund rows written for refund outcomes <!-- satisfied: worker/closecall-clock.ts:508-509,523-524 — isRefund check writes refund event -->
- [x] `match_id` links back to the correct round in `rounds` or `closecall_rounds` <!-- satisfied: coinflip/lord use round.match_id→rounds; closecall uses roundId→closecall_rounds.round_id -->
- [x] No duplicate rows for the same event (idempotent via ON CONFLICT) <!-- satisfied: UNIQUE(wallet,match_id,event) in migration:27-29; all paths use ON CONFLICT DO NOTHING -->

### FR-3: API Endpoint — Transaction History

```
GET /profile/transactions?cursor=<id>&limit=<n>&game=<filter>
```

- **Auth**: JWT required. Returns transactions only for the authenticated
  wallet (from JWT `sub` claim). No wallet parameter in URL — prevents
  enumeration.
- **Pagination**: Cursor-based using `id` (descending). Default limit 20,
  max 50.
- **Filtering**: Optional `game` query param (`coinflip`, `lord`, `closecall`).
- **Response shape**:
  ```json
  {
    "transactions": [
      {
        "id": 123,
        "game": "coinflip",
        "matchId": "a1b2c3d4e5f67890",
        "event": "win",
        "amountLamports": "5000000",
        "txSig": "5KtP...",
        "createdAt": "2026-03-19T12:00:00Z"
      }
    ],
    "nextCursor": "122"
  }
  ```
- `amountLamports` serialized as string (BigInt safety).

**Acceptance Criteria:**
- [x] Endpoint requires valid JWT; returns 401 without one <!-- satisfied: routes/profile.ts:35-38 returns 401; index.ts:84-89 JWT middleware requireAllMethods -->
- [x] Returns only transactions for the authenticated wallet <!-- satisfied: routes/profile.ts:35,64 — wallet from JWT, no URL wallet param -->
- [x] Cursor-based pagination works correctly (forward traversal) <!-- satisfied: routes/profile.ts:41,76-79; db.ts:548-584 — id-based cursor, DESC order -->
- [x] `game` filter restricts results to the specified game <!-- satisfied: routes/profile.ts:54-61 — TO_DB_GAME mapping, invalid game returns 400 -->
- [x] Default limit is 20; max clamped to 50 <!-- satisfied: routes/profile.ts:46-51 — default 20, Math.min(parsed, 50) -->
- [x] Response matches the documented shape <!-- satisfied: routes/profile.ts:66-81 — id, game (frontend-mapped), matchId, event, amountLamports (string), txSig, createdAt -->
- [x] Empty result returns `{ "transactions": [], "nextCursor": null }` <!-- satisfied: routes/profile.ts:76-79 — empty array length !== limit → nextCursor = null -->

### FR-4: Frontend — Wire ProfileTransactions to Real Data

Replace mock transaction data in the profile page with real API calls.

- Fetch from `GET /profile/transactions` using the existing auth token.
- Infinite scroll or "load more" pagination using `nextCursor`.
- Show loading skeleton while fetching.
- Show empty state when no transactions exist.
- Each row links to the match deep-link page (`/coinflip/:matchId`,
  `/lord-of-rngs/:matchId`, `/close-call/:matchId`).

**Acceptance Criteria:**
- [x] Profile transactions tab fetches from the real endpoint <!-- satisfied: hooks/useTransactions.ts:71 GET /profile/transactions; ProfileTransactions.tsx:55-56 uses hook -->
- [x] Pagination loads more results on scroll/click <!-- satisfied: ProfileTransactions.tsx:116-127 — "Load more" button with nextCursor -->
- [x] Loading and empty states render correctly <!-- satisfied: ProfileTransactions.tsx:59-68 skeleton, :71-79 empty state; visual baseline profile-transactions-empty.png -->
- [x] Transaction rows link to the correct game match page <!-- satisfied: ProfileTransactions.tsx:42-44,97-103 — matchPath(gameId, matchId) → /{gameId}/{matchId} -->
- [x] Amounts display in SOL with USD estimate (via Pyth SOL/USD feed) <!-- satisfied: ProfileTransactions.tsx:14-24 formatSol(); useSolPrice.ts fetches /price/sol-usd -->
- [x] Mock transaction generation is removed or bypassed when real data is available <!-- satisfied: mock-simulation.ts exists but not imported by ProfileTransactions; useTransactions hook is sole data source -->

### FR-5: SOL/USD Price Display

Transaction amounts are stored in lamports. The frontend displays them in SOL
with a USD estimate using the Pyth SOL/USD price feed (Hermes REST API —
already used for Close Call BTC/USD prices).

- Backend exposes a cached `GET /price/sol-usd` endpoint (or piggybacks on an
  existing price infrastructure). Cache TTL ~60s.
- Frontend fetches the SOL/USD price and displays amounts as e.g.
  `0.50 SOL (~$75.00)`.
- If price is unavailable, show SOL amount only (no USD estimate). No error
  state — graceful degradation.

**Acceptance Criteria:**
- [x] Backend serves cached SOL/USD price from Pyth Hermes <!-- satisfied: routes/price.ts:10-66 — HermesClient, SOL/USD feed, 60s TTL cache, stale-on-error -->
- [x] Frontend displays lamport amounts as SOL with USD estimate <!-- satisfied: ProfileTransactions.tsx:14-24 formatSol(amount, solPrice) → "0.50 SOL (~$75.00)" -->
- [x] Graceful fallback to SOL-only when price unavailable <!-- satisfied: useSolPrice.ts returns null on error; formatSol omits USD when price=null -->

---

## Success Criteria

- A player who completes a game sees the transaction appear in their profile
  within seconds of settlement
- Transaction list is accurate — amounts, outcomes, and game types match
  on-chain reality
- Profile page loads transaction history performantly (< 500ms for first page)

---

## Dependencies

- JWT auth system (spec 007 — already shipped)
- Settlement worker (coinflip + lord + closecall — already shipped)
- PDA watcher for join detection (already shipped)

## Assumptions

- No backfill of historical data — table starts empty, only new events recorded
- Close Call enforces one entry per player per round (on-chain constraint)
- No aggregate stats (win rate, total wagered, P&L) in this iteration
- No other players' transaction visibility — own wallet only

---

## Developer Reference

> These notes exist so the implementor doesn't have to re-discover project
> conventions each time.

### Database & Migrations

| What | Where |
|------|-------|
| Migration files | `services/backend/migrations/NNN_snake_name.sql` |
| Migration runner | `services/backend/src/migrate.ts` — auto-runs on server start (`pnpm start` = `migrate && server`) |
| DB client + query fns | `services/backend/src/db.ts` |
| DB config (schema) | `services/backend/src/db-config.ts` — supports `DB_SCHEMA` env var |
| Connection library | `postgres` (v3.4.0) — tagged template literal style |

**Naming**: Files are `NNN_description.sql` where NNN is zero-padded sequential.
Next available: `007`.

**Runner behavior**: Reads `migrations/` dir, parses version from filename
prefix, tracks applied versions in `_migrations` table, applies pending ones
inside `sql.begin()` transactions. Idempotent — safe to re-run.

**Manual run**: `cd services/backend && pnpm migrate` (uses `.env`).
**Check status**: `pnpm migrate:status`.

### Settlement Write Paths (where to add INSERTs)

| Game | File | Function | Insert after |
|------|------|----------|-------------|
| Coinflip settle | `src/worker/settle-tx.ts` | `settleMatch()` | After `settle_confirmed` operator event (~line 286) |
| Lord settle | `src/worker/settle-tx.ts` | `settleLordRound()` | After `settle_confirmed` operator event (~line 466) |
| Close Call settle | `src/worker/closecall-clock.ts` | `settleRound()` | After DB update (~line 443-487) |
| Coinflip creator join | `src/routes/create.ts` | POST `/fairness/coinflip/create` | After round INSERT |
| Coinflip opponent join | `src/worker/pda-watcher.ts` | `handleCoinflipChange()` | After lock detection (~line 113) |
| Close Call join+outcome | `src/worker/closecall-clock.ts` | `settleRound()` | Same as settle — all rows at settlement |

### Existing Schema (for reference)

| Table | PK | Purpose |
|-------|----|---------|
| `rounds` | `pda` | Commit-reveal rounds (coinflip + lord). Has `creator`, `winner`, `settle_tx`, `amount_lamports`, `match_id` |
| `closecall_rounds` | `round_id` | Pari-mutuel rounds. Entries in JSONB: `green_entries` / `red_entries` = `[{ player, amountLamports }]` |
| `operator_events` | `id` | Audit log. `event_type` + JSONB `payload` |
| `auth_challenges` | `nonce` | JWT challenge nonces |
| `refresh_tokens` | `id` | JWT refresh token families |
| `closecall_candles` | `minute_ts` | Cached Hermes BTC prices |

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Migration creates table + indexes | Run `pnpm migrate` on fresh + existing DB | Migration status shows applied |
| 2 | Settlement writes correct rows | Settle a coinflip match on devnet, query table | Row with correct wallet, game, event, amount, tx_sig |
| 3 | API returns own transactions only | Call endpoint with two different JWTs | Each sees only their own rows |
| 4 | Pagination works | Insert > 20 rows, paginate | Second page returns remaining rows |
| 5 | Frontend displays real data | Play a game, check profile page | Transaction appears with correct details |

---

## Completion Signal

### Implementation Checklist

- [x] [engine] Migration `007_user_transactions.sql` — create table with schema from FR-1 (id, wallet, game, match_id, event, amount_lamports, tx_sig, created_at) + indexes `idx_user_tx_wallet_created` and `idx_user_tx_match_id` + UNIQUE constraint on `(wallet, match_id, event)` for idempotency. Add `insertUserTransaction()` and `getUserTransactions(wallet, cursor?, limit?, game?)` query functions to `db.ts`. Verify migration runs cleanly: `cd services/backend && pnpm migrate:status`. (done: iteration 1)
- [x] [engine] Coinflip write paths — (a) In `src/routes/create.ts`: after inserting round into DB, write a `join` row for the creator (wallet = creator, game = "coinflip", amount_lamports = wager). (b) In `src/worker/pda-watcher.ts` `handleCoinflipChange()`: after lock detection (~line 113), read opponent from on-chain account, write a `join` row for the opponent. (c) In `src/worker/settle-tx.ts` `settleMatch()`: after `settle_confirmed` event (~line 286), write one `win` row (amount_lamports = payoutAmount) and one `loss` row (amount_lamports = original wager) with tx_sig. All writes use `ON CONFLICT DO NOTHING`. (done: iteration 2)
- [x] [engine] Lord of the RNGs write paths — In `src/worker/settle-tx.ts` `settleLordRound()`: after `settle_confirmed` event (~line 466), write one `win` row for the winner (amount_lamports = payoutAmount) and one `loss` row per losing entry (amount_lamports = that entry's amountLamports). Entries array is available from `roundData.entries`. Game = "lord". No join rows for Lord (deferred — PDA watcher doesn't see individual entries). All writes use `ON CONFLICT DO NOTHING`. (done: iteration 3)
- [x] [engine] Close Call write paths — In `src/worker/closecall-clock.ts` `settleRound()`: after DB settle update (~line 487), iterate `green_entries` and `red_entries` arrays. For each entry write: (a) one `join` row (amount_lamports = entry.amountLamports), (b) one outcome row — `win` (amount_lamports = computed payout) if entry is on winning side, `loss` (amount_lamports = entry.amountLamports) if losing side, or `refund` (amount_lamports = entry.amountLamports) if `isRefund`. Game = "closecall", match_id = round_id. Payout per winner = `(entryAmount / winningSidePool) * (totalPool - fee)`. All writes use `ON CONFLICT DO NOTHING`. (done: iteration 4)
- [x] [engine] API route `GET /profile/transactions` — Add `src/routes/profile.ts`, register at `/profile/transactions`. Require JWT auth middleware (reuse existing). Extract wallet from `req.auth.sub`. Query params: `cursor` (id, optional), `limit` (default 20, max 50), `game` (optional filter — accept both DB names and frontend names: `lord`/`lord-of-rngs`, `closecall`/`close-call`). Call `db.getUserTransactions()`. Map response: `game` field mapped to frontend names (`lord` → `lord-of-rngs`, `closecall` → `close-call`), `amountLamports` as string, `matchId` camelCase. Return `{ transactions: [...], nextCursor: string | null }`. (done: iteration 5)
- [x] [engine] SOL/USD price endpoint — Add `GET /price/sol-usd` to backend. Fetch from Pyth Hermes REST API (SOL/USD feed ID: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`). Cache in-memory with ~60s TTL. Response: `{ price: number, expo: number, updatedAt: string }`. No auth required (public endpoint). Reuse existing Hermes fetch patterns from `closecall-clock.ts`. (done: iteration 6)
- [x] [frontend] Wire `ProfileTransactions` to real API — Update `ProfileTransaction` type in `types.ts` to match API shape: add `event` field (`join`/`win`/`loss`/`refund`), rename `outcome` → `event`, keep `gameId` mapped from API `game`. Create `useTransactions(cursor?, game?)` hook that calls `GET /profile/transactions` with auth header. Replace `getTransactions()` mock import in `ProfileTransactions.tsx` with the hook. Implement "Load more" button using `nextCursor`. Add loading skeleton and empty state. Each row links to deep-link page: `/coinflip/:matchId`, `/lord-of-rngs/:matchId`, `/close-call/:matchId` based on game. Display `join`/`win`/`loss`/`refund` event types with appropriate styling. (done: iteration 7)
- [x] [frontend] SOL amount display with USD estimate — Fetch SOL/USD price from `GET /price/sol-usd` (create `useSolPrice()` hook, cache in React state, refresh every 60s). Convert lamports → SOL (`amount / 1e9`). Display as `"0.50 SOL (~$75.00)"`. If price unavailable, show SOL only (no error). Apply to all amount cells in `ProfileTransactions`. (done: iteration 8)
- [x] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) (done: iteration 9)
- [x] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes (done: iteration 10)
- [x] [test] Update visual baselines for profile transactions page. Run `pnpm test:visual` to identify failures, then `pnpm test:visual:update` to regenerate. **Before committing**: read old baseline and new screenshot for each changed page (use Read tool on PNG files). Evaluate: **PASS** (changes clearly match spec intent, only expected areas changed) → commit updated baselines. **REVIEW** (changes look plausible but unexpected areas also changed, or uncertain) → do NOT commit baselines. Save the diff images from `test-results/` to `docs/specs/008-user-profile/visual-review/`, describe concerns in `history.md`, output `<blocker>Visual review needed: [describe what looks off]</blocker>`. **FAIL** (layout broken, elements missing, clearly wrong) → fix the code, do NOT update baselines. (done: iteration 11)
- [x] [test] N/A — no external provider/oracle/VRF integration in scope for this spec (done: iteration 11)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Visual Regression
- [ ] `pnpm test:visual` passes (all baselines match)
- [ ] If this spec changes UI: affected baselines regenerated and committed
- [ ] Local deterministic E2E passes (`pnpm test:e2e`) for user-facing flows
- [ ] Devnet real-provider E2E: N/A for this spec

#### Visual Verification (if UI)
- [ ] Desktop view correct
- [ ] Mobile view correct

#### Console/Network Check (if web)
- [ ] No JS console errors
- [ ] No failed network requests

#### Smoke Test (Human-in-the-Loop)

- [ ] Settle a coinflip match → transaction appears in profile within seconds
- [ ] Settle a lord round → transaction appears in profile
- [ ] Place a closecall bet + settle → join and result rows appear
- [ ] Pagination loads older transactions correctly
- [ ] Amounts shown in SOL with USD estimate, match on-chain values
- [ ] Empty profile shows clean empty state, not broken UI
- [ ] Unauthenticated request returns 401, not data

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/008-user-profile/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
