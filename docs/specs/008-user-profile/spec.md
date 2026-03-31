# Specification: 008 User Profile

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Phase | 3 |
| NR_OF_TRIES | 20 |

---

## Overview

Player profile system for TAUNT. Backend/API only — no frontend work in this
spec. The profile is the player's identity on the platform: a username, avatar,
aggregate stats, and transaction history. Wallets are never exposed publicly;
all external-facing lookups use a short user ID or username.

**Iteration 1 (done):** Transaction history ledger + API.

**Iteration 2 (this pass):** Player identity (profile record, username, avatar),
aggregate stats, public lookup API, HEAT/points display slots (null until those
features ship).

No on-chain footprint. No social accounts (X/Discord) — deferred TBD.

## User Stories

- As a player, I want to see every game transaction tied to my wallet so I can
  track what I wagered, won, or lost.
- As a player, I want the list to update automatically after a game settles so
  I don't have to refresh.
- As a player, I want an auto-generated username when I sign up so I have an
  identity on the platform immediately.
- As a player, I want to change my username so I can personalize my identity,
  with a cooldown to prevent abuse.
- As a player, I want to see my aggregate stats (games played, wins, win rate,
  streaks) so I can track my performance.
- As another player, I want to look up someone by username or ID and see their
  public stats (games played, wins, win rate) without seeing their wallet or
  transaction history.

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

### FR-6: Player Profile Record

A `player_profiles` table that stores the player's identity. Created automatically
on first wallet auth (JWT challenge-response) or waitlist signup. The wallet is
stored internally but **never exposed in API responses** — all public-facing
references use `user_id` or `username`.

**Schema:**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `BIGSERIAL` | PK | Internal DB key (not exposed) |
| `user_id` | `TEXT` | UNIQUE, NOT NULL | Short random string, e.g. `usr_a8f3k2`. Public-facing identifier for API calls |
| `wallet` | `TEXT` | UNIQUE, NOT NULL | Player wallet address. **Never exposed in public API responses** |
| `username` | `TEXT` | UNIQUE, NOT NULL | Auto-generated on creation. Editable (freeform, 30-day cooldown) |
| `username_updated_at` | `TIMESTAMPTZ` | | Null until first manual edit. Cooldown enforced from this timestamp |
| `avatar_url` | `TEXT` | | Null = use deterministic identicon derived from wallet. Explicit URL for future unlock/upload |
| `heat_multiplier` | `NUMERIC` | DEFAULT 1.0 | Reserved slot — always 1.0 until HEAT feature ships |
| `points_balance` | `BIGINT` | DEFAULT 0 | Reserved slot — always 0 until Points feature ships |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Profile creation time |

**Indexes:**
- `uq_player_profiles_user_id` on `(user_id)` — public lookup
- `uq_player_profiles_wallet` on `(wallet)` — internal lookup / auth join
- `uq_player_profiles_username` on `(username)` — username lookup

**User ID format:** `usr_` prefix + 8 random alphanumeric characters (lowercase).
Generated once at profile creation, immutable.

**Username auto-generation:** `{adjective}-{noun}-{4digits}`. On collision, retry
with new random suffix (max 5 retries, then fall back to `user-{random8}`).

**Username edit rules:**
- Freeform: 3-20 characters, `[a-zA-Z0-9_-]`, no spaces
- Unique (case-insensitive)
- Editable once per 30 days (enforced via `username_updated_at`)
- First manual edit is free (cooldown starts from that edit, not from creation)

**Acceptance Criteria:**
- [ ] Migration `013_player_profiles.sql` creates table + indexes
- [ ] Profile auto-created on first JWT auth (challenge-response verify endpoint)
- [ ] Profile auto-created on waitlist signup (if applicable entry point exists)
- [ ] `user_id` is a short random string (`usr_` + 8 alphanumeric), immutable after creation
- [ ] Username auto-generated as `{adjective}-{noun}-{4digits}`, collision-safe
- [ ] Wallet address never appears in any public API response
- [ ] `heat_multiplier` and `points_balance` are reserved columns, default values only

### FR-7: Username Management API

Players can view and change their username.

**Endpoints:**

