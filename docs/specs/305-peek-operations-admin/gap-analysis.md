# Gap Analysis: 305 — Peek Operations Admin

- **Date**: 2026-04-26
- **Spec status**: Done (iteration 160)
- **Previous analysis**: 2026-04-25 (against iteration 41)

## Changes Since Last Analysis

The spec moved from iteration 41 → 160. Eleven gap items closed; two new gaps surfaced
(both pre-existing in the code but not previously named).

| Item | Previous | Current | Notes |
|------|----------|---------|-------|
| FR-7 #6 — CSV export wiring for referral/KOL tables | GAP | SATISFIED | `app/exports/[entity]/route.ts`; `ExportActionLink` wired into growth pages |
| FR-9 #3 — Points page | GAP | SATISFIED | `app/economy/points/page.tsx` + `get-points-and-crates.ts` |
| FR-9 #4 — Crates page | GAP | SATISFIED | `app/economy/crates/page.tsx` + `listCrateDrops` |
| FR-9 #5 — Challenges page | GAP | SATISFIED | `app/economy/challenges/page.tsx` (six sections) + `get-challenges.ts` |
| FR-9 #6 — Dogpile page | GAP | SATISFIED | `app/operations/dogpile/page.tsx` + `listDogpileEvents` |
| FR-9 #7 — Fraud review surface | PARTIAL | SATISFIED | global table on `/operations/dogpile`; per-user view kept |
| FR-9 #9 — Reward config editing via FR-14 | GAP | SATISFIED | `reward_config.update` mutation + admin-only confirm |
| FR-10 #1, #2, #3, #6 — Queue overview/table/detail/redaction | GAP | SATISFIED | `/operations/queue` + `getEventQueueOverview/listEventQueue/getEventQueueDetail` |
| FR-11 #3 — Mutation before/after audit | GAP | SATISFIED | `runner.ts:90-110` + per-mutation diff helpers |
| FR-11 #4 — Rejected mutation audit | GAP | SATISFIED | `runner.ts:113-134` emits `peek.change.rejected` on every reject path |
| FR-11 #6 — All sensitive surfaces call audit helper | PARTIAL | SATISFIED | with one residual gap (`peek.access.denied` never emitted) |
| FR-11 #8 — Audit view filters | GAP | SATISFIED | `app/audit/page.tsx` + `get-audit-events.ts` |
| FR-12 #1–#7 — Exports framework | GAP × 7 | SATISFIED × 7 | `src/server/exports/**` + `/exports/[entity]` route |
| FR-14 #1–#7 — Mutation framework + four candidates | GAP × 7 | SATISFIED × 7 | runner + four mutations + four UI forms |
| FR-3 #1 nav nuance | flagged in Recommendations | still residual | `/users` (list) + `/access` nav links → 404 |
| `peek.access.denied` audit event | not previously named | NEW GAP (low) | event type defined + counted on `/audit` but never emitted from a denial path |
| FR-1 #2 hard 403 for missing email | GAP | GAP | unchanged: `proxy.ts:54-56` still passes through and relies on layout |
| FR-4 #4 page-level freshness banner | GAP | GAP | unchanged: per-metric only |

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
| `/economy/points` | `peek/app/economy/points/page.tsx` | Built |
| `/economy/crates` | `peek/app/economy/crates/page.tsx` | Built |
| `/economy/challenges` | `peek/app/economy/challenges/page.tsx` | Built |
| `/operations/queue` | `peek/app/operations/queue/page.tsx` | Built |
| `/operations/dogpile` | `peek/app/operations/dogpile/page.tsx` | Built |
| `/audit` | `peek/app/audit/page.tsx` | Built (admin-only) |
| `/exports/[entity]` (CSV route handler) | `peek/app/exports/[entity]/route.ts` | Built |
| `/users` (list page) | — | Missing — nav link 404s; home `/` carries the users table |
| `/access` (current actor email + role + recent denied) | — | Missing — nav link 404s |
| `/growth/telegram` | — | IA only — deferred |
| `/search` | — | Optional — search lives on `/` |

### Server modules

