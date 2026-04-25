# Implementation History — 305-peek-operations-admin

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — 2026-04-25

- Added `jose@6.2.2` to `peek/package.json` as a runtime dep.
- Rewrote `peek/src/server/cloudflare-access.ts` on top of `jose`:
  `jwtVerify` with `algorithms: ['RS256']`, `audience`, `issuer`, and
  `currentDate`, using `createLocalJWKSet` when callers pass an in-memory
  JWKS (test path) and `createRemoteJWKSet` against
  `${teamDomain}/cdn-cgi/access/certs` otherwise (cached per issuer).
- Removed all custom RSA/JWKS/base64url/JSON-claim crypto helpers; mapped
  jose error subclasses (`JWTExpired`, `JWTClaimValidationFailed` with
  `claim === "iss"`/`"aud"`, `JOSEAlgNotAllowed`, `JOSENotSupported`,
  `JWKSNoMatchingKey`, `JWSSignatureVerificationFailed`,
  `JWKSTimeout`/`JWKSInvalid`/`JWKInvalid`, `JWTInvalid`/`JWSInvalid`)
  back onto the existing `CloudflareAccessVerificationReason` union so
  callers and existing tests are unchanged.
- Preserved the public surface: `verifyCloudflareAccessJwt`,
  `getVerifiedCloudflareAccessEmailFromHeaders`, and
  `VERIFIED_ACCESS_EMAIL_HEADER` keep their shapes; `proxy.ts` and
  `app/layout.tsx` need no edits.
- Targeted check: `pnpm --dir peek lint`, `pnpm --dir peek typecheck`,
  and `pnpm --dir peek test` — all green; 21/21 unit tests pass.

## Iteration 1 — 2026-04-25T09:45:06Z — BLOCKED
- **Blocker**: No file changes detected — agent made no progress.
- **Log**: iteration-001.log

## Iteration 2 — 2026-04-25

- Expanded `peek/src/server/__tests__/cloudflare-access.test.ts` for the
  jose-backed verifier: malformed token, expired (`exp` in the past),
  invalid issuer (signed with `https://other.cloudflareaccess.com`),
  invalid audience, bad signature (sign with key A, present JWK B with
  the same `kid`), `alg: "none"` rejection, missing email claim
  (returns `ok: true, email: null`), and case/whitespace normalization
  (`"  Admin@Example.COM  "` → `"admin@example.com"`).
- Lowercased + trimmed in `normalizeEmail` so the verified email
  identity is canonical for FR-2 role matching.
- Replaced the implicit `NODE_ENV === "development"` bypass in
  `peek/proxy.ts` with the spec-required explicit `PEEK_DEV_ACCESS_EMAIL`
  bypass: dev-only, validates email shape, sets the
  `VERIFIED_ACCESS_EMAIL_HEADER` so server context still gets a normalized
  actor identity. Production never honors the bypass; missing CF env in
  prod still returns 500.
- Rewrote `peek/src/server/__tests__/cloudflare-access-middleware.test.ts`
  with `vi.stubEnv` (TS forbids assigning to `process.env.NODE_ENV`) and
  added: prod blocks without JWT (existing), prod 500 on missing CF env,
  prod ignores `PEEK_DEV_ACCESS_EMAIL`, dev honors `PEEK_DEV_ACCESS_EMAIL`
  with case normalization, dev rejects malformed `PEEK_DEV_ACCESS_EMAIL`.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (31/31, +10 new).

## Iteration 2 — 2026-04-25T10:32:41Z — OK
- **Log**: iteration-002.log

## Iteration 3 — 2026-04-25

- Added `peek/src/server/access-policy.ts`:
  - `PeekRole = "business" | "admin"`, `PeekRolePolicyEntry = { match, role }`
    where `match` is either an exact email (`alice@example.com`) or a wildcard
    domain (`*@example.com`).
  - `parsePeekRolePolicy(raw)` validates entries: trims/lowercases, drops
    invalid `role` values, drops missing/non-string `match` values, validates
    wildcard domain shape, and de-duplicates exact `(match, role)` pairs.
  - `loadPeekRolePolicyFromEnv()` reads `PEEK_ACCESS_POLICY` JSON; returns
    `[]` on missing/malformed input (fail-closed for env-driven config).
  - `normalizeActorEmail()` and `resolveRoleForEmail()` implement
    case-insensitive matching and admin precedence: any matching `admin`
    rule wins (short-circuit), otherwise first matching `business` wins.
  - `getPeekActorContext()` reads `next/headers` for the trusted
    `VERIFIED_ACCESS_EMAIL_HEADER` (set only by the proxy), normalizes it,
    resolves the role, and returns `{ email, role }` or `null`. Browser
    headers are never trusted — the policy is loaded from server env only.
