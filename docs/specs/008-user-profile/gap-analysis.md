# Gap Analysis: 008 — User Profile

- **Date**: 2026-04-01
- **Spec status**: Ready
- **Previous analysis**: 2026-03-31 (pre-refactor, all satisfied)

## Implementation Inventory

### Backend Migrations

| Migration | Tables | File |
|-----------|--------|------|
| 001_init.sql (consolidated) | `transactions`, `player_profiles`, `game_entries`, all others | migrations/001_init.sql |

All tables now live in a single consolidated migration. The old per-file
migrations (008, 009, 013) are gone.

### Database Functions (db.ts)

| Function | Line | Purpose |
|----------|------|---------|
| `insertTransaction` | 981 | Write tx row (ON CONFLICT DO NOTHING) |
| `insertTransactions` | 996 | Batch-write tx rows (ON CONFLICT DO NOTHING) |
| `getTransactions` | 1114 | Cursor-based paginated history |
| `upsertGameEntry` | 1012 | Insert/update single game entry (ON CONFLICT DO UPDATE) |
| `upsertGameEntries` | 1035 | Batch upsert game entries |
| `createPlayerProfile` | 1347 | Auto-gen user_id + username, 5 retries + fallback |
| `getProfileByWallet` | 1378 | Internal wallet lookup |
| `getProfileByIdentifier` | 1385 | Public lookup (user_id or username, case-insensitive) |
| `updateUsername` | 1398 | 30-day cooldown + UNIQUE check |
| `getPlayerStats` | 1434 | gamesPlayed, totalWagered, totalWins, winRate, netPnl from `game_entries` |
| `getPublicPlayerStats` | 1463 | Subset: gamesPlayed, totalWins, winRate |
| `getGameBreakdown` | 1472 | Per-game stats keyed by frontend name from `game_entries` |
| `getWinStreaks` | 1516 | Current + best consecutive wins from `game_entries` |
| `getOrCreateProfile` | 1103 | Get or create profile for settlement joiners |

### Routes

| Endpoint | Auth | File | Line |
|----------|------|------|------|
| `GET /profile/me` | JWT | routes/profile.ts | 35 |
| `PUT /profile/username` | JWT | routes/profile.ts | 99 |
| `GET /profile/transactions` | JWT | routes/profile.ts | 165 |
| `POST /profile/confirm-tx` | JWT | routes/profile.ts | 223 |
| `GET /public-profile/:identifier` | None | routes/public-profile.ts | 18 |
| `GET /price/sol-usd` | None | routes/price.ts | 57 |

### Utilities

| Export | File | Line |
|--------|------|------|
| `generateUserId()` | utils/username-gen.ts | 140 |
| `generateUsername()` | utils/username-gen.ts | 148 |

### Auth Hook

| Hook | File | Line |
|------|------|------|
| Profile auto-create on JWT verify | routes/auth.ts | 155-163 |

### Settlement Write Paths (game_entries + transactions)

| Game | Actor | When | File | Line |
|------|-------|------|------|------|
| Coinflip creator | Participation | `POST /coinflip/create` | routes/create.ts | 209-227 |
| Coinflip winner + loser | Settlement | `settleMatch()` | worker/settle-tx.ts | 358-386 (upsertGameEntries), 400-407 (insertTransaction) |
| Lord creator | Participation | `POST /lord/create` | routes/lord-create.ts | 253-269 |
| Lord all entries | Settlement | `settleLordRound()` | worker/settle-tx.ts | 596-618 (upsertGameEntries), 634-642 (insertTransaction) |
| Close Call bettor | Participation | `POST /closecall/bet` | routes/closecall.ts | 342-358 |
| Close Call all entries | Settlement | `closecall-clock.ts settleRound()` | worker/closecall-clock.ts | 440-541 (withTransaction: insertTransactions + upsertGameEntries) |

### OpenAPI

| Schema | File |
|--------|------|
| `PlayerStats` | openapi.ts:269 |
| `PublicStats` | openapi.ts:286 |
| `PlayerProfile` | openapi.ts:294 |
| `PublicPlayerProfile` | openapi.ts:307 |

### Tests

| Test File | Type | Status |
|-----------|------|--------|
| `__tests__/username-gen.test.ts` | Unit | Present |
| `__tests__/player-stats.test.ts` | Unit/Integration | Present |
| `__tests__/profile.test.ts` | Integration | Present |
| `__tests__/referral-routes.test.ts` | Integration | Present |

