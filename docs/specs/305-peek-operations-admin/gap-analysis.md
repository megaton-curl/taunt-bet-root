# Gap Analysis: 305 — Peek Operations Admin

- **Date**: 2026-04-25
- **Spec status**: Ready (iteration 41)
- **Previous analysis**: First run

## Implementation Inventory

### Routes (Next.js App Router)

| Route | File | Status |
|-------|------|--------|
| `/` (command center + users list + global search) | `peek/app/page.tsx` | Built |
| `/users/[userId]` | `peek/app/users/[userId]/page.tsx` | Built |
| `/games` | `peek/app/games/page.tsx` | Built |
| `/games/[game]` | `peek/app/games/[game]/page.tsx` | Built |
| `/games/[game]/rounds/[roundId]` | `peek/app/games/[game]/rounds/[roundId]/page.tsx` | Built |
| `/growth/referrals` | `peek/app/growth/referrals/page.tsx` | Built |
| `/growth/kol` | `peek/app/growth/kol/page.tsx` | Built |
| `/economy/rewards` | `peek/app/economy/rewards/page.tsx` | Built |
| `/users` (list page) | — | **Missing** (nav links to it) |
| `/economy/challenges` | — | **Missing** |
| `/operations/queue` | — | **Missing** (nav links to it) |
| `/operations/dogpile` | — | **Missing** |
| `/audit` | — | **Missing** (nav links to it) |
| `/access` | — | **Missing** (nav links to it) |
| `/growth/telegram` | — | Missing (IA only, may be deferrable) |
| `/search` | — | Missing (search lives on `/`) |

### Server modules

| Module | File | Purpose |
|--------|------|---------|
| Cloudflare Access verifier (`jose`) | `peek/src/server/cloudflare-access.ts` | FR-1 JWT verification |
| Proxy / middleware | `peek/proxy.ts` | FR-1 outer gate, dev bypass, header strip |
| Local role policy | `peek/src/server/access-policy.ts` | FR-2 roles, route + action rules |
| Admin shell nav | `peek/src/server/admin-shell-nav.ts` | FR-3 visible nav items |
| Audit writer | `peek/src/server/audit/writer.ts` | FR-11 writes `peek.*` to `operator_events` |
| Audit redact | `peek/src/server/audit/redact.ts` | FR-11 secret redaction |
| Mutations | `peek/src/server/mutations/README.md` (placeholder only) | FR-14 not implemented |

### Query functions (`peek/src/server/db/queries`)

| Query | Backs |
|-------|-------|
| `count-peek-users.ts` | `/` users table count |
| `list-peek-users.ts` | `/` users table |
| `get-peek-summary.ts` | `/` summary strip |
| `get-peek-user-detail.ts` | `/users/[userId]` (FR-6) |
| `get-command-center-attention.ts` | `/` attention queue (FR-3, FR-10 metric counts) |
| `get-recent-operator-events.ts` | `/` activity list |
| `universal-search.ts` | `/` global search (FR-5) |
| `get-growth-referrals.ts` | `/growth/referrals`, `/growth/kol` (FR-7) |
| `get-games-overview.ts` | `/games` (FR-8) |
| `get-game-rounds.ts` | `/games/[game]` (FR-8) |
| `get-round-detail.ts` | `/games/[game]/rounds/[roundId]` (FR-8) |
| `get-rewards.ts` | `/economy/rewards` (FR-9 reward economy slice) |

### Components (`peek/src/components`)