- Hardened `peek/proxy.ts`: clones `request.headers` and unconditionally
  `delete()`s `VERIFIED_ACCESS_EMAIL_HEADER` at the top of every code path,
  so a spoofed `x-peek-verified-access-email` header from the browser cannot
  survive into server context — even on the dev no-config and dev no-bypass
  branches. The header is only ever (re-)set with the dev-bypass email or a
  jose-verified Cloudflare Access email.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (31/31, no regressions; access-policy unit tests land in
  the next iteration per the checklist split).

## Iteration 3 — 2026-04-25T10:36:33Z — OK
- **Log**: iteration-003.log

## Iteration 4 — 2026-04-25

- Extended `peek/src/server/access-policy.ts` with the FR-2 centralized
  route-prefix and action-id authorization helpers:
  - `PEEK_ROUTE_RULES` table (`/audit` → `admin`); other routes fall back to
    `PEEK_DEFAULT_ROUTE_ROLES = ["business", "admin"]` per System Invariant
    #6 (read-only default for any resolved peek role).
  - `PEEK_ACTION_RULES` table covering the FR-14 initial mutation candidates:
    `kol_rate.update` (`business`/`admin`), `fraud_flag.status.update`
    (`admin`), `dogpile.cancel` (`admin`), `reward_config.update` (`admin`).
  - `getRequiredRolesForRoute(path)` normalizes the path (strips query/hash,
    trailing slash) and resolves the most-specific matching prefix; unknown
    paths return the documented default.
  - `isRouteAllowedForRole(path, role)` → false for `null` role, otherwise
    membership in the resolved required-roles list.
  - `getRequiredRolesForAction(actionId)` returns the required roles or
    `null` when the action id is unknown; `isActionAllowedForRole` fails
    closed (returns false) on unknown action ids or `null` role.
  - All rule tables and helpers accept overridable rule arrays so the test
    suite (next iteration) can exercise unit-table edge cases without
    coupling to the live policy.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (31/31, no regressions; new helpers will get dedicated
  unit coverage in the next iteration per the checklist split).

## Iteration 4 — 2026-04-25T10:39:30Z — OK
- **Log**: iteration-004.log

## Iteration 5 — 2026-04-25

- Added `peek/src/server/__tests__/access-policy.test.ts` (44 tests) covering
  the FR-2 surface end-to-end:
  - `parsePeekRolePolicy`: non-array input, trim+lowercase normalization,
    invalid roles dropped, missing/non-string `match` dropped, malformed
    wildcard domains dropped (including `*@`, `*@*.com`, `*@with space.com`),
    malformed exact emails dropped, exact `(match, role)` de-duplication
    that still preserves distinct roles for the same email, and rejection of
    non-object array items.
  - `loadPeekRolePolicyFromEnv`: empty env, malformed JSON, valid env policy
    (using `vi.stubEnv("PEEK_ACCESS_POLICY", …)`).
  - `normalizeActorEmail`: trim+lowercase, nullish/empty/invalid → null.
  - `resolveRoleForEmail`: invalid email, exact match (case-insensitive),
    wildcard domain match, admin precedence both ways (exact admin beats
    wildcard business; wildcard admin beats exact business), no match, and
    empty policy.
  - Route helpers: `getRequiredRolesForRoute` returns the documented default
    for unknown routes (`/`, `/users`, `/games/flipyou`), `admin` for `/audit`
    + subpaths, refuses prefix-substring leakage (`/auditing` → default), strips
    `?query` and `#hash`, normalizes paths missing a leading slash, and picks
    the most specific matching prefix when multiple rules match.
  - `isRouteAllowedForRole`: denies on null/undefined role, allows
    business+admin on default routes, denies business on `/audit` while
    allowing admin.
  - Action helpers: `getRequiredRolesForAction` returns roles for every FR-14
    initial mutation id and `null` for unknown ids; `isActionAllowedForRole`
    fails closed on unknown ids and null role, admin can perform every initial
    mutation, business can do `kol_rate.update` only, and an injected rules
    array overrides without leaking the live table.
  - `getPeekActorContext` (with `vi.mock("next/headers")`): missing header →
    null, no policy match → null, empty policy → null, exact admin match →
    `{ email, role: "admin" }`, wildcard match with case+whitespace
    normalization, malformed verified email header → null.
  - Live tables: asserts `/audit` rule is admin-only and that
    `PEEK_ACTION_RULES` includes the FR-14 initial mutation ids.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (75/75 — was 31/31, +44 new).

