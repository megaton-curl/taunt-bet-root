# Specification: [406] Unified Crate Claim

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Economy |
| NR_OF_TRIES | 0 |
| Supersedes | Auto-delivery semantics in spec 400 FR-5; per-source player crate endpoints in spec 402 |
| Authors | (assigned at refine time) |

---

## Overview

Collapse all crate sources (daily, challenge, completion-bonus) into **one player-facing API**: a single inventory, a single history, a single open endpoint. The data still lives in two tables (`daily_crate_rewards` and `crate_drops`), but the player and the FE see one uniform crate object.

The previous shape — separate `POST /crates/daily/claim`, `POST /crates/drops/:dropId/claim`, `GET /crates/daily/pending`, `GET /crates/mine` — is replaced by:

```
GET  /crates/inventory                — unopened crates, contents masked
GET  /crates/history                  — opened crates (in-flight + terminal), contents shown
GET  /crates/:crateId                 — single crate detail (deep-link / share / revisit)
POST /crates/:crateId/open            — open a crate (any source)
```

A `crateId` is a self-contained routing key:

- `daily:<dayId>` for `daily_crate_rewards` rows — e.g. `daily:2024-03-04`
- `drop:<dropId>` for `crate_drops` rows — e.g. `drop:99`

The prefix identifies the source table and dispatches the open call; the suffix is the natural key for that source. The player can have multiple unopened daily crates (one per backlog day) and multiple unopened drops at the same time.

Also changed from the spec-400 baseline: challenge/bonus crates no longer auto-deliver. The `crate-drop` queue handler **freezes** the rolled outcome into `crate_drops.status='awaiting_open'` and emits no delivery event. Delivery is gated by `POST /crates/:crateId/open`.

### Non-goals

- **No table consolidation.** Two backing tables remain — dispatch happens in the unified route module.
- **No change to daily-crate materialization or fairness** (spec 402 nightly compute is unchanged).
- **No change to the on-chain SOL payout handler** — `crate-sol-payout.ts` legacy crate_drops branch keeps its `pending → granted/failed` transitions.
- **No publicly-verifiable fairness for challenge crates** in this spec. They use `Math.random()` frozen at handler time; a follow-on can add committed-blockhash seeding.
- **Frontend is out of scope.** API contracts only; webapp migration is a separate FE MR.

### Design principles

1. **One crate object, many sources.** The FE treats every crate as `{ crateId, source, state, status, ... }`. Routing happens on `crateId`, not source.
2. **Contents hidden until opened.** Inventory and the single-crate endpoint (for unopened rows) omit `crateType`, `contentsAmount`, and any reward-hash-equivalent. They land in the open response and in history.
3. **Pool reservation moves to open time.** Challenge SOL crates no longer reserve at roll time. Matches daily semantics.
4. **Additive migration only.** Schema changes expand the `crate_drops` status enum and add nullable columns; existing rows are not reshaped.
5. **Breaking the public API is acceptable here.** The current per-source endpoints have no internal consumers beyond the webapp; we set the direction and the FE migrates.

---

## User Stories

- As a player, I want one inventory page showing every unopened crate I have, regardless of where it came from.
- As a player, I want to click "open" on each crate individually and see its contents revealed in the response.
- As a player, I want to revisit a crate I opened earlier (deep-link or share), and the page should show the current delivery state.
- As a player who's been offline, I want all my backlog daily crates plus any challenge crates available together, each openable independently.
- As an operator, I want challenge-earned SOL crates to follow the same pool-gate / payout-queue pipeline as daily SOL crates.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: "Loot crates" — unified player-facing model across all sources.
- **Replaces**: spec 400 FR-5 auto-delivery for challenge/bonus; spec 402 FR-6/FR-8 player-facing daily endpoints (`/crates/daily/claim`, `/crates/daily/pending`); and `GET /crates/mine`. The underlying `daily_crate_rewards`, `crate_drops`, `CRATE_SOL_PAYOUT` event, `crate-sol-payout` handler, peek admin views, and public fairness proof endpoints (`/crates/daily/configs/:version`, `/crates/daily/rewards/:rewardId/verify`, `/crates/daily/today`) are unchanged.
- **Reuses**: spec 307 payout gate (`evaluateGate`, `payout_attempts`), the daily-crate-payout service (and a sibling for crate_drops).

---

## Required Context Files

