# Specification: [405] Signup Burst Detection

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Extended |
| NR_OF_TRIES | 0 |

---

## Overview

Add a read-only **Signup bursts** tab to `/growth/referrals` in peek that surfaces
referral codes whose referees signed up in suspiciously bursty time patterns.

The current contest awards prizes to the referrers with the most referees. Bot
operators can win unfairly by scripting wallet creation + `/referral/apply`
calls against a single code. The smallest gap between two signups and the
largest count in a rolling 5-minute window are both strong tells — no human
shares a link, gets a wallet funded, and joins through it in 3 seconds, and a
human network of friends does not pile 12 signups into the same 5-minute
window.

This is **visibility only** for v1. No flagging workflow, no
disqualification, no audit log. Biz reviews the table and decides manually.

## User Stories

- As a biz reviewer, I want to see which referral codes have a bursty signup
  pattern so that I can manually exclude bot operators from the contest.
- As a biz reviewer, I want the table filterable by minimum referee count so
  that I am not distracted by codes with one or two referees.
- As a biz reviewer, I want to sort by burst intensity so that the most
  suspicious referrers are at the top of the page without me thinking about
  thresholds.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Extends spec 303 (peek admin) and spec 300
  (referral system). Off-chain growth tooling.
- **Current baseline fit**: Extends peek `/growth/referrals` page (already in
  production).
- **Planning bucket**: Extended.

## Required Context Files

- `peek/app/growth/referrals/page.tsx` — page that gains a third tab
- `peek/src/server/db/queries/get-growth-referrals.ts` — sibling query module
  to mirror for style/limit conventions
- `peek/src/lib/types/peek.ts` — central type exports for peek tables
- `peek/src/lib/growth-search-params.ts` — URL filter normalization pattern
- `peek/src/components/growth-referrers-table.tsx` — sibling table component
  to mirror for visual style
- `peek/src/server/access-policy.ts` — confirms `/growth/*` is already open to
  the `business` role; no policy change required
- `backend/migrations/010_referral.sql` — `referral_links`, `referral_codes`
  schema

## Contract Files

- New query module: `peek/src/server/db/queries/get-signup-bursts.ts`
- New table component: `peek/src/components/signup-bursts-table.tsx`
- New filter helpers in: `peek/src/lib/growth-search-params.ts`
- New types in: `peek/src/lib/types/peek.ts`
  - `PeekSignupBurstRow`
  - `PeekSignupBurstFilters`

---

## System Invariants

1. **Read-only.** The feature MUST NOT write to any table. No flagging,
   tagging, or audit-log row is produced by viewing or sorting the table.
2. **Existing access policy stands.** `/growth/*` is already
   `["business", "admin"]`; this feature MUST NOT introduce any policy edit.
   Both roles see the tab.
3. **Single source of truth.** Burst metrics MUST be derived from
   `referral_links.created_at` at query time. No new persisted column, no
   denormalized cache, no worker.
4. **No new index up front.** The existing `idx_referral_links_referrer`
   covers the partition. Adding a new index is out of scope unless query
   timing demonstrates the need (see Success Criteria).
5. **Bounded result set.** The query MUST be `LIMIT`-bounded server-side
   (default 50, max 250), matching `PEEK_GROWTH_TOP_REFERRERS_*` conventions.

---

## Functional Requirements

> **Note:** Frontend admin (peek) is in scope for this spec because peek is
> the consumer. The customer-facing webapp and waitlist are unaffected.

### FR-1: Signup Bursts Query

Add `listSignupBursts(options)` to a new
`peek/src/server/db/queries/get-signup-bursts.ts`. For each referrer with at
least `minReferees` referees in `referral_links`, compute:

- `referee_count` — total referees
- `min_gap_seconds` — smallest inter-arrival gap between consecutive referee
  signups for that referrer (NULL if `referee_count < 2`)
- `median_gap_seconds` — median inter-arrival gap (NULL if `referee_count < 2`)
- `max_burst_5min` — largest count of referees that signed up in any rolling
  5-minute window for that referrer
- `first_signup_at`, `last_signup_at` — bounding timestamps

Join `player_profiles` for `username` and `referral_codes` for `code` (both
nullable in the result; we want the row even if no profile / no code).

