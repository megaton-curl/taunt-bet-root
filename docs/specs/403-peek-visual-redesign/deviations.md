# 403 Peek Visual Redesign — Deviations from Plan

Tracks places where the implementation diverged from the plan as written, and why. Plan and spec stay authoritative for intent; this file captures the *concrete* shape that landed.

## Phase 4 — Visual-fixture seed

### `telegram_links` → `linked_accounts`

The plan named a `telegram_links` table. The actual schema uses `linked_accounts` with `provider = 'telegram'` (migrations 014 → 015 → 016 → 017 consolidated into the polymorphic `linked_accounts` shape that `peek/src/server/db/queries/list-peek-users.ts` consumes via `linked_accounts.telegram_user_id` / `telegram_username`). Telegram-flavored rows are correctly seeded into `linked_accounts`; no `telegram_links` table is created or referenced.

### `dogpile_events` table is absent (pre-existing peek query gap)

`peek/src/server/db/queries/get-dogpile-and-fraud.ts` queries a table called `dogpile_events`. That table was dropped in `backend/migrations/019_remove_legacy_reward_surfaces.sql` (`DROP TABLE IF EXISTS dogpile_events`). The query file was not updated when the table was removed.

For the visual-fixture seed, this means `seedOperations` cannot populate dogpile data, and the `/operations/dogpile` page in peek will render with empty metrics under the visual fixture. This is a pre-existing peek bug, not a redesign-phase concern, but flagged here because the visual snapshots will reflect the empty state — which is fine for the visual rubric (the page still renders) but worth a follow-up issue against peek's queries.

### `postgres:///<dbname>` URL shorthand handled by helper

The local Postgres instance accepts only Unix-socket connections (no TCP listener configured). The `postgres` npm package does not natively interpret `postgres:///<dbname>` as a Unix-socket connect string the way `psql` does. The seed script and smoke test include a small `buildSqlClient` helper that detects the `postgres:///` shorthand and rewrites the connection to use `host: '/var/run/postgresql'`. Transparent to callers; the README still documents the shorthand as the canonical form because it works for `psql` and matches what backend `migrations` accept under the same env var.