| Module | File | Purpose |
|--------|------|---------|
| Cloudflare Access verifier (`jose`) | `peek/src/server/cloudflare-access.ts` | FR-1 JWT verification |
| Proxy / middleware | `peek/proxy.ts` | FR-1 outer gate, dev bypass, header strip |
| Local role policy | `peek/src/server/access-policy.ts` | FR-2 roles, route + action rules |
| Admin shell nav | `peek/src/server/admin-shell-nav.ts` | FR-3 visible nav items |
| Audit writer | `peek/src/server/audit/writer.ts` | FR-11 writes `peek.*` to `operator_events` |
| Audit redact | `peek/src/server/audit/redact.ts` | FR-11 secret redaction policy |
| Mutation registry | `peek/src/server/mutations/registry.ts` | FR-14 four-action registry |
| Mutation runner | `peek/src/server/mutations/runner.ts` | FR-14 transactional execute + audit |
| KOL rate mutation | `peek/src/server/mutations/kol-rate.ts` | FR-14 |
| Fraud flag mutation | `peek/src/server/mutations/fraud-flag.ts` | FR-14 |
| Dogpile cancel mutation | `peek/src/server/mutations/dogpile.ts` | FR-14 |
| Reward config mutation | `peek/src/server/mutations/reward-config.ts` | FR-14 |
| Mutation server actions | `peek/src/server/actions/peek-mutations.ts` | FR-14 form bridge |
| Export registry | `peek/src/server/exports/registry.ts` | FR-12 three exporters |
| Export runner | `peek/src/server/exports/runner.ts` | FR-12 fetch → audit → return |
| Export filename builder | `peek/src/server/exports/filename.ts` | FR-12 `{entity}_{date}_{slug}.csv` |
| Export source-route map | `peek/src/server/exports/source-routes.ts` | FR-12 per-entity page-level access |
| CSV serializer | `peek/src/server/exports/csv.ts` | FR-12 |
| Per-entity exporters | `peek/src/server/exports/exporters/{claims,kol,referrers}.ts` | FR-12 |

### Query functions (`peek/src/server/db/queries`)

| Query | Backs |
|-------|-------|
| `count-peek-users.ts` | `/` users table count |
| `list-peek-users.ts` | `/` users table |
| `get-peek-summary.ts` | `/` summary strip |
| `get-peek-user-detail.ts` | `/users/[userId]` (FR-6, emits `peek.user.view_sensitive`) |
| `get-command-center-attention.ts` | `/` attention queue (FR-3, FR-10 metric counts) |
| `get-recent-operator-events.ts` | `/` activity list |
| `universal-search.ts` | `/` global search (FR-5, emits `peek.search`) |
| `get-growth-referrals.ts` | `/growth/referrals`, `/growth/kol` (FR-7) |
| `get-games-overview.ts` | `/games` (FR-8) |
| `get-game-rounds.ts` | `/games/[game]` (FR-8) |
| `get-round-detail.ts` | `/games/[game]/rounds/[roundId]` (FR-8) |
| `get-rewards.ts` | `/economy/rewards` (FR-9) |
| `get-points-and-crates.ts` | `/economy/points`, `/economy/crates` (FR-9) |
| `get-challenges.ts` | `/economy/challenges` (FR-9) |
| `get-dogpile-and-fraud.ts` | `/operations/dogpile` (FR-9) |
| `get-event-queue.ts` | `/operations/queue` (FR-10) |
| `get-audit-events.ts` | `/audit` (FR-11) |

### Components (`peek/src/components`)

Primitives: `AdminShell`, `MetricStrip`, `FilterBar`, `PeekTable`, `StatusChip`,
`EmptyState`, `DetailPanel`, `SummaryStrip`, `PaginationControls`,
`ExportActionLink`, `RecentActivityList`, `UniversalSearchResults`.

