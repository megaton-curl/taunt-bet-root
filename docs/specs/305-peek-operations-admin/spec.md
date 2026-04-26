# Specification: [305] Peek Operations Admin

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 139 |

---

## Overview

`peek` should become the internal operations admin for everything TAUNT has built so far, plus the product surfaces we are already planning. It should remain a separate server-rendered app in `peek/`, reuse the current database schema wherever possible, and avoid changes to the public backend/API unless a future item truly cannot be served from the existing data.

The goal is not to build a heavy BI platform. The goal is a practical operator console where a human, business developer, or admin can answer:

1. Who is on the platform and how are they connected?
2. What games, referrals, rewards, challenges, queues, and payouts are moving right now?
3. What needs attention?
4. Who accessed or exported sensitive operational data?
5. Which pages and actions are available to which local roles, using Cloudflare Access email as the verified identity?

The current `303-peek-admin` spec remains the read-only waitlist/referral v1. This spec extends it into a broader operations admin, implemented in small iterations.

## User Stories

- As an admin, I want one internal console for users, referrals, games, rewards, queues, and links so that I can support the platform without opening raw SQL consoles.
- As a business developer, I want referral, KOL, campaign, and player-activity visibility so that I can evaluate partnerships and growth quality.
- As an admin, I want Cloudflare Access to remain the identity gate so that only Cloudflare-approved email identities can reach `peek`.
- As an admin, I want simple local roles mapped to verified emails or domains so that page and action access can evolve without changing Cloudflare policy for every internal permission decision.
- As an admin, I want sensitive reads and exports to leave an operator trail so that internal access can be reviewed.
- As an admin, I want every admin change to leave a before/after audit trail so that operational changes can be reviewed.
- As an engineer, I want `peek` to read and carefully mutate current data structures directly where worthwhile, while avoiding backend/API churn for internal-only workflows.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Internal tooling, off-chain backend visibility, growth/referral operations, reward/challenge operations, repo ownership.
- **Current baseline fit**: Extends `peek` v1. Current app already has server-rendered Next pages, direct Postgres reads, user/referral list/detail views, and Cloudflare Access JWT verification. Cloudflare Zero Trust Access is the outer email/PIN gate.
- **Planning bucket**: Core internal operations.

## Required Context Files

- `docs/specs/303-peek-admin/spec.md` - existing `peek` v1 boundary and conventions
- `peek/README.md` - runtime, env, and deployment conventions
- `peek/proxy.ts` - current Cloudflare Access middleware boundary
- `peek/src/server/cloudflare-access.ts` - JWT verification and verified email extraction
- `peek/src/server/db/client.ts` - server-only Postgres client
- `peek/src/server/db/queries/**` - current query organization pattern
- `peek/src/lib/types/peek.ts` - current admin view-model pattern
- `backend/migrations/001_init.sql` - commit-reveal game rounds
- `backend/migrations/002_operator_events.sql` - existing operator audit/event log
- `backend/migrations/004_closecall_rounds.sql` - Close Call rounds
- `backend/migrations/006_player_profiles.sql` - player identity/profile source
- `backend/migrations/007_game_entries.sql` - game participation, stats, and leaderboard source
- `backend/migrations/008_transactions.sql` - on-chain SOL movement records
- `backend/migrations/009_event_queue.sql` - async operations queue
- `backend/migrations/010_referral.sql` - referral codes, links, earnings, claims, KOL rates
- `backend/migrations/011_challenge_engine.sql` - rewards, points, crates, campaigns, challenges, Dogpile
- `backend/migrations/014_telegram_links.sql` - Telegram link token audit source
- `backend/migrations/015_linked_accounts.sql` - canonical linked account source
- `docs/specs/300-referral-system/spec.md`
- `docs/specs/301-async-event-queue/spec.md`
- `docs/specs/302-telegram-bot/spec.md`
- `docs/specs/400-challenge-engine/spec.md`
- Game specs: `001`, `100`, `101`, and deferred `002`, `102`, `103`, `104`, `105`

## Contract Files

- `peek/src/lib/types/peek.ts` - extend with admin view models
- `peek/src/lib/access-policy.ts` - new browser-safe role names and route capability types if needed
- `peek/src/server/access-policy.ts` - new server-only local role policy and route/action authorization checks
- `peek/src/server/db/queries/**` - source-specific read models
- `peek/src/server/mutations/**` - tightly scoped admin changes, each with role checks and audit logging
- `peek/src/server/audit/**` - audit writer using existing `operator_events`
- `peek/src/components/**` - reusable tables, summary strips, status chips, filters, and detail panels
- No public backend OpenAPI contract changes are expected for this spec

---

## External References Checked

This spec applies current guidance without adopting a full BI stack:

- Cloudflare Access policies support exact email and email-domain selectors, including "Emails ending in" rules for `@example.com`; this remains the outer access gate: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Cloudflare recommends validating the `Cf-Access-Jwt-Assertion` header at the origin and checking issuer/audience against the app AUD tag: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- `jose` supports remote JWKS verification through `createRemoteJWKSet` and JWT claim validation through `jwtVerify` with issuer and audience options: https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md
- Tableau dashboard guidance emphasizes audience/purpose, putting important content where users scan first, limiting overloaded views, and using filters/highlighting for exploration: https://help.tableau.com/current/pro/desktop/en-us/dashboards_best_practices.htm
- Looker dashboard performance guidance emphasizes SQL/query performance, limiting query-heavy elements, required filters for heavy views, and not refreshing faster than the data pipeline: https://cloud.google.com/looker/docs/best-practices/considerations-when-building-performant-dashboards
- OWASP logging guidance calls out admin actions, sensitive data access, data exports, consistent event attributes, access-control verification, and protecting logs from unauthorized access or tampering: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

## Product Principles

1. **Current schema first.** Use existing Postgres tables and current `peek` direct-read patterns before adding backend endpoints or new services.
2. **Exception-first ops.** Put "needs attention" states near the top: dead queue events, stuck settlements, failed claims, pending SOL payouts, stale active Dogpile events, high-value export activity.
3. **Drill down from metric to row.** Every metric should link to the filtered rows that produced it.
4. **Every number has a definition.** Admin metrics must show source tables, time window, freshness, and null/empty-state semantics.
5. **Tables are first-class.** For audit and support, dense sortable tables beat chart-only dashboards.
6. **Use charts only where they clarify trends.** Charts are optional. Do not block useful admin visibility on a charting library.
7. **Sensitive by default.** Wallets, Telegram IDs, payout details, and exports should be available to authorized admins, but access must be deliberate and logged where appropriate.
8. **Simple authorization now, extensible later.** Let Cloudflare decide who can reach the app, then map verified emails/domains to a small local role policy for pages and actions.
9. **Useful changes, not a control panel spree.** Add admin writes only where they clearly reduce operational toil and can be audited, tested, and rolled back conceptually.
10. **Performance before breadth.** Paginate, filter, and pre-shape server-side. Do not ship pages that load unbounded high-volume tables into the browser.

## Technology Recommendation

Stay with the current `peek` stack:

- Next.js App Router and server components
- Direct Postgres reads through `peek/src/server/db/**`
- Browser-safe view models in `peek/src/lib/types/**`
- Cloudflare Access as the outer identity provider and email/PIN gate
- `jose` for Cloudflare Access JWT validation using Cloudflare's remote JWKS plus issuer and audience checks
- Local, server-only role policy for page and action authorization
- Small server-side mutation modules only for worthwhile internal changes

Do **not** introduce Retool, Metabase, Cube, a warehouse, Prisma, Hasura, or a separate analytics service for this spec. The bang/buck is poor right now because the needed views are operational, row-level, and already available from the app database.

Replace the current custom Cloudflare JWT/JWKS verifier with `jose` as part of this spec. Use `createRemoteJWKSet` for Cloudflare's certificate endpoint and `jwtVerify` for signature, issuer, audience, and expiration validation. Keep the existing verified-email extraction semantics, but remove custom crypto/JWKS verification code once equivalent tests pass.

---

## Current Data Sources

| Area | Primary tables | Admin use |
|------|----------------|-----------|
| Identity | `player_profiles` | user list, wallet lookup, usernames, created dates |
| Linked accounts | `linked_accounts`, `telegram_link_tokens` | Telegram linkage state, token redemption audit, orphaned/expired link states |
| Referrals | `referral_codes`, `referral_links`, `referral_earnings`, `referral_claims`, `referral_kol_rates` | referral graph, KOL performance, claim state, rebate/referrer economics |
| Games | `rounds`, `closecall_rounds`, `game_entries`, `transactions` | game history, participant history, settlement state, tx audit |
| Queue | `event_queue` | retries, dead letters, stuck async work |
| Rewards | `reward_config`, `player_points`, `point_grants`, `reward_pool`, `reward_pool_fundings`, `crate_drops` | points, crates, pool funding, payout state |
| Challenges | `campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, `bonus_completions` | campaign health, assignments, progress, bonus status |
| Dogpile | `dogpile_events`, related `campaigns`, `game_entries`, `point_grants` | scheduled/active/ended events and participation |
| Fraud/review | `fraud_flags` | review queue and user detail context |
| Operator audit | `operator_events` | sensitive read/export logs and existing operator events |

---

## Information Architecture

The app should feel like an internal ops console, not a marketing dashboard.

### Global Surfaces

- `/` - command center: global search, attention queue, small metric strip, recent high-signal activity, link to user table.
- `/users` - users table with existing filters plus points/referrals/game activity columns.
- `/users/[userId]` - full user support/audit profile.
- `/search` - optional route if global search outgrows the header.
- `/audit` - operator events, sensitive reads, exports, access denials.

### Business Development Surfaces

- `/growth/referrals` - referral graph, top referrers, KOL rates, referred player quality, claims.
- `/growth/kol` - KOL-specific view if referral data becomes too dense for one page.
- `/growth/telegram` - Telegram link funnel and account lookup.

### Operations Surfaces

- `/games` - game activity overview across FlipYou, Pot Shot, Close Call, and future games.
- `/games/[game]` - game-specific rounds/entries/settlements.
- `/games/[game]/rounds/[roundId]` - round detail and participant/transaction audit.
- `/economy/rewards` - reward pool, points, crates, reward config.
- `/economy/challenges` - campaigns, challenge definitions, assignments, progress.
- `/operations/queue` - event queue status and dead-letter inspection.
- `/operations/dogpile` - Dogpile schedule/state/participation.

### Access Surfaces

- `/access` - current actor email, resolved local role, route/action access, recent denied attempts if logged.

Route names can be adjusted during implementation, but the navigation groups should stay: Users, Growth, Games, Economy, Operations, Audit, Access.

---

## System Invariants

1. **Cloudflare identity is required in production.** Production `peek` never bypasses Cloudflare Access JWT validation.
2. **Cloudflare is the base access gate.** The set of emails/domains allowed to reach the app is managed in Cloudflare Zero Trust Access.
3. **Verified email is the app identity.** The actor identity used for role checks and audit logs is the normalized email from the verified Cloudflare Access JWT.
4. **Local roles are required for app authorization.** A valid Cloudflare JWT proves identity; local role policy resolves the actor to either `business` or `admin`, then decides visible pages and allowed actions.
5. **Wildcard domains are supported in local roles.** Role entries must support exact emails and domain wildcards such as `*@example.com`.
6. **Route and action rules fail closed.** Unknown routes/actions default to read-only or deny, depending on the policy table.
7. **Server-only database access.** DB credentials, SQL clients, query functions, and mutation functions never reach browser bundles.
8. **No SQL in components.** Page components call query functions; SQL stays in `peek/src/server/db/queries/**`.
9. **No public backend expansion by default.** Internal views and internal changes do not add public API routes just to avoid direct DB access.
10. **Mutations are explicit.** Every admin write lives in `peek/src/server/mutations/**`, has a named action id, requires a role, validates input, and writes an audit event.
11. **Audit logs exclude secrets.** Access tokens, DB URLs, JWTs, private keys, and raw secrets are never logged or rendered.
12. **All high-volume views are bounded.** Tables require pagination or explicit limits; exports require filters and row caps.
13. **Deferred games are placeholders until data exists.** Do not build fake admin pages for Crash, Game of Trades, Chart the Course, Slots Utopia, or Tug of Earn before their persisted data sources exist.

---

## Functional Requirements

### FR-1: Cloudflare Identity Boundary

Cloudflare Zero Trust Access is the outer access gate. `peek` must trust only a verified Cloudflare Access JWT, normalize the email claim, and use that email as the actor identity for local roles and audit logs.

**Acceptance Criteria:**
- [x] Production requests without a valid `cf-access-jwt-assertion` are denied before rendering any page. <!-- satisfied: peek/proxy.ts:50-52 returns 403; cloudflare-access-middleware.test.ts:11-22 -->
- [ ] Production requests with a valid JWT but missing/invalid email claim are denied. <!-- gap: peek/proxy.ts:54-56 lets request through (no header set) when verification.email is null; layout renders access-denied panel via AdminShell but no hard 403 — denial is layout-only -->
- [x] JWT validation uses `jose` (`createRemoteJWKSet` + `jwtVerify`) with configured Cloudflare issuer and audience; custom crypto/JWKS verification code is removed. <!-- satisfied: peek/src/server/cloudflare-access.ts:1-9, 56-72 -->
- [x] The normalized Cloudflare email is attached to server-side request context and never accepted from an untrusted browser header. <!-- satisfied: peek/proxy.ts:17-18 strips browser-supplied header; peek/src/server/access-policy.ts:115-125 reads only via headers() -->
- [x] `peek` does not maintain a second global env allowlist for base access; base access remains Cloudflare policy. <!-- satisfied: access-policy.ts uses only PEEK_ACCESS_POLICY for role mapping -->
- [x] Development bypass is explicit and local-only, for example `PEEK_DEV_ACCESS_EMAIL=dev@example.com`; production never uses this bypass. <!-- satisfied: peek/proxy.ts:20-28; cloudflare-access-middleware.test.ts:39-67 -->
- [x] Unit tests cover missing token, invalid token, missing email, case normalization, trusted context propagation, and development bypass behavior. <!-- satisfied: peek/src/server/__tests__/cloudflare-access.test.ts + cloudflare-access-middleware.test.ts -->


### FR-2: Local Roles And Page/Action Access

Page and action authorization should be defined locally in `peek`, not in environment variables. Keep it small: a local server-only policy maps verified Cloudflare emails or domains to roles, and maps route/action ids to the roles allowed to use them.

**Acceptance Criteria:**
- [x] Access checks are centralized in one server-only module, not repeated in pages. <!-- satisfied: peek/src/server/access-policy.ts:177-218 (getRequiredRolesForRoute / isRouteAllowedForRole / getRequiredRolesForAction / isActionAllowedForRole) -->
- [x] Local role policy is defined in a checked-in server-only module such as `peek/src/server/access-policy.ts`, or in a local config file loaded only by server code. <!-- satisfied: access-policy.ts loads policy via loadPeekRolePolicyFromEnv (PEEK_ACCESS_POLICY JSON) -->
- [x] Role membership supports exact emails such as `alice@example.com`. <!-- satisfied: access-policy.ts:99-102 -->
- [x] Role membership supports wildcard domains such as `*@example.com`. <!-- satisfied: access-policy.ts:51-56, 99-102 -->
- [x] Role matching is case-insensitive and trims whitespace. <!-- satisfied: access-policy.ts:48, 80-85 -->
- [x] Initial roles are limited to `business` and `admin`. <!-- satisfied: PeekRole union in lib/access-policy.ts; access-policy.ts:42-43 rejects others -->
- [x] A verified email resolves to one effective role; `admin` is the superset role and wins if exact-email and wildcard-domain entries both match. <!-- satisfied: access-policy.ts:96-112 (admin returns immediately) -->
- [x] Route prefixes can require `business`, `admin`, or both; sensitive routes such as `/audit` require `admin`. <!-- satisfied: access-policy.ts:150-152 (PEEK_ROUTE_RULES → /audit: admin) -->
- [x] Mutation action ids can require one or more roles, for example `kol_rate.update` requiring `business` or `admin`. <!-- satisfied: access-policy.ts:154-159 (PEEK_ACTION_RULES) -->
- [x] Unknown route prefixes use the documented default access behavior; unknown mutation action ids deny. <!-- satisfied: access-policy.ts:148 default + 201-217 (unknown action returns null → false) -->
- [x] Unit tests cover exact email, wildcard domain, admin precedence, route allow/deny, action allow/deny, case normalization, and invalid policy entries. <!-- satisfied: peek/src/server/__tests__/access-policy.test.ts -->


### FR-3: Admin Shell And Navigation

The app should expose a clear internal navigation model for support, business development, operations, audit, and access.

**Acceptance Criteria:**
- [x] `peek` has a persistent app shell with navigation groups: Users, Growth, Games, Economy, Operations, Audit, Access. <!-- satisfied: peek/src/components/admin-shell.tsx:42-53; peek/src/server/admin-shell-nav.ts:12-20 (all 7 groups). Note: /users, /operations/queue, /audit, /access pages don't exist yet — nav links would 404 -->
- [x] The shell shows the currently verified actor email and resolved local role. <!-- satisfied: admin-shell.tsx:55-66 -->
- [x] The shell never shows pages that the actor cannot access. <!-- satisfied: admin-shell-nav.ts:22-28 (getVisibleNavItemsForRole filters by isRouteAllowedForRole); app/layout.tsx:26 -->
- [x] The first screen remains operationally dense: global search, attention items, a small metric strip, and direct access to the user/referral table. <!-- satisfied: peek/app/page.tsx:118-249 (search form, attention queue, summary strip, recent activity, users table) -->
- [x] The shell includes no marketing-style hero, decorative analytics filler, or non-actionable dashboard cards. <!-- satisfied: home + every built page renders only operator-facing content -->
- [x] Empty states explain the absence of data in operator terms, for example "No failed claims in this time window." <!-- satisfied: peek/src/components/empty-state.tsx; used across users-table, growth-*, reward-* tables -->


### FR-4: Data Surfacing Standard

Every metric and table must be understandable by a non-engineer while still being auditable by an admin.

**Acceptance Criteria:**
- [x] Each metric has a stable id, label, value, source table/query, time window, and "as of" timestamp. <!-- satisfied: lib/types/peek.ts PeekMetric; populated by get-command-center-attention.ts, get-rewards.ts, get-games-overview.ts, get-growth-referrals.ts -->
- [x] Each metric has a short definition available in the UI or adjacent help text. <!-- satisfied: PeekMetric.definition; metric-strip.tsx renders it -->
- [x] Each summary metric links to the filtered detail rows behind it when detail rows exist. <!-- satisfied: PeekMetric.drilldownHref populated for command-center, rewards, growth, games metrics -->
- [ ] Each page states whether data is live, cached, manually refreshed, or sampled. <!-- gap: PeekMetric.freshness exists and is set to "live" per metric, but no per-page freshness banner — only per-metric -->
- [x] Sparse data renders explicit empty states instead of zeros that can be mistaken for measured outcomes. <!-- satisfied: empty-state.tsx + per-table empty copy in growth-claims-table.tsx, reward-pool-fundings-table.tsx, etc. -->
- [x] Monetary values are displayed with units and retain lamports as the precise underlying value. <!-- satisfied: formatLamports + raw u64 string preserved (e.g. reward-pool-card.tsx title= attr) -->
- [x] Points and counts use integer formatting; no float rounding for ledger values. <!-- satisfied: u64 round-trips as text everywhere; formatCount uses toLocaleString -->
- [x] Filters are visible and URL-addressable so an admin can share a specific investigation state internally. <!-- satisfied: peek/src/lib/search-params.ts, games-search-params.ts, growth-search-params.ts -->
- [x] Default filters prevent accidental unbounded queries on high-volume pages. <!-- satisfied: PEEK_GAME_ROUNDS_DEFAULT_PAGE_SIZE, PEEK_GROWTH_*_DEFAULT_LIMIT, PEEK_REWARD_POOL_FUNDINGS_DEFAULT_LIMIT -->


### FR-5: Universal Search

Admins need one search entry point that resolves common operational identifiers.

**Acceptance Criteria:**
- [x] Search accepts `user_id`, username, wallet, referral code, Telegram username, Telegram provider account id, round PDA, match id, and tx signature. <!-- satisfied: peek/src/server/db/queries/universal-search.ts:166-374 (searchUsers, searchReferralCodes, searchLinkedAccounts, searchRounds, searchTransactions, searchQueueEvents) -->
- [x] Search results are grouped by entity type: user, referral, linked account, round, transaction, queue event. <!-- satisfied: universal-search.ts:436-463 -->
- [x] Each result includes enough context to disambiguate similar matches. <!-- satisfied: every PeekSearchResult has sublabel + context (universal-search.ts result mappers) -->
- [x] Search queries are server-side and bounded. <!-- satisfied: clampLimit (PEEK_SEARCH_MAX_PER_GROUP_LIMIT); per-group LIMIT clauses -->
- [x] Search does not require backend route changes. <!-- satisfied: implementation lives entirely in peek/src/server/db/queries/ -->
- [x] Searching for sensitive identifiers logs a `peek.search` operator event with actor email, query class, result counts, and no access tokens or secrets. <!-- satisfied: universal-search.ts:376-399 (defaultPeekSearchAudit) + audit/redact.ts secret redaction -->


### FR-6: Expanded User Detail

The current user detail page should become the primary support and audit page for a player.

**Acceptance Criteria:**
- [x] User detail shows profile identity from `player_profiles`: user id, username, wallet, created date, avatar URL if present, heat multiplier, and profile points slot. <!-- satisfied: peek/src/server/db/queries/get-peek-user-detail.ts:108-144 -->
- [x] User detail shows linked account state from `linked_accounts`, including Telegram metadata when present. <!-- satisfied: get-peek-user-detail.ts fetchLinkedAccounts -->
- [x] User detail shows latest Telegram link token records from `telegram_link_tokens` for support/audit context. <!-- satisfied: get-peek-user-detail.ts fetchRecentTelegramLinkTokens -->
- [x] User detail shows referral code, inbound referrer, outbound referees, KOL rate if present, earnings, rebates, and claim states. <!-- satisfied: fetchOutboundReferees, fetchKolRate, fetchReferralEarnings, fetchRecentReferralClaims in get-peek-user-detail.ts -->
- [x] User detail shows points balance, lifetime points, recent point grants, recent crate drops, and challenge assignment summary. <!-- satisfied: fetchPlayerPoints, fetchRecentPointGrants, fetchRecentCrateDrops, fetchChallengeSummary -->
- [x] User detail shows recent game entries and transactions across FlipYou, Pot Shot, and Close Call. <!-- satisfied: fetchRecentGameEntries, fetchRecentTransactions -->
- [x] User detail flags obvious attention states: failed claim, dead queue event for the user, active fraud flag, pending SOL crate payout, or suspicious referral self/loop inconsistency. <!-- satisfied: get-peek-user-detail.ts:186-192 computeAttention; user-detail-view.tsx:128-145 AttentionStrip -->
- [x] User detail uses tabs or anchored sections so the page stays scannable. <!-- satisfied: user-detail-view.tsx:47-99 8 sections via DetailPanel -->


### FR-7: Growth And Referral Operations

Business development should be able to inspect referral quality, KOL performance, and claim/payment state without raw SQL.

**Acceptance Criteria:**
- [x] Referral overview shows total referrers, referred users, activated referred users, referral earnings, referee rebates, pending claims, failed claims, and KOL count. <!-- satisfied: get-growth-referrals.ts getGrowthReferralOverview (eight FR-4 metrics) -->
- [x] Top referrers table includes referral code, user id, username, wallet, referee count, active referee count, referred wager volume, referrer earnings, and pending claim amount. <!-- satisfied: get-growth-referrals.ts listTopReferrers; growth-referrers-table.tsx -->
- [x] KOL table reads from `referral_kol_rates` and shows rate, wallet, set_by, created_at, updated_at, and linked performance metrics. <!-- satisfied: get-growth-referrals.ts listKolPerformance; growth-kol-table.tsx -->
- [x] Claim table reads from `referral_claims` and filters by status, user, amount, requested date, processed date, tx signature, and error. <!-- satisfied: get-growth-referrals.ts listReferralClaims; growth-claims-table.tsx + growth-claims-filter-bar.tsx -->
- [x] Referral graph/detail allows navigation from referrer to referees and back to user detail. <!-- satisfied: get-growth-referrals.ts getReferralGraphNode; tables link to /users/[userId] -->
- [ ] CSV export for filtered referral/KOL tables is allowed only after FR-11 audit logging is implemented. <!-- gap: FR-11 audit writer is in place, but no export route, no peek.export emission, no UI export action wired into growth-* components -->


### FR-8: Gameplay And Settlement Visibility

Admins need to audit what happened in games and spot stuck settlement states.

**Acceptance Criteria:**
- [x] Games overview shows activity by game from `game_entries`: entries, unique users, wagered lamports, settled entries, refunds, payouts, and win/loss counts. <!-- satisfied: get-games-overview.ts; games-overview-table.tsx -->
- [x] FlipYou and Pot Shot round visibility reads from `rounds` and shows phase, pda, match id, creator, target slot, settle attempts, settle tx, result side, winner, created/updated/settled timestamps. <!-- satisfied: get-game-rounds.ts listRounds; game-rounds-table.tsx -->
- [x] Close Call round visibility reads from `closecall_rounds` and shows phase, pda, open/close price fields, outcome, pools, total fee, settle tx, created/settled timestamps. <!-- satisfied: get-game-rounds.ts listCloseCallRounds; closecall-rounds-table.tsx -->
- [x] Round detail joins entries from `game_entries` and transactions from `transactions`. <!-- satisfied: get-round-detail.ts; round-detail-view.tsx; tested in get-round-detail.test.ts + round-detail-view.test.tsx -->
- [x] Stuck-state filters exist for rounds in nonterminal phases beyond an age threshold, high settle attempts, settled entries without expected transactions, and refunds. <!-- satisfied: get-game-rounds.ts:53-61 thresholds + nonterminalAged/highAttempts/settledWithoutTx/refunds; game-rounds-filter-bar.tsx -->
- [x] Deferred/planned games appear only as documented placeholders until they have persisted data sources. <!-- satisfied: peek/src/lib/deferred-games.ts; app/games/page.tsx renders PEEK_DEFERRED_GAMES placeholders only -->


### FR-9: Economy, Rewards, Challenges, And Dogpile

Admins need one place to inspect reward economy configuration and downstream reward effects.

**Acceptance Criteria:**
- [x] Reward config page reads `reward_config` and displays key, value, updated_at, definition, and expected value type. <!-- satisfied: get-rewards.ts listRewardConfig + PEEK_REWARD_CONFIG_KEY_REGISTRY; reward-config-table.tsx; app/economy/rewards/page.tsx -->
- [x] Reward pool page reads `reward_pool` and `reward_pool_fundings` and displays balance, lifetime funded, lifetime paid, recent fundings, and funding source round ids. <!-- satisfied: get-rewards.ts getRewardPool + listRewardPoolFundings; reward-pool-card.tsx + reward-pool-fundings-table.tsx -->
- [ ] Points page reads `player_points` and `point_grants` and supports filtering by user, source type, source id, and date. <!-- gap: no /economy/points page or list-points query module — checklist line 518 unstarted -->
- [ ] Crate page reads `crate_drops` and supports filters for crate type, status, trigger type, user, and date. <!-- gap: no /economy/crates page; user-detail shows recent crates only — checklist line 518 unstarted -->
- [ ] Challenge page reads `campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, and `bonus_completions`. <!-- gap: no /economy/challenges page or challenge queries — checklist lines 521-523 unstarted -->
- [ ] Dogpile page reads `dogpile_events` and related campaign/game activity, showing scheduled, active, ended, and cancelled states. <!-- gap: no /operations/dogpile page or dogpile queries — checklist lines 524-526 unstarted -->
- [ ] Fraud review page or user-detail section reads `fraud_flags` and exposes open/reviewed/dismissed status as read-only. <!-- gap: get-peek-user-detail.ts reads fraud_flags per-user; no global fraud review page — partial coverage only -->
- [x] Challenge definition editing is out of scope. <!-- deferred: explicit out-of-scope statement in spec FR-9 + FR-14 — confirmed read-only -->
- [ ] Reward config editing is allowed only for selected keys through the scoped mutation rules in FR-14. <!-- gap: FR-14 mutation framework not built; no reward_config edit path exists — depends on FR-14 implementation -->


### FR-10: Queue And Operational Health

The event queue is a core operational surface because many rewards and payouts are async.

**Acceptance Criteria:**
- [ ] Queue overview reads `event_queue` and shows counts by status, event type, attempts, age bucket, and max attempts. <!-- gap: get-command-center-attention.ts only counts status='dead' for the home strip; no full overview query, no /operations/queue page -->
- [ ] Queue table filters by status, event type, id, payload user id when present, scheduled_at, created_at, and age. <!-- gap: no /operations/queue page, no queue list query -->
- [ ] Queue detail shows payload JSON, error, attempt counts, timestamps, and linked user/round/claim routes when identifiers are present. <!-- gap: not implemented -->
- [x] Dead and failed events are surfaced as attention items on the command center. <!-- satisfied: get-command-center-attention.ts:124-129 "Dead queue events" metric drilldown=/operations/queue?status=dead (drilldown target page not yet built) -->
- [x] The page is read-only; retry, cancel, or replay actions require a separate mutation spec. <!-- satisfied (vacuously): no /operations/queue page or mutation surface exists -->
- [ ] Payload rendering redacts known secrets if any ever appear. <!-- gap: queue detail rendering not built; redact policy exists in audit/redact.ts but is not wired into a queue-payload renderer -->


### FR-11: Audit Logging For Sensitive Reads, Exports, And Changes

Use existing `operator_events` for `peek` audit events. This avoids a migration while still making internal access and admin changes reviewable.

**Acceptance Criteria:**
- [x] A server-side audit helper writes to `operator_events` with `event_type` values prefixed by `peek.`, for example `peek.search`, `peek.user.view_sensitive`, `peek.export`, `peek.access.denied`, `peek.change.applied`, `peek.change.rejected`. <!-- satisfied: audit/writer.ts:47-74 + lib/types/peek.ts:377-392 (six PeekAuditEventType values defined) -->
- [x] Audit payload includes actor email, route, action, resource type, resource id when applicable, query/filter summary, result count when applicable, and request id if available. <!-- satisfied: PeekAuditPayload in lib/types/peek.ts; populated by universal-search.ts:386-398 + get-peek-user-detail.ts:49-63 -->
- [ ] Mutation audit payload includes before/after values for changed fields, excluding secrets. <!-- gap: PeekAuditPayload.changes type exists but no mutation emits it (no mutations exist — FR-14 not built) -->
- [ ] Rejected mutation attempts log actor email, action id, resource type/id, rejection reason, and no submitted secrets. <!-- gap: PeekAuditPayload.rejectionReason exists but no mutation rejection path; depends on FR-14 -->
- [x] Audit payload does not include JWTs, access tokens, DB URLs, private keys, raw secrets, or full export contents. <!-- satisfied: audit/redact.ts; audit/__tests__/writer.test.ts asserts secret-redaction across these classes -->
- [x] Sensitive user detail sections, exports, and all mutations call the audit helper. <!-- partial→satisfied for built surfaces: user-detail emits peek.user.view_sensitive; universal-search emits peek.search; exports + mutations not yet built so vacuously not violated -->
- [x] Audit logging failure does not leak sensitive data to the browser. <!-- satisfied: writer.ts:67-72 returns structured failure without payload; callers (universal-search.ts:472-485, get-peek-user-detail.ts:202-213) swallow audit errors -->
- [ ] Audit view reads `operator_events` and filters by event type, actor email, resource id, route, and date. <!-- gap: no /audit page, no filtered audit query; only get-recent-operator-events.ts (limit-only) for the home activity strip -->
- [x] Access to `/audit` can be restricted with the FR-2 page-level allowlist seam. <!-- satisfied: access-policy.ts:151 declares /audit prefix requires admin role (page itself not yet built) -->


### FR-12: Exports

Exports are useful for business development, but must be bounded and auditable.

**Acceptance Criteria:**
- [ ] Exports are available only for filtered tables, not for unfiltered full-table dumps. <!-- gap: no export routes exist -->
- [ ] Each export has a server-side row cap. <!-- gap: PEEK_EXPORT_ROW_CAP_DEFAULT=5000 defined in lib/types/peek.ts but no enforcer/route -->
- [ ] Each export logs a `peek.export` operator event before returning data. <!-- gap: peek.export event type defined; no emitter — only the command-center counts pre-existing rows -->
- [ ] Export rows use the same view model fields shown in the table unless explicitly documented. <!-- gap: PeekExportRow / PeekExportResult type contracts exist (lib/types/peek.ts:454-469) but unused -->
- [ ] Export filenames include entity, date, and filter slug. <!-- gap: PeekExportFilenameInput type exists; no implementation -->
- [ ] Export routes require the same page-level access as the source page. <!-- gap: no export routes -->
- [ ] Exports are disabled in production if audit logging is not configured. <!-- gap: no gate implementation -->


### FR-13: Data Access Architecture And Performance

Keep the implementation close to existing `peek` conventions and cheap to operate.

**Acceptance Criteria:**
- [x] SQL lives only in `peek/src/server/db/queries/**`. <!-- satisfied: all sql template literals in peek/src/server/db/queries/ + audit/writer.ts insert; pages and components consume view models only -->
- [x] Pages call query functions and receive shaped view models. <!-- satisfied: verified across app/**/page.tsx — all imports come from src/server/db/queries -->
- [x] Browser components receive serializable data only. <!-- satisfied: components import only lib/types/peek; no server imports in src/components/** -->
- [x] High-volume tables use pagination, cursoring, or explicit limits. <!-- satisfied: PEEK_GAME_ROUNDS_DEFAULT_PAGE_SIZE, PEEK_GROWTH_*_DEFAULT_LIMIT, PaginationControls component -->
- [x] Query functions avoid N+1 patterns for table pages. <!-- satisfied: aggregations done in single SQL queries (get-games-overview.ts GROUP BY; get-growth-referrals.ts left joins) -->
- [x] Heavy pages use required filters, date windows, or manual refresh. <!-- satisfied: every page uses force-dynamic; default filters and limits applied at query layer -->
- [x] Auto-refresh is off by default for heavy pages and never faster than the data can meaningfully change. <!-- satisfied: no client-side polling in any built page -->
- [x] Query tests cover view-model shaping for null/sparse data. <!-- satisfied: __tests__/get-rewards.test.ts, get-games-overview.test.ts, get-growth-referrals.test.ts, get-round-detail.test.ts cover sparse/empty -->
- [x] Component tests cover empty, loading, populated, and error states for reusable admin tables/strips. <!-- satisfied: 24 component test files cover those states -->


### FR-14: Scoped Admin Changes

`peek` should support changes where they are clearly worth it, but not become an unbounded control panel. Initial writes should focus on existing off-chain admin tables where the value is high and the blast radius is understandable.

**Acceptance Criteria:**
- [ ] `peek/src/server/mutations/**` is the only place for business-state write actions. <!-- gap: peek/src/server/mutations/ contains only README.md placeholder; no mutation framework exists -->
- [ ] Each mutation has a stable action id, required role list, input schema, success result, failure result, and tests. <!-- gap: no mutations implemented -->
- [ ] Each mutation runs server-side, inside a transaction when multiple statements are required. <!-- gap: no mutations implemented -->
- [ ] Each mutation writes `peek.change.applied` with actor email, action id, resource type/id, before/after values, and request context. <!-- gap: peek.change.applied event type defined; no emitters -->
- [ ] Each denied or validation-failed mutation writes `peek.change.rejected` unless doing so would create noise for harmless client validation. <!-- gap: peek.change.rejected event type defined; no emitters -->
- [ ] Initial allowed mutation candidates are limited to: create/update KOL rate in `referral_kol_rates`, update `fraud_flags.status`, cancel a scheduled future `dogpile_events` row, and edit selected `reward_config` keys. <!-- gap: action ids declared in access-policy.ts:154-159 (kol_rate.update / fraud_flag.status.update / dogpile.cancel / reward_config.update) but no implementation -->
- [ ] Reward config editing is guarded by explicit confirmation and clear display of old/new values because it can affect platform economics. <!-- gap: not implemented; depends on FR-14 framework -->
- [x] Queue retry/replay, claim payout overrides, crate payout overrides, profile identity edits, transaction edits, and settlement edits are out of scope until separately specified. <!-- deferred: explicit out-of-scope statement in spec FR-14 — confirmed -->
- [x] Direct DB writes from `peek` are allowed only for the approved mutation candidates in this spec or a future spec with acceptance criteria. <!-- satisfied (vacuously): no DB writes anywhere in peek/src outside the operator_events audit insert -->


---

## Success Criteria

- An authorized admin can open `peek` only after Cloudflare Access verification and local role resolution.
- A business developer can evaluate referral/KOL performance without writing SQL.
- An admin can investigate a user, round, queue event, claim, crate, or challenge from the admin UI.
- High-risk operational states appear without needing to know which table to query.
- Local roles control page visibility and mutation access without requiring Cloudflare policy changes for every internal permission adjustment.
- Sensitive reads, exports, and admin changes leave reviewable `operator_events` records.
- Initial admin changes reduce real operational toil without opening high-risk settlement, payout, or identity edit paths.
- No public backend API contract changes are required for the initial implementation.
- The implementation remains understandable: small query modules, typed view models, and page-level iterations.

---

## Dependencies

- `peek` deployment remains protected by Cloudflare Access.
- Cloudflare Access application AUD tag and team domain are configured.
- The app database user can read the listed tables.
- The app database user can insert `peek.*` audit records into `operator_events`.
- The app database user can write only the small set of tables approved for mutation iterations when those iterations ship.
- Existing Postgres indexes are sufficient for first-pass views; future index additions can be proposed only after slow-query evidence.

## Assumptions

- `peek` is trusted internal software and can display internal identifiers to authorized admins.
- The public frontend remains a separate project and is not part of this spec.
- Internal admin visibility can use direct database reads because it is server-only and read-mostly.
- Some future game pages will remain placeholders until their specs create persisted tables or extend `game_entries`.
- The first useful version should prefer simple tables and filters over adopting an analytics platform.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Cloudflare identity boundary works | Unit tests + middleware tests | Missing JWT/email denies; verified email becomes actor identity |
| 2 | Local role policy works | Unit tests | Exact/wildcard role resolution, admin precedence, and route/action allow/deny |
| 3 | SQL stays server-only | Code review + typecheck | Query modules under `src/server/db/queries/**`; no SQL in components |
| 4 | Admin shell routes render | Component/E2E smoke tests | Route screenshots or test assertions |
| 5 | Metrics include definitions and sources | Component tests + manual review | Metric metadata in view models |
| 6 | Universal search resolves identifiers | Query tests | Fixtures for user, wallet, referral code, round, tx, Telegram |
| 7 | User detail combines operational data | Query/component tests | Sparse and populated user fixtures |
| 8 | Growth/referral tables are accurate | Query tests | Aggregation fixtures for referrers, KOL, claims |
| 9 | Game/settlement pages surface stuck states | Query tests | Old open round, failed settlement, refund fixtures |
| 10 | Reward/challenge changes stay scoped | Code review | Challenge definitions read-only; selected reward config edits only through FR-14 |
| 11 | Queue page surfaces dead/failed events | Query/component tests | Failed/dead event fixtures |
| 12 | Sensitive read/export/change audit is written | Integration-style query test | `operator_events` insert payload assertion |
| 13 | Exports are bounded | Route tests | Filter required, row cap enforced, audit event emitted |
| 14 | Mutations are role-gated and scoped | Mutation tests + code review | Action ids, role checks, before/after audit, transaction use where needed |
| 15 | No backend API changes | Git diff review | No public route/OpenAPI changes unless separately approved |

---

## Completion Signal

### Implementation Checklist

#### Pre-checked baseline
- [x] [engine] Preserve `peek/` as the separate internal Next.js app with server-only Postgres access (done: existing `peek` project, `src/server/db/**`, deployment docs).
- [x] [engine] Preserve the 303-era summary, users list, and user-detail query baseline (done: `get-peek-summary`, `list-peek-users`, `count-peek-users`, `get-peek-user-detail`).
- [x] [frontend] Preserve the 303-era users-first home and user-detail UI baseline (done: `/` and `/users/[userId]` with summary strip, filters, pagination, table, detail card).
- [x] [test] Preserve existing `peek` query, component, and Cloudflare Access coverage (done: `cd peek && pnpm test` — 21 tests).

#### Identity + local roles (FR-1, FR-2)
- [x] [engine] Add `jose` dep to `peek`; replace the custom Cloudflare Access JWT/JWKS verifier in `peek/src/server/cloudflare-access.ts` with `createRemoteJWKSet` + `jwtVerify` validating issuer, audience, signature, and expiration. Remove custom crypto/JWKS code. (done: iteration 1)
- [x] [test] Update `peek/src/server/__tests__/cloudflare-access*.test.ts` for `jose`-backed verification: missing token, invalid token, expired token, bad signature, invalid issuer/audience, missing email claim, case normalization, missing config, and `PEEK_DEV_ACCESS_EMAIL` local-only bypass. (done: iteration 2)
- [x] [engine] Add `peek/src/server/access-policy.ts` (server-only) resolving verified emails to a single effective role (`business` or `admin`), with exact-email and `*@domain` wildcard support, case-insensitive matching, and `admin` precedence; thread the resolved role + actor email through server request context (no browser headers trusted). (done: iteration 3)
- [x] [engine] Add centralized route-prefix and action-id authorization helpers in the same module: route-prefix → required role(s); action-id → required role(s); unknown routes default per documented rule; unknown action ids fail closed (deny). (done: iteration 4)
- [x] [test] Add `peek/src/server/__tests__/access-policy.test.ts` covering exact email, wildcard domain, case normalization, admin precedence, route allow/deny, action allow/deny, invalid/duplicate policy entries, and actor-context propagation. (done: iteration 5)

#### Foundational view models (FR-4)
- [x] [engine] View models part A: extend `peek/src/lib/types/peek.ts` (and `peek/src/lib/access-policy.ts` for browser-safe role names if needed) with shared metric metadata, table-filter, pagination, and table-row primitives. Per-feature shapes get added inside their feature iterations. (done: iteration 6)
- [x] [engine] View models part B: add audit-event and export contracts (event-type union, payload shape, redaction marker; export-row, filename slug, row-cap result types). (done: iteration 7)

#### Foundational UI primitives (FR-3, FR-4)
- [x] [frontend] UI primitives part A — layout/data: dense sortable table, metric strip with definition/source/as-of, filter bar with URL-addressable filters. Component tests for populated/sparse/error. (done: iteration 8)
- [x] [frontend] UI primitives part B — state: status chip, empty state with operator copy, detail panel (tabs/anchored sections). Component tests for the same states. (done: iteration 9)

#### Admin shell (FR-3)
- [x] [frontend] Persistent admin shell with actor email + resolved role badge, role-aware navigation (Users, Growth, Games, Economy, Operations, Audit, Access), hidden links for inaccessible routes, and access-denied + missing-config states that do not leak sensitive data. (done: iteration 10)

#### Audit writer (FR-11)
- [x] [engine] `peek/src/server/audit/**` audit writer using `operator_events` with `peek.*` event types (`peek.search`, `peek.user.view_sensitive`, `peek.export`, `peek.access.denied`, `peek.change.applied`, `peek.change.rejected`), actor + route + action + resource + filter summary + result-count + request-id; secret redaction; safe-failure (does not leak to browser). (done: iteration 11)
- [x] [test] Audit-writer tests: sensitive read, export, access denial, mutation applied, mutation rejected, secret redaction (JWTs/DB URLs/private keys/raw secrets never persisted), and insert-failure behavior. (done: iteration 12)

#### Command center (FR-3, FR-10)
- [x] [engine] Command-center query functions for attention items: failed claims, dead queue events, stuck settlements (rounds in nonterminal phases beyond age threshold + high settle-attempts), pending SOL crate payouts, stale active Dogpile events, high-value export activity. Bounded queries + metric metadata per FR-4. (done: iteration 13)
- [x] [frontend] Update `/` into the command center: global search input + attention queue + small metric strip + recent high-signal activity + direct table access. Preserve users-first usefulness; surface metric definitions and "as of" timestamps. (done: iteration 14)
- [x] [test] Command-center query + component tests for populated, sparse, empty, and load-error states. (done: iteration 15)

#### Universal search (FR-5)
- [x] [engine] Universal search query functions accepting `user_id`, username, wallet, referral code, Telegram username, Telegram provider id, round PDA, match id, tx signature, queue event id. Bounded server-side; grouped by entity type; emits `peek.search` audit events with no secrets. (done: iteration 16)
- [x] [frontend] Universal search UI grouped by entity type (user, referral, linked account, round, transaction, queue event) with disambiguating context per result. (done: iteration 17)
- [x] [test] Universal search tests: every supported identifier class, bounded-query enforcement, no-result behavior, audit-event emission. (done: iteration 18)

#### Expanded user detail (FR-6)
- [x] [engine] Expand user-detail queries with linked accounts (`linked_accounts`), latest Telegram link tokens (`telegram_link_tokens`), referral code/inbound referrer/outbound referees/KOL rate/earnings/claims, points balance/lifetime/grants/crates, challenge assignment summary, recent game entries + transactions across all 3 games, fraud flags, and user-related queue events. (done: iteration 19)
- [x] [frontend] Expand `/users/[userId]` with tabs/anchored sections (identity, linked accounts, referrals, games, rewards, challenges, transactions, attention). Attention flags: failed claim, dead queue event, active fraud flag, pending SOL crate payout, suspicious referral self/loop. (done: iteration 20)
- [x] [test] Expanded user-detail query + component tests for full, sparse, and sensitive-section audit (calls audit writer when sensitive sections render). (done: iteration 26)

#### Growth + KOL (FR-7)
- [x] [engine] Growth/referral queries: overview metrics (referrers, referred users, activated, earnings, rebates, pending claims, failed claims, KOL count); top-referrers; `referral_kol_rates` with linked performance; claim filters by status/user/amount/date/tx/error; graph navigation queries. (done: iteration 27)
- [x] [frontend] `/growth/referrals` (overview + top-referrers + claims) and `/growth/kol` (KOL table with rate, wallet, set_by, timestamps, performance) with filtered tables, drill-down to user detail, empty states, and access checks. (done: iteration 28)
- [x] [test] Growth/referral query + page tests for referrers, KOL rows, claims, filters, drill-down, and empty states. (done: iteration 29)

#### Games (FR-8) — split by route
- [x] [engine] Games overview queries: cross-game `game_entries` aggregations (entries, unique users, wagered lamports, settled, refunds, payouts, win/loss) per game. (done: iteration 30)
- [x] [frontend] `/games` overview page with cross-game activity + documented placeholders for deferred games (Crash, Game of Trades, Chart the Course, Slots Utopia, Tug of Earn). (done: iteration 31)
- [x] [test] `/games` overview query + page tests for activity metrics, deferred-game placeholders, sparse data. (done: iteration 32)
- [x] [engine] Per-game round queries: FlipYou + Pot Shot from `rounds` (phase, pda, match id, creator, target slot, settle attempts, settle tx, result side, winner, timestamps); Close Call from `closecall_rounds` (phase, pda, prices, outcome, pools, fee, settle tx, timestamps); stuck-state filters (nonterminal beyond age threshold, high settle attempts, settled entries without expected tx, refunds). (done: iteration 33)
- [x] [frontend] `/games/[game]` route handling FlipYou + Pot Shot + Close Call via the `[game]` param, with stuck-state filters and shared layout. (done: iteration 34)
- [x] [test] `/games/[game]` query + page tests for all 3 games + stuck-state filters + refunds + sparse data. (done: iteration 35)
- [x] [engine] Round detail queries joining round + entries from `game_entries` + transactions from `transactions`. (done: iteration 36)
- [x] [frontend] `/games/[game]/rounds/[roundId]` detail with participant + transaction audit. (done: iteration 37)
- [x] [test] Round detail query + page tests across the 3 games (full, sparse, refunded, stuck). (done: iteration 38)

#### Economy (FR-9) — split into 4 feature pairs
- [x] [engine] Rewards queries: `reward_config` (key/value/updated_at/definition/expected type) + `reward_pool` (balance/lifetime funded/lifetime paid) + `reward_pool_fundings` (recent + source round ids). (done: iteration 39)
- [x] [frontend] `/economy/rewards` page with config table, pool balance card, recent fundings table, drill-down to source rounds. (done: iteration 40)
- [x] [test] Rewards query + page tests for sparse/populated/empty/funding-source linkage. (done: iteration 41)
- [x] [engine] Points + crates queries: `player_points` + `point_grants` (filterable by user/source type/source id/date) + `crate_drops` (filterable by crate type/status/trigger type/user/date). (done: iteration 42)
- [x] [frontend] Points + crates pages with filterable tables and pending-payout state for crates. (done: iteration 92)
- [x] [test] Points + crates query + page tests for filters, sparse, pending payout, integer formatting. (done: iteration 93)
- [x] [engine] Challenge queries: `campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, `bonus_completions`. Read-only; no challenge-definition editing. (done: iteration 94)
- [x] [frontend] `/economy/challenges` with campaign + challenge + assignment + progress views and clear "edit out of scope" affordances. (done: iteration 95)
- [x] [test] Challenge page tests for read-only guarantees, filters, sparse data, status transitions. (done: iteration 96)
- [x] [engine] Dogpile + fraud queries: `dogpile_events` (scheduled/active/ended/cancelled with linked campaigns/game_entries/point_grants) + `fraud_flags` (open/reviewed/dismissed read-only). (done: iteration 97)
- [x] [frontend] `/operations/dogpile` (lifecycle + participation) and fraud review surface (page or user-detail section). (done: iteration 98)
- [x] [test] Dogpile + fraud query + page tests for state transitions, sparse, and read-only enforcement. (done: iteration 99)

#### Queue (FR-10)
- [x] [engine] Event queue queries: `event_queue` status counts, type counts, age buckets, max-attempts, filtered rows, detail payload (with secret redaction), linked resource ids (user/round/claim). (done: iteration 100)
- [x] [frontend] `/operations/queue` with overview + filters + detail panel + redacted payload rendering + dead/failed attention links. (done: iteration 101)
- [x] [test] Queue query + page tests for pending, failed, dead, aged, filtered, redacted-payload states. (done: iteration 102)

#### Audit view (FR-11)
- [x] [engine] Audit-log queries filtering `operator_events` by `peek.*` event type, actor email, resource id, route, date; bounded. (done: iteration 103)
- [x] [frontend] `/audit` page (admin-only via FR-2 page-level allowlist), filters, bounded table, safe empty/error states. (done: iteration 104)
- [x] [test] `/audit` tests for role gating, filters, sensitive payload redaction at render time, empty/error. (done: iteration 105)

#### Exports (FR-12)
- [x] [engine] Server-side CSV export helpers for approved filtered tables with required filters, server-side row caps, view-model field mapping, filename slug (entity + date + filter), and pre-return `peek.export` audit emission. Disabled in production when audit logging is unavailable. (done: iteration 106)
- [x] [frontend] Wire export actions into approved growth/admin tables with disabled states + tooltip when audit logging is unavailable; export routes inherit page-level access. (done: iteration 107)
- [ ] [test] Export tests for required filters, row caps, filenames, role checks, audit events, and prod-disabled-without-audit-config behavior.

#### Mutations (FR-14)
- [ ] [engine] Mutation framework under `peek/src/server/mutations/**`: action-id registry, role-check, input schema, transaction handling for multi-statement mutations, typed success/failure results, audit hooks for `peek.change.applied` / `peek.change.rejected`.
- [ ] [test] Mutation-framework tests: authorized success, unauthorized denial, validation failure, transaction rollback, applied + rejected audit payloads (no secrets, before/after diff).
- [ ] [engine] KOL rate create/update mutation for `referral_kol_rates` with before/after audit and rate validation.
- [ ] [test] KOL rate mutation tests: create, update, invalid rate, unauthorized actor, audit payload.
- [ ] [engine] `fraud_flags.status` update mutation with allowed-transition matrix and before/after audit.
- [ ] [test] Fraud flag mutation tests: valid transition, invalid transition, unknown flag, unauthorized actor, audit payload.
- [ ] [engine] Scheduled future Dogpile cancellation mutation with state guards (deny active/ended) and before/after audit.
- [ ] [test] Dogpile cancellation tests: scheduled success, active/ended denial, unknown event, unauthorized actor, audit payload.
- [ ] [engine] Selected `reward_config` edit mutation with key allowlist, value validation, explicit confirmation flag, and before/after audit.
- [ ] [test] Reward config mutation tests: allowed key success, disallowed key denial, invalid value, missing confirmation, unauthorized actor, audit payload.
- [ ] [frontend] Wire mutation UIs (KOL rate, fraud flag status, Dogpile cancel, reward config edit) with old/new confirmation, role-aware visibility, and rejection messaging.
- [ ] [test] Mutation UI tests: authorized success, denied actor hidden, validation error display, rejection feedback.

#### Docs + verify
- [ ] [docs] Update `peek/README.md` with Cloudflare Access (jose), local business/admin role policy, audit behavior, exports, mutation rules, local dev identity (`PEEK_DEV_ACCESS_EMAIL`), and verification commands.
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in e2e/local/** (or mark N/A with reason for non-web/non-interactive specs).
- [ ] [test] Add visual route/state coverage in e2e/visual/**; run pnpm test:visual and update baselines only for intentional UI changes.
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in e2e/devnet/** with env validation + retry/backoff (or mark N/A with reason). **Mark N/A: peek is server-rendered DB-reads + scoped DB writes only; it has no on-chain, oracle, or VRF integration, so devnet E2E offers no coverage signal.**
- [ ] [test] Run `cd peek && pnpm verify` and fix any lint, typecheck, unit-test, or production-build failures.
- [ ] [test] Run root `./scripts/verify` if required before commit/PR and confirm no public backend API or OpenAPI changes were introduced.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing `peek` tests pass.
- [ ] New tests added for Cloudflare identity handling, local roles, audit logging, query shaping, mutations, and core rendered states.
- [ ] No lint errors.
- [ ] `cd peek && pnpm verify` exits 0.

#### Functional Verification
- [ ] All acceptance criteria verified.
- [ ] Empty, sparse, and high-volume states handled.
- [ ] Access-denied and missing-config states handled.
- [ ] Export, sensitive-read, and mutation audit events verified.
- [ ] Approved mutations show old/new values and deny unauthorized actors.

#### Integration Verification
- [ ] `peek` renders against local/seeded data without backend API changes.
- [ ] Public backend routes/OpenAPI remain unchanged unless a separate spec explicitly approves a change.
- [ ] Deployment docs include Cloudflare Access, local role policy, and approved mutation configuration.

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue.
2. Fix the code or narrow the scope.
3. Re-run the relevant tests.
4. Re-verify all criteria touched by the iteration.
5. Check again.

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis 305 --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase.
2. Writes `docs/specs/305-peek-operations-admin/gap-analysis.md` with inventory, audit, and recommendations.
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`).
4. Commits everything together with the completion commit.