- `backend/migrations/011_challenge_engine.sql` lines 128–142 — current `crate_drops` schema
- `backend/migrations/032_daily_crate.sql` — daily-crate schema and status enum
- `backend/src/queue/handlers/crate-drop.ts` — handler refactored to freeze, not deliver
- `backend/src/queue/handlers/crate-sol-payout.ts` lines 42–76 — legacy branch we keep compatible
- `backend/src/services/daily-crate-payout.ts` — gate ritual to mirror
- `docs/specs/402-daily-crate/spec.md` — daily semantics this spec absorbs into a unified surface

---

## Contract Files

- `backend/src/contracts/crates.ts` — shared types: `CrateSource`, `CrateInventoryItem`, `CrateHistoryItem`, `CrateDetail`, `CrateOpenResponse`, `CratePublicStatus`, plus `formatCrateId` / `parseCrateId` helpers.
- `backend/src/contracts/api-errors.ts` — adds `CRATE_NOT_FOUND`, `CRATE_NOT_OPENABLE`, `INVALID_CRATE_ID`.
- `backend/src/routes/crates.ts` — **new** unified module implementing all four endpoints.

The following are deleted:
- `backend/src/routes/crates-drops.ts`
- `backend/src/routes/crates-inventory.ts`
- `createCrateRoutes` export from `backend/src/routes/points.ts` (and the `GET /crates/mine` handler).
- The `/pending` and `/claim` routes from `backend/src/routes/crates-daily.ts` (keeping `today`, `configs/:version`, `rewards/:rewardId/verify`).

---

## System Invariants

1. **One open per crate.** The open handler locks the source row with `FOR UPDATE`; non-`unopened` repeats return the persisted post-open state without re-emitting events.
2. **No pool decrement before open.** `crate-drop` handler never touches `reward_pool`; reservation is exclusive to the open transaction.
3. **Contents masked pre-open.** Inventory items and `/crates/:crateId` GETs for unopened rows omit `crateType`, `contentsAmount`, and any reward-hash-equivalent.
4. **`crateId` round-trip.** `parseCrateId(formatCrateId(source, suffix)) === { source, suffix }` for every valid pair; invalid prefixes or suffixes return a 400 `INVALID_CRATE_ID`.
5. **Backward-compat at the DB level.** Existing `crate_drops.status='pending'` rows from before deploy keep draining via the unchanged `crate-sol-payout` legacy branch.
6. **Wallet-mismatch is masked as 404.** A drop owned by user B, looked up by user A, returns `CRATE_NOT_FOUND`, not 403. No existence leak.

---

## Functional Requirements

### FR-1: Schema additions (additive migration)

Migration `036_crate_open.sql` (already shipped) added the `'awaiting_open'`, `'awaiting_funds'`, and `'held'` statuses to `crate_drops.status_check`, plus nullable `opened_at` and `hold_reason` columns and a partial index on `(user_id, created_at DESC) WHERE status='awaiting_open'`. Plus a `payout_controls` seed row for `claim_kind='crate_drop_sol'`.

**Acceptance Criteria:**
- [ ] Migration applied; CHECK accepts new statuses.
- [ ] Existing rows unchanged.
- [ ] `payout_controls` row exists for `crate_drop_sol`.

### FR-2: Crate-drop handler — roll and freeze

`crate-drop.ts` rolls outcomes using the existing distribution but:

- Inserts `crate_drops` with `status='awaiting_open'`.
- Does **not** decrement `reward_pool` at roll time.
- Does **not** emit `POINTS_GRANT` or `CRATE_SOL_PAYOUT`.
- Suppresses the row entirely (no insert) when the candidate SOL `payoutLamports < sol_crate_min_value` — preserves "no row visible to player" parity.

**Acceptance Criteria:**
- [ ] Rows insert with `status='awaiting_open'`.
- [ ] No `event_queue` rows produced.
- [ ] Pool balance unchanged at roll time.
- [ ] Idempotency on duplicate `(user_id, trigger_type, trigger_id)`.

### FR-3: `crateId` encoding

Single canonical format: `<source>:<suffix>`.

- `source` ∈ `{ daily, drop }`.
- For `daily`, suffix is a `YYYY-MM-DD` string (the `dayId`).
- For `drop`, suffix is a positive integer string (the `crate_drops.id`).

Helpers in `backend/src/contracts/crates.ts`:

```ts
export type CrateSource = "daily" | "challenge" | "bonus";
export type CrateIdSource = "daily" | "drop";

export function formatCrateId(source: CrateIdSource, suffix: string): string;
export function parseCrateId(crateId: string):
  | { source: "daily"; dayId: string }
  | { source: "drop";  dropId: string }
  | null;
```

