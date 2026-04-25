# Specification: [305] Peek Operations Admin

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 23 |

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
- [ ] Production requests without a valid `cf-access-jwt-assertion` are denied before rendering any page.
- [ ] Production requests with a valid JWT but missing/invalid email claim are denied.
- [ ] JWT validation uses `jose` (`createRemoteJWKSet` + `jwtVerify`) with configured Cloudflare issuer and audience; custom crypto/JWKS verification code is removed.
- [ ] The normalized Cloudflare email is attached to server-side request context and never accepted from an untrusted browser header.
- [ ] `peek` does not maintain a second global env allowlist for base access; base access remains Cloudflare policy.
- [ ] Development bypass is explicit and local-only, for example `PEEK_DEV_ACCESS_EMAIL=dev@example.com`; production never uses this bypass.
- [ ] Unit tests cover missing token, invalid token, missing email, case normalization, trusted context propagation, and development bypass behavior.

### FR-2: Local Roles And Page/Action Access

Page and action authorization should be defined locally in `peek`, not in environment variables. Keep it small: a local server-only policy maps verified Cloudflare emails or domains to roles, and maps route/action ids to the roles allowed to use them.

**Acceptance Criteria:**
- [ ] Access checks are centralized in one server-only module, not repeated in pages.
- [ ] Local role policy is defined in a checked-in server-only module such as `peek/src/server/access-policy.ts`, or in a local config file loaded only by server code.
- [ ] Role membership supports exact emails such as `alice@example.com`.
- [ ] Role membership supports wildcard domains such as `*@example.com`.
- [ ] Role matching is case-insensitive and trims whitespace.
- [ ] Initial roles are limited to `business` and `admin`.
- [ ] A verified email resolves to one effective role; `admin` is the superset role and wins if exact-email and wildcard-domain entries both match.
- [ ] Route prefixes can require `business`, `admin`, or both; sensitive routes such as `/audit` require `admin`.
- [ ] Mutation action ids can require one or more roles, for example `kol_rate.update` requiring `business` or `admin`.
- [ ] Unknown route prefixes use the documented default access behavior; unknown mutation action ids deny.
- [ ] Unit tests cover exact email, wildcard domain, admin precedence, route allow/deny, action allow/deny, case normalization, and invalid policy entries.

### FR-3: Admin Shell And Navigation

The app should expose a clear internal navigation model for support, business development, operations, audit, and access.

**Acceptance Criteria:**
- [ ] `peek` has a persistent app shell with navigation groups: Users, Growth, Games, Economy, Operations, Audit, Access.
- [ ] The shell shows the currently verified actor email and resolved local role.
- [ ] The shell never shows pages that the actor cannot access.
- [ ] The first screen remains operationally dense: global search, attention items, a small metric strip, and direct access to the user/referral table.
- [ ] The shell includes no marketing-style hero, decorative analytics filler, or non-actionable dashboard cards.
- [ ] Empty states explain the absence of data in operator terms, for example "No failed claims in this time window."

### FR-4: Data Surfacing Standard

Every metric and table must be understandable by a non-engineer while still being auditable by an admin.

**Acceptance Criteria:**
- [ ] Each metric has a stable id, label, value, source table/query, time window, and "as of" timestamp.
- [ ] Each metric has a short definition available in the UI or adjacent help text.
- [ ] Each summary metric links to the filtered detail rows behind it when detail rows exist.
- [ ] Each page states whether data is live, cached, manually refreshed, or sampled.
- [ ] Sparse data renders explicit empty states instead of zeros that can be mistaken for measured outcomes.
- [ ] Monetary values are displayed with units and retain lamports as the precise underlying value.
- [ ] Points and counts use integer formatting; no float rounding for ledger values.
- [ ] Filters are visible and URL-addressable so an admin can share a specific investigation state internally.
- [ ] Default filters prevent accidental unbounded queries on high-volume pages.

### FR-5: Universal Search

Admins need one search entry point that resolves common operational identifiers.

**Acceptance Criteria:**
- [ ] Search accepts `user_id`, username, wallet, referral code, Telegram username, Telegram provider account id, round PDA, match id, and tx signature.
- [ ] Search results are grouped by entity type: user, referral, linked account, round, transaction, queue event.
- [ ] Each result includes enough context to disambiguate similar matches.
- [ ] Search queries are server-side and bounded.
- [ ] Search does not require backend route changes.
- [ ] Searching for sensitive identifiers logs a `peek.search` operator event with actor email, query class, result counts, and no access tokens or secrets.

### FR-6: Expanded User Detail

The current user detail page should become the primary support and audit page for a player.