## Iteration 5 — 2026-04-25T10:42:46Z — OK
- **Log**: iteration-005.log

## Iteration 6 — 2026-04-25

- Added `peek/src/lib/access-policy.ts` exposing the browser-safe `PeekRole`
  literal + `PEEK_ROLES` list + `isPeekRole` guard. Server-only policy details
  (env loading, route + action rules, actor context, `next/headers` reads) stay
  in `peek/src/server/access-policy.ts`; the server module now re-exports
  `PeekRole` from the lib module so existing callers/tests are unchanged.
- Extended `peek/src/lib/types/peek.ts` with foundational FR-4 view-model
  primitives, all browser-safe (no server imports, fully serializable):
  - `PeekActorView` — `{ email, role }` for the admin shell badge.
  - `PeekMetric` — stable id, label, value, valueDisplay, unit, source,
    windowLabel, asOf, definition, freshness, drilldownHref. `PeekMetricFreshness`
    union covers `live | cached | manual | sampled` so pages can declare how
    fresh the data is per FR-4.
  - `PeekPagination` — `{ page, pageSize, totalCount, totalPages }`.
  - `PeekTableSort` + `PeekSortDirection` for URL-addressable sort state.
  - `PeekTableFilter` + `PeekFilterKind` (`text | select | boolean | date |
    dateRange`) + `PeekFilterOption` for the URL-addressable filter primitive.
  - `PeekStatusTone` (`neutral | positive | warning | negative | info`) for the
    shared status-chip component.
  - `PeekEmptyState` for the operator-copy empty-state primitive.
  - `PeekTableColumn` (id/label/align/sortable), `PeekTableRowBase`
    (`{ id, href }`) which per-feature row types extend, and a generic
    `PeekTableViewModel<TRow>` envelope (columns, rows, pagination, filters,
    sort, empty) used by feature pages.
- Existing 303-era `PeekSummary`, `PeekUserRow`, and `PeekUserDetail` shapes
  remain unchanged; per-feature view models for users/referrals/games/queue/
  audit/exports get added inside their respective feature iterations.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (75/75, no regressions).


## Iteration 6 — 2026-04-25T10:46:50Z — OK
- **Log**: iteration-006.log

## Iteration 7 — 2026-04-25

- Extended `peek/src/lib/types/peek.ts` with the foundational FR-11 audit and
  FR-12 export contracts (browser-safe, fully serializable, no server imports):
  - `PeekAuditEventType` union: `peek.search`, `peek.user.view_sensitive`,
    `peek.export`, `peek.access.denied`, `peek.change.applied`,
    `peek.change.rejected` — paired with `PEEK_AUDIT_EVENT_TYPES` const list +
    `isPeekAuditEventType` guard for parsing rows back from `operator_events`.
  - `PEEK_AUDIT_REDACTED = "[REDACTED]"` sentinel for the writer to substitute
    in place of any redacted value before persisting; the audit-view UI will
    render the token verbatim so reviewers see that a field was redacted (not
    silently absent), per FR-11 (no JWTs, access tokens, DB URLs, private keys,
    or raw secrets in payload).
  - `PeekAuditScalar`, `PeekAuditChange { field, before, after }`, and
    `PeekAuditPayload` capturing every FR-11 field: `actorEmail`, `route`,
    `actionId`, `resourceType`, `resourceId`, `filterSummary`, `resultCount`,
    `requestId`, `rejectionReason`, `changes` (mutation before/after diff).
  - `PeekAuditEvent { id, eventType, createdAt, payload }` view model for the
    audit page table.
  - `PEEK_EXPORT_ROW_CAP_DEFAULT = 5000` baseline cap; `PeekExportEntity` union
    enumerating the entities expected to ship CSV exports (users, referrers,
    KOL, claims, rounds, transactions, queue, audit).
  - `PeekExportRow = Record<string, string>` keyed by table column id so export
    rows track the rendered table view-model fields (FR-12 row-mapping rule).
  - `PeekExportFilenameInput { entity, date, filterSlug }` and
    `PeekExportResult { filename, rowCount, rowCap, rowCapApplied, columns,
    rows }` so the export helper (later iteration) can return both the bounded
    rows and a cap-applied indicator the UI surfaces to the operator.
- Per-feature view models (queue payload redaction, audit filter view models,
  per-entity export row aliases) get added inside their respective feature
  iterations.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (75/75, no regressions).

## Iteration 7 — 2026-04-25T10:50:01Z — OK
- **Log**: iteration-007.log