Domain tables / panels (built): `UsersTable`, `UserDetailView`,
`GamesOverviewTable`, `GameRoundsTable`, `GameRoundsFilterBar`,
`CloseCallRoundsTable`, `RoundDetailView`, `GrowthReferrersTable`,
`GrowthKolTable`, `GrowthClaimsTable`, `GrowthClaimsFilterBar`,
`RewardPoolCard`, `RewardConfigTable`, `RewardPoolFundingsTable`,
`PlayerPointsTable`, `PointGrantsTable`, `PlayerPointsFilterBar`,
`PointGrantsFilterBar`, `CrateDropsTable`, `EconomyCratesFilterBar`,
`CampaignsTable`, `ChallengesTable`, `ChallengeAssignmentsTable`,
`ProgressEventsTable`, `CompletionBonusesTable`, `BonusCompletionsTable`,
`ChallengesFilterBar`, `ChallengeAssignmentsFilterBar`,
`ProgressEventsFilterBar`, `BonusCompletionsFilterBar`,
`DogpileEventsTable`, `FraudFlagsTable`, `DogpileEventsFilterBar`,
`FraudFlagsFilterBar`, `EventQueueTable`, `EventQueueFilterBar`,
`EventQueueDetailPanel`, `AuditEventsTable`, `AuditEventsFilterBar`.

Mutation forms (FR-14, in `src/components/mutations/`): `KolRateMutationForm`,
`FraudFlagMutationForm`, `DogpileCancelMutationForm`,
`RewardConfigMutationForm`, `MutationFeedback`.

### Tests (88 files, 1008 tests passing — verified locally on this run)

| Layer | Tests |
|-------|-------|
| Cloudflare verifier + middleware | `__tests__/cloudflare-access*.test.ts` |
| Access policy | `__tests__/access-policy.test.ts` |
| Admin shell nav | `__tests__/admin-shell-nav.test.ts` |
| Audit writer + redact | `audit/__tests__/writer.test.ts` |
| Per-query | `db/queries/__tests__/*.test.ts` (17 files) |
| Per-component | `components/__tests__/*.test.tsx` (44 files) |
| Mutation runner + four mutations | `server/mutations/__tests__/*.test.ts` (5 files) |
| Mutation forms | `components/mutations/__tests__/*.test.tsx` (4 files) |
| Export runner + csv + filename + route + source-routes | `server/exports/__tests__/*.test.ts` (5 files) |
| Lib helpers | `lib/__tests__/*.test.ts` (7 files) |

## Acceptance Criteria Audit

### FR-1: Cloudflare Identity Boundary

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No-JWT request denied before render | SATISFIED | `peek/proxy.ts:50-52` returns 403 |
| 2 | Valid JWT but missing/invalid email denied | **GAP** | `proxy.ts:54-56` does not return 403 when `verification.email === null`; falls through and the layout renders an access-denied panel — not a hard denial |
| 3 | `jose` JWKS + `jwtVerify`; custom code removed | SATISFIED | `cloudflare-access.ts:1-9, 56-72` |
| 4 | Normalized email is server-side context only | SATISFIED | `proxy.ts:17-18` strips browser header; `access-policy.ts:115-125` reads only via `headers()` |
| 5 | No second global env allowlist for base access | SATISFIED | `access-policy.ts` reads only `PEEK_ACCESS_POLICY` |
| 6 | Dev bypass explicit, local-only | SATISFIED | `proxy.ts:20-28` |
| 7 | Tests cover all FR-1 behaviors | SATISFIED | `cloudflare-access.test.ts`, `cloudflare-access-middleware.test.ts` |

### FR-2: Local Roles And Page/Action Access

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Centralized in one server-only module | SATISFIED | `access-policy.ts:177-218` |
| 2 | Policy in checked-in server-only module/config | SATISFIED | `access-policy.ts` + `PEEK_ACCESS_POLICY` JSON |
| 3 | Exact emails | SATISFIED | `access-policy.ts:99-102` |
| 4 | Wildcard domains `*@example.com` | SATISFIED | `access-policy.ts:51-56, 99-102` |
| 5 | Case-insensitive + whitespace-trim | SATISFIED | `access-policy.ts:48, 80-85` |
| 6 | Roles limited to `business`/`admin` | SATISFIED | `lib/access-policy.ts` PeekRole union; `access-policy.ts:42-43` rejects others |
| 7 | One effective role; admin precedence | SATISFIED | `access-policy.ts:96-112` |
| 8 | Route prefixes; `/audit` admin-only | SATISFIED | `access-policy.ts:150-152` |
| 9 | Mutation action ids with role lists | SATISFIED | `access-policy.ts:154-159` |
| 10 | Unknown routes default; unknown actions deny | SATISFIED | `access-policy.ts:148, 201-217` |
| 11 | Tests cover all role/policy paths | SATISFIED | `__tests__/access-policy.test.ts` (44 tests) |