| Component | File | Purpose |
|-----------|------|---------|
| `AdminShell` | `admin-shell.tsx` | FR-3 persistent shell |
| `MetricStrip` | `metric-strip.tsx` | FR-4 metric primitive |
| `FilterBar` | `filter-bar.tsx` | FR-4 URL-addressable filters |
| `PeekTable` | `peek-table.tsx` | FR-13 dense sortable table |
| `StatusChip` | `status-chip.tsx` | FR-3 state primitive |
| `EmptyState` | `empty-state.tsx` | FR-3 operator empty copy |
| `DetailPanel` | `detail-panel.tsx` | FR-3 anchored sections |
| `SummaryStrip` | `summary-strip.tsx` | 303-era summary |
| `UsersTable` | `users-table.tsx` | `/` users |
| `UniversalSearchResults` | `universal-search-results.tsx` | FR-5 |
| `UserDetailView` | `user-detail-view.tsx` | FR-6 |
| `RecentActivityList` | `recent-activity-list.tsx` | `/` activity |
| `GamesOverviewTable` | `games-overview-table.tsx` | FR-8 overview |
| `GameRoundsTable`, `GameRoundsFilterBar` | `game-rounds-table.tsx`, `game-rounds-filter-bar.tsx` | FR-8 per-game |
| `CloseCallRoundsTable` | `closecall-rounds-table.tsx` | FR-8 close call |
| `RoundDetailView` | `round-detail-view.tsx` | FR-8 round detail |
| `GrowthReferrersTable`, `GrowthKolTable`, `GrowthClaimsTable`, `GrowthClaimsFilterBar` | `growth-*` | FR-7 |
| `RewardPoolCard`, `RewardConfigTable`, `RewardPoolFundingsTable` | `reward-*` | FR-9 rewards slice |
| `PaginationControls` | `pagination-controls.tsx` | FR-13 |

### Tests (44 vitest files, 410 tests passing per iteration 41 log)

| Layer | File | Status |
|-------|------|--------|
| Cloudflare Access verifier | `__tests__/cloudflare-access.test.ts` | Pass |
| Cloudflare proxy | `__tests__/cloudflare-access-middleware.test.ts` | Pass |
| Access policy | `__tests__/access-policy.test.ts` | Pass |
| Admin shell nav | `__tests__/admin-shell-nav.test.ts` | Pass |
| Audit writer | `audit/__tests__/writer.test.ts` | Pass |
| Per-query | `db/queries/__tests__/*.test.ts` (12 files) | Pass |
| Per-component | `components/__tests__/*.test.tsx` (24 files) | Pass |
| Lib helpers | `lib/__tests__/*.test.ts` (3 files) | Pass |

## Acceptance Criteria Audit

### FR-1: Cloudflare Identity Boundary

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Production requests without valid JWT denied before render | SATISFIED | `peek/proxy.ts:50-52` returns 403; `cloudflare-access-middleware.test.ts:11-22` |
| 2 | Valid JWT but missing/invalid email denied | PARTIAL → GAP | `proxy.ts:54-56` lets request through with no header set when `verification.email === null`; `app/layout.tsx:19-31` shows access-denied panel via `AdminShell` (no 403, but children are not rendered) — denial is rendered, not a hard 403 |
| 3 | `jose` `createRemoteJWKSet` + `jwtVerify`, custom code removed | SATISFIED | `cloudflare-access.ts:1-9, 56-72`; no custom crypto/JWKS code present |
| 4 | Normalized email attached to server-side context, not from browser | SATISFIED | `proxy.ts:17-18` strips browser-supplied header; `proxy.ts:54-56` re-sets after verification; `access-policy.ts:115-125` reads only via `headers()` |
| 5 | No second global env allowlist for base access | SATISFIED | `access-policy.ts` reads only `PEEK_ACCESS_POLICY` for role mapping; base access is Cloudflare-only |
| 6 | Dev bypass explicit, local-only via `PEEK_DEV_ACCESS_EMAIL` | SATISFIED | `proxy.ts:20-28`; `cloudflare-access-middleware.test.ts:39-67` (production ignores; dev honors) |
| 7 | Tests cover missing/invalid token, missing email, normalization, propagation, dev bypass | SATISFIED | `cloudflare-access.test.ts`, `cloudflare-access-middleware.test.ts` |