**Acceptance Criteria:**
- [ ] Query returns rows ordered by `max_burst_5min DESC, min_gap_seconds ASC
  NULLS LAST, referrer_user_id ASC` by default.
- [ ] Query supports filters: `minReferees` (int, default 5),
  `minMaxBurst` (int, optional), `referrerUserId`, `referrerWallet`,
  `referralCode` (case-insensitive on `code`).
- [ ] Query supports an optional `firstSignupFrom` / `firstSignupTo`
  inclusive-half-open window on `first_signup_at`.
- [ ] Query is `LIMIT`-bounded with default 50 and max 250, exposed via
  `PEEK_GROWTH_SIGNUP_BURSTS_DEFAULT_LIMIT` and
  `PEEK_GROWTH_SIGNUP_BURSTS_MAX_LIMIT` constants in the same file.
- [ ] Lamport-precision conventions do not apply here (no money columns);
  count columns return as `int`, timestamp columns return as `text`
  (ISO 8601), and gap columns return as numeric / `null`.
- [ ] Returns an empty array, not throws, when no referrer meets
  `minReferees`.

### FR-2: Types and Filter Normalizers

Add to `peek/src/lib/types/peek.ts`:

```ts
export type PeekSignupBurstRow = {
  referrerUserId: string;
  username: string | null;
  wallet: string;
  referralCode: string | null;
  refereeCount: number;
  minGapSeconds: number | null;
  medianGapSeconds: number | null;
  maxBurst5Min: number;
  firstSignupAt: string;
  lastSignupAt: string;
};

export type PeekSignupBurstFilters = {
  minReferees: string | null;
  minMaxBurst: string | null;
  referrerUserId: string | null;
  wallet: string | null;
  referralCode: string | null;
  firstSignupFrom: string | null;
  firstSignupTo: string | null;
};
```

Add `normalizeSignupBurstFiltersFromSearchParams(params)` to
`peek/src/lib/growth-search-params.ts`, mirroring the
`normalizeTopReferrerFiltersFromSearchParams` style: trim, return `null` for
blanks, validate unsigned-int / date strings, and ignore unknown keys.

**Acceptance Criteria:**
- [ ] New types are exported from `peek/src/lib/types/peek.ts`.
- [ ] Normalizer parses each filter key, returns `null` for blank / invalid
  input, and is covered by a unit test with at least one happy-path case and
  one invalid-input case per field.
- [ ] All new strings used in the page URL use the prefix `burst*` (e.g.
  `burstMinReferees`, `burstReferrerUserId`) so a follow-up filter form
  submit does not collide with `claim*` / `referrer*` keys from the other two
  tabs.

### FR-3: New Tab on `/growth/referrals`

Add a third tab labelled **Signup bursts** to
`peek/app/growth/referrals/page.tsx` with id `bursts`.

**Acceptance Criteria:**
- [ ] Tab ids array becomes `["claims", "top", "bursts"]` and the visible
  order is Referral claims · Top referrers · Signup bursts.
- [ ] Visiting `/growth/referrals?tab=bursts` selects the new tab and queries
  `listSignupBursts` server-side, mirroring the per-tab "only query the
  active tab" pattern already present.
- [ ] The tab renders `<SignupBurstsTable>` with the result rows and an error
  state if the query throws.
- [ ] A filter form sitting above the table preserves `tab=bursts` on
  submit, mirrors the visual style of the existing top-referrer form, and
  exposes inputs for: min referees (default `5`), min max-burst, referrer
  user id, referrer wallet, referral code, first-signup-from,
  first-signup-to.
- [ ] The page does not break the existing two tabs; both `claims` and `top`
  continue to render their existing data and filter UI.

### FR-4: `SignupBurstsTable` Component

Add `peek/src/components/signup-bursts-table.tsx`.

**Acceptance Criteria:**
- [ ] Columns: Referrer (username with wallet underneath), Code, Referees,
  Max burst (5 min), Min gap (s), Median gap (s), First signup, Last signup,
  Action.
- [ ] The Action cell links to the Top referrers tab pre-filtered on the
  same `referrerUserId` so an operator can drill into earnings context with
  one click.
- [ ] Null gap values (single-referee referrers — only possible when
  `minReferees` is lowered to 1) render as `—`, not `null` or `0`.
