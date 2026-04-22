# Specification: [303] Peek Admin

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P2 |
| Track | Extended |
| NR_OF_TRIES | 0 |

---

## Overview

`peek` is a separate internal admin project for inspecting waitlist and referral data without changing the existing public waitlist contract. It is a server-rendered operator app, mounted as its own root-level project/submodule, and reads directly from the shared Postgres database through a small server-side repository layer.

V1 is intentionally read-only and users-first. The main job is to let an operator answer three questions quickly:

1. Who signed up?
2. Who referred whom?
3. Which users are driving referrals?

The first release should optimize for operational clarity, not broad analytics coverage or admin actions.

## User Stories

- As an operator, I want a separate internal project for waitlist/referral inspection so that I can iterate on admin tooling without disturbing the public waitlist app
- As an operator, I want to browse users and referral relationships in one place so that I can understand signup and referral activity quickly
- As an operator, I want raw identifiers and link metadata visible in v1 so that I can answer support and growth questions without opening the database manually
- As an operator, I want the app structure to be ready for future lightweight actions so that read-only v1 does not need a rewrite later

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section 2 "Growth", Section 4 "Off-Chain (backend)", Section 6 "Repo Ownership"
- **Current baseline fit**: Planned
- **Planning bucket**: Extended

## Required Context Files

- `docs/SCOPE.md` — trust boundaries and repo ownership
- `backend/CLAUDE.md` — backend route, DB, and admin conventions
- `waitlist/CLAUDE.md` — waitlist project constraints and deployment expectations
- `backend/migrations/006_player_profiles.sql` — user/profile schema
- `backend/migrations/010_referral.sql` — referral schema
- `backend/migrations/014_telegram_links.sql` — Telegram waitlist/link schema
- `backend/src/db/referrals.ts` — existing referral query patterns
- `backend/src/db/telegram-links.ts` — Telegram link query patterns
- `backend/src/index-waitlist.ts` — current waitlist-only deployment surface

## Contract Files

- `backend/src/__tests__/waitlist-contract.test.ts` — must remain unchanged for v1
- No existing admin contract file; `peek` owns its internal view models and repository contracts

---

## Out of Scope (v1)

- End-user waitlist UI changes
- Public/backend API contract changes for the waitlist app
- KOL rate editing, claim review, or other write actions
- Full analytics/BI dashboards beyond the summary strip and users/referrals views
- Final auth implementation; edge protection and operator auth are handled separately from this spec

---

## Functional Requirements

### FR-1: Separate Internal Project Boundary

`peek` must exist as its own root-level project, intended to live in `peek/` and align with the new `taunt-bet/peek` repository/submodule. It must be an internal operator app, not a hidden section inside the public waitlist app.

**Acceptance Criteria:**
- [ ] `peek/` exists as a separate root project with its own package manifest, runtime, and deployment inputs
- [ ] V1 does not require changes to the public waitlist UI or waitlist client contract
- [ ] The app is server-rendered and keeps database access on the server side only
- [ ] The project boundary is documented so operators understand that `backend/` remains the public/product API surface and `peek/` is internal-only

### FR-2: Direct Database Repository Layer

`peek` must read directly from Postgres through a small server-side repository layer instead of routing reads through the existing backend HTTP surface or embedding SQL in page components.

**Acceptance Criteria:**
- [ ] Database reads are centralized in a repository/data-access layer such as `server/db/**`
- [ ] Page components and route components do not contain inline SQL
- [ ] V1 includes distinct read functions for: summary metrics, paginated/sortable user list, and single-user referral detail
- [ ] Repository outputs are shaped into admin-facing view models before they reach UI components

### FR-3: Users-First Landing Screen

The default screen must be a users-first operational view, not a dashboard-first marketing view. Operators should land on a dense, actionable table with lightweight summary context above it.

**Acceptance Criteria:**
- [ ] The landing page shows a small summary strip containing at least: total users, total users with referral codes, total referred users, and total unique referrers
- [ ] The primary surface is a users table, not a card-only analytics dashboard
- [ ] Each row shows at least: user id, username, wallet, joined timestamp, referral code, inbound referrer, and referee count
- [ ] The table defaults to a practical operator sort order, with joined date and referee count available as explicit sort options

### FR-4: Full Ops-Oriented User Detail

V1 should expose rich internal detail for operators. The app should favor operational visibility over minimal public-facing polish.