### FR-2: Local Roles And Page/Action Access

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Access checks centralized in one server-only module | SATISFIED | `access-policy.ts:177-218` (route + action helpers in same module) |
| 2 | Local role policy in checked-in server-only module/config | SATISFIED | `access-policy.ts` (server-only, loaded via `loadPeekRolePolicyFromEnv`); `PEEK_ACCESS_POLICY` JSON is the policy seam |
| 3 | Exact emails supported | SATISFIED | `access-policy.ts:99-102` |
| 4 | Wildcard domains `*@example.com` supported | SATISFIED | `access-policy.ts:51-56, 99-102` |
| 5 | Case-insensitive + whitespace-trim matching | SATISFIED | `access-policy.ts:48, 80-85` |
| 6 | Roles limited to `business`, `admin` | SATISFIED | `lib/access-policy.ts` defines `PeekRole = "business" \| "admin"`; `access-policy.ts:42-43` rejects others |
| 7 | One effective role; admin precedence | SATISFIED | `access-policy.ts:96-112` (admin returns immediately) |
| 8 | Route prefixes with role list; sensitive routes admin-only | SATISFIED | `access-policy.ts:150-152` (`/audit` requires admin); `getRequiredRolesForRoute` |
| 9 | Mutation action ids with role lists | SATISFIED | `access-policy.ts:154-159` (kol_rate.update, fraud_flag.status.update, dogpile.cancel, reward_config.update) |
| 10 | Unknown routes default; unknown actions deny | SATISFIED | `access-policy.ts:148, 201-207` (unknown action → null → false) |
| 11 | Tests cover all role/policy paths | SATISFIED | `__tests__/access-policy.test.ts` |

### FR-3: Admin Shell And Navigation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Persistent shell with nav groups (Users, Growth, Games, Economy, Operations, Audit, Access) | SATISFIED | `admin-shell.tsx:42-53`; `admin-shell-nav.ts:12-20` (all 7 groups declared) |
| 2 | Shell shows verified actor email + resolved role | SATISFIED | `admin-shell.tsx:55-66` |
| 3 | Shell hides pages actor cannot access | SATISFIED | `admin-shell-nav.ts:22-28`; `app/layout.tsx:26` |
| 4 | First screen dense: search + attention + metric strip + table access | SATISFIED | `app/page.tsx:118-249` (search, attention, summary, recent activity, users) |
| 5 | No marketing hero / decorative filler | SATISFIED | `app/page.tsx` and other pages render only operator-facing content |
| 6 | Empty states explain absence in operator terms | SATISFIED | `empty-state.tsx`; used across `users-table.tsx`, growth/games tables |

(Implicit gap not tied to a checkbox: nav has links to `/users`, `/operations/queue`, `/audit`, `/access` whose pages do not exist — covered under FR-9, FR-10, FR-11, FR-3-shell coverage. Listed under "Recommendations".)

### FR-4: Data Surfacing Standard

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Each metric has stable id, label, value, source, window, asOf | SATISFIED | `lib/types/peek.ts` `PeekMetric`; populated in `get-command-center-attention.ts:80-94`, `get-rewards.ts`, `get-games-overview.ts`, `get-growth-referrals.ts` |
| 2 | Each metric has a short definition in UI/help | SATISFIED | `PeekMetric.definition` populated; `metric-strip.tsx` renders it |
| 3 | Each summary metric links to filtered detail | SATISFIED | `drilldownHref` populated for command-center, rewards, growth, games metrics |
| 4 | Each page states freshness (live/cached/manual/sampled) | PARTIAL | `PeekMetric.freshness` exists and is set to `"live"`; not surfaced as a per-page banner — only per-metric |
| 5 | Sparse data renders explicit empty states | SATISFIED | Empty state copy in tables (e.g., `growth-claims-table.tsx`, `reward-pool-fundings-table.tsx`, `users-table.tsx`) |
| 6 | Monetary values display units, retain lamports | SATISFIED | `formatLamports` in queries; raw lamport string preserved (e.g., `reward-pool-card.tsx` `title=` attr) |
| 7 | Integer formatting; no float rounding for ledger values | SATISFIED | u64 round-trips as `text` everywhere; `formatCount` uses `toLocaleString` |
| 8 | Filters URL-addressable | SATISFIED | `lib/search-params.ts`, `lib/games-search-params.ts`, `lib/growth-search-params.ts` |
| 9 | Default filters prevent unbounded queries | SATISFIED | `PEEK_GAME_ROUNDS_DEFAULT_PAGE_SIZE`, `PEEK_GROWTH_*_DEFAULT_LIMIT`, `PEEK_REWARD_POOL_FUNDINGS_DEFAULT_LIMIT` |