`PUT /profile/username`
- Auth: JWT required
- Body: `{ "username": "my-new-name" }`
- Validates: 3-20 chars, `[a-zA-Z0-9_-]`, unique (case-insensitive), 30-day cooldown
- Returns: `{ "username": "my-new-name", "nextEditAvailableAt": "2026-05-01T..." }`
- Errors: 400 (invalid format), 409 (taken), 429 (cooldown not expired)

**Acceptance Criteria:**
- [ ] Username change validates format (3-20 chars, `[a-zA-Z0-9_-]`)
- [ ] Username uniqueness enforced case-insensitively
- [ ] 30-day cooldown enforced from `username_updated_at`; first edit is free
- [ ] Successful edit updates both `username` and `username_updated_at`
- [ ] Returns next available edit timestamp in response

### FR-8: Aggregate Player Stats API

Computed stats from the existing `transactions` table. Served as part of the
profile response (own profile) or public lookup (limited subset).

**Own profile stats (authenticated):**

| Stat | Computation |
|------|-------------|
| `gamesPlayed` | COUNT(DISTINCT match_id) where tx_type = 'deposit' |
| `totalWagered` | SUM(amount_lamports) where tx_type = 'deposit' |
| `totalWins` | COUNT(*) where tx_type = 'payout' |
| `winRate` | totalWins / gamesPlayed (0 if no games) |
| `winStreakCurrent` | Consecutive most-recent wins (across all games) |
| `winStreakBest` | Longest-ever consecutive win streak |
| `netPnl` | SUM(payout + refund) - SUM(deposit) |
| `gameBreakdown` | Per-game version of above (keyed by game name) |

**Public stats (visible to others via lookup):**

| Stat | Included |
|------|----------|
| `gamesPlayed` | Yes |
| `totalWins` | Yes |
| `winRate` | Yes |
| `totalWagered` | **No** |
| `netPnl` | **No** |
| `winStreakCurrent` | **No** |
| `winStreakBest` | **No** |
| `gameBreakdown` | **No** |

**Win streak logic:** Ordered by `created_at DESC`, across all games. A `payout`
row = win. A `deposit` row with no corresponding `payout` for the same `match_id`
= loss. Refunds don't break or extend streaks. Streak resets on first loss
walking backward from most recent game.

**Performance note:** Stats can be computed on-the-fly for now (single query per
request). If latency becomes a problem, add a `player_stats_cache` materialized
view or summary table later — but don't pre-optimize.

**Acceptance Criteria:**
- [ ] `gamesPlayed`, `totalWagered`, `totalWins`, `winRate` computed correctly from `transactions`
- [ ] `winStreakCurrent` counts consecutive most-recent wins across all games
- [ ] `winStreakBest` tracks the longest-ever streak
- [ ] `netPnl` = total inflows (payout + refund) minus total outflows (deposit)
- [ ] `gameBreakdown` returns per-game stats keyed by frontend game name
- [ ] Public stats expose only `gamesPlayed`, `totalWins`, `winRate`

### FR-9: Profile API Endpoints

All profile interaction points for the frontend.

**Endpoints:**

`GET /profile/me` (authenticated)
- Returns: full own profile + full stats
- Response shape:
  ```json
  {
    "userId": "usr_a8f3k2",
    "username": "fierce-dragon-4821",
    "avatarUrl": null,
    "heatMultiplier": 1.0,
    "pointsBalance": "0",
    "stats": {
      "gamesPlayed": 42,
      "totalWagered": "150000000000",
      "totalWins": 23,
      "winRate": 0.5476,
      "winStreakCurrent": 3,
      "winStreakBest": 7,
      "netPnl": "5000000000",
      "gameBreakdown": {
        "coinflip": { "gamesPlayed": 20, "totalWins": 11, "winRate": 0.55, "totalWagered": "...", "netPnl": "..." },
        "lord-of-rngs": { ... },
        "close-call": { ... }
      }
    },
    "usernameNextEditAt": "2026-05-01T00:00:00Z",
    "createdAt": "2026-03-15T10:00:00Z"
  }
  ```
- `avatarUrl` null means frontend should render identicon from `userId`
- `totalWagered`, `netPnl`, `pointsBalance` as strings (BigInt safety)

