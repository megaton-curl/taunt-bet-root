# Implementation History — 008-user-profile

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 13 — Migration 013_player_profiles.sql

**Item:** `[engine] Migration 013_player_profiles.sql`
**Status:** Done

Created `/workspaces/rng-utopia/backend/services/backend/migrations/013_player_profiles.sql` with:
- `player_profiles` table: id (BIGSERIAL PK), user_id (TEXT UNIQUE NOT NULL), wallet (TEXT UNIQUE NOT NULL), username (TEXT UNIQUE NOT NULL), username_updated_at (TIMESTAMPTZ), avatar_url (TEXT), heat_multiplier (NUMERIC DEFAULT 1.0), points_balance (BIGINT DEFAULT 0), created_at (TIMESTAMPTZ DEFAULT now())
- Functional index `idx_player_profiles_username_lower` on `LOWER(username)` for case-insensitive uniqueness
- Verified: `pnpm migrate` applied cleanly on fresh DB, `pnpm migrate:status` shows all 13 migrations applied, `\d player_profiles` confirms all columns, types, defaults, and indexes match spec

## Iteration 13 — 2026-03-31T14:05:54Z — OK
- **Log**: iteration-013.log

## Iteration 14 — Username + User ID Generation Utility

**Item:** `[engine] Username + user ID generation utility`
**Status:** Done

Created `/workspaces/rng-utopia/backend/services/backend/src/utils/username-gen.ts` with:
- `generateUserId()`: returns `usr_` + 8 random lowercase alphanumeric chars (a-z0-9) using `crypto.randomBytes`
- `generateUsername()`: picks random adjective + noun from embedded word lists (51 adjectives, 56 nouns, no profanity) + random 4-digit suffix → `{adjective}-{noun}-{NNNN}`
- Both functions are pure (no DB access), synchronous, and unit-testable
- Verified: `pnpm lint` and `pnpm typecheck` both pass

## Iteration 14 — 2026-03-31T14:09:31Z — OK
- **Log**: iteration-014.log

## Iteration 15 — DB functions for player_profiles

**Item:** `[engine] DB functions for player_profiles`
**Status:** Done

Added to `/workspaces/rng-utopia/backend/services/backend/src/db.ts`:
- 4 new methods on `Db` interface: `createPlayerProfile`, `getProfileByWallet`, `getProfileByIdentifier`, `updateUsername`
- `normalizePlayerProfile()` helper for numeric field coercion (`id`, `heat_multiplier`, `points_balance`)
- `createPlayerProfile(wallet)`: generates `userId` + `username` via imported utils, inserts row, retries up to 5 times on UNIQUE violation (username collision), final fallback uses `user-{random8}`
- `getProfileByWallet(wallet)`: simple SELECT by wallet, returns null if not found
- `getProfileByIdentifier(identifier)`: routes `usr_*` to `user_id` lookup, otherwise case-insensitive username lookup via `LOWER()`
- `updateUsername(wallet, newUsername)`: validates 30-day cooldown from `username_updated_at` (null = first edit free), throws enriched error with `cooldown: true` + `nextEditAvailableAt` on cooldown violation, UNIQUE violation propagates naturally from postgres
- `PlayerProfile` type was already defined (iteration 13)
- Verified: `pnpm lint` and `pnpm typecheck` both pass

## Iteration 15 — 2026-03-31T14:54:54Z — OK
- **Log**: iteration-015.log

## Iteration 16 — Profile creation hook in auth verify

**Item:** `[engine] Profile creation hook in auth verify`
**Status:** Done

Modified `/workspaces/rng-utopia/backend/services/backend/src/routes/auth.ts`:
- Added `db: Db` to `AuthRoutesDeps` interface
- Imported `Db` type from `../db.js`
- Destructured `db` in `createAuthRoutes()`
- After Ed25519 signature verification in POST `/verify` handler, added fire-and-forget profile creation: checks `db.getProfileByWallet(wallet)`, if null calls `db.createPlayerProfile(wallet)`, logs errors but never blocks auth success

Modified `/workspaces/rng-utopia/backend/services/backend/src/index.ts`:
- Passed `db` in the `createAuthRoutes()` deps object

Modified `/workspaces/rng-utopia/backend/services/backend/src/__tests__/auth-routes.test.ts`:
- Added `stubDb` with mock `getProfileByWallet` (returns null) and `createPlayerProfile` (returns empty object) to satisfy the new `db` dependency in tests
- Passed `db: stubDb` in `createAuthRoutes()` call

Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass.

## Iteration 16 — 2026-03-31T14:59:42Z — OK
- **Log**: iteration-016.log

## Iteration 17 — Aggregate stats query

