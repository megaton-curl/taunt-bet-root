# 403 — Peek Visual Redesign — Retrospective

The original `spec.md` covered **Phase 1** only (foundation + home page anchor). Three more phases shipped on top of that foundation. This retrospective captures what each phase delivered so the spec folder reflects the actual landed shape.

For raw history see `git log --oneline -- peek/` from the merge commits below.

## Phase 1 — Foundation + anchor page

Per `spec.md`. Merged to `peek/dev` at `5e575a6` (then `de3586f` after a CI test-fix). Bumped in root at `176ca513` → `b7a324f4`.

Delivered:
- Tailwind 4 + 17-color token system (light, OKLCH, neutral hue 260; paired `*-foreground` variants on every semantic surface — fixed during code review)
- 8 shadcn primitives (`Button`, `Input`, `Label`, `Card`, `Table`, `Badge`, `Separator`, `Skeleton`) + 2 native form-control wrappers (`NativeSelect`, `NativeCheckbox`)
- AdminShell port (header + nav + content frame)
- Home/command-center port end-to-end (MetricStrip, SummaryStrip, RecentActivityList, UsersTable, PaginationControls, UniversalSearchResults, filter form, page-freshness banner)
- Visual-fixture seed (~120 users + referral graph + 400 transactions + 250 game entries + operator events + reward economy + growth + operations) populating a dedicated `peek_visual_fixture` Postgres DB
- Critique infrastructure: structural rubric script (TDD-built, 4 unit tests), `@axe-core/playwright` advisory lint, Claude vision-judge runner (graceful skip when `ANTHROPIC_API_KEY` unset)
- Iteration loop: capture → critique → patch → recapture, capped at 3 rounds
- `/search` route (dedicated universal-search page; home no longer renders inline results)
- `formatShortDateTime` date helper
- Friendly error fallbacks (no raw SQL surfaced to operators)
- `peek/DESIGN_RUBRIC.md` documenting the rubric + loop

Schema corrections + critique-script limitations captured in `deviations.md`.

## Phase 2 — Per-page rollout

Originally an out-of-scope follow-up; brought in scope by user direction. Merged at `aff2a53`. Bumped in root at `c54afe08`.