`GET /public-profile/:identifier` (public, no auth)
- Mounted at `/public-profile` (separate from `/profile/*` to avoid JWT middleware)
- `:identifier` resolves to either `user_id` (starts with `usr_`) or `username`
- Returns: public profile (no wallet, no tx history, limited stats)
- Response shape:
  ```json
  {
    "userId": "usr_a8f3k2",
    "username": "fierce-dragon-4821",
    "avatarUrl": null,
    "heatMultiplier": 1.0,
    "stats": {
      "gamesPlayed": 42,
      "totalWins": 23,
      "winRate": 0.5476
    },
    "createdAt": "2026-03-15T10:00:00Z"
  }
  ```
- 404 if identifier not found

**Acceptance Criteria:**
- [ ] `GET /profile/me` requires JWT, returns full profile + full stats
- [ ] `GET /public-profile/:identifier` is public (no auth), resolves user_id or username
- [ ] Public endpoint returns only `gamesPlayed`, `totalWins`, `winRate` — no wallet, no PnL, no wagered, no streaks, no tx history
- [ ] `avatarUrl` null means use identicon (frontend responsibility)
- [ ] BigInt fields serialized as strings
- [ ] 404 for unknown identifier on public endpoint

---

## Success Criteria

- A player who completes a game sees the transaction appear in their profile
  within seconds of settlement
- Transaction list is accurate — amounts, outcomes, and game types match
  on-chain reality
- Profile page loads transaction history performantly (< 500ms for first page)
- Profile is auto-created on first wallet auth with a unique username and user ID
- Any player can look up another player by username or user ID and see limited public stats
- Wallet addresses are never exposed in any public-facing API response

---

## Dependencies

- JWT auth system (spec 007 — already shipped)
- Settlement worker (coinflip + lord + closecall — already shipped)
- PDA watcher for join detection (already shipped)
- `transactions` table (migration 009 — already shipped)

## Assumptions

- No backfill of historical data — `transactions` table starts empty, only new events recorded
- Close Call enforces one entry per player per round (on-chain constraint)
- Stats computed on-the-fly from `transactions` table (no pre-aggregation cache for now)
- No public browsable profile page — the public API serves a popup/card in the frontend
- No social account linking (X/Discord) — deferred TBD
- HEAT multiplier and points balance are placeholder fields (always default values until those features ship)
- Identicon generation is a frontend concern — backend just stores/serves `avatar_url` (null = identicon)

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
Next available: `013`.

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

### Iteration 1 (Transaction History)

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Migration creates table + indexes | Run `pnpm migrate` on fresh + existing DB | Migration status shows applied |
| 2 | Settlement writes correct rows | Settle a coinflip match on devnet, query table | Row with correct wallet, game, event, amount, tx_sig |
| 3 | API returns own transactions only | Call endpoint with two different JWTs | Each sees only their own rows |
| 4 | Pagination works | Insert > 20 rows, paginate | Second page returns remaining rows |
| 5 | Frontend displays real data | Play a game, check profile page | Transaction appears with correct details |

### Iteration 2 (Identity + Stats)

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 6 | Profile migration creates table + indexes | Run `pnpm migrate` on fresh + existing DB | Migration 013 applied |
| 7 | Profile auto-created on JWT auth | Auth a new wallet, query `player_profiles` | Row with user_id, username, wallet |
| 8 | Username auto-generated correctly | Auth a new wallet, check format | `{adjective}-{noun}-{4digits}` pattern |
| 9 | Username edit with cooldown | Change username, attempt again within 30 days | 429 on second attempt |
| 10 | Username uniqueness (case-insensitive) | Attempt to take an existing username with different case | 409 response |
| 11 | `GET /profile/me` returns full stats | Auth + fetch, verify all stat fields | JSON with gamesPlayed, totalWagered, winRate, streaks, PnL, gameBreakdown |
| 12 | `GET /public-profile/:id` returns limited stats | Fetch without auth, verify no wallet/PnL | JSON with gamesPlayed, totalWins, winRate only |
| 13 | Public endpoint resolves both user_id and username | Lookup same player by both identifiers | Same response body |
| 14 | No wallet in any public response | Inspect all public endpoint responses | No `wallet` field anywhere |
| 15 | Win streak computed correctly | Play games with known outcomes, check streak | Correct current and best streak values |

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