### FR-3: Admin Shell And Navigation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Shell with all 7 nav groups | SATISFIED (with residual) | `admin-shell-nav.ts:12-20` declares all 7 groups; `/users` and `/access` targets still 404 — see Recommendations |
| 2 | Shows actor email + resolved role | SATISFIED | `admin-shell.tsx:55-66` |
| 3 | Hides routes the actor cannot access | SATISFIED | `admin-shell-nav.ts:22-28` filters by `isRouteAllowedForRole` |
| 4 | First screen dense with operator content | SATISFIED | `app/page.tsx` |
| 5 | No marketing hero / decorative filler | SATISFIED | every built page renders only operator content |
| 6 | Empty states explain absence in operator terms | SATISFIED | `empty-state.tsx` + per-table copy |

### FR-4: Data Surfacing Standard

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Each metric has stable id/label/value/source/window/asOf | SATISFIED | `PeekMetric` populated everywhere |
| 2 | Each metric has a short definition in UI | SATISFIED | `metric-strip.tsx` renders `definition` |
| 3 | Each summary metric drills to filtered detail rows | SATISFIED | `drilldownHref` populated across pages |
| 4 | Each page states data freshness (live/cached/manual/sampled) | **GAP** | per-metric `freshness="live"` is rendered, but no per-page banner — pages do not state at top whether they are live, cached, manually refreshed, or sampled |
| 5 | Sparse data → empty states, not zeros | SATISFIED | every list page uses `EmptyState` or per-table empty copy |
| 6 | Monetary values display units, retain lamports | SATISFIED | `formatLamports` + raw u64 in `title=` |
| 7 | Integer formatting; no float rounding for ledger values | SATISFIED | u64 round-trips as text; `toLocaleString` for counts |
| 8 | Filters URL-addressable | SATISFIED | `lib/{search-params,games-search-params,growth-search-params,economy-search-params,economy-challenges-search-params,operations-queue-search-params,operations-dogpile-search-params,audit-search-params}.ts` |
| 9 | Default filters prevent unbounded queries | SATISFIED | per-page DEFAULT_LIMIT constants |

### FR-5: Universal Search

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All required identifier classes accepted | SATISFIED | `universal-search.ts:166-374` |
| 2 | Results grouped by entity type | SATISFIED | `universal-search.ts:436-463` |
| 3 | Disambiguating context per result | SATISFIED | each result carries `sublabel` + `context` |
| 4 | Server-side and bounded | SATISFIED | `clampLimit` + per-group LIMIT |
| 5 | No backend route changes | SATISFIED | implementation lives in `peek/src/server/db/queries/` |
| 6 | Logs `peek.search` with no secrets | SATISFIED | `universal-search.ts:384-399` |

### FR-6: Expanded User Detail

All 8 criteria SATISFIED — see in-spec annotations. Sources: `get-peek-user-detail.ts`
+ `user-detail-view.tsx` (8 sections).

### FR-7: Growth And Referral Operations

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Referral overview (8 metrics) | SATISFIED | `getGrowthReferralOverview` |
| 2 | Top referrers table | SATISFIED | `listTopReferrers` + `growth-referrers-table.tsx` |
| 3 | KOL table from `referral_kol_rates` | SATISFIED | `listKolPerformance` + `growth-kol-table.tsx` |
| 4 | Claim table with filters | SATISFIED | `listReferralClaims` + `growth-claims-table.tsx` |
| 5 | Graph navigation | SATISFIED | `getReferralGraphNode` + table → `/users/[userId]` links |
| 6 | CSV export for filtered tables | SATISFIED | `app/exports/[entity]/route.ts` + `ExportActionLink` wired in `app/growth/referrals/page.tsx:128,153` and `app/growth/kol/page.tsx:75` |

### FR-8: Gameplay And Settlement Visibility