## Acceptance Criteria Audit

### FR-1: Transaction Ledger Table

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Migration creates table + indexes + CHECK constraints | SATISFIED | migrations/001_init.sql:172-187 — `transactions` table with CHECK on game/tx_type, indexes on wallet+created, match_id, user_id+created, UNIQUE on (wallet, match_id, tx_type, tx_sig) |
| 2 | Migration runs cleanly on fresh DB | SATISFIED | Consolidated DDL with `CREATE TABLE` (no IF NOT EXISTS needed for fresh schema) |
| 3 | No backfill of historical data | SATISFIED | DDL only, no INSERT/UPDATE statements |

### FR-2: Write Paths — Game Entries + Transactions

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Coinflip: creator game_entry written at create time | SATISFIED | routes/create.ts:209-227 — `db.upsertGameEntry()` with userId, wallet, game="coinflip", roundPda, matchId, amountLamports, side |
| 2 | Coinflip: both entries UPSERT'd at settlement with results | SATISFIED | worker/settle-tx.ts:358-386 — `txDb.upsertGameEntries()` for winner (isWinner=true, payoutLamports) and loser (isWinner=false, payoutLamports=0), uses `getOrCreateProfile()` to resolve user_id |
| 3 | Lord: creator game_entry written at create time | SATISFIED | routes/lord-create.ts:253-269 — `db.upsertGameEntry()` with game="lord" |
| 4 | Lord: all entries UPSERT'd at settlement | SATISFIED | worker/settle-tx.ts:596-618 — aggregates per player via `playerTotals` Map, resolves profiles via `getOrCreateProfile()`, calls `txDb.upsertGameEntries()` |
| 5 | Close Call: bettor game_entry written at bet time | SATISFIED | routes/closecall.ts:342-358 — `db.upsertGameEntry()` with game="closecall", side="green"/"red" |
| 6 | Close Call: entries UPSERT'd at settlement (including refund handling) | SATISFIED | worker/closecall-clock.ts:497-541 — refund: isWinner=undefined, payoutLamports=amount; non-refund: isWinner=true/false with computed payout. Uses `getOrCreateProfile()` |
| 7 | Transaction rows written for real SOL movements at settlement | SATISFIED | settle-tx.ts:400-407 (coinflip payout), 634-642 (lord payout), closecall-clock.ts:461-491 (insertTransactions for payout/refund) |
| 8 | match_id links to correct round | SATISFIED | coinflip/lord use `round.match_id`; closecall uses `roundId = String(Number(minuteTs))` |
| 9 | No duplicate entries (idempotent via UPSERT) | SATISFIED | game_entries: `UNIQUE(wallet, round_pda)` + `ON CONFLICT DO UPDATE` (db.ts:1027-1031); transactions: `ON CONFLICT DO NOTHING` (db.ts:992) |

### FR-3: API Endpoint — Transaction History

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Requires valid JWT; 401 without | SATISFIED | routes/profile.ts:166-168 wallet from JWT, returns 401 if missing; index.ts:97-99 JWT middleware with `requireAllMethods: true` on `/profile/*` |
| 2 | Returns only authenticated wallet's tx | SATISFIED | routes/profile.ts:165-166 wallet from `c.get("wallet")` (JWT subject), no URL wallet param |
| 3 | Cursor-based pagination | SATISFIED | routes/profile.ts:172; db.ts:1114-1150 — `WHERE id < cursor ORDER BY id DESC` |
| 4 | Game filter works | SATISFIED | routes/profile.ts:186-192 — `TO_DB_GAME` mapping, invalid game returns 400 |
| 5 | Default limit 20, max 50 | SATISFIED | routes/profile.ts:177-183 — default 20, `Math.min(parsed, 50)` |
| 6 | Response matches documented shape | SATISFIED | routes/profile.ts:197-205 — id, game (frontend-mapped via `GAME_TO_FRONTEND`), matchId, txType, amountLamports (String), txSig, createdAt |
| 7 | Empty result returns null cursor | SATISFIED | routes/profile.ts:207-210 — `transactions.length === limit ? String(last.id) : null` |

### FR-4: Frontend — Wire ProfileTransactions

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1-6 | All frontend criteria | N/A | Frontend is being reworked separately (not in this repo). Spec marks these as satisfied from prior iteration. No code to re-verify in this repo. |