**Acceptance Criteria:**
- [ ] User detail shows profile identity from `player_profiles`: user id, username, wallet, created date, avatar URL if present, heat multiplier, and profile points slot.
- [ ] User detail shows linked account state from `linked_accounts`, including Telegram metadata when present.
- [ ] User detail shows latest Telegram link token records from `telegram_link_tokens` for support/audit context.
- [ ] User detail shows referral code, inbound referrer, outbound referees, KOL rate if present, earnings, rebates, and claim states.
- [ ] User detail shows points balance, lifetime points, recent point grants, recent crate drops, and challenge assignment summary.
- [ ] User detail shows recent game entries and transactions across FlipYou, Pot Shot, and Close Call.
- [ ] User detail flags obvious attention states: failed claim, dead queue event for the user, active fraud flag, pending SOL crate payout, or suspicious referral self/loop inconsistency.
- [ ] User detail uses tabs or anchored sections so the page stays scannable.

### FR-7: Growth And Referral Operations

Business development should be able to inspect referral quality, KOL performance, and claim/payment state without raw SQL.

**Acceptance Criteria:**
- [ ] Referral overview shows total referrers, referred users, activated referred users, referral earnings, referee rebates, pending claims, failed claims, and KOL count.
- [ ] Top referrers table includes referral code, user id, username, wallet, referee count, active referee count, referred wager volume, referrer earnings, and pending claim amount.
- [ ] KOL table reads from `referral_kol_rates` and shows rate, wallet, set_by, created_at, updated_at, and linked performance metrics.
- [ ] Claim table reads from `referral_claims` and filters by status, user, amount, requested date, processed date, tx signature, and error.
- [ ] Referral graph/detail allows navigation from referrer to referees and back to user detail.
- [ ] CSV export for filtered referral/KOL tables is allowed only after FR-11 audit logging is implemented.

### FR-8: Gameplay And Settlement Visibility

Admins need to audit what happened in games and spot stuck settlement states.

**Acceptance Criteria:**
- [ ] Games overview shows activity by game from `game_entries`: entries, unique users, wagered lamports, settled entries, refunds, payouts, and win/loss counts.
- [ ] FlipYou and Pot Shot round visibility reads from `rounds` and shows phase, pda, match id, creator, target slot, settle attempts, settle tx, result side, winner, created/updated/settled timestamps.
- [ ] Close Call round visibility reads from `closecall_rounds` and shows phase, pda, open/close price fields, outcome, pools, total fee, settle tx, created/settled timestamps.
- [ ] Round detail joins entries from `game_entries` and transactions from `transactions`.
- [ ] Stuck-state filters exist for rounds in nonterminal phases beyond an age threshold, high settle attempts, settled entries without expected transactions, and refunds.
- [ ] Deferred/planned games appear only as documented placeholders until they have persisted data sources.

### FR-9: Economy, Rewards, Challenges, And Dogpile

Admins need one place to inspect reward economy configuration and downstream reward effects.