All 6 criteria SATISFIED — see in-spec annotations. Sources: `get-games-overview.ts`,
`get-game-rounds.ts`, `get-round-detail.ts`, `lib/deferred-games.ts`.

### FR-9: Economy, Rewards, Challenges, And Dogpile

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Reward config (key/value/updated_at/definition/expected type) | SATISFIED | `get-rewards.ts` + `PEEK_REWARD_CONFIG_KEY_REGISTRY` |
| 2 | Reward pool + recent fundings + funding round ids | SATISFIED | `getRewardPool` + `listRewardPoolFundings` |
| 3 | Points page with filters | SATISFIED | `app/economy/points/page.tsx` + `listPlayerPoints` / `listPointGrants` |
| 4 | Crate page with filters | SATISFIED | `app/economy/crates/page.tsx` + `listCrateDrops` |
| 5 | Challenge page (six tables) | SATISFIED | `app/economy/challenges/page.tsx` + `get-challenges.ts` |
| 6 | Dogpile page | SATISFIED | `app/operations/dogpile/page.tsx` + `listDogpileEvents` |
| 7 | Fraud review page or section | SATISFIED | global table on `/operations/dogpile`; per-user view in user-detail |
| 8 | Challenge definition editing out of scope | DEFERRED | spec FR-9, FR-14 — confirmed read-only; no edit path exists |
| 9 | Reward config editing only via FR-14 mutation rules | SATISFIED | `reward_config.update` mutation + admin-only + confirm guard |

### FR-10: Queue And Operational Health

All 6 criteria SATISFIED — see in-spec annotations. Sources: `get-event-queue.ts`,
`/operations/queue`. Page is read-only as required.

### FR-11: Audit Logging For Sensitive Reads, Exports, And Changes

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Helper writes `operator_events` with `peek.*` types | SATISFIED | `audit/writer.ts:47-74` + six event types in `lib/types/peek.ts:377-392` |
| 2 | Payload includes actor/route/action/resource/filter summary/result count/request id | SATISFIED | `PeekAuditPayload`; populated by every emitter |
| 3 | Mutation audit before/after for changed fields | SATISFIED | `runner.ts:90-110` + per-mutation diff helpers |
| 4 | Rejected mutation audit | SATISFIED | `runner.ts:113-134, 159-194, 226-241` |
| 5 | No JWTs/DB URLs/secrets in payload | SATISFIED | `audit/redact.ts` + writer test asserts every secret class |
| 6 | Sensitive sections, exports, and mutations call audit helper | SATISFIED with residual | Built emitters: `peek.user.view_sensitive`, `peek.search`, `peek.export`, `peek.change.applied`, `peek.change.rejected`. **Residual gap**: `peek.access.denied` is defined and counted on `/audit` but never emitted from the route-level role-denied panels (`audit`, `queue`, `dogpile`, `points`, `crates`, `challenges`, exports route). See Recommendations. |
| 7 | Audit failure does not leak to browser | SATISFIED | `writer.ts:67-72` returns structured failure; callers swallow |
| 8 | `/audit` view filters by event type, actor, resource, route, date | SATISFIED | `app/audit/page.tsx` + `listAuditEvents` |
| 9 | `/audit` restricted via FR-2 page-level allowlist | SATISFIED | `access-policy.ts:151` + `app/audit/page.tsx:52-67` |

### FR-12: Exports

All 7 criteria SATISFIED — see in-spec annotations. Source files:
`src/server/exports/{runner,registry,filename,csv,source-routes}.ts`,
`src/server/exports/exporters/{claims,kol,referrers}.ts`,
`app/exports/[entity]/route.ts`.

### FR-13: Data Access Architecture And Performance

All 9 criteria SATISFIED — see in-spec annotations. SQL only in
`peek/src/server/db/queries/**`; pages call query functions; components import only
`lib/types/peek` types; pagination via `PaginationControls`; force-dynamic on every
page; no client polling; full vitest coverage.

### FR-14: Scoped Admin Changes