- [ ] Gap values render with thousand separators and a `s` suffix; bursts
  render as a plain integer. Timestamps render in the same local-time style
  used by `growth-claims-table.tsx`.
- [ ] An empty result state renders an accessible "No rows match these
  filters." message instead of a blank `<tbody>`.
- [ ] An error string passed via prop renders an accessible error region in
  place of the table.

### FR-5: Tests

**Acceptance Criteria:**
- [ ] Unit test for `listSignupBursts` against seeded `referral_links`:
  - clean referrer (5 referees spread across days → small max burst, large
    gaps, no flags)
  - burst referrer (10 referees in 30 seconds → max_burst_5min >= 10,
    min_gap_seconds < 5)
  - paced bot referrer (10 referees one every 90 seconds → max_burst_5min
    small, but median_gap_seconds ≈ 90 and variance low)
  - referrer below `minReferees` (filtered out entirely)
- [ ] Unit test for `normalizeSignupBurstFiltersFromSearchParams` covering
  trim, blank → null, unsigned-int validation, and date validation.
- [ ] Component test for `SignupBurstsTable` covering: empty state, error
  state, populated state with three rows including one with null gaps.

---

## Success Criteria

- Biz can open `/growth/referrals?tab=bursts`, see referrers ranked by 5-min
  burst, and spot a referrer cluster of >= 10 signups inside 5 minutes
  without writing SQL.
- Query latency on the current `referral_links` table (low five-figure
  rows) is under 200 ms p95 in dev. If we cross 500 ms in production, add
  an index on `(referrer_user_id, created_at)` — out of scope unless that
  threshold is breached.
- No regressions in the existing two tabs (claims, top referrers).

---

## Dependencies

- Existing `referral_links`, `referral_codes`, `player_profiles` tables —
  no migration.
- Existing peek role policy — no policy change.

## Assumptions

- The contest is decided by **referrer count**, not by referred wagering
  volume; bursty signups are the dominant fraud vector.
- Bot operators are not (yet) sophisticated enough to randomize
  inter-arrival times convincingly; v1 catches the obvious patterns. If the
  fraud pattern shifts to slow-paced scripted signups, a follow-up adds a
  CV/regularity column to the same table.
- We do not need to persist IP / UA for v1. If biz later wants those
  signals, a separate spec captures them on `/auth/verify` and joins them
  in.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | FR-1 default ordering | seeded query unit test | rows returned in expected order |
| 2 | FR-1 filter semantics | seeded query unit test per filter | filter narrows result set, blank filter is no-op |
| 3 | FR-1 LIMIT bound | seeded query unit test with 300 rows | response length = max 250 |
| 4 | FR-2 normalizer | unit test on `growth-search-params` | blank/invalid → null, valid → string |
| 5 | FR-3 tab routing | server-component render test on the page | `?tab=bursts` triggers `listSignupBursts` only |
| 6 | FR-4 table states | component test on table | empty / error / populated render correctly |
| 7 | Success: latency | local `EXPLAIN ANALYZE` on seeded rows | plan uses `idx_referral_links_referrer`, no seq scan above N rows |

---

## Completion Signal

### Implementation Checklist
- [ ] Add `listSignupBursts` query module with `LIMIT` constants and types.
- [ ] Add `PeekSignupBurstRow` / `PeekSignupBurstFilters` to peek types.
- [ ] Add `normalizeSignupBurstFiltersFromSearchParams` to growth search-param helpers.
- [ ] Add `SignupBurstsTable` component matching existing table style.
- [ ] Extend `peek/app/growth/referrals/page.tsx` with the `bursts` tab, per-tab data fetch, and filter form.
- [ ] Add unit tests for query (4 referrer profiles), normalizer, and component.
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) — **N/A**: peek admin is not in `e2e/local`; covered by peek component + query unit tests.
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes — **N/A**: visual regression is for webapp; peek has its own `playwright.visual.config.ts`. Add a peek visual snapshot for the new tab's empty + populated states under `peek/e2e/`.
- [ ] [test] Devnet real-provider E2E — **N/A**: no on-chain interaction.

### Testing Requirements

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Empty / error states handled
- [ ] Existing two tabs unchanged

#### Integration Verification
- [ ] `cd peek && pnpm verify` green
- [ ] No new public API contract changes (peek is internal admin)

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run targeted tests, then `cd peek && pnpm verify`
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`