## Iteration 8 — 2026-04-25

- Added foundational FR-3/FR-4 UI primitives part A (dense table, metric strip,
  filter bar) — all server-component-friendly (no client state), browser-safe
  imports only:
  - `peek/src/components/peek-table.tsx` — generic `PeekTable<TRow>` rendering a
    `PeekTableViewModel<TRow>`. Sortable column headers render `next/link`
    anchors using a caller-supplied `buildSortHref(columnId, nextDirection)`
    callback (component computes the toggle: currently-sorted desc → asc, else
    desc); active-sort header carries a `▲`/`▼` indicator and `aria-sort`. Cells
    are rendered via a typed `renderCell(row, columnId)` callback so per-feature
    row shapes stay strongly typed without leaking into the table component.
    Empty rows render the view-model's `empty` operator copy (`role="status"`),
    and a non-null `error` prop renders `role="alert"` instead of the table.
  - `peek/src/components/metric-strip.tsx` — renders a `ReadonlyArray<PeekMetric>`
    grid of cards with the FR-4 bookkeeping visible (label, valueDisplay + unit,
    definition, source, windowLabel, as-of, freshness chip, optional drill-down
    `Link`). Empty array renders an operator status; non-null error renders an
    alert instead of the grid.
  - `peek/src/components/filter-bar.tsx` — `<form method="get">` with `name=`
    inputs matching each filter id so applied filters round-trip through the
    URL. Supports `text` / `select` / `boolean` / `date` / `dateRange` (the last
    splits on `..` and emits `${id}From` and `${id}To` named inputs). Required
    filters get a `*` suffix; non-required `select` filters get an empty/Any
    leading option. Empty filter list renders an operator status; non-null error
    renders an alert.
- Added component tests covering populated / sparse / error for each:
  - `peek-table.test.tsx` (3 tests): populated renders columns, rows via
    renderCell, toggling sort hrefs (active desc → asc next), `aria-sort`
    descending on the active column, and `▼` indicator; sparse renders
    `role="status"` with the empty-state copy and no `<table>`; error renders
    `role="alert"` and suppresses both the table and the empty state.
  - `metric-strip.test.tsx` (4 tests): populated renders label/value/unit/
    definition/source/window/asOf/freshness/drilldown link; sparse-data variant
    (null asOf, null drilldownHref) renders a `—` and no link; empty array
    renders operator status; error renders alert.
  - `filter-bar.test.tsx` (3 tests): populated renders all five filter kinds
    with default values, the `windowFrom` / `windowTo` split inputs, and the
    submit button; empty list renders operator status; error renders alert and
    no `role="search"` form.
- No changes to existing 303-era components (`SummaryStrip`, `UsersTable`,
  `PaginationControls`) — those stay as feature-specific surfaces; the new
  primitives become the default for FR-3/FR-4 feature pages going forward.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (85/85 — was 75/75, +10 new across 3 new component test files).

## Iteration 8 — 2026-04-25T10:55:00Z — OK
- **Log**: iteration-008.log

## Iteration 8 — 2026-04-25T10:55:14Z — OK
- **Log**: iteration-008.log

## Iteration 9 — 2026-04-25

- Added foundational FR-3/FR-4 UI primitives part B (state primitives) — all
  server-component-friendly (no client state), browser-safe imports only:
  - `peek/src/components/status-chip.tsx` — renders a `PeekStatusTone`-toned
    chip via `<span role="status" data-tone={tone}>`. Default tone is
    `neutral`; `null`/empty label collapses to a `—` placeholder span with
    `aria-label="status missing"`; non-null `error` prop renders `role="alert"`
    instead of the chip. Tones (`neutral | positive | warning | negative |
    info`) drive the background/foreground/border palette so per-feature
    status surfaces (claim status, queue state, round phase, fraud flag) get
    a consistent operator-readable chip.
  - `peek/src/components/empty-state.tsx` — renders a `PeekEmptyState`
    `{ title, body }` inside `role="status"` for operator-copy empties (FR-3
    "Empty states explain the absence of data in operator terms"). `body` is
    nullable; non-null `error` renders `role="alert"` instead.
  - `peek/src/components/detail-panel.tsx` — renders a
    `ReadonlyArray<PeekDetailSection>` (`{ id, label, body: ReactNode }`) as
    `<nav aria-label>` anchor links + a stack of `<section id={id}
    aria-labelledby>` blocks with `<h2>` headings. `activeId` toggles
    `aria-current="true"` + a highlighted style on the active link; empty
    sections list renders an operator empty state; non-null `error` renders
    `role="alert"`. Body is `ReactNode` (not a serializable view-model field),
    so the detail-section type lives in the component module rather than the
    browser-safe types module.