All 9 criteria SATISFIED or DEFERRED — see in-spec annotations. Framework:
`runner.ts` with `sql.begin` + transactional applied-audit; rejected-audit on every
denial path. Four registered mutations: `kol_rate.update`,
`fraud_flag.status.update`, `dogpile.cancel`, `reward_config.update`. Each has a
zod schema, role rule, before/after diff, server-action wrapper, and UI form.
Direct DB writes outside this framework are limited to the `operator_events` audit
insert.

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|----|-----------|----------|----------|------------|-----------|
| 1 | FR-1 | Missing/invalid email returns hard 403 instead of layout-rendered access-denied | low | engine | — | Add explicit `verification.email === null` 403 branch in `proxy.ts` for production |
| 2 | FR-3 | Nav links to `/users` (list) and `/access` 404 — pages never built | low | frontend | — | Either build trivial stub pages, route `/users` → `/?focus=users`, or remove the nav entries until they exist |
| 3 | FR-4 | Page-level data freshness banner | low | frontend | — | Add a small per-page header chip describing live/cached/manual freshness; today only individual metrics declare it |
| 4 | FR-11 | `peek.access.denied` event type defined and counted on `/audit` but never emitted | low | engine | — | Wire `writePeekAuditEvent({ eventType: "peek.access.denied", ... })` from each `if (!allowed) { ... access-denied panel ... }` branch in admin pages and from the `403` branches in `app/exports/[entity]/route.ts` |

Severity: critical (blocks launch) / moderate (degrades UX) / low (polish).
Category: on-chain / frontend / engine / test / docs.

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Crash, Game of Trades, Chart the Course, Slots Utopia, Tug of Earn admin pages | placeholders until persisted data lands | 002, 102, 103, 104, 105 | Deferred | Not stale — game specs themselves deferred |
| Challenge / campaign / completion-bonus definition editing | out of scope (FR-9, FR-14) | — | — | Intentional — no target spec |
| Queue retry / cancel / replay actions | out of scope (FR-10, FR-14) | future spec | — | Intentional — separate spec required before write paths land |
| Claim payout / crate payout overrides, profile identity edits, transaction edits, settlement edits | out of scope (FR-14) | future spec | — | Intentional |

## Recommendations

1. **Polish FR-1 #2** — return 403 in `proxy.ts` when verification succeeds but
   `verification.email === null` in production, instead of letting the request
   fall through and relying on the layout to render denial. Today the soft-denial
   path is correct only because every page is inside the layout that calls
   `getPeekActorContext()`; a future page rendered outside the layout (or a
   route handler) would silently bypass the denial gate. Hard 403 keeps the
   FR-1 boundary symmetrical with #1.

2. **Decide what `/users` and `/access` should mean** — both have nav entries
   today but no page. The cheapest credible answers:
   - `/users` — point the nav directly at `/?focus=users-list` (the home page
     already carries the users table) or build a dedicated list page.
   - `/access` — build a small page that renders the verified actor email,
     resolved role, allowed routes/actions, and the most recent `peek.access.denied`
     events. Pairs naturally with the `peek.access.denied` emitter
     recommendation below.

3. **Emit `peek.access.denied`** — every role-denied panel today (`/audit`,
   `/operations/queue`, `/operations/dogpile`, `/economy/points`, `/economy/crates`,
   `/economy/challenges`, plus the 403 branches in `app/exports/[entity]/route.ts`)
   silently shows a denial without recording the attempt. The audit writer
   already supports the event type; one helper call per page makes the
   `/audit` view useful for spotting attempted-but-denied access.

4. **Per-page freshness banner (FR-4 #4)** — small, mechanical addition: render
   a per-page chip ("live · server-rendered" or similar) so a non-engineer
   reviewer doesn't have to infer freshness from each metric strip cell.

5. **Mutation rollout discipline holds** — the four mutations honor the
   spec's blast-radius story: each guards by role, validates input, runs in a
   transaction, and produces an applied/rejected audit row that includes the
   diff. Future mutations should follow the same pattern (registry entry +
   action rule + zod schema + diff + UI form + tests). The runner is set up to
   absorb new mutations one-at-a-time without framework changes.

6. **No backend-API regressions** — confirmed: spec invariant 9 holds. No
   public route or OpenAPI change shipped with this spec.