**Item:** `[engine] Aggregate stats query`
**Status:** Done

Added to `/workspaces/rng-utopia/backend/services/backend/src/db.ts`:
- `PlayerStats` interface: `{ gamesPlayed: number, totalWagered: bigint, totalWins: number, winRate: number, netPnl: bigint }`
- `PublicPlayerStats` interface: `{ gamesPlayed: number, totalWins: number, winRate: number }`
- `getPlayerStats(wallet)`: single SQL query against `transactions` table — COUNT(DISTINCT match_id) for deposits/payouts, SUM for wagered/PnL, computes winRate in app code (avoids division-by-zero). Returns BigInt for monetary values, number for counts.
- `getPublicPlayerStats(wallet)`: delegates to `getPlayerStats`, returns only `{ gamesPlayed, totalWins, winRate }`
- Both methods added to `Db` interface with JSDoc
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 17 — 2026-03-31T15:03:53Z — OK
- **Log**: iteration-017.log

## Iteration 18 — Win streak computation

**Item:** `[engine] Win streak computation`
**Status:** Done

Added to `/workspaces/rng-utopia/backend/services/backend/src/db.ts`:
- `WinStreaks` interface: `{ current: number, best: number }`
- `getWinStreaks(wallet)` method on `Db` interface
- Implementation: SQL query groups `transactions` by `match_id`, uses `bool_or(tx_type = 'payout')` and `bool_or(tx_type = 'deposit')` to determine win/loss per match, orders by `MAX(created_at) DESC`. Application code walks the ordered results: counts consecutive wins from most recent for `current`, tracks longest run for `best`. Refund-only matches (no deposit, no payout) are skipped. If no losses encountered, current = total streak.
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 18 — 2026-03-31T15:07:24Z — OK
- **Log**: iteration-018.log

## Iteration 19 — Per-game breakdown query

**Item:** `[engine] Per-game breakdown query`
**Status:** Done

Added to `/workspaces/rng-utopia/backend/services/backend/src/db.ts`:
- `GameBreakdownStats` interface: `{ gamesPlayed: number, totalWagered: bigint, totalWins: number, winRate: number, netPnl: bigint }`
- `getGameBreakdown(wallet)` method on `Db` interface + implementation
- SQL: same aggregation as `getPlayerStats` but with `GROUP BY game`
- Maps DB game names to frontend names: `lord` → `lord-of-rngs`, `closecall` → `close-call`, `coinflip` → `coinflip`
- Games with zero `gamesPlayed` are omitted from the result
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 19 — 2026-03-31T15:11:18Z — OK
- **Log**: iteration-019.log

## Iteration 20 — GET /profile/me endpoint

**Item:** `[engine] GET /profile/me endpoint`
**Status:** Done

Added `GET /me` handler to `/workspaces/rng-utopia/backend/services/backend/src/routes/profile.ts`:
- Gets wallet from `c.get("wallet")`, fetches profile via `db.getProfileByWallet(wallet)`
- Returns 404 `{ error: "PROFILE_NOT_FOUND" }` if no profile exists
- Fetches stats, streaks, and game breakdown in parallel via `Promise.all`
- Assembles FR-9 response shape: `{ userId, username, avatarUrl, heatMultiplier, pointsBalance (string), stats: { gamesPlayed, totalWagered (string), totalWins, winRate, winStreakCurrent, winStreakBest, netPnl (string), gameBreakdown }, usernameNextEditAt, createdAt }`
- BigInt fields (`totalWagered`, `netPnl`, `pointsBalance`, per-game breakdown values) serialized as strings
- `usernameNextEditAt` is null if first edit hasn't been used, otherwise username_updated_at + 30 days ISO
- No `wallet` field in response
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 20 — 2026-03-31T15:14:08Z — OK
- **Log**: iteration-020.log

## Iteration 21 — PUT /profile/username endpoint

**Item:** `[engine] PUT /profile/username endpoint`
**Status:** Done

Added `PUT /username` handler to `/workspaces/rng-utopia/backend/services/backend/src/routes/profile.ts`:
- Requires JWT auth (wallet from `c.get("wallet")`)
- Validates username format: regex `^[a-zA-Z0-9_-]{3,20}$`, returns 400 `INVALID_FORMAT` on failure
- Checks 30-day cooldown from `username_updated_at` (first edit is free), returns 429 `COOLDOWN_ACTIVE` with `nextEditAvailableAt`
- Calls `db.updateUsername(wallet, username)` to persist the change
- On postgres UNIQUE violation (code `23505` or message contains "unique"), returns 409 `USERNAME_TAKEN`
- Race condition fallback: catches cooldown error from db layer too
- On success, returns `{ username, nextEditAvailableAt }` (ISO string, 30 days from now)
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 21 — 2026-03-31T15:17:08Z — OK
- **Log**: iteration-021.log