#### Iteration 2: Identity + Stats (Backend Only)

- [x] [engine] Migration `013_player_profiles.sql` — create `player_profiles` table: `id BIGSERIAL PK`, `user_id TEXT UNIQUE NOT NULL`, `wallet TEXT UNIQUE NOT NULL`, `username TEXT UNIQUE NOT NULL`, `username_updated_at TIMESTAMPTZ`, `avatar_url TEXT`, `heat_multiplier NUMERIC DEFAULT 1.0`, `points_balance BIGINT DEFAULT 0`, `created_at TIMESTAMPTZ DEFAULT now()`. Add functional index `CREATE UNIQUE INDEX idx_player_profiles_username_lower ON player_profiles (LOWER(username))` for case-insensitive uniqueness. Verify: `cd services/backend && pnpm migrate`. (done: iteration 13)
- [x] [engine] Username + user ID generation utility — create `services/backend/src/utils/username-gen.ts`. Export `generateUserId()`: returns `usr_` + 8 random lowercase alphanumeric chars (a-z0-9). Export `generateUsername()`: picks random adjective + noun from embedded word lists (50+ each, no profanity) + random 4-digit suffix → `{adjective}-{noun}-{NNNN}`. Both functions are pure (no DB access), synchronous, and unit-testable. No collision handling here — that's in the DB layer. (done: iteration 14)
- [x] [engine] DB functions for player_profiles — add to `db.ts`: (1) `createPlayerProfile(wallet: string): Promise<PlayerProfile>` — calls `generateUserId()` + `generateUsername()`, inserts row, on UNIQUE violation of username retries up to 5 times with new username, if all retries fail uses fallback `user-{random8}`. Returns the created profile. (2) `getProfileByWallet(wallet: string): Promise<PlayerProfile | null>` — lookup by wallet column. (3) `getProfileByIdentifier(identifier: string): Promise<PlayerProfile | null>` — if identifier starts with `usr_`, lookup by `user_id`; otherwise lookup by `LOWER(username) = LOWER(identifier)`. (4) `updateUsername(wallet: string, newUsername: string): Promise<PlayerProfile>` — validates 30-day cooldown from `username_updated_at` (null = first edit free), updates `username` + `username_updated_at = now()`, throws on UNIQUE violation. Define `PlayerProfile` type matching the table columns (excluding `wallet` from any serialization helper). Verify: `cd services/backend && pnpm lint`. (done: iteration 15)
- [x] [engine] Profile creation hook in auth verify — in `services/backend/src/routes/auth.ts`, in the POST `/verify` handler: after successful signature verification (after the `nacl.sign.detached.verify` check) and before issuing tokens, add: `const profile = await deps.db.getProfileByWallet(body.wallet); if (!profile) { try { await deps.db.createPlayerProfile(body.wallet); } catch (e) { console.error("Profile creation failed:", e); } }`. This is fire-and-forget — auth success MUST NOT depend on profile creation succeeding. Update `AuthRoutesDeps` interface to include `db`. Verify: `cd services/backend && pnpm lint`. (done: iteration 16)
- [x] [engine] Aggregate stats query — add `getPlayerStats(wallet: string)` to `db.ts`. Single SQL query against the `transactions` table: `gamesPlayed` = COUNT(DISTINCT match_id) WHERE tx_type='deposit', `totalWagered` = SUM(amount_lamports) WHERE tx_type='deposit', `totalWins` = COUNT(DISTINCT match_id) WHERE tx_type='payout', `winRate` = totalWins / gamesPlayed (0.0 if no games), `netPnl` = SUM(CASE WHEN tx_type IN ('payout','refund') THEN amount_lamports ELSE -amount_lamports END). Returns `{ gamesPlayed: number, totalWagered: bigint, totalWins: number, winRate: number, netPnl: bigint }`. Add `getPublicPlayerStats(wallet)` that calls getPlayerStats and returns only `{ gamesPlayed, totalWins, winRate }`. Verify: `cd services/backend && pnpm lint`. (done: iteration 17)
- [x] [engine] Win streak computation — add `getWinStreaks(wallet: string)` to `db.ts`. Query approach: get all distinct match_ids for this wallet from `transactions`, determine outcome per match (has tx_type='payout' row = win, has 'deposit' but no 'payout' = loss, only 'refund' = skip). Order by MAX(created_at) DESC per match. Walk the ordered list: count consecutive wins from the most recent for `current`, track longest run for `best`. Refund-only matches are excluded. Returns `{ current: number, best: number }`. This can be done in SQL with window functions or in application code — implementer's choice. Verify: `cd services/backend && pnpm lint`. (done: iteration 18)
- [x] [engine] Per-game breakdown query — add `getGameBreakdown(wallet: string)` to `db.ts`. Same computation as `getPlayerStats` but grouped by `game` column. Returns `Record<string, { gamesPlayed, totalWagered, totalWins, winRate, netPnl }>` keyed by frontend game name (map DB `lord` → `lord-of-rngs`, `closecall` → `close-call`, `coinflip` → `coinflip`). Games with zero activity are omitted from the result (not returned as zeroes). Verify: `cd services/backend && pnpm lint`. (done: iteration 19)
- [x] [engine] `GET /profile/me` endpoint — add to `services/backend/src/routes/profile.ts` (already behind JWT middleware). Handler: get wallet from `c.get("wallet")`, fetch profile via `db.getProfileByWallet(wallet)`. If no profile, return 404 `{ error: "PROFILE_NOT_FOUND" }`. Fetch stats via `db.getPlayerStats(wallet)`, streaks via `db.getWinStreaks(wallet)`, breakdown via `db.getGameBreakdown(wallet)`. Assemble response per FR-9 shape: `{ userId, username, avatarUrl, heatMultiplier, pointsBalance (string), stats: { gamesPlayed, totalWagered (string), totalWins, winRate, winStreakCurrent, winStreakBest, netPnl (string), gameBreakdown }, usernameNextEditAt (null if username_updated_at is null, else +30 days ISO), createdAt }`. No `wallet` field anywhere. Verify: `cd services/backend && pnpm lint`. (done: iteration 20)
- [ ] [engine] `PUT /profile/username` endpoint — add to `services/backend/src/routes/profile.ts` (already behind JWT middleware). Handler: get wallet from `c.get("wallet")`, parse body `{ username: string }`. Validate format: regex `^[a-zA-Z0-9_-]{3,20}$`, return 400 `{ error: "INVALID_FORMAT" }` if fails. Fetch current profile. Check cooldown: if `username_updated_at` is not null and less than 30 days ago, return 429 `{ error: "COOLDOWN_ACTIVE", nextEditAvailableAt }`. Call `db.updateUsername(wallet, username)`. On UNIQUE violation (case-insensitive index), return 409 `{ error: "USERNAME_TAKEN" }`. On success, return `{ username, nextEditAvailableAt }`. Verify: `cd services/backend && pnpm lint`.
- [ ] [engine] `GET /public-profile/:identifier` endpoint — create `services/backend/src/routes/public-profile.ts`. Export `createPublicProfileRoutes(deps)` following the existing route factory pattern. Single GET `/:identifier` handler (no auth middleware). Resolve identifier via `db.getProfileByIdentifier(identifier)`. If not found, return 404 `{ error: "NOT_FOUND" }`. Fetch public stats via `db.getPublicPlayerStats(profile.wallet)`. Return FR-9 public shape: `{ userId, username, avatarUrl, heatMultiplier, stats: { gamesPlayed, totalWins, winRate }, createdAt }`. No `wallet` anywhere. Register in `index.ts`: `app.route("/public-profile", createPublicProfileRoutes({ db }))` — NO JWT middleware. Verify: `cd services/backend && pnpm lint`.
- [ ] [engine] Update OpenAPI spec (`services/backend/src/openapi.ts`) — (1) Update Profile tag description from "Player transaction history" to "Player identity, stats, and transaction history". (2) Add component schemas: `PlayerProfile` (userId, username, avatarUrl, heatMultiplier, pointsBalance, stats, usernameNextEditAt, createdAt), `PlayerStats` (gamesPlayed, totalWagered, totalWins, winRate, winStreakCurrent, winStreakBest, netPnl, gameBreakdown), `PublicPlayerProfile` (userId, username, avatarUrl, heatMultiplier, stats: {gamesPlayed, totalWins, winRate}, createdAt). (3) Add paths: `GET /profile/me` (tag: Profile, security: bearerAuth, 200→PlayerProfile, 401, 404), `PUT /profile/username` (tag: Profile, security: bearerAuth, requestBody: {username: string}, 200→{username, nextEditAvailableAt}, 400/409/429), `GET /public-profile/{identifier}` (tag: Profile, no security, parameter: identifier path string, 200→PublicPlayerProfile, 404). Follow existing endpoint documentation patterns. Verify: `cd services/backend && pnpm lint`.
- [ ] [test] Unit tests for username-gen — in `services/backend/src/__tests__/username-gen.test.ts`. Tests: (1) `generateUserId()` matches format `usr_[a-z0-9]{8}`, (2) `generateUsername()` matches format `{word}-{word}-{4digits}`, (3) both produce different values on successive calls (non-deterministic check with 10 iterations), (4) username words contain no spaces or special characters. Run: `cd services/backend && pnpm test`.
- [ ] [test] Unit tests for stats + streaks — in `services/backend/src/__tests__/player-stats.test.ts`. Requires DB (use vitest setup from existing `auth-routes.test.ts` pattern). Seed `transactions` table with known rows, then call `getPlayerStats`, `getWinStreaks`, `getGameBreakdown`, `getPublicPlayerStats`. Test cases: (1) empty history → all zeros, (2) 3 wins in a row → current=3 best=3, (3) win-win-loss-win → current=1 best=2, (4) refund-only match skipped in streak, (5) game breakdown groups correctly, (6) public stats omit wagered/pnl. Run: `cd services/backend && pnpm test`.
- [ ] [test] Integration test for profile lifecycle — in `services/backend/src/__tests__/profile.test.ts`. Test flow: (1) POST `/verify` with new wallet → succeeds → `player_profiles` row exists with auto-generated username + user_id, (2) GET `/profile/me` returns profile + stats (empty), (3) PUT `/profile/username` with valid name → succeeds, (4) PUT `/profile/username` again immediately → 429 cooldown, (5) PUT `/profile/username` with taken name → 409, (6) GET `/public-profile/{username}` returns public profile + limited stats, (7) GET `/public-profile/{user_id}` returns same data, (8) no `wallet` field in any response. Run: `cd services/backend && pnpm test`.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality (username gen, stats computation, streak logic)
- [ ] No lint errors (`cd backend && pnpm lint`)