The public `CrateSource` (returned in API bodies) distinguishes `challenge` vs `bonus` for drops based on `trigger_type`; the `crateId` prefix only encodes table source (`daily` vs `drop`) because the open dispatch doesn't need finer granularity.

**Acceptance Criteria:**
- [ ] `formatCrateId('daily', '2024-03-04')` → `'daily:2024-03-04'`.
- [ ] `formatCrateId('drop', '42')` → `'drop:42'`.
- [ ] `parseCrateId('daily:2024-03-04')` → `{ source: 'daily', dayId: '2024-03-04' }`.
- [ ] `parseCrateId('drop:42')` → `{ source: 'drop', dropId: '42' }`.
- [ ] `parseCrateId('foo:bar')`, `'daily:not-a-date'`, `'drop:abc'`, `''` → `null`.

### FR-4: Unified public status enum

API responses use a small, source-agnostic status vocabulary:

| Public status | Internal (daily) | Internal (drops) | Meaning |
|---|---|---|---|
| `awaiting_open` | `earned` | `awaiting_open` | Unopened; player hasn't clicked yet |
| `pending` | `grant_queued`, `payout_queued`, `held` | `pending`, `held` | Post-open, delivery in flight |
| `awaiting_funds` | `awaiting_funds` | `awaiting_funds` | Post-open, waiting for pool refill |
| `granted` | `granted` | `granted` | Terminal success |
| `failed` | `failed`, `rejected` | `failed` | Terminal failure |

`held` is masked to `pending` for the player (matches spec 402 daily behaviour). The terminal `rejected` (daily-only) is masked to `failed`.

**Acceptance Criteria:**
- [ ] Every internal status maps to exactly one public status.
- [ ] `held` → `pending`.
- [ ] `rejected` → `failed`.
- [ ] Unit tests cover every mapping cell.

### FR-5: `GET /crates/inventory` — unopened crates

Player-initiated paginated list of unopened crates from both sources, contents masked.

- **Auth:** required.
- **Query:** `cursor` (ISO timestamp), `limit` (1–50, default 20), `source` (optional: `daily | drop | all`, default `all`).
- **Response:**

```ts
type CrateInventoryItem = {
  crateId: string;
  source: 'daily' | 'challenge' | 'bonus';
  state: 'unopened';
  status: 'awaiting_open';
  createdAt: string;
  rarityHint: 'common' | 'rare' | 'epic' | null;
};
type CrateInventoryResponse = { items: CrateInventoryItem[]; nextCursor: string | null };
```

Items from both source tables, sorted by `created_at DESC`. `rarityHint` is derived from `daily_crate_rewards.tier` for daily rows; `null` for drops (no tier concept yet).

**Acceptance Criteria:**
- [ ] Returns unopened daily AND drop rows mixed in `createdAt DESC`.
- [ ] Multiple backlog daily crates (different `day_id`) all appear.
- [ ] No `crateType`, `contentsAmount`, or other contents fields in the response.
- [ ] `source=daily` filters to daily only; `source=drop` filters to drops only.
- [ ] Pagination cursor walks pages without dupes/skips.
- [ ] 401 without auth.

### FR-6: `GET /crates/history` — opened crates

Player-initiated paginated list of post-open crates (in-flight + terminal), with contents revealed.

- **Auth:** required.
- **Query:** `cursor` (ISO timestamp), `limit` (1–50, default 20), `source` (`daily | drop | all`, default `all`), `status` (optional: any public status except `awaiting_open`).
- **Response:**

```ts
type CrateHistoryItem = {
  crateId: string;
  source: 'daily' | 'challenge' | 'bonus';
  state: 'opened';
  status: 'pending' | 'awaiting_funds' | 'granted' | 'failed';
  crateType: 'points' | 'sol';
  contentsAmount: string;
  createdAt: string;
  openedAt: string;
  grantedAt: string | null;
};
type CrateHistoryResponse = { items: CrateHistoryItem[]; nextCursor: string | null };
```

The cursor key is `openedAt DESC` (or `created_at` fallback for legacy rows pre-spec-406 that lack `opened_at`).

**Acceptance Criteria:**
- [ ] Returns only rows with internal status NOT in `{ earned, awaiting_open }`.
- [ ] Combines daily and drop sources by default.
- [ ] Contents fields populated.
- [ ] `source` and `status` filters work.
- [ ] Pagination consistent across pages.
- [ ] 401 without auth.

### FR-7: `GET /crates/:crateId` — single crate detail

Lookup a specific crate by its `crateId`. Returns the full state object including current status and (for opened crates) contents.