## Iteration 22 — GET /public-profile/:identifier endpoint

**Item:** `[engine] GET /public-profile/:identifier endpoint`
**Status:** Done

Created `/workspaces/rng-utopia/backend/services/backend/src/routes/public-profile.ts`:
- `createPublicProfileRoutes(deps)` factory following existing route pattern
- GET `/:identifier` handler — no auth middleware
- Resolves via `db.getProfileByIdentifier(identifier)` (supports both `usr_*` user IDs and usernames)
- Returns 404 `{ error: "NOT_FOUND" }` when no profile found
- Fetches public stats via `db.getPublicPlayerStats(profile.wallet)`
- Response shape: `{ userId, username, avatarUrl, heatMultiplier, stats: { gamesPlayed, totalWins, winRate }, createdAt }` — no wallet anywhere

Modified `/workspaces/rng-utopia/backend/services/backend/src/index.ts`:
- Imported `createPublicProfileRoutes` from `./routes/public-profile.js`
- Registered `app.route("/public-profile", createPublicProfileRoutes({ db }))` without JWT middleware

Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 22 — 2026-03-31T15:19:27Z — OK
- **Log**: iteration-022.log

## Iteration 23 — Update OpenAPI spec

**Item:** `[engine] Update OpenAPI spec`
**Status:** Done

Modified `/workspaces/rng-utopia/backend/services/backend/src/openapi.ts`:
- Updated Profile tag description from "Player transaction history" to "Player identity, stats, and transaction history"
- Added 6 component schemas: `GameBreakdownStats`, `PlayerStats` (with gameBreakdown as additionalProperties), `PublicStats`, `PlayerProfile` (full profile shape with stats + pointsBalance + usernameNextEditAt), `PublicPlayerProfile` (limited shape without wallet/PnL/streaks)
- Added 3 new paths:
  - `GET /profile/me` — JWT-secured, returns PlayerProfile, 401/404 errors
  - `PUT /profile/username` — JWT-secured, requestBody {username}, returns {username, nextEditAvailableAt}, 400/409/429 errors
  - `GET /public-profile/{identifier}` — no auth, path param identifier, returns PublicPlayerProfile, 404 error
- All schemas match actual response shapes from profile.ts and public-profile.ts
- Verified: `pnpm lint` (0 errors, 1 existing warning) and `pnpm typecheck` both pass

## Iteration 23 — 2026-03-31T15:25:00Z — OK
- **Log**: iteration-023.log

## Iteration 23 — 2026-03-31T15:22:11Z — OK
- **Log**: iteration-023.log

## Iteration 24 — Unit tests for username-gen

**Item:** `[test] Unit tests for username-gen`
**Status:** Done

Created `/workspaces/rng-utopia/backend/services/backend/src/__tests__/username-gen.test.ts` with 5 tests:
- `generateUserId()` matches format `usr_[a-z0-9]{8}`
- `generateUserId()` produces 10 unique values on successive calls
- `generateUsername()` matches format `{word}-{word}-{4digits}`
- `generateUsername()` produces 10 unique values on successive calls
- Username parts contain no spaces or special characters (20 iterations, verifies adjective=lowercase alpha, noun=lowercase alpha, suffix=4 digits)

All 5 tests pass. Pre-existing referral-routes test failure is unrelated.

## Iteration 24 — 2026-03-31T15:28:00Z — OK
- **Log**: iteration-024.log

## Iteration 24 — 2026-03-31T15:25:30Z — OK
- **Log**: iteration-024.log

## Iteration 25 — Unit tests for stats + streaks

**Item:** `[test] Unit tests for stats + streaks`
**Status:** Done

Created `/workspaces/rng-utopia/backend/services/backend/src/__tests__/player-stats.test.ts` with 9 tests:
- Empty history → all zeros (stats, streaks, and breakdown)
- 3 consecutive wins → current=3 best=3
- win-win-loss-win → current=1 best=2
- Refund-only match skipped in streak calculation
- Game breakdown groups by frontend game name (coinflip, lord-of-rngs, close-call) with correct stats per game
- Public stats expose only gamesPlayed, totalWins, winRate (no totalWagered/netPnl)
- Aggregate stats correctness (mixed wins/losses/refunds, correct netPnl computation)

All 9 tests pass. Pre-existing referral-routes test failure is unrelated.
Lint: 0 errors (1 existing warning). Typecheck: passes.

## Iteration 25 — 2026-03-31T15:31:00Z — OK
- **Log**: iteration-025.log
## Iteration 25 — 2026-03-31T15:31:40Z — OK
- **Log**: iteration-025.log