**Acceptance Criteria:**
- [ ] Reward config page reads `reward_config` and displays key, value, updated_at, definition, and expected value type.
- [ ] Reward pool page reads `reward_pool` and `reward_pool_fundings` and displays balance, lifetime funded, lifetime paid, recent fundings, and funding source round ids.
- [ ] Points page reads `player_points` and `point_grants` and supports filtering by user, source type, source id, and date.
- [ ] Crate page reads `crate_drops` and supports filters for crate type, status, trigger type, user, and date.
- [ ] Challenge page reads `campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, and `bonus_completions`.
- [ ] Dogpile page reads `dogpile_events` and related campaign/game activity, showing scheduled, active, ended, and cancelled states.
- [ ] Fraud review page or user-detail section reads `fraud_flags` and exposes open/reviewed/dismissed status as read-only.
- [ ] Challenge definition editing is out of scope.
- [ ] Reward config editing is allowed only for selected keys through the scoped mutation rules in FR-14.

### FR-10: Queue And Operational Health

The event queue is a core operational surface because many rewards and payouts are async.

**Acceptance Criteria:**
- [ ] Queue overview reads `event_queue` and shows counts by status, event type, attempts, age bucket, and max attempts.
- [ ] Queue table filters by status, event type, id, payload user id when present, scheduled_at, created_at, and age.
- [ ] Queue detail shows payload JSON, error, attempt counts, timestamps, and linked user/round/claim routes when identifiers are present.
- [ ] Dead and failed events are surfaced as attention items on the command center.
- [ ] The page is read-only; retry, cancel, or replay actions require a separate mutation spec.
- [ ] Payload rendering redacts known secrets if any ever appear.

### FR-11: Audit Logging For Sensitive Reads, Exports, And Changes

Use existing `operator_events` for `peek` audit events. This avoids a migration while still making internal access and admin changes reviewable.

**Acceptance Criteria:**
- [ ] A server-side audit helper writes to `operator_events` with `event_type` values prefixed by `peek.`, for example `peek.search`, `peek.user.view_sensitive`, `peek.export`, `peek.access.denied`, `peek.change.applied`, `peek.change.rejected`.
- [ ] Audit payload includes actor email, route, action, resource type, resource id when applicable, query/filter summary, result count when applicable, and request id if available.
- [ ] Mutation audit payload includes before/after values for changed fields, excluding secrets.
- [ ] Rejected mutation attempts log actor email, action id, resource type/id, rejection reason, and no submitted secrets.
- [ ] Audit payload does not include JWTs, access tokens, DB URLs, private keys, raw secrets, or full export contents.
- [ ] Sensitive user detail sections, exports, and all mutations call the audit helper.
- [ ] Audit logging failure does not leak sensitive data to the browser.
- [ ] Audit view reads `operator_events` and filters by event type, actor email, resource id, route, and date.
- [ ] Access to `/audit` can be restricted with the FR-2 page-level allowlist seam.

### FR-12: Exports

Exports are useful for business development, but must be bounded and auditable.

**Acceptance Criteria:**
- [ ] Exports are available only for filtered tables, not for unfiltered full-table dumps.
- [ ] Each export has a server-side row cap.
- [ ] Each export logs a `peek.export` operator event before returning data.
- [ ] Export rows use the same view model fields shown in the table unless explicitly documented.
- [ ] Export filenames include entity, date, and filter slug.
- [ ] Export routes require the same page-level access as the source page.
- [ ] Exports are disabled in production if audit logging is not configured.

### FR-13: Data Access Architecture And Performance

Keep the implementation close to existing `peek` conventions and cheap to operate.

**Acceptance Criteria:**
- [ ] SQL lives only in `peek/src/server/db/queries/**`.
- [ ] Pages call query functions and receive shaped view models.
- [ ] Browser components receive serializable data only.
- [ ] High-volume tables use pagination, cursoring, or explicit limits.
- [ ] Query functions avoid N+1 patterns for table pages.
- [ ] Heavy pages use required filters, date windows, or manual refresh.
- [ ] Auto-refresh is off by default for heavy pages and never faster than the data can meaningfully change.
- [ ] Query tests cover view-model shaping for null/sparse data.
- [ ] Component tests cover empty, loading, populated, and error states for reusable admin tables/strips.

### FR-14: Scoped Admin Changes

`peek` should support changes where they are clearly worth it, but not become an unbounded control panel. Initial writes should focus on existing off-chain admin tables where the value is high and the blast radius is understandable.

**Acceptance Criteria:**
- [ ] `peek/src/server/mutations/**` is the only place for business-state write actions.
- [ ] Each mutation has a stable action id, required role list, input schema, success result, failure result, and tests.
- [ ] Each mutation runs server-side, inside a transaction when multiple statements are required.
- [ ] Each mutation writes `peek.change.applied` with actor email, action id, resource type/id, before/after values, and request context.
- [ ] Each denied or validation-failed mutation writes `peek.change.rejected` unless doing so would create noise for harmless client validation.
- [ ] Initial allowed mutation candidates are limited to: create/update KOL rate in `referral_kol_rates`, update `fraud_flags.status`, cancel a scheduled future `dogpile_events` row, and edit selected `reward_config` keys.
- [ ] Reward config editing is guarded by explicit confirmation and clear display of old/new values because it can affect platform economics.
- [ ] Queue retry/replay, claim payout overrides, crate payout overrides, profile identity edits, transaction edits, and settlement edits are out of scope until separately specified.
- [ ] Direct DB writes from `peek` are allowed only for the approved mutation candidates in this spec or a future spec with acceptance criteria.

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
- [ ] [test] Expanded user-detail query + component tests for full, sparse, and sensitive-section audit (calls audit writer when sensitive sections render).

#### Growth + KOL (FR-7)
- [ ] [engine] Growth/referral queries: overview metrics (referrers, referred users, activated, earnings, rebates, pending claims, failed claims, KOL count); top-referrers; `referral_kol_rates` with linked performance; claim filters by status/user/amount/date/tx/error; graph navigation queries.
- [ ] [frontend] `/growth/referrals` (overview + top-referrers + claims) and `/growth/kol` (KOL table with rate, wallet, set_by, timestamps, performance) with filtered tables, drill-down to user detail, empty states, and access checks.
- [ ] [test] Growth/referral query + page tests for referrers, KOL rows, claims, filters, drill-down, and empty states.

#### Games (FR-8) — split by route
- [ ] [engine] Games overview queries: cross-game `game_entries` aggregations (entries, unique users, wagered lamports, settled, refunds, payouts, win/loss) per game.
- [ ] [frontend] `/games` overview page with cross-game activity + documented placeholders for deferred games (Crash, Game of Trades, Chart the Course, Slots Utopia, Tug of Earn).
- [ ] [test] `/games` overview query + page tests for activity metrics, deferred-game placeholders, sparse data.
- [ ] [engine] Per-game round queries: FlipYou + Pot Shot from `rounds` (phase, pda, match id, creator, target slot, settle attempts, settle tx, result side, winner, timestamps); Close Call from `closecall_rounds` (phase, pda, prices, outcome, pools, fee, settle tx, timestamps); stuck-state filters (nonterminal beyond age threshold, high settle attempts, settled entries without expected tx, refunds).
- [ ] [frontend] `/games/[game]` route handling FlipYou + Pot Shot + Close Call via the `[game]` param, with stuck-state filters and shared layout.
- [ ] [test] `/games/[game]` query + page tests for all 3 games + stuck-state filters + refunds + sparse data.
- [ ] [engine] Round detail queries joining round + entries from `game_entries` + transactions from `transactions`.
- [ ] [frontend] `/games/[game]/rounds/[roundId]` detail with participant + transaction audit.
- [ ] [test] Round detail query + page tests across the 3 games (full, sparse, refunded, stuck).

#### Economy (FR-9) — split into 4 feature pairs
- [ ] [engine] Rewards queries: `reward_config` (key/value/updated_at/definition/expected type) + `reward_pool` (balance/lifetime funded/lifetime paid) + `reward_pool_fundings` (recent + source round ids).
- [ ] [frontend] `/economy/rewards` page with config table, pool balance card, recent fundings table, drill-down to source rounds.
- [ ] [test] Rewards query + page tests for sparse/populated/empty/funding-source linkage.
- [ ] [engine] Points + crates queries: `player_points` + `point_grants` (filterable by user/source type/source id/date) + `crate_drops` (filterable by crate type/status/trigger type/user/date).
- [ ] [frontend] Points + crates pages with filterable tables and pending-payout state for crates.
- [ ] [test] Points + crates query + page tests for filters, sparse, pending payout, integer formatting.
- [ ] [engine] Challenge queries: `campaigns`, `challenges`, `challenge_assignments`, `progress_events`, `completion_bonuses`, `bonus_completions`. Read-only; no challenge-definition editing.
- [ ] [frontend] `/economy/challenges` with campaign + challenge + assignment + progress views and clear "edit out of scope" affordances.
- [ ] [test] Challenge page tests for read-only guarantees, filters, sparse data, status transitions.
- [ ] [engine] Dogpile + fraud queries: `dogpile_events` (scheduled/active/ended/cancelled with linked campaigns/game_entries/point_grants) + `fraud_flags` (open/reviewed/dismissed read-only).
- [ ] [frontend] `/operations/dogpile` (lifecycle + participation) and fraud review surface (page or user-detail section).
- [ ] [test] Dogpile + fraud query + page tests for state transitions, sparse, and read-only enforcement.

#### Queue (FR-10)
- [ ] [engine] Event queue queries: `event_queue` status counts, type counts, age buckets, max-attempts, filtered rows, detail payload (with secret redaction), linked resource ids (user/round/claim).
- [ ] [frontend] `/operations/queue` with overview + filters + detail panel + redacted payload rendering + dead/failed attention links.
- [ ] [test] Queue query + page tests for pending, failed, dead, aged, filtered, redacted-payload states.

#### Audit view (FR-11)
- [ ] [engine] Audit-log queries filtering `operator_events` by `peek.*` event type, actor email, resource id, route, date; bounded.
- [ ] [frontend] `/audit` page (admin-only via FR-2 page-level allowlist), filters, bounded table, safe empty/error states.
- [ ] [test] `/audit` tests for role gating, filters, sensitive payload redaction at render time, empty/error.

#### Exports (FR-12)
- [ ] [engine] Server-side CSV export helpers for approved filtered tables with required filters, server-side row caps, view-model field mapping, filename slug (entity + date + filter), and pre-return `peek.export` audit emission. Disabled in production when audit logging is unavailable.
- [ ] [frontend] Wire export actions into approved growth/admin tables with disabled states + tooltip when audit logging is unavailable; export routes inherit page-level access.
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