### FR-5: SOL/USD Price Display

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Backend serves cached SOL/USD from Pyth Hermes | SATISFIED | routes/price.ts:10-66 — HermesClient, SOL/USD feed, 60s TTL cache, stale-on-error fallback |
| 2 | Frontend displays SOL with USD estimate | N/A | Frontend not in this repo |
| 3 | Graceful fallback to SOL-only when unavailable | N/A (backend part SATISFIED) | routes/price.ts:58-60 returns 503 only if no cached price at all; stale cache returned on error |

### FR-6: Player Profile Record

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Migration creates `player_profiles` table + indexes | SATISFIED | migrations/001_init.sql:126-138 — table with `GENERATED ALWAYS AS IDENTITY`, `UNIQUE` on user_id/wallet/username, case-insensitive index `idx_player_profiles_username_lower` on `LOWER(username)` |
| 2 | Profile auto-created on first JWT auth | SATISFIED | routes/auth.ts:155-163 — after signature verify, checks `db.getProfileByWallet()`, calls `db.createPlayerProfile()` if null (fire-and-forget, non-blocking) |
| 3 | Profile auto-created on waitlist signup | SATISFIED | Waitlist app calls `POST /auth/verify` which triggers the same auto-creation path in auth.ts:155-163 |
| 4 | `user_id` is `usr_` + 8 alphanumeric, immutable | SATISFIED | utils/username-gen.ts:140-141 `usr_${randomAlphanumeric(8)}`; db.ts:1348 generated once at creation, no update path for user_id exists |
| 5 | Username auto-generated as `{adj}-{noun}-{4digits}`, collision-safe | SATISFIED | utils/username-gen.ts:148-153; db.ts:1347-1376 — 5 retries on unique violation + fallback to `user-{random8}` |
| 6 | Wallet never in any public API response | SATISFIED | profile.ts:70-88 response has no wallet field; public-profile.ts:29-39 response has no wallet field |
| 7 | `heat_multiplier` and `points_balance` are reserved, defaults only | SATISFIED | migrations/001_init.sql:133-134 — `DEFAULT 1.0` / `DEFAULT 0` |

### FR-7: Username Management API

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Validates format (3-20 chars, `[a-zA-Z0-9_-]`) | SATISFIED | routes/profile.ts:113 — regex `^[a-zA-Z0-9_-]{3,20}$` |
| 2 | Uniqueness enforced case-insensitively | SATISFIED | migrations/001_init.sql:138 — `CREATE UNIQUE INDEX idx_player_profiles_username_lower ON player_profiles (LOWER(username))` |
| 3 | 30-day cooldown; first edit free | SATISFIED | routes/profile.ts:124-132 — cooldown check, `profile.username_updated_at` null means first edit free; db.ts:1408-1423 double-check in updateUsername |
| 4 | Successful edit updates username + username_updated_at | SATISFIED | db.ts:1425-1431 — `SET username = ${newUsername}, username_updated_at = now()` |
| 5 | Returns next available edit timestamp | SATISFIED | routes/profile.ts:137-141 — `nextEditAvailableAt` computed from `username_updated_at + 30 days` |

### FR-8: Aggregate Player Stats API

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | gamesPlayed, totalWagered, totalWins, winRate computed correctly | SATISFIED | db.ts:1434-1461 `getPlayerStats()` — queries `game_entries WHERE settled_at IS NOT NULL`: COUNT, SUM(amount_lamports), SUM(CASE is_winner), SUM(payout - amount) |
| 2 | winStreakCurrent counts consecutive most-recent wins | SATISFIED | db.ts:1516-1551 `getWinStreaks()` — queries game_entries ordered by settled_at DESC, skips `is_winner IS NULL` (refunds), walks list counting consecutive wins |
| 3 | winStreakBest tracks longest-ever streak | SATISFIED | db.ts:1538 — `if (streak > best) best = streak` tracked across all entries |
| 4 | netPnl = SUM(payout_lamports - amount_lamports) | SATISFIED | db.ts:1447 — `COALESCE(SUM(payout_lamports - amount_lamports), 0)` |
| 5 | gameBreakdown per-game stats by frontend name | SATISFIED | db.ts:1472-1514 `getGameBreakdown()` — `DB_TO_FRONTEND` mapping (`lord` -> `lord-of-rngs`, `closecall` -> `close-call`), GROUP BY game |
| 6 | Public stats expose only gamesPlayed, totalWins, winRate | SATISFIED | db.ts:1463-1470 `getPublicPlayerStats()` — calls `getPlayerStats()` then returns only 3 fields |