#### Functional Verification
- [ ] All acceptance criteria verified (FR-1 through FR-9)
- [ ] Edge cases: empty tx history → zero stats, single game → streak of 1 or 0, username collision retry, cooldown boundary
- [ ] Error states: invalid username format, taken username, cooldown not expired, unknown identifier 404

#### Backend-Specific Checks
- [ ] Migration runs cleanly on fresh and existing DB
- [ ] Profile auto-created on auth (verify via DB query after JWT flow)
- [ ] Stats match manual calculation from transactions table
- [ ] No wallet address in any public API response (grep all response builders)

#### Smoke Test (Human-in-the-Loop)

**Iteration 1:**
- [ ] Settle a coinflip match → transaction appears in profile within seconds
- [ ] Settle a lord round → transaction appears in profile
- [ ] Place a closecall bet + settle → join and result rows appear
- [ ] Pagination loads older transactions correctly
- [ ] Amounts shown in SOL with USD estimate, match on-chain values

**Iteration 2:**
- [ ] Auth a fresh wallet → profile row created with username + user_id
- [ ] `GET /profile/me` returns correct stats after playing games
- [ ] `GET /public-profile/{username}` returns limited public stats, no wallet
- [ ] `PUT /profile/username` succeeds on first edit, 429 on second within 30 days
- [ ] Win streak reflects actual consecutive wins across games

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