### FR-5: Universal Search

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Accepts user_id, username, wallet, referral code, Telegram username, Telegram provider id, round PDA, match id, tx signature | SATISFIED | `universal-search.ts:166-374` (searchUsers, searchReferralCodes, searchLinkedAccounts, searchRounds, searchTransactions, searchQueueEvents) |
| 2 | Results grouped by entity type | SATISFIED | `universal-search.ts:436-463` |
| 3 | Each result includes disambiguating context | SATISFIED | Each result has `sublabel` + `context` |
| 4 | Server-side and bounded | SATISFIED | `clampLimit` (`PEEK_SEARCH_MAX_PER_GROUP_LIMIT`); per-group `limit` clauses |
| 5 | No backend route changes | SATISFIED | All queries direct DB reads in `peek/src/server/db/queries/` |
| 6 | Logs `peek.search` with actor, query class, counts, no secrets | SATISFIED | `universal-search.ts:376-399` (`defaultPeekSearchAudit`) + redaction in writer |

### FR-6: Expanded User Detail

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Profile identity from `player_profiles` (heat, profile points slot, avatar) | SATISFIED | `get-peek-user-detail.ts:108-144` |
| 2 | Linked accounts state from `linked_accounts` with Telegram metadata | SATISFIED | `get-peek-user-detail.ts:289-308` (fetchLinkedAccounts) |
| 3 | Latest Telegram link tokens from `telegram_link_tokens` | SATISFIED | `fetchRecentTelegramLinkTokens` in same file |
| 4 | Referral code, inbound referrer, outbound referees, KOL rate, earnings, rebates, claim states | SATISFIED | Same file: fetchOutboundReferees, fetchKolRate, fetchReferralEarnings, fetchRecentReferralClaims |
| 5 | Points balance, lifetime, recent grants, recent crates, challenge summary | SATISFIED | fetchPlayerPoints, fetchRecentPointGrants, fetchRecentCrateDrops, fetchChallengeSummary |
| 6 | Recent game entries + transactions across all 3 games | SATISFIED | fetchRecentGameEntries, fetchRecentTransactions |
| 7 | Attention flags (failed claim, dead queue, fraud, pending SOL crate, self/loop) | SATISFIED | `get-peek-user-detail.ts:186-192` (`computeAttention`); `user-detail-view.tsx:128-145` |
| 8 | Tabs / anchored sections | SATISFIED | `user-detail-view.tsx:47-99` 8 sections via `DetailPanel` |

### FR-7: Growth And Referral Operations

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Referral overview: referrers, referred, activated, earnings, rebates, pending claims, failed claims, KOL count | SATISFIED | `get-growth-referrals.ts` `getGrowthReferralOverview` (eight FR-4 metrics) |
| 2 | Top referrers table | SATISFIED | `listTopReferrers`; `growth-referrers-table.tsx` |
| 3 | KOL table from `referral_kol_rates` | SATISFIED | `listKolPerformance`; `growth-kol-table.tsx` |
| 4 | Claim table with filters | SATISFIED | `listReferralClaims`; `growth-claims-table.tsx`, `growth-claims-filter-bar.tsx` |
| 5 | Graph navigation referrer ↔ referees ↔ user detail | SATISFIED | `getReferralGraphNode`; tables link to `/users/[userId]` |
| 6 | CSV export for filtered tables (after FR-11) | GAP | No export route, no export action wired in `growth-*` components, no `peek.export` emission |

