# Technical Debt & Temporary Fixes

Track temporary hacks, relaxed rules, and shortcuts here. 
**Goal**: Eliminate these items before V1 Launch (or explicitly defer them).

---

## High Priority (Fix ASAP)

### [Webapp] Round/match consumers still expect wallet strings for `creator`/`winner`/`entries[].player`
- **Date**: 2026-05-04
- **Location**: `webapp/src/pages/flip-you/`, `webapp/src/pages/pot-shot/`, `webapp/src/pages/close-call/` — anywhere those fields are read off `/flip-you/by-id`, `/flip-you/history`, `/flip-you/verify`, `/pot-shot/current`, `/pot-shot/history`, `/pot-shot/by-id`, `/pot-shot/verify`, `/closecall/current-round`, `/closecall/history`, `/closecall/by-id`.
- **What**: Those response fields are now `PlayerRef = { userId, username, avatarUrl }` instead of base58 wallet strings. Frontend code that does `truncateAddress(round.creator)` / `match.player1` / `entries[].player` as a string will break or render `[object Object]`. The change closes a casual wallet leak (see `docs/PRIVACY.md`).
- **Current mitigation**: None. Webapp is a consult-only submodule from the backend's perspective; this is a deliberate breaking contract change documented for the frontend team to migrate against.
- **Proper solution**: Frontend reads `creator.username` / `creator.userId` / `creator.avatarUrl`; replaces wallet truncation with username; uses `avatarUrl` (or identicon hashed off `userId`, not wallet) where avatars are rendered. Same swap for `winner` and per-entry `player`.
- **Why not now**: Out of scope for this workspace (frontend team owns the migration).