- **Auth:** required.
- **Errors:** `400 INVALID_CRATE_ID` (parse failure), `404 CRATE_NOT_FOUND` (missing OR owned by another user), `401 AUTH_REQUIRED`.
- **Response:**

```ts
type CrateDetail =
  | {
      crateId: string;
      source: 'daily' | 'challenge' | 'bonus';
      state: 'unopened';
      status: 'awaiting_open';
      createdAt: string;
      rarityHint: 'common' | 'rare' | 'epic' | null;
    }
  | {
      crateId: string;
      source: 'daily' | 'challenge' | 'bonus';
      state: 'opened';
      status: 'pending' | 'awaiting_funds' | 'granted' | 'failed';
      crateType: 'points' | 'sol';
      contentsAmount: string;
      createdAt: string;
      openedAt: string;
      grantedAt: string | null;
    };
```

**Acceptance Criteria:**
- [ ] Returns unopened detail with masked contents for `awaiting_open` rows.
- [ ] Returns opened detail with revealed contents for post-open rows.
- [ ] Invalid `crateId` format → 400.
- [ ] Unknown id OR cross-user lookup → 404 (no existence leak).
- [ ] 401 without auth.

### FR-8: `POST /crates/:crateId/open` — open a crate

Single open endpoint. Internally dispatches on `parseCrateId(crateId).source`.

- **Auth:** required.
- **Errors:** `400 INVALID_CRATE_ID`, `404 CRATE_NOT_FOUND`, `409 CRATE_NOT_OPENABLE` (extra-safety; replay returns 200 with persisted state, not this code), `401`, `425 DAILY_CRATE_NOT_READY` (daily only; run not finished), `503 DAILY_CRATE_RUN_FAILED` (daily only).
- **Response (200):**

```ts
type CrateOpenResponse = {
  crateId: string;
  source: 'daily' | 'challenge' | 'bonus';
  state: 'opened';
  status: 'pending' | 'awaiting_funds' | 'granted' | 'failed';
  crateType: 'points' | 'sol';
  contentsAmount: string;
  openedAt: string;
};
```

**Daily dispatch:** parses `dayId`, runs the existing daily-claim transactional sequence (lock row, gate, reserve, emit event). Replay on non-`earned` returns 200 with persisted state.

**Drop dispatch:** parses `dropId`, runs the equivalent transactional sequence on `crate_drops` (lock row, points → `granted` + `POINTS_GRANT`; sol → gate, reserve, emit `crate.sol_payout` with `source='crate_drop'`). Replay on non-`awaiting_open` returns 200 with persisted state.

**Acceptance Criteria:**
- [ ] `crateId=daily:<dayId>` opens that daily row; same transitions as the old `/crates/daily/claim`.
- [ ] `crateId=drop:<dropId>` opens that drop row.
- [ ] Replay returns 200 with persisted state and no new event.
- [ ] Wallet-mismatch returns 404.
- [ ] Invalid `crateId` returns 400.
- [ ] Future `dayId` returns `INVALID_DAY_ID` (existing 400 contract).

### FR-9: Pool retry tail — challenge SOL `awaiting_funds`

The existing daily-crate retry tail (`payPendingDailyCrateSolRewards`) is paired with a new `payPendingCrateDropSolRewards` that drains `crate_drops.status='awaiting_funds'` rows after each successful `reward.pool_fund`. Both run after the funding transaction commits, FIFO by `opened_at`, with opportunistic-no-FIFO guards.

**Acceptance Criteria:**
- [ ] Funding the pool drains both sources' `awaiting_funds` rows.
- [ ] Independent error containment: a row failure in one source doesn't block the other.

### FR-10: OpenAPI contract

All four player endpoints have OpenAPI route modules. The three daily-specific public endpoints (`/crates/daily/today`, `/configs/:version`, `/rewards/:rewardId/verify`) remain documented in their existing module. Contract test mounts the new unified module.

**Acceptance Criteria:**
- [ ] OpenAPI auto-spec includes the four unified paths.
- [ ] Old paths (`/crates/daily/claim`, `/crates/daily/pending`, `/crates/mine`, `/crates/drops/:dropId/claim`) are absent.
- [ ] `backend/src/__tests__/openapi-contract.test.ts` passes.

---

## Success Criteria

- The FE consumes one set of endpoints regardless of crate source.
- A player with backlog (multiple unopened daily crates plus drops) sees all of them in `/crates/inventory`.
- Network responses for inventory items never contain `crateType` or `contentsAmount` — those only appear in the open response, history, or `GET /crates/:crateId` for opened rows.
- Reward pool is never decremented from an un-opened roll.
- `./scripts/verify --ts` exit 0.