**Acceptance Criteria:**
- [ ] The users surface supports search by username, wallet, referral code, or user id
- [ ] The users surface supports filters for at least: has referrer, has referees, has referral code, and Telegram link state
- [ ] Selecting a user reveals or navigates to a detail view containing inbound referral context, outbound referees, and raw link metadata
- [ ] V1 is allowed to show raw internal identifiers and metadata relevant to support/growth workflows, including referral link metadata and Telegram linkage fields when present

### FR-5: Waitlist And Referral Data Coverage

V1 must cover the current waitlist/referral reality rather than an idealized future model. The app should gracefully surface sparse or partial data from the live schema.

**Acceptance Criteria:**
- [ ] V1 reads from the live waitlist/referral sources needed for the screen: `player_profiles`, `referral_codes`, `referral_links`, and Telegram link state data
- [ ] Missing optional records (for example no referral code, no referrer, no Telegram link) are rendered as explicit empty states instead of breaking rows
- [ ] Referrer/referee counts are computed consistently from referral link data, not entered manually
- [ ] The landing screen can answer "who signed up", "who referred whom", and "how many referees each user has" without opening the database manually

### FR-6: Read-Only V1 With Future Mutation Boundary

V1 is read-only, but the project structure must leave a clean place for future lightweight actions such as KOL edits or claim review states.

**Acceptance Criteria:**
- [ ] No write actions are exposed in v1
- [ ] The project includes a reserved server-side boundary for future actions/mutations, even if mostly empty in v1
- [ ] Read concerns and future write concerns are kept separate in the project layout
- [ ] The spec and implementation make it clear that future write actions will require audit logging and stricter auth before release

### FR-7: Internal-Only Operational Safety

Because `peek` reads the database directly and displays sensitive internal data, it must behave like an internal operator tool from day one.

**Acceptance Criteria:**
- [ ] Database credentials remain server-only and are never exposed to browser code
- [ ] `peek` does not rely on `X-Admin-Key`, `X-Admin-Token`, or waitlist-user JWTs for its core data path
- [ ] V1 does not expand the public OpenAPI or waitlist API surface just to power the admin view
- [ ] The app can be deployed independently from the waitlist app without changing waitlist runtime behavior

---

## Success Criteria

- Operators can inspect signups and referral relationships from one internal screen
- Operators can identify each user's referrer and referee count without opening raw SQL consoles
- `peek` launches as a separate internal project without breaking the current waitlist contract
- The project layout is stable enough that future admin actions can be added without restructuring the whole app

---

## Dependencies

- Shared Postgres database with access to waitlist/referral tables
- New `taunt-bet/peek` repository/submodule mounted at `peek/`
- A server-rendered app framework/runtime suitable for internal tools
- Deployment path for a separate internal hostname/app

## Assumptions

- V1 is internal-only and can ship before final auth is implemented
- Operators prefer operational density over a highly polished analytics dashboard
- Direct DB reads are acceptable for v1 because the tool is internal and read-only
- Waitlist/referral schema remains the source of truth for user/referral visibility

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Separate root project exists | Repo inspection | `peek/` project structure in git |
| 2 | DB access is server-only and centralized | Code review + typecheck | Repository layer files and no SQL in page components |
| 3 | Landing page is users-first | Manual UI verification | Screenshot or route review of summary strip + table |
| 4 | Search/filter/sort support exists | Manual verification + focused tests | Tests or route-level evidence covering table state changes |
| 5 | User detail shows referral relationships and raw metadata | Manual verification | Detail view evidence against seeded/live-like data |
| 6 | Waitlist contract remains untouched | Contract review | No changes required in `backend/src/__tests__/waitlist-contract.test.ts` for v1 |
| 7 | V1 remains read-only | Code review | No mutation endpoints/actions wired to UI |

---

## Completion Signal

### Implementation Checklist
- [ ] Add `peek/` as a separate root-level project/submodule
- [ ] Scaffold the server-rendered internal app and basic project structure
- [ ] Add server-side DB configuration and repository layer
- [ ] Implement summary query, users list query, and user detail query
- [ ] Build the users-first landing page with summary strip and dense table
- [ ] Add search, filters, sorting, and detail drill-in
- [ ] Document required env/config for local and deployed operation
- [ ] [test] Add focused automated coverage for the repository layer and key rendered states
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is included, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Integration Verification
- [ ] Internal app routes render correctly against local/seeded data
- [ ] Repository query contracts and admin view models are documented
- [ ] Waitlist/public API behavior remains unchanged by the `peek` implementation

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis 303 --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/303-peek-admin/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