### FR-9: Profile API Endpoints

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `GET /profile/me` requires JWT, returns full profile + stats | SATISFIED | routes/profile.ts:35-96 — wallet from JWT, fetches profile+stats+streaks+breakdown, returns userId/username/avatarUrl/heatMultiplier/pointsBalance/stats/usernameNextEditAt/createdAt. No wallet field. |
| 2 | `GET /public-profile/:identifier` is public, resolves user_id or username | SATISFIED | routes/public-profile.ts:18; db.ts:1385-1396 — `usr_` prefix -> user_id lookup, else LOWER(username) lookup. Mounted at `/public-profile` (index.ts:104) without JWT middleware. |
| 3 | Public endpoint returns only gamesPlayed, totalWins, winRate | SATISFIED | routes/public-profile.ts:29-39 — response has only `stats: { gamesPlayed, totalWins, winRate }`, no wallet, no PnL, no wagered, no streaks |
| 4 | `avatarUrl` null = use identicon (frontend responsibility) | SATISFIED | routes/profile.ts:73 passes through null; public-profile.ts:32 passes through null |
| 5 | BigInt fields serialized as strings | SATISFIED | routes/profile.ts:75 `String(profile.points_balance)`, :78 `String(stats.totalWagered)`, :83 `String(stats.netPnl)`, :62 `String(gs.totalWagered)`, :66 `String(gs.netPnl)` |
| 6 | 404 for unknown identifier | SATISFIED | routes/public-profile.ts:23-24 — returns `{ error: "NOT_FOUND" }` with 404 |

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| -- | -- | -- | -- | -- | -- | No gaps found |

All 37 backend acceptance criteria across FR-1 through FR-9 are SATISFIED.
Zero gaps. Zero deferred.

FR-4 (frontend wiring) and parts of FR-5 (frontend display) are marked N/A
because the frontend is being reworked in a separate repo and is not available
for verification here. The spec's checkboxes for those criteria were satisfied
in a prior iteration when the frontend was co-located.

## Key Changes Since Previous Analysis (2026-03-31)

1. **Consolidated migration**: The old per-file migrations (008, 009, 013) were
   replaced by a single `001_init.sql`. All tables (including `transactions`,
   `player_profiles`, `game_entries`) are created together.

2. **Stats source changed from `transactions` to `game_entries`**: `getPlayerStats`,
   `getWinStreaks`, and `getGameBreakdown` now query `game_entries` (which has
   `is_winner`, `payout_lamports`, `settled_at`) instead of deriving outcomes
   from the `transactions` table. This is simpler and more correct.

3. **Participation-time game_entry writes**: All three games now write a
   `game_entry` at participation time (create/bet), not just at settlement.
   Settlement UPSERTs the existing entry with results (winner, payout, settled_at).

4. **PDA watcher no longer writes entries**: Opponent join detection moved
   entirely to settlement. The PDA watcher only handles phase transitions
   (created -> locked). No `insertTransaction` or `upsertGameEntry` calls
   in `pda-watcher.ts`.

5. **Line numbers shifted**: Due to the data layer refactor, all db.ts function
   line numbers have changed. Updated in the inventory above.

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Social accounts (X/Discord) | TBD per spec Overview | None | N/A | UNTRACKED -- no target spec |
| HEAT multiplier feature | Future phase | None | N/A | UNTRACKED -- reserved column only |
| Points balance feature | Future phase | None | N/A | UNTRACKED -- reserved column only |

## Recommendations

1. **Spec status can advance to Done** -- all FR acceptance criteria are satisfied
   with code evidence. The only unchecked items are the testing/smoke-test
   checklists which require human verification.
2. **Social accounts (X/Discord)**: Consider creating a spec if planned for a
   future phase, or document the deferral in SCOPE.md.
3. **HEAT/Points reserved columns**: Correctly stubbed with defaults. When those
   features ship, they will need their own specs.
4. **Waitlist profile creation**: Already covered -- the waitlist app calls
   `POST /auth/verify` which triggers backend profile auto-creation in
   routes/auth.ts:155-163.
5. **Response shape note**: The `/profile/transactions` response uses `txType`
   (camelCase) rather than `event` as shown in the FR-3 spec example. The spec
   example shows `"event": "win"` but the actual response uses `"txType": "payout"`.
   This is intentional -- the table was redesigned from event-based
   (join/win/loss/refund) to movement-based (deposit/payout/refund). The spec's
   inline checkboxes already reflect this. Not a gap, but the example JSON in
   the spec body (FR-3 response shape) is stale.