### FR-8: Gameplay And Settlement Visibility

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Games overview from `game_entries`: entries, unique users, wagered, settled, refunds, payouts, win/loss per game | SATISFIED | `get-games-overview.ts`; `games-overview-table.tsx` |
| 2 | FlipYou + Pot Shot round visibility from `rounds` | SATISFIED | `get-game-rounds.ts` (fields: phase, pda, match_id, creator, target_slot, settle_attempts, settle_tx, result_side, winner, timestamps); `game-rounds-table.tsx` |
| 3 | Close Call round visibility from `closecall_rounds` | SATISFIED | `get-game-rounds.ts` listCloseCallRounds; `closecall-rounds-table.tsx` |
| 4 | Round detail joins entries + transactions | SATISFIED | `get-round-detail.ts`; `round-detail-view.tsx` |
| 5 | Stuck-state filters (nonterminal age, high attempts, settled-without-tx, refunds) | SATISFIED | `get-game-rounds.ts:53-61` thresholds; `game-rounds-filter-bar.tsx` |
| 6 | Deferred/planned games appear only as documented placeholders | SATISFIED | `lib/deferred-games.ts`; `app/games/page.tsx` renders `PEEK_DEFERRED_GAMES` placeholder strip |

### FR-9: Economy, Rewards, Challenges, And Dogpile

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Reward config (key, value, updated_at, definition, expected type) | SATISFIED | `get-rewards.ts:46-... PEEK_REWARD_CONFIG_KEY_REGISTRY`; `reward-config-table.tsx` |
| 2 | Reward pool + recent fundings + funding round ids | SATISFIED | `getRewardPool`, `listRewardPoolFundings`; `reward-pool-card.tsx`, `reward-pool-fundings-table.tsx` |
| 3 | Points page from `player_points` + `point_grants` with filters | GAP | No `/economy/points` page, no `list-points` query module — checklist iteration unstarted |
| 4 | Crate page from `crate_drops` with filters | GAP | No `/economy/crates` page; user-detail shows recent crates only |
| 5 | Challenge page (`campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, `bonus_completions`) | GAP | No `/economy/challenges` page or queries |
| 6 | Dogpile page (`dogpile_events` + linked campaign/game activity) | GAP | No `/operations/dogpile` page or queries |
| 7 | Fraud review page or section from `fraud_flags` (read-only) | PARTIAL → GAP | `get-peek-user-detail.ts` reads `fraud_flags` per-user; no global fraud review page |
| 8 | Challenge definition editing out of scope | DEFERRED | Spec says explicitly out of scope (FR-9, FR-14) |
| 9 | Reward config editing only via FR-14 mutation rules | DEFERRED → GAP | FR-14 not implemented; no edit path exists |

### FR-10: Queue And Operational Health

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Queue overview from `event_queue`: counts by status, type, attempts, age, max | PARTIAL | `get-command-center-attention.ts:124-129` only counts `status='dead'` for the home strip; no full overview query |
| 2 | Queue table with filters | GAP | No `/operations/queue` page, no queue list query |
| 3 | Queue detail with payload JSON, error, attempts, linked routes | GAP | Not implemented |
| 4 | Dead/failed events surfaced on command center | SATISFIED | `get-command-center-attention.ts` "Dead queue events" metric on `/` |
| 5 | Read-only (no retry/cancel/replay) | SATISFIED (vacuously) | No mutation surface exists |
| 6 | Payload rendering redacts known secrets | GAP | Detail rendering not implemented; redaction policy exists in audit writer but not in queue payload renderer |

### FR-11: Audit Logging For Sensitive Reads, Exports, And Changes

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Server-side helper writes `operator_events` with `peek.*` event types | SATISFIED | `audit/writer.ts:47-74`; `lib/types/peek.ts:377-392` (six types defined) |
| 2 | Payload includes actor, route, action, resource, filter summary, result count, request id | SATISFIED | `lib/types/peek.ts` `PeekAuditPayload`; populated by `universal-search.ts:386-398`, `get-peek-user-detail.ts:49-63` |
| 3 | Mutation audit includes before/after for changed fields, no secrets | DEFERRED → GAP | `PeekAuditPayload.changes` exists; no mutation emits it (no mutations exist) |
| 4 | Rejected mutation audit logs reason and no submitted secrets | DEFERRED → GAP | Same as above |
| 5 | Audit payload excludes JWTs, DB URLs, private keys, raw secrets | SATISFIED | `audit/redact.ts`; `audit/__tests__/writer.test.ts` covers redaction |
| 6 | Sensitive sections, exports, and mutations call audit helper | PARTIAL | Sensitive user view + search call audit; exports + mutations not implemented so no calls there |
| 7 | Audit failure does not leak sensitive data to browser | SATISFIED | `writer.ts:67-72` returns `{ ok: false, reason }` without payload; callers (`universal-search.ts:472-485`, `get-peek-user-detail.ts:202-213`) swallow errors |
| 8 | Audit view filters by event type, actor, resource, route, date | GAP | No `/audit` page, no filtered audit query (only `get-recent-operator-events.ts` for the home activity strip) |
| 9 | `/audit` route restricted via FR-2 page-level allowlist | PARTIAL | `access-policy.ts:151` declares `/audit: ["admin"]`, but the route doesn't exist |

### FR-12: Exports

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Available only for filtered tables | GAP | No export routes exist |
| 2 | Server-side row cap | GAP | `PEEK_EXPORT_ROW_CAP_DEFAULT = 5000` defined in types but no enforcer |
| 3 | Logs `peek.export` before returning | GAP | No export route emits this; only the command-center counts existing rows |
| 4 | Export rows match table view-model | GAP | Type contracts exist (`PeekExportRow`, `PeekExportResult`) but unused |
| 5 | Filenames include entity, date, filter slug | GAP | `PeekExportFilenameInput` defined; no implementation |
| 6 | Export routes inherit page-level access | GAP | No routes |
| 7 | Disabled in production without audit logging | GAP | No gate implementation |

### FR-13: Data Access Architecture And Performance

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | SQL only in `peek/src/server/db/queries/**` | SATISFIED | All `sql\`...\`` template literals live there; pages and components consume view models only |
| 2 | Pages call query functions and receive shaped view models | SATISFIED | Verified across `app/**/page.tsx` |
| 3 | Browser components receive serializable data only | SATISFIED | Components import only `lib/types/peek` types; no server imports |
| 4 | High-volume tables paginated / cursored / limited | SATISFIED | `PEEK_GAME_ROUNDS_DEFAULT_PAGE_SIZE`, `PEEK_GROWTH_*_DEFAULT_LIMIT`, `PaginationControls` |
| 5 | Query functions avoid N+1 on table pages | SATISFIED | Aggregations done in single SQL queries (e.g. `get-games-overview.ts` GROUP BY; `get-growth-referrals.ts` left joins) |
| 6 | Heavy pages use required filters / date windows / manual refresh | SATISFIED | `force-dynamic`; default filters and limits |
| 7 | Auto-refresh off by default | SATISFIED | No client-side polling in any built page |
| 8 | Query tests cover null/sparse view-model shaping | SATISFIED | `__tests__/get-rewards.test.ts`, `get-games-overview.test.ts`, `get-growth-referrals.test.ts`, `get-round-detail.test.ts`, etc. |
| 9 | Component tests cover empty/loading/populated/error | SATISFIED | 24 component test files cover those states |

### FR-14: Scoped Admin Changes

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `peek/src/server/mutations/**` is the only place for write actions | GAP | Directory contains only `README.md` placeholder |
| 2 | Each mutation has stable action id, role list, schemas, results, tests | GAP | No mutations |
| 3 | Each mutation runs server-side, transaction when needed | GAP | No mutations |
| 4 | Each mutation writes `peek.change.applied` with before/after | GAP | Event type defined; no emitters |
| 5 | Denied/validation-failed mutation writes `peek.change.rejected` | GAP | Same |
| 6 | Initial allowed: KOL rate, fraud_flags.status, scheduled Dogpile cancel, selected reward_config keys | GAP | None implemented |
| 7 | Reward config edit guarded by explicit confirmation + old/new display | GAP | Not implemented |
| 8 | Other write paths (queue retry, claim/crate payout overrides, profile edits, tx edits, settlement edits) out of scope | DEFERRED | Documented in spec as out of scope; no implementation |
| 9 | Direct DB writes only for approved candidates | SATISFIED (vacuously) | No DB writes anywhere in `peek/src` outside the audit insert |

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|----|-----------|----------|----------|------------|-----------|
| 1 | FR-1 | Missing/invalid email returns hard 403 instead of layout-rendered access-denied | low | engine | — | Add explicit deny in `proxy.ts` when `verification.email === null` in production |
| 2 | FR-3 | Nav links to `/users`, `/operations/queue`, `/audit`, `/access` whose pages don't exist (404s) | moderate | frontend | FR-9/10/11 buildout | Either build the pages or hide nav items until they ship |
| 3 | FR-4 | Page-level data freshness banner | low | frontend | — | Surface freshness label per page header (per-metric only today) |
| 4 | FR-7 | CSV export for referral/KOL tables | moderate | engine + frontend | FR-12 framework | Implement FR-12 first, then wire into growth pages |
| 5 | FR-9 | Points + crates page (queries + UI + tests) | moderate | engine + frontend | — | Next iteration per checklist line ~518 |
| 6 | FR-9 | Challenges page (campaigns, challenges, assignments, progress, bonuses) | moderate | engine + frontend | — | Checklist line ~521 |
| 7 | FR-9 | Dogpile + fraud page | moderate | engine + frontend | — | Checklist line ~524 |
| 8 | FR-10 | Queue overview, table, detail, payload redaction | critical | engine + frontend | — | Without this, async payouts can't be inspected without raw SQL |
| 9 | FR-11 | `/audit` page with filtered `operator_events` view | critical | engine + frontend | — | Audit writer is live; need the read surface to make audits reviewable |
| 10 | FR-12 | Export routes (entity slugs, row caps, audit emission, prod-disable-without-audit) | moderate | engine + frontend | FR-11 audit writer (done) | Next iteration |
| 11 | FR-14 | Mutation framework + KOL rate / fraud status / Dogpile cancel / reward config edit | critical | engine + frontend + test | — | All four planned mutations missing; no framework |

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Crash, Game of Trades, Chart the Course, Slots Utopia, Tug of Earn admin pages | placeholders until persisted data exists | 002, 102, 103, 104, 105 | Deferred | Not stale — game specs themselves deferred |
| Challenge definition editing | out of scope (FR-9) | — | — | Intentional — no target spec, edits stay out of scope |
| Queue retry / cancel / replay actions | out of scope (FR-10, FR-14) | future spec | — | Intentional — separate spec required before write paths land |
| Claim payout / crate payout overrides, profile identity edits, transaction edits, settlement edits | out of scope (FR-14) | future spec | — | Intentional |

## Recommendations

1. **Critical for "operations admin" claim**: FR-10 (queue), FR-11 audit view, and FR-14 mutations are the load-bearing parts of an ops admin. Without queue + audit view + at least one mutation, the spec's user stories ("admin can investigate a queue event", "admin changes leave before/after audit trail", "sensitive reads/exports leave operator trail") are not actually satisfied end-to-end. The audit writer is in place but unreadable from the UI; mutations are entirely absent.
2. **Hide nav items for routes that don't exist yet** (`/users`, `/operations/queue`, `/audit`, `/access`) so the shell doesn't ship 404 links to operators. Either gate the nav definitions behind a feature flag or add stub pages with an "in progress" state.
3. **FR-1 missing-email-claim** — tighten `proxy.ts:54-56` to return 403 in production when verification succeeds but email is null. Today the request silently passes through and relies on the layout to render denial; that depends on every page route being inside the layout and is out of step with the rest of the FR-1 hard denials.
4. **FR-9 finish-line** — points/crates, challenges, dogpile/fraud all share a similar "list + filter + drill-down to user" pattern already established by `growth-*`. Likely a short, high-value iteration.
5. **FR-12 + FR-7 export wiring** — type contracts for exports already exist (`PeekExportEntity`, `PeekExportResult`, `PEEK_EXPORT_ROW_CAP_DEFAULT`). Adding export routes is mostly mechanical once one is built; CSV serialization is straightforward. Best to implement once and reuse across growth/audit/queue.
6. **FR-14 framework first**: build the mutation framework (action registry + role check + transaction + applied/rejected audit emission) once, then layer in the four scoped mutations (KOL rate, fraud flag status, Dogpile cancel, reward config). Tests should drive the audit payload contracts.
7. **No backend-API regressions** — confirmed: spec invariant 9 holds. No public route or OpenAPI change is required to finish FR-9 → FR-14.