- Added component tests covering populated / sparse / error for each:
  - `status-chip.test.tsx` (4 tests): populated renders label + `data-tone`
    + forwards `title`; populated default-tone falls back to `neutral`; sparse
    `label={null}` renders `—` with `aria-label="status missing"` and no
    `data-tone`; error renders `role="alert"` and suppresses the chip.
  - `empty-state.test.tsx` (3 tests): populated renders title + body inside
    `role="status"`; sparse `body=null` renders only the title (single `<p>`);
    error renders `role="alert"` and suppresses the status region.
  - `detail-panel.test.tsx` (4 tests): populated renders nav links in section
    order with correct `href="#…"` anchors, marks `activeId="linked-accounts"`
    via `aria-current="true"`, and renders each section's body + `<h2>`
    heading; populated without `activeId` leaves every link non-active;
    sparse renders the operator empty state with title + body and no nav;
    error renders `role="alert"` and suppresses both nav and status.
- Existing 303-era components (`SummaryStrip`, `UsersTable`,
  `PaginationControls`, `UserDetailCard`) and the iteration-8 layout/data
  primitives (`PeekTable`, `MetricStrip`, `FilterBar`) are untouched — the
  state primitives complete the FR-3/FR-4 foundational set used by upcoming
  feature pages.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (96/96 — was 85/85, +11 new across 3 new component test
  files).

## Iteration 9 — 2026-04-25T10:58:00Z — OK
- **Log**: iteration-009.log

## Iteration 9 — 2026-04-25T10:58:58Z — OK
- **Log**: iteration-009.log

## Iteration 10 — 2026-04-25

- Added the FR-3 persistent admin shell — a server-rendered chrome that wraps
  every peek route and resolves the verified Cloudflare Access actor against
  the FR-2 local role policy:
  - `peek/src/components/admin-shell.tsx` — pure presentational
    server-component-friendly shell. Takes `actor: PeekActorView | null`,
    `navItems: ReadonlyArray<AdminShellNavItem>`, optional `accessIssue:
    "no-identity" | "no-role"`, and `children`. Renders `aria-label="Peek
    admin shell"` header with brand, primary navigation (`<nav
    aria-label="Primary">`), and an actor-identity strip with a tone-coded
    role badge (`data-role`, `aria-label="Resolved role: ..."`). When
    `accessIssue` is set, the shell suppresses nav, identity, and `children`,
    and renders an `aria-label="Access denied"` `role="alert"` block with a
    generic operator-readable title + body — never echoing the verified email
    so the missing-config / no-identity branches do not leak sensitive data.
  - `peek/src/server/admin-shell-nav.ts` — server-only nav model. Declares
    `PEEK_ADMIN_SHELL_NAV` covering the FR-3 groups (Users, Growth, Games,
    Economy, Operations, Audit, Access) and `getVisibleNavItemsForRole(role)`
    which filters via `isRouteAllowedForRole` (so `/audit` is admin-only and
    null roles see nothing), keeping page authorization centralized in the
    FR-2 policy module.
  - `peek/app/layout.tsx` — replaced the ad-hoc header with `AdminShell`.
    Reads the trusted `VERIFIED_ACCESS_EMAIL_HEADER` and `getPeekActorContext`
    once per request, classifies the access state (`no-identity` when the
    proxy did not set the verified email; `no-role` when an email is present
    but no role resolves), and passes the role-filtered nav into the shell so
    inaccessible routes never appear in the link list.
- Added shell coverage:
  - `src/components/__tests__/admin-shell.test.tsx` (6 tests): admin sees
    every nav group + email + admin-toned badge; business-style filtered nav
    omits Audit; `accessIssue="no-role"` renders the alert and suppresses
    nav/identity/children with no `@` characters in the alert text;
    `accessIssue="no-identity"` renders the generic missing-identity alert
    with the same suppression; stale-actor + access-issue still hides the
    email; empty navItems renders identity but no nav.
  - `src/server/__tests__/admin-shell-nav.test.ts` (4 tests): admin → all
    7 groups; business → 6 groups (Audit hidden); null role → empty list;
    declared nav covers the FR-3 group ids in order.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (106/106 — was 96/96, +10 new across 2 new test files;
  the existing layout was the only modified surface and its consumers
  (`app/page.tsx`, `app/users/[userId]/page.tsx`) keep their `<main>`
  wrappers because the shell renders only chrome, not a `<main>` element).

## Iteration 10 — 2026-04-25 — OK