Delivered:
- 13 additional pages ported: `/users`, `/users/[userId]`, `/access`, `/audit`, `/games`, `/games/[game]`, `/games/[game]/rounds/[roundId]`, `/growth/referrals`, `/growth/overrides`, `/economy/{challenges,crates,points,rewards}`, `/operations/{queue,payouts,dogpile}`
- `Tabs` primitive (URL-driven via `?tab=foo`, server-rendered, no client component). Applied to `/growth/referrals` (claims + top tabs; non-active tab's DB query is skipped server-side for a real perf win).
- Flex-wrap filter-bar pattern replaces the broken grid-with-auto-fit that dropped the Apply button to its own line on tight widths
- All supporting components ported: `audit-events-table`, `audit-events-filter-bar`, `auth-whitelist-panel`, `route-access-denied`, `game-rounds-table`, `game-rounds-filter-bar`, `growth-claims-table`, `growth-claims-filter-bar`, `growth-referrers-table`, `growth-rate-overrides-table`, `closecall-rounds-table`, `round-detail-view`, `user-detail-view`, and ~10 economy/operations tables
- Out of scope: `/economy/daily-crate` and `daily-crate-*` components (Megaton's parallel refactor; left untouched throughout)

Three home-page tasks were commit-consolidated when they all rewrote `app/page.tsx` end-to-end. AdminShell active-route highlighting deferred (would require server-side `headers().get('x-pathname')` injected via middleware; documented in `deviations.md`).

## Phase 3 — Polish iteration

Merged at `25aceb0`. Bumped in root at `bb4c6716`.

Four user-driven items addressed:
- Silenced "metrics unavailable" red Cards when the underlying error was the permanently-retired `dogpile_events` table (this approach later reverted — see Phase 4 cleanup)
- `truncateMiddle` helper (`src/lib/format-address.ts`, 4-…-4 default, override-able). Applied to wallet / PDA / tx-signature renders across `users-table`, `growth-*` tables, `fraud-flags-table`, `held-claims-table`, `user-detail-view`, `round-detail-view`, `closecall-rounds-table` (replacing its local helper). Every truncated value carries `title={fullValue}` for hover + screen-reader recovery.
- Username column widened (`min-w-[180px] whitespace-nowrap font-medium`) — usernames now read as identities, not muted body text.
- `formatShortDateTime` applied across every remaining timestamp column: `event-queue-table`, `completion-bonuses-table`, `challenge-assignments-table`, `reward-config-table`, `fraud-flags-table`, `game-rounds-table`, `growth-rate-overrides-table`, `held-claims-table`, `auth-whitelist-panel`, `progress-events-table`, `point-grants-table`, `crate-drops-table`, `payout-decisions-list`, `reward-pool-fundings-table`, `dogpile-events-table`, `event-queue-detail-panel`, `user-detail-view`, `round-detail-view`, `campaigns-table`, `payout-controls-card`. Tests aligned in dedicated `test(...)` commits.

## Phase 4 — Dogpile cleanup + new operator surfaces

Merged at `2b8a9f4`. Bumped in root at `405c565a`.

Bundled into one merge for coherence; two distinct concerns:

### Dogpile cleanup

Migration 019 dropped the `dogpile_events` table permanently — no replacement (events became `event_queue` long before, and the dogpile-specific anti-pattern detector was retired). Peek still had dead code paths around it. Cleaned out:

- Deleted: `/operations/dogpile` page, `DogpileEventsTable`, `dogpile.cancel` mutation + form + tests, `operations-dogpile-filter-bar`, `operations-dogpile-search-params`, `dogpile_events`-related queries + tests
- Removed `stale_active_dogpile_events` attention metric (one less query at home page load)
- Reverted Phase 3 `isRetiredDogpileError` defensive guard (no longer needed since the metric is gone at the source)
- Promoted fraud-flags to its own `/operations/fraud-flags` page (was crammed onto the dogpile page; `fraud_flags` table is still real and reviewed) + dedicated `FraudFlagsFilterBar`, `get-fraud-flags.ts`, search-params helper, tests
- Updated `admin-shell-nav.ts`, `access-policy.ts`, and access-policy tests

### Six new peek-only operator surfaces

User-driven addition: peek had gaps that hurt day-1 admin work. All six surfaces use data peek already queries; no backend changes.

| Surface | Source | Notable UX |
|---|---|---|
| `/games/stuck` | `rounds` + `closecall_rounds` joined, phase non-terminal past threshold (5min default; `?ageMinutes=N` override) | Threshold quick-links (>5/10/30/60min), oldest-first, age cell tinted destructive ≥60min |
| `/operations/fees` | `fee_bucket_debits` | Window Tabs (24h/7d/30d/all), per-bucket Cards with inline pill status row, recent-debits table with filter bar |
| `/operations/refunds` | `transactions WHERE tx_type='refund'` | Chronological (the `transactions` table has no `status` column — confirmed during query write); metric strip for 24h/7d counts + total |
| `/users/top` | `game_entries` aggregated by user, joined to `player_profiles` | Window Tabs + Sort Tabs (Volume / Net loss / Net gain / Win rate), Net P&L Badge tints, win-rate column. Only settled rounds count. |
| Home fee sparkline | `fee_bucket_debits` hourly aggregate | Pure SVG (24 points, zero-filled), no chart library, between Summary and Activity sections |
| AdminShell build badge | `NEXT_PUBLIC_GIT_SHA` env (falls back to `"dev"`) | Tiny grey badge in header, between email and role |

Schema surprises caught during the work:
- `closecall_rounds` has no `settling` phase — phase enum is `open / settled / refunded`. Stuck predicate uses `phase = 'open'` past threshold.
- `transactions` has no `status` column. Refunds page is chronological only.
- `fee_bucket_debits` has 7 statuses (including `held` and `rejected` beyond what was originally documented).

## What's still open after Phase 4

The trio called out as "out-of-pure-peek-scope":
- **Worker health surfaces.** Needs backend to emit heartbeats. Not peek-only.
- **Game-config viewer.** Would need either a peek-side Solana RPC client (new infra) or a new backend route.
- **Vision-judge calibration pass** over the now-21-page surface. Needs `ANTHROPIC_API_KEY` in the env.

## What the redesign left behind for future work

- `peek/DESIGN_RUBRIC.md` — 10-item rubric + automated critique loop (structural + axe advisory + optional vision-judge), documented for reuse on future redesigns.
- `peek/scripts/seed-visual-fixture.ts` — deterministic full-domain seed; reusable for any visual iteration without disturbing prod or CI test DBs.
- `peek/e2e/visual/` — 60+ committed target PNGs at three viewport widths covering every page; baseline kept for before/after comparisons.
- The Tabs primitive + flex-wrap filter-bar pattern + truncateMiddle + formatShortDateTime + `_referrer` URL-state pattern — all reusable across any future surface.