---

## Implementation Reference

### Backend

- **Endpoints (Iteration 1 — transaction history)**:
  - `GET  /profile/transactions?cursor=<id>&limit=<n>&game=<filter>` -- paginated transaction history for JWT-authenticated wallet. Default limit 20, max 50. Game filter accepts both DB names (`lord`, `closecall`) and frontend names (`lord-of-rngs`, `close-call`). Response: `{ transactions: [...], nextCursor }` with `amountLamports` as string
  - `POST /profile/confirm-tx` -- frontend reports a confirmed on-chain tx (deposit/refund). Accepts `{ game, matchId, txType, txSig, amountLamports }`
  - `GET  /price/sol-usd` -- cached SOL/USD price from Pyth Hermes (60s TTL, public, no auth). Response: `{ price, updatedAt }`

- **Endpoints (Iteration 2 — identity + stats)**:
  - `GET  /profile/me` -- JWT required (under `/profile/*` middleware). Full own profile: userId, username, avatarUrl, heatMultiplier, pointsBalance, full stats (gamesPlayed, totalWagered, totalWins, winRate, winStreakCurrent, winStreakBest, netPnl, gameBreakdown), usernameNextEditAt, createdAt. No wallet in response.
  - `GET  /public-profile/:identifier` -- public (no auth). Mounted at `/public-profile` separately from `/profile/*` to avoid JWT middleware. Resolves user_id (starts with `usr_`) or username (case-insensitive). Returns: userId, username, avatarUrl, heatMultiplier, limited stats (gamesPlayed, totalWins, winRate), createdAt. No wallet, no PnL, no streaks, no tx history. 404 if not found.
  - `PUT  /profile/username` -- JWT required (under `/profile/*` middleware). Body: `{ username }`. Validates format (3-20 chars, `[a-zA-Z0-9_-]`), case-insensitive uniqueness, 30-day cooldown. Returns: `{ username, nextEditAvailableAt }`. Errors: 400/409/429.