## Iteration 10 — 2026-04-25T11:05:34Z — OK
- **Log**: iteration-010.log

## Iteration 11 — 2026-04-25

- Added the FR-11 audit writer module under `peek/src/server/audit/**` so
  `peek.*` operator events land in the existing `operator_events` table
  without a new migration:
  - `peek/src/server/audit/redact.ts` — `looksLikeSecret`, `redactScalar`,
    `redactNullableString`, `redactChange`, and `redactPayload`. Patterns
    cover JWTs (`eyJ…\.…\.…`), DB connection URLs (postgres/mysql/mongodb/
    redis/amqp), `-----BEGIN […] PRIVATE KEY-----` blocks, `Bearer …`
    headers, and `cf-access-jwt-assertion: …` lines. Matches are replaced
    with `PEEK_AUDIT_REDACTED` from `peek/src/lib/types/peek.ts`. Mutation
    `changes[]` entries get the same scalar redaction so before/after
    string values cannot persist secrets.
  - `peek/src/server/audit/writer.ts` — `writePeekAuditEvent({ eventType,
    payload }, options)` that runs every payload through `redactPayload`,
    inserts into `operator_events (event_type, payload)` (pda left null —
    peek records are not round-keyed), and returns
    `{ ok: true } | { ok: false, reason: "invalid_payload" | "insert_failed" }`.
    Empty `actorEmail` short-circuits to `invalid_payload` so unauthenticated
    paths never write a row. DB errors are caught and only forwarded to a
    server-side `logger` (defaults to `console.error`); the error detail
    never reaches the writer's return value, so callers cannot accidentally
    leak DB internals to the browser.
  - `peek/src/server/audit/index.ts` — public re-exports
    (`writePeekAuditEvent`, the result types, and the redaction helpers).
  - The writer accepts an injectable `Sql` and `logger` so the next
    iteration's tests can drive it without touching live Postgres.
- Inserts use `sql.json(...)` to keep the JSONB serialization consistent
  with the backend's existing `operator_events` writer pattern in
  `backend/src/db/rounds.ts`.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (106/106, no regressions; audit-writer tests land in the
  next iteration per the checklist split).

## Iteration 11 — 2026-04-25T11:10:28Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-04-25

- Added `peek/src/server/audit/__tests__/writer.test.ts` (9 tests) covering the
  FR-11 audit-writer surface end-to-end:
  - **Sensitive read**: `peek.user.view_sensitive` insert carries the full
    payload (route, actionId, resourceType/Id, filterSummary, resultCount,
    requestId) verbatim into `operator_events`; SQL string contains
    `insert into operator_events`.
  - **Export**: `peek.export` insert carries actionId, resultCount, and
    filterSummary unchanged.
  - **Access denial**: `peek.access.denied` insert carries route + a
    `rejectionReason` (e.g. `role_required:admin`) without leaking secrets.
  - **Mutation applied**: `peek.change.applied` insert carries the
    `changes[]` before/after array with mixed scalar types (number + string)
    intact.
  - **Mutation rejected**: `peek.change.rejected` insert carries
    `rejectionReason` and the changes[] for the rejected diff.
  - **Secret redaction**: a payload stuffed with a JWT, postgres connection
    URL, RSA `-----BEGIN PRIVATE KEY-----` block, `Bearer …` header, and
    `cf-access-jwt-assertion: …` line is fully redacted to
    `PEEK_AUDIT_REDACTED` before persistence; the serialized stored payload
    contains none of the raw secret strings.
  - **Empty actorEmail**: returns `{ ok: false, reason: "invalid_payload" }`
    and writes nothing to the SQL mock (no insert call, no `sql.json` call).
  - **Insert failure**: a rejected insert returns `{ ok: false, reason:
    "insert_failed" }`, the injected logger is invoked with
    `"[peek-audit] insert failed"` + `{ eventType }`.
  - **Error containment**: even when the underlying DB error string contains
    `password=hunter2`, the structured result never contains those bytes —
    the writer's return type is a closed union with no error detail.
- The test creates a typed SQL mock that captures both the tagged-template
  call (strings + values) and `sql.json(...)` invocations so the writer's
  payload-shaping contract is asserted directly without touching live
  Postgres. The mock is passed via the writer's `options.sql` injection
  seam (the same seam used in production calls when iterations need to run
  inside a transaction).
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (115/115 — was 106/106, +9 new).


## Iteration 12 — 2026-04-25T11:13:59Z — OK
- **Log**: iteration-012.log


## Iteration 13 — 2026-04-25