### [Webapp] Flip You lobby + live match should switch off `getProgramAccounts` / on-chain account fetching
- **Date**: 2026-05-04
- **Location**: `webapp/src/pages/flip-you/api.ts` — `fetchAllOpenMatches`, `fetchClaimableMatches`, `fetchMatch`, `fetchMatchByMatchId`.
- **What**: Backend now serves the same data wallet-free via `GET /flip-you/open` (lobby), `GET /flip-you/mine` (auth, caller's matches across phases), and the existing `GET /flip-you/by-id/{matchId}`. Frontend currently reads on-chain (`program.account.flipYouMatch.all` / `.fetch`) for these, which exposes other players' wallets to the user's RPC traffic and to anything inspecting it (devtools, browser extensions, traffic analysis). The new endpoints align Flip You with the Pot Shot/Close Call pattern (already backend-driven) and remove the only remaining application-layer wallet leak.
- **Current mitigation**: None. The on-chain reads still work; this is a cleanup, not a regression.
- **Proper solution**: Replace `fetchAllOpenMatches` with `GET /flip-you/open`. Replace `fetchClaimableMatches` with `GET /flip-you/mine`. Replace `fetchMatch` / `fetchMatchByMatchId` polling with `GET /flip-you/by-id/{matchId}`. Keep WS PDA subscriptions for change-detection only (refetch from backend on change), not for rendering. Per-game UX trade-off: ~3-5s lag between on-chain join and lobby refresh, same as Pot Shot today; race conditions handled by on-chain `joinMatch` failing gracefully when phase is no longer `waiting`.
- **Why not now**: Out of scope for this workspace (frontend team owns the migration). Note: even after this, on-chain accounts remain enumerable by any RPC client — this fix removes the leak from *our users*, not from the world.

---

## Medium Priority (Before Launch)

### [Waitlist] `ProfileResponse.stats` is dead-typed
- **Date**: 2026-04-30
- **Location**: `waitlist/src/lib/profile-api.ts` — `ProfileResponse.stats: ProfileStatsResponse`
- **What**: Backend `/profile/me` no longer returns a `stats` field (split out to `GET /profile/stats` on 2026-04-30 per `docs/specs/008-user-profile/spec.md`). The waitlist type still declares `stats` and `ProfileStatsResponse`, but no code reads them — `TelegramCard.tsx` only consumes `telegramLinked`. Runtime is unaffected (extra field is ignored if absent), but the TS type lies about the contract.
- **Current mitigation**: Field is unread.
- **Proper solution**: Drop `stats: ProfileStatsResponse` from `ProfileResponse` and delete the unused `ProfileStatsResponse` interface in `waitlist/src/lib/profile-api.ts`.

### [Backend] `rateLimitGlobal` is route-local, not app-global
- **Date**: 2026-04-21
- **Location**: `backend/src/middleware/rate-limit.ts`, `backend/src/index.ts`, `backend/src/index-waitlist.ts`
- **What**: `createRateLimitMiddleware(...)` allocates fresh in-memory state per middleware instance, so `rateLimitGlobal` only applies within each mounted route group (`/auth/*`, `/flip-you/*`, `/pot-shot/*`, `/closecall/bet`, waitlist routes) instead of enforcing one shared global bucket across the app.
- **Current mitigation**: Cloudflare now provides a coarse host-level backstop in front of the API, and route-local in-app limits still protect individual endpoints.
- **Proper solution**: Either (1) implement a truly shared in-process/global limiter bucket for all route groups that are meant to share `rateLimitGlobal`, or (2) rename/configure the setting to make the route-local scope explicit and document it accordingly.
- **Why not now**: Current edge rate limiting reduces immediate flood risk, and changing limiter state sharing touches request-shaping behavior that should be validated separately.

### [Backend] Public referral code check endpoint — remove at prod
- **Date**: 2026-04-15
- **Location**: `backend/src/routes/public-referral.ts` — `GET /public-referral/code/:code`
- **What**: Unauthenticated endpoint that checks whether a referral code exists. Added for the waitlist pre-connect flow. Leaks code-existence info without auth — acceptable for waitlist but unnecessary attack surface once the main app launches.
- **Current mitigation**: Returns only `{ exists: boolean }` (no user info). Regex-validates input.
- **Proper solution**: Remove endpoint once waitlist is retired and the main app handles referral flows behind auth.

### ~~[Telegram] Webhook errors are too opaque and retry-prone~~
- **Resolved**: 2026-04-09 — `telegram/src/app.ts` now catches outbound reply delivery failures, logs webhook context, and still returns `200` to Telegram; `telegram/src/telegram-api.ts` now includes Telegram error bodies in thrown errors for faster diagnosis.

### [Challenge Engine] SOL crate payout handler needs production review
- **Date**: 2026-04-03
- **Location**: `backend/src/queue/handlers/crate-sol-payout.ts`
- **What**: `CRATE_SOL_PAYOUT` handler sends SOL from server keypair to player wallet. Needs manual review before production enablement — verify transfer amounts, error handling, retry behavior, and rate limiting against real treasury wallet.
- **Current mitigation**: Handler marks failed transfers as terminal (no retry). Integration-tested with mock connection only.
- **Proper solution**: (1) Add retry logic with max attempts (like referral-claim handler), (2) Add rate limiting per user, (3) Verify payout amounts against pool balance, (4) Test with real devnet treasury wallet, (5) Add monitoring/alerting for failed payouts.
- **Why not now**: M1 launch — handler structure is correct, needs ops hardening before real SOL flows through it.

### ~~[Pot Shot] Backend game-engine PDA helper uses stale `roundNumber` seed~~
- **Resolved**: 2026-04-02 — `getRoundPda(matchId: Buffer)` already uses correct seed. Confirmed in gap analysis for spec 101.

---

## Low Priority (Post-Launch cleanup)

### [Reward Economy] Multi-replica cache invalidation
- **Date**: 2026-04-29
- **Location**: `backend/src/reward-economy.ts` — `activeSeasonCache`, `activePointRateCache`, `invalidateRewardEconomyCache()`
- **What**: Active-season and active-point-rate caches are module-level globals with a 5-min TTL. `invalidateRewardEconomyCache()` is called after admin writes (season rollover, point-rate version, event create/cancel) but only invalidates the in-process cache.
- **Current mitigation**: App Platform runs **one** backend replica today, so the cache is consistent with admin writes.
- **Proper solution**: Before scaling to N replicas, switch to one of: (1) Postgres `LISTEN/NOTIFY` channel that all replicas subscribe to, (2) shorten TTL to ~30s and accept the staleness window, or (3) revalidate per request when the cached entry's `at` falls outside the cached season window.
- **Why not now**: Single-replica deploy makes this a non-issue today. Important to address before the first horizontal scale-out.

### ~~[Reward Economy] Wager-USD aggregate scales with grant count~~
- **Resolved**: 2026-04-29 — Migration 021 introduces `user_wager_totals` (per-user lifetime + current-season USD), maintained inside the points-grant transaction under the existing advisory lock. `computeEffectiveMultiplier` reads from the table instead of summing `metadata->>'wagerUsd'` across `point_grants`. Lazy season reset on first wager into the new active season. No backfill — existing grants do not contribute.

### [Reward Economy] Modifier table needs pruning strategy
- **Date**: 2026-04-29
- **Location**: `multiplier_modifiers` table; `computeEffectiveMultiplier()` query.
- **What**: Migration 020 split the index into two partial indexes (user-scoped + global) to keep lookups fast as the table grows. Long term, expired modifier rows still accumulate; the partial indexes don't filter by `ends_at`.
- **Current mitigation**: Two queries each hit a small partial index; performance is fine until expired-row count dominates.
- **Proper solution**: Periodically delete rows where `ends_at IS NOT NULL AND ends_at < now() - INTERVAL '90 days'` (or archive to a history table for audit). Alternatively, add a recurring `VACUUM`-friendly retention worker.
- **Why not now**: At launch volume the index alone is sufficient.

### [Backend] Migration 032 index on `game_entries` is non-CONCURRENT
- **Date**: 2026-05-09
- **Location**: `backend/migrations/032_daily_crate.sql` — `CREATE INDEX … idx_game_entries_daily_crate_settled_user`.
- **What**: The migration creates a partial b-tree on `game_entries (settled_at, user_id)`. The runner wraps every migration in a transaction, so `CREATE INDEX CONCURRENTLY` cannot be used inline. On a populated prod `game_entries` table this would take a `SHARE` lock that blocks concurrent inserts/updates on settlement writes for the duration of the build.
- **Current mitigation**: The migration uses `CREATE INDEX IF NOT EXISTS`, so ops can pre-create the index out-of-band before applying 032: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_entries_daily_crate_settled_user ON game_entries (settled_at, user_id) WHERE settled_at IS NOT NULL AND is_winner IS NOT NULL;` — the migration then short-circuits that statement.
- **Proper solution**: Either teach the migrate runner to honor a `-- migrate:concurrent` directive that runs the file outside a transaction, or move every CONCURRENTLY-eligible index into a dedicated post-step file. Decide before the next migration that adds an index on a hot table.
- **Why not now**: We are still in dev with an empty `game_entries` table; current setups complete instantly. The IF NOT EXISTS escape hatch is enough for first prod rollout.

### [Backend] Spec 306 invariant-violation test mutates schema
- **Date**: 2026-05-02
- **Location**: `backend/src/__tests__/admin-fee-audit.test.ts` — `flags invariant violations when components do not sum to fee`
- **What**: To exercise the snapshot's `invariantViolations` path, the test temporarily drops the `ck_fee_allocation_components_sum` CHECK on `fee_allocation_events`, inserts a row that violates the invariant, asserts the snapshot surfaces it, then deletes the row and re-adds the constraint. Schema mutation in a test against the shared dev/CI Postgres is unusual; if the `try/finally` ever fails to restore the constraint, the next test run starts with a missing CHECK.
- **Current mitigation**: Cleanup uses `DROP CONSTRAINT IF EXISTS` + delete-then-VALID-re-add so the test is re-runnable even if a prior run aborted. `beforeEach` truncates the table between tests, bounding cross-test impact.
- **Proper solution**: Move the invariant-violation case to a transaction-scoped fixture — open a `BEGIN`, drop the CHECK, insert the bad row, run assertions, `ROLLBACK`. The schema mutation never escapes the transaction, removing the "what if cleanup fails" failure mode entirely. Alternatively, expose a test-only helper that bypasses the helper-layer's CHECK alignment and writes via a partition or a separate test-only table.
- **Why not now**: The test passes reliably and the cleanup path is robust. Risk is bounded enough that fixing it during the simplify pass would have added churn for a hypothetical failure mode.

### [Reward Economy] `idx_point_balances_season_balance` is unused
- **Date**: 2026-04-29
- **Location**: `backend/migrations/018_reward_economy.sql:49-50`.
- **What**: Index `(season_id, balance DESC)` was added for a future points leaderboard. Current leaderboard ranks off `game_entries.amount_lamports`, so this index has zero readers.
- **Current mitigation**: None. Index is cheap (small table today) but writes pay for an unused index.
- **Proper solution**: Either ship the points leaderboard, or drop the index. Decide alongside the leaderboard product call.

### [Challenge Engine] Extract to separate service
- **Date**: 2026-04-04
- **Location**: `backend/src/queue/handlers/` (game-settled, reward-pool-fund, points-grant, crate-drop, crate-sol-payout), `routes/` (challenges, points, dogpile, admin)
- **What**: The archived reference spec (`docs/archive/references/challenge-engine-spec.md`) calls for `challenge-engine` as a standalone internal service with separate verification-workers and reward-service components. M1 implementation lives in the backend monolith for simplicity.
- **Current mitigation**: Event-driven architecture already decouples all components — handlers communicate via the event queue, not direct function calls. Extraction is mechanical when scale demands it.
- **Proper solution**: Move challenge engine handlers, routes, and DB helpers to a new `services/challenge-engine/` package. Share the event queue and DB connection. Separate deploy cycle.
- **Why not now**: At M1 scale, a second service adds deployment complexity for zero benefit. The event queue boundary makes future extraction straightforward.

---

## Post-V1 Backlog (Revisit When More Advanced)

Items that work today but deserve a proper implementation once the platform matures.

### [On-Chain] Stale account cleanup after program redeploys
- **Date**: 2026-03-15
- **Location**: `backend/src/worker/settlement.ts`, on-chain accounts
- **What**: Program redeploys can leave old accounts with incompatible layouts (different enum encoding, removed/reordered fields). Currently the settlement worker caches undecodeable PDAs and skips them after one warning. There's also one permanently undecodeable 888-byte Lord account on devnet from a pre-IDL-change deploy.
- **Current mitigation**: `undecodeablePdas` set in settlement worker, try/catch per-account in poll loop.
- **Proper solution**: (1) Admin "close any PDA" instruction that skips deserialization (transfer lamports + zero data), (2) Pre-deploy cleanup script that closes all game accounts before upgrade, (3) Account versioning (`version: u8` as first field) so decoders can branch on layout version.
- **Why not now**: Dev phase — redeploys are frequent, accounts are low-value, and the workaround is adequate.

### [Spec 307] Single combined `admin` role for payout pause/approve/reject
- **Date**: 2026-05-04
- **Location**: `peek/src/server/access-policy.ts` — `PEEK_ACTION_RULES` for `payout.pause.set`, `payout.controls.update`, `payout.claim.approve`, `payout.claim.reject`. Spec: `docs/specs/307-payout-pause-and-review/spec.md`.
- **What**: Spec 307 ships every payout admin action gated by the same `admin` role. There is no split between "operator who can pause" and "operator who can approve high-value claims". The audit trail (`operator_events`, `payout.*` actions) is the only safety net distinguishing decisions made by different operators.
- **Current mitigation**: Audit log captures actor email + before/after diff for every action. `/operations/payouts` recent-decisions list surfaces the trail to peers.
- **Proper solution**: Add a `treasury_operator` sub-role. Leave pause/threshold edit on `admin`, move approve/reject to `treasury_operator|admin`. Update `PEEK_ACTION_RULES` and `PEEK_ROLE_POLICY`.
- **Why not now**: There is no concrete role-separation requirement today (no second peer with limited scope, no compliance-driven split). Adding the role split before the need exists would block routine ops on a privilege we do not yet need to enforce.

### [Spec 402] Per-round `CRATE_DROP` removed from `game.settled`
- **Date**: 2026-05-08
- **Location**: `backend/src/queue/handlers/game-settled.ts` (per-round emit removed); `backend/migrations/032_daily_crate.sql` (CHECK tightened to `('challenge_completed','bonus_completed')`); spec 402 supersedes spec 400 FR-5 for the per-round path.
- **What**: Spec 402 replaces the per-round random crate drop with a single daily crate per eligible user (computed at 00:15 UTC on the previous-day's wager volume). The `game.settled` handler no longer emits `crate.drop` with `trigger_type='game_settled'`; the migration rejects any leftover row of that shape; spec 400 FR-5 acceptance criteria for the per-round path are explicitly overridden by spec 402.
- **Current mitigation**: Daily crate compute worker is the new source of player-facing crate drops. Challenge-completed and bonus-completed crate paths are unchanged and still emit `crate.drop` for their respective `trigger_type` values. Operators verify the daily run via peek's runs/rewards tables and pending-SOL liability widget.
- **Proper solution**: This is the proper solution; the entry exists to record that legacy `'game_settled'` is intentionally absent from the `crate_drops.trigger_type` CHECK and that any code path attempting to re-introduce it is a regression. Re-enabling per-round drops requires re-adding the trigger value, the emit block, and reconciling against the daily aggregate. Don't.

### [Spec 402] Reward event-naming convention is uneven
- **Date**: 2026-05-08
- **Location**: `backend/src/queue/event-types.ts`, `backend/src/queue/handlers/`. Examples: `EventTypes.CRATE_DROP` ("crate.drop") vs. `EventTypes.CRATE_SOL_PAYOUT` ("crate.sol_payout") vs. `EventTypes.POINTS_GRANT` ("points.grant") vs. `EventTypes.REWARD_POOL_FUND` ("reward.pool_fund") vs. `EventTypes.REFERRAL_GAME_SETTLED` ("referral.game_settled").
- **What**: Reward-economy event names mix several conventions: domain-noun-verb (`reward.pool_fund`, `crate.sol_payout`), domain-verb (`crate.drop`, `points.grant`), and domain-source (`referral.game_settled`). New events tend to follow the closest neighbor rather than a documented rule, which keeps the inconsistency growing. Spec 402 introduces `'daily_crate'` as a new `point_grants.source_type` value and `'daily_crate_reward:{id}'` as the SOL payout idempotency-key namespace; both are stable on the wire and cannot be renamed without coordinated consumer updates.
- **Current mitigation**: All current names are stable and documented in `event-types.ts`. Persisted idempotency keys (`payout_attempts.idempotency_key`) and persisted source-type values (`point_grants.source_type`) anchor wire compatibility for queue consumers and downstream dedupe.
- **Proper solution**: Adopt a single convention (e.g. `<domain>.<action>` with snake_case actions: `crate.drop`, `crate.sol_payout`, `points.grant`, `reward.pool_fund`, `referral.game_settled` — already mostly conformant) and codify it in `docs/FOUNDATIONS.md`. Rename outliers behind dual-emit shims if/when a real refactor is scheduled; renaming a shipped name is a breaking change for the queue and persisted dedupe state.
- **Why not now**: Pure cosmetic cleanup with non-trivial migration cost (queue consumers, persisted source_type/idempotency_key values). Not a launch blocker.