## Dependencies

- Spec 307 payout gate.
- Spec 402 daily-crate plumbing (compute, payout service).
- Existing `crate-sol-payout.ts` legacy branch (unchanged).
- Existing `reward-pool-fund.ts` (retry tail extended).

## Assumptions

- The webapp will migrate to the unified endpoints in a follow-on FE MR. The migration window is short and we accept the breakage; no compatibility shim is provided.
- `Math.random()` fairness for challenge crates is acceptable for v1.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---|---|---|
| 1 | crate-drop handler freezes without delivery | Vitest in `crate-drop-handler.test.ts` | `status='awaiting_open'`, 0 events, pool unchanged |
| 2 | `crateId` encoding round-trips | Unit test on `parseCrateId`/`formatCrateId` | Cover daily, drop, invalid prefixes, invalid suffix |
| 3 | Inventory returns multi-backlog daily + drops mixed | Integration test | 3 daily different dayIds + 2 drops; all 5 appear, sorted DESC |
| 4 | Inventory masks contents | Same test | No `crateType` / `contentsAmount` keys |
| 5 | History returns post-open rows with contents | Integration test | Mixed daily granted + drop pending; contents present |
| 6 | Single crate detail (unopened) masks contents | Integration test | GET on `awaiting_open` daily and drop |
| 7 | Single crate detail (opened) reveals contents | Integration test | GET on `granted` daily and `pending` drop |
| 8 | Open daily by crateId works | Integration test | `daily:<dayId>` opens daily row; one event emitted |
| 9 | Open drop by crateId works | Integration test | `drop:<id>` opens drop row; one event emitted |
| 10 | Replay returns 200 with no new event | Integration test | Two open calls, single event in `event_queue` |
| 11 | Wallet-mismatch returns 404 | Integration test | User B opens a crate of user A |
| 12 | Invalid crateId returns 400 | Integration test | `foo:bar`, `daily:abc`, `drop:zzz` |
| 13 | SOL gate / pool / queue parity for drops | Integration test | Held, awaiting_funds, queued paths |
| 14 | Pool funding drains both sources' awaiting_funds | Integration test | Insert one of each, fund, both → pending |
| 15 | OpenAPI spec has the four unified paths | Contract test | Spot-check paths absent and present |

---

## Completion Signal

### Implementation Checklist

- [x] Migration `036_crate_open.sql` (shipped previously).
- [x] `crate-drop.ts` refactor (shipped previously; semantic preserved).
- [x] `crate-drop-payout.ts` service (shipped previously).
- [x] `reward-pool-fund.ts` retry tail extension (shipped previously).
- [ ] `crateId` encoding helpers in `contracts/crates.ts`.
- [ ] Unified public status mapping in `contracts/crates.ts`.
- [ ] New `routes/crates.ts` with the four endpoints.
- [ ] Delete `routes/crates-drops.ts`, `routes/crates-inventory.ts`.
- [ ] Trim `routes/crates-daily.ts` to `today` + `configs/:version` + `rewards/:rewardId/verify`.
- [ ] Remove `createCrateRoutes` from `routes/points.ts`.
- [ ] Update `src/index.ts` mounts.
- [ ] Add `INVALID_CRATE_ID` to `contracts/api-errors.ts`.
- [ ] Delete `crates-drops-claim.test.ts`, `crates-inventory.test.ts`.
- [ ] Add `crates-unified.test.ts` covering inventory/history/detail/open (rows 3–14).
- [ ] Update `crates-daily-claim.test.ts` for the trimmed module (or rename).
- [ ] Update `points-and-crates-routes.test.ts` removing `/crates/mine` cases.
- [ ] Update `openapi-contract.test.ts` to mount the unified module.
- [ ] `cd backend && pnpm verify`.
- [ ] [test] N/A `e2e/local/**` — backend contract change only.
- [ ] [test] N/A `e2e/visual/**` — no UI.
- [ ] [test] N/A `e2e/devnet/**` — no chain integration changes.

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

---

## Future Work

- **Verifiable challenge-crate fairness.** Replace `Math.random()` with deterministic hashing seeded by a committed blockhash at challenge-completion time, mirroring daily.
- **Bulk open.** A future endpoint or batched open RPC for players returning with large backlogs.
- **Table consolidation.** A single `user_crates` inventory table is conceivable but not currently justified.