- Added the FR-3/FR-10 command-center attention queue query module so the
  command-center page can render exception states without per-page hardcoded
  thresholds:
  - `peek/src/server/db/queries/get-command-center-attention.ts` —
    `getCommandCenterAttention(options?)` runs seven bounded count queries in
    parallel and returns a `PeekCommandCenterAttention` envelope:
    1. `failed_claims` — `referral_claims.status IN ('failed', 'error')`,
       drill-down `/growth/referrals?claimStatus=failed`.
    2. `dead_queue_events` — `event_queue.status = 'dead'`, drill-down
       `/operations/queue?status=dead`.
    3. `stuck_rounds_flipyou_potshot` — `rounds` in nonterminal phases
       (`'created' | 'locked' | 'settling'`) older than the age threshold OR
       `settle_attempts > max`, drill-down `/games?stuck=true`.
    4. `stuck_rounds_closecall` — `closecall_rounds.phase = 'open'` older than
       the age threshold (Pyth settles on minute boundaries), drill-down
       `/games/closecall?stuck=true`.
    5. `pending_sol_crate_payouts` — `crate_drops.crate_type = 'sol' AND
       status = 'pending'`, drill-down
       `/economy/rewards?crateType=sol&status=pending`.
    6. `stale_active_dogpile_events` — `dogpile_events.status = 'active' AND
       ends_at < now()` (should have transitioned to `'ended'`), drill-down
       `/operations/dogpile?status=active`.
    7. `high_value_exports_24h` — `operator_events.event_type = 'peek.export'
       AND created_at > now() - 24h AND (payload->>'resultCount')::int > 1000`,
       drill-down `/audit?eventType=peek.export`.
  - Each metric is shaped as the foundational `PeekMetric` (FR-4 metric
    metadata: stable id, label, value/valueDisplay, unit, source table,
    windowLabel, asOf, definition, freshness, drilldownHref) so the
    metric-strip primitive renders it without component-side branching.
  - `COMMAND_CENTER_DEFAULTS` exposes the thresholds (5m stuck rounds, >3
    settle attempts, 24h export window, >1000-row export threshold) and the
    function accepts a `CommandCenterOptions` argument with `sql`,
    `thresholds`, and `now` overrides so future iteration tests can drive
    deterministic count + asOf assertions and so future tuning does not
    require module edits.
  - All seven queries are bounded (`select count(*)::int as "value"`); no
    row-level data crosses the wire from the command-center query — per-feature
    pages own their drill-down rows.
- Added `PeekCommandCenterAttention` and `PeekCommandCenterAttentionId` view
  models in `peek/src/lib/types/peek.ts` so the command-center page can import
  the typed envelope without leaking server imports.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (115/115, no regressions; command-center query + page tests
  land in iterations 14–15 per the checklist split).
## Iteration 13 — 2026-04-25T11:18:38Z — OK
- **Log**: iteration-013.log

## Iteration 14 — 2026-04-25