- **DB Tables**:
  - `transactions` (PK: `id`, BIGSERIAL) -- on-chain SOL movement ledger. Key columns: `wallet`, `game`, `match_id`, `tx_type` (deposit/payout/refund), `amount_lamports`, `tx_sig` (NOT NULL). Unique index: `(wallet, match_id, tx_type, tx_sig)`. Migration 009.
  - `player_profiles` (PK: `id`, BIGSERIAL) -- player identity. Key columns: `user_id` (UNIQUE, `usr_` + 8 random), `wallet` (UNIQUE, internal only), `username` (UNIQUE, auto-gen or player-set), `username_updated_at`, `avatar_url`, `heat_multiplier` (default 1.0), `points_balance` (default 0), `created_at`. Migration 013.

- **Profile Creation Triggers**:
  - JWT auth verify endpoint (`routes/auth.ts`) -- on first successful challenge-response, check if `player_profiles` row exists for wallet; if not, create with auto-generated username + user_id
  - Waitlist signup (if applicable entry point exists) -- same logic

- **Write Paths (Iteration 1)**:
  - Coinflip settlement: `worker/settle-tx.ts` `settleMatch()` -- writes win + loss rows after `settle_confirmed`
  - Lord settlement: `worker/settle-tx.ts` `settleLordRound()` -- writes win row for winner + loss rows for all losers
  - Close Call settlement: `worker/closecall-clock.ts` `settleRound()` -- writes join + outcome (win/loss/refund) per entry
  - Coinflip creator deposit: frontend reports via `POST /profile/confirm-tx` after tx confirmation
  - Coinflip opponent join: `worker/pda-watcher.ts` on PHASE_LOCKED detection

