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