- Reshaped `peek/app/page.tsx` into the FR-3 command center while preserving
  the users-first table baseline:
  - **Global search** — separate `<form action="/" method="get" role="search">`
    at the top with a single `name="query"` input. Placeholder advertises the
    cross-entity surface (`user id, username, wallet, referral code, Telegram,
    round PDA, tx signature`) so the input reads as global. Submitting routes
    back to `/?query=…`; the lower filter form carries `query` as a hidden
    field so applying filters preserves the search. The cross-entity resolution
    arrives with the universal-search query functions in the next FR-5
    iteration; routing target stays `/` until then.
  - **Attention queue** — `MetricStrip` renders the seven metrics from
    `getCommandCenterAttention` (failed claims, dead queue events, stuck
    Flip You/Pot Shot rounds, stuck Close Call rounds, pending SOL crate
    payouts, stale active Dogpile events, high-value exports 24h). Each
    metric still carries the FR-4 bookkeeping (definition, source, window,
    "as of", drill-down href) via the iteration-13 query.
  - **Small metric strip** — kept the existing `SummaryStrip` (4 baseline
    metrics: total users, users with codes, referred users, unique referrers)
    so the 303-era summary stays useful and visible.
  - **Recent activity** — new `RecentActivityList` inline component renders
    the latest operator events as a dense list (`time | event_type | actor |
    route + resource`). Empty state is operator-readable ("No recent operator
    activity recorded yet."), error state renders `role="alert"` and
    suppresses the list.
  - **Direct table access** — preserved the existing filter form (sort,
    direction, hasReferrer/hasReferees/hasCode/hasTelegram), pagination, and
    `UsersTable` at the bottom of the page. The data-load error branch only
    affects the Users section now; the attention queue and recent activity
    have their own try/catch boundaries so a failure in one section does not
    blank the others.
- New supporting code:
  - `peek/src/lib/types/peek.ts` — added `PeekRecentActivityItem`
    (`id, eventType, actorEmail, resourceType, resourceId, route, createdAt`).
    Browser-safe; no server imports. The audit-view (`/audit`, later
    iteration) still owns the full bounded audit-table view model.
  - `peek/src/server/db/queries/get-recent-operator-events.ts` — bounded
    query: defaults to 10 rows, hard-capped at `RECENT_OPERATOR_EVENTS_MAX_LIMIT`
    (50). Selects only the columns the activity strip needs
    (`id::text`, `event_type`, `payload->>'actorEmail'`, `payload->>'resourceType'`,
    `payload->>'resourceId'`, `payload->>'route'`, `created_at::text`); does
    not stream JSONB payloads or before/after diffs across the wire. Accepts
    an injectable `Sql` for future tests.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (115/115, no regressions; command-center query + page tests
  land in the next iteration per the checklist split).

## Iteration 14 — 2026-04-25 — OK


## Iteration 14 — 2026-04-25T11:24:49Z — OK
- **Log**: iteration-014.log

## Iteration 15 — 2026-04-25

- Added the FR-3/FR-10 command-center test coverage (query + component) using
  the same SQL-mock pattern that the iteration-12 audit-writer tests
  established, so no live Postgres is required:
  - **Component test** — extracted the previously-inline `RecentActivityList`
    out of `peek/app/page.tsx` into
    `peek/src/components/recent-activity-list.tsx` (browser-safe, no server
    imports). Added `peek/src/components/__tests__/recent-activity-list.test.tsx`
    (4 tests): populated renders one `<li>` per item with time/event-type/actor,
    a `next/link` to the route, and the `resourceType:resourceId` label;
    sparse renders `—` for missing actor and omits the link/resource label;
    empty renders `role="status"` with the operator empty copy; error renders
    `role="alert"` and suppresses both list + status. Updated `app/page.tsx` to
    import the extracted component (no behavior change to the rendered page).
  - **Command-center query test** —
    `peek/src/server/db/queries/__tests__/get-command-center-attention.test.ts`
    (8 tests): populated shapes seven `PeekMetric` rows in id order with FR-4
    bookkeeping (label, source, definition, windowLabel, asOf, freshness,
    drilldownHref) all populated; thousands-separator `valueDisplay`
    formatting; postgres-driver string→number coercion for `count(*)::int`;
    sparse-data path (every query returns `[]`) collapses to zero counts
    without dropping any metric; threshold overrides surface in both the
    `windowLabel` and the `definition` copy (so future tuning shows up in the
    UI); the published `COMMAND_CENTER_DEFAULTS` match what the metrics
    advertise; rejected SQL queries propagate so the page-level try/catch can
    render the alert state; every emitted SQL is a bounded
    `count(*)::int` projection (no row-level data crosses the wire).
  - **Recent operator events query test** —
    `peek/src/server/db/queries/__tests__/get-recent-operator-events.test.ts`
    (8 tests): populated shapes rows into `PeekRecentActivityItem` preserving
    column order; default limit applied via
    `RECENT_OPERATOR_EVENTS_DEFAULT_LIMIT`; oversized limits clamp to
    `RECENT_OPERATOR_EVENTS_MAX_LIMIT` (50); zero/negative clamp up to 1;
    fractional limits floor to integers; empty result returns `[]`; query
    orders by `created_at desc` and projects the activity columns
    (`actorEmail`, `resourceType`, `resourceId`, `route`); rejected queries
    propagate to the caller.
- **Type fix on the production module** — widened
  `CommandCenterThresholds` in `get-command-center-attention.ts` from
  `typeof COMMAND_CENTER_DEFAULTS` (literal types via `as const`) to an explicit
  `{ stuckRoundsAgeMinutes: number; ... }` shape. The original literal type
  prevented `Partial<CommandCenterThresholds>` overrides at call sites
  (typecheck error: `Type '10' is not assignable to type '5'`). Defaults still
  ship the same numeric values, but threshold tuning is now a first-class
  caller-facing override.
- Targeted check (peek): `pnpm lint` ✅, `pnpm typecheck` ✅,
  `pnpm test` ✅ (135/135 — was 115/115, +20 new across 3 new test files).

## Iteration 15 — 2026-04-25 — OK

## Iteration 15 — 2026-04-25T11:30:54Z — OK
- **Log**: iteration-015.log

