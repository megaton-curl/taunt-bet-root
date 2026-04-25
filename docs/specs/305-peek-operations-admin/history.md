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