- **Key Files**:
  - `services/backend/src/routes/profile.ts` -- transaction history + confirm-tx + profile/me + username (all behind JWT)
  - `services/backend/src/routes/public-profile.ts` -- public player lookup (no JWT, separate mount)
  - `services/backend/src/routes/auth.ts` -- JWT auth (profile creation hook goes here)
  - `services/backend/src/utils/username-gen.ts` -- generateUserId() + generateUsername() pure functions
  - `services/backend/src/routes/price.ts` -- SOL/USD price endpoint (Pyth HermesClient)
  - `services/backend/src/db.ts` -- query functions (add: createPlayerProfile, getProfileByWallet, getProfileByIdentifier, updateUsername, getPlayerStats, getPublicPlayerStats)
  - `services/backend/src/worker/settle-tx.ts` -- coinflip + lord settlement write paths
  - `services/backend/src/worker/closecall-clock.ts` -- Close Call settlement write paths
  - `services/backend/src/worker/pda-watcher.ts` -- opponent join detection (coinflip)
  - `services/backend/migrations/009_transactions.sql` -- transactions table schema
  - `services/backend/migrations/013_player_profiles.sql` -- player profiles table schema

---

## Key Decisions (from refinement)

### Iteration 1 (Transaction History)
- **Amounts**: SOL + USD estimate (Pyth SOL/USD feed via Hermes REST API, 60s cache TTL)
- **Refunds**: Close Call only — coinflip/lord refunds are permissionless on-chain, backend doesn't process them
- **Lord joins**: Skipped — PDA watcher sees round state, not individual entries. Win/loss only at settlement
- **Close Call joins**: Written at settlement time (not at /bet route) — avoids false positives from unsubmitted txs
- **Coinflip joins**: Creator at create route, opponent at PDA watcher lock detection
- **Game name mapping**: DB `lord`/`closecall` mapped to API `lord-of-rngs`/`close-call`
- **Idempotency**: UNIQUE constraint on `(wallet, match_id, event)` with `ON CONFLICT DO NOTHING` on all write paths

### Iteration 2 (Identity + Stats)
- **No wallet exposure**: Wallet is internal only. All public-facing references use `user_id` (short random string) or `username`. This is a hard rule — no endpoint returns a wallet address.
- **Profile creation trigger**: JWT auth verify endpoint (first successful challenge-response). Also waitlist signup if that entry point exists. NOT first completed game.
- **User ID format**: `usr_` + 8 random lowercase alphanumeric chars. Immutable once created.
- **Username auto-gen**: `{adjective}-{noun}-{4digits}`. Retry on collision (max 5 retries, fallback `user-{random8}`). Freeform editable: 3-20 chars, `[a-zA-Z0-9_-]`, 30-day cooldown.
- **Avatar**: `avatar_url` field, null = frontend renders identicon from `user_id`. No upload/unlock system in this iteration.
- **Stats source**: Computed on-the-fly from `transactions` table. No pre-aggregation cache.
- **Win streak**: Cross-game (all games combined). Refunds don't affect streak.
- **Public stats**: Only `gamesPlayed`, `totalWins`, `winRate`. No PnL, wagered, or streaks visible to others.
- **HEAT + Points**: Reserved columns with default values. No computation yet.
- **No social links**: X/Discord linking removed from scope entirely — TBD future decision.
- **No public profile page**: API serves data for a popup/card in the frontend, not a browsable page.

## Deferred Items

- **Lord join rows** (individual entry tracking): PDA watcher sees round state change but not individual entries. Low priority; entries are visible on-chain
- **Lord multi-entry loss amount accuracy**: UNIQUE constraint means at most one loss row per player per Lord round. If a player enters multiple times and loses, only the first entry's amount is recorded (ON CONFLICT DO NOTHING drops subsequent inserts). Total loss amount is under-reported for multi-entry losers. Low impact for V1. Potential fix: change UNIQUE constraint to `(wallet, match_id, event, amount_lamports)` or aggregate amounts before insert
- **Social account linking (X/Discord)**: Removed from scope. TBD future decision — unclear whether self-reported handles or OAuth verification.
- **Avatar upload / unlock system**: Depends on Loot Crates feature. Only identicon for now.
- **Stats pre-aggregation / caching**: On-the-fly computation for now. Add `player_stats_cache` materialized view if latency becomes a problem.
- **HEAT multiplier computation**: Reserved column, always 1.0. Depends on HEAT feature spec.
- **Points system**: Reserved column, always 0. Depends on Points feature spec.
- **Orphaned mock file**: `apps/platform/src/features/player-profile/utils/mock-simulation.ts` is no longer imported by ProfileTransactions but still exists (568 lines). Consider deleting to reduce bundle size.
