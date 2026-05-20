# Specification: [406] Unified Crate Claim

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Economy |
| NR_OF_TRIES | 0 |
| Supersedes | Auto-delivery semantics in spec 400 FR-5 (`crate_drops` for challenge/bonus crates) |
| Authors | (assigned at refine time) |

---

## Overview

Bring **all** crates — daily (spec 402) and challenge/bonus (spec 400) — under the same player-initiated **claim/open** model and the same **contents-masked-until-opened** API contract.

Today the two crate sources behave differently:

- **Daily crates** (`daily_crate_rewards`) require a manual `POST /crates/daily/claim` to deliver. The endpoint exists; the chest animation in the webapp wraps that HTTP call. ✅
- **Challenge / completion-bonus crates** (`crate_drops`) **auto-deliver**: the `crate-drop` handler rolls and immediately emits `POINTS_GRANT` / `CRATE_SOL_PAYOUT` in the same transaction that inserts the row. There is no manual player action. ❌
- **List responses** (`GET /crates/daily/pending`, `GET /crates/mine`) **leak the contents** (`crate_type`, `contents_amount`) before the player opens the crate. ❌

This spec makes the challenge/bonus path mirror the daily path:

1. `crate-drop` handler **rolls and freezes** the outcome into `crate_drops` with a new `'awaiting_open'` status. It does **not** emit any delivery event and does **not** decrement `reward_pool` at this stage.
2. A new player endpoint `POST /crates/drops/:dropId/claim` performs the same gate / reservation / event-emit sequence that `POST /crates/daily/claim` already does.
3. All pre-open list responses are reshaped to **mask contents** (`crateType` / `contentsAmount` / `rewardHash` removed from list rows; revealed only in the response body of the claim/open call itself).
4. A unified `GET /crates/inventory` returns the player's unopened crates from both sources in one paginated list, so the webapp has a single inventory model to render.

### Non-goals

- **No table consolidation.** `daily_crate_rewards` and `crate_drops` remain separate. This avoids a risky prod migration and respects "production data safety is non-negotiable" (CLAUDE.md). Endpoint logic dispatches on source.
- **No change to daily-crate fairness or materialization** (spec 402 is unchanged).
- **No change to the on-chain SOL payout path** — `crate-sol-payout.ts` legacy `crate_drops` branch keeps its `'pending' → 'granted' / 'failed'` transitions unchanged. The new `'awaiting_open'` state sits *before* what the payout handler sees.
- **No publicly-verifiable fairness commitment for challenge crates** in this spec. Challenge crates continue to use `Math.random()` for the roll, frozen at handler time. A follow-on spec can introduce a committed-blockhash seed if needed (see "Future Work").
- **Frontend is out of scope.** This spec defines API contracts only; the webapp team consumes them.

### Design Principles

1. **One claim model, two backing tables.** Both `POST /crates/daily/claim` (existing) and `POST /crates/drops/:dropId/claim` (new) take a player action and emit the same downstream delivery events (`POINTS_GRANT` or `CRATE_SOL_PAYOUT`).
2. **Contents hidden until claim response.** List/inventory endpoints expose only `{ id, source, status, createdAt, rarityHint? }`. Contents land in the claim/open response.
3. **Pool reservation moves to open time.** For challenge SOL crates, the reward pool is reserved when the player opens, not when the roll fires. This matches the daily-crate gate semantics and prevents pool depletion by un-opened rolls.
4. **Additive migration only.** Schema changes are additive (new status enum value, new nullable columns). Existing `'pending'` rows are not retroactively reshaped.

---

## User Stories

- As a player, I want to manually click "open" on every crate I earn — daily or challenge — so opening always feels like a deliberate action.
- As a player, I want the crate's contents to remain hidden until I open it, so the reveal animation actually reveals something.
- As a player, I want a single inventory of all my unopened crates so I don't have to check multiple pages.
- As an operator, I want challenge-earned SOL crates to follow the same pool-gate / payout-queue pipeline as daily SOL crates, so all SOL payouts share one observability surface.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section "Loot crates" — extends the daily-crate manual-claim model to all crate sources.
- **Supersedes**: spec 400 FR-5 auto-delivery semantics for `trigger_type IN ('challenge_completed', 'bonus_completed')`. The `crate_drops` table itself, `CRATE_SOL_PAYOUT` event, and `crate-sol-payout` handler are reused.
- **Reuses**: spec 307 payout gate (`evaluateGate` / `payout_attempts` idempotency), spec 402 daily-crate-payout service (`gateAndQueueDailyCrateSolPayout`'s shape — a sibling function will be added for the `crate_drops` source).
- **Current baseline**: Auto-delivery is shipped in dev; daily-claim is shipped in dev. This spec is behavior-changing for the challenge/bonus path.

---

## Required Context Files

Read before implementation:

- `backend/migrations/011_challenge_engine.sql` lines 128–142 — current `crate_drops` schema
- `backend/migrations/032_daily_crate.sql` — daily-crate schema (reference for status enum and column patterns)
- `backend/src/queue/handlers/crate-drop.ts` — handler to refactor
- `backend/src/queue/handlers/crate-sol-payout.ts` lines 42–76 — legacy crate_drops branch that must stay compatible
- `backend/src/routes/crates-daily.ts` lines 683–899 — existing daily claim endpoint (the reference design)
- `backend/src/services/daily-crate-payout.ts` — `gateAndQueueDailyCrateSolPayout` (the gate ritual to mirror)
- `backend/src/routes/points.ts` lines 310–367 — existing `GET /crates/mine` (legacy history; not deleted)
- `backend/src/queue/handlers/challenge-progress.ts` lines 124–152 — `emitChallengeReward` (emits `CRATE_DROP` events; unchanged)
- `docs/specs/402-daily-crate/spec.md` — daily-crate FR-6/FR-7 semantics this spec mirrors

---

## Contract Files

- `backend/src/contracts/crates.ts` — **new** shared contract module: `CrateSource`, `CrateInventoryItem`, `CrateOpenResponse`, status enums.
- `backend/src/contracts/api-errors.ts` — extend with `CRATE_NOT_OPENABLE` (current status disallows open), `CRATE_NOT_FOUND`.
- `backend/src/routes/crates-drops.ts` — **new** route module: `POST /crates/drops/:dropId/claim`.
- `backend/src/routes/crates-inventory.ts` — **new** route module: `GET /crates/inventory`.

---

## System Invariants

1. **One open per crate.** A `crate_drops` row in `'awaiting_open'` transitions atomically (with `FOR UPDATE`) on the first successful claim call. Repeat claims return the persisted post-open state without re-emitting events.
2. **No pool decrement before open.** `crate-drop` handler never touches `reward_pool`. The pool is reserved exclusively at open time, inside the claim transaction, using `lockAndReadRewardPool` (existing helper).
3. **Contents masked pre-open.** Any list/inventory response MUST omit `crateType`, `contentsAmount`, and any reward-hash-equivalent for rows in `'awaiting_open'` status. The masking applies to both `crate_drops` and `daily_crate_rewards` rows in their respective list endpoints.
4. **Backward compatibility of `'pending'`.** Rows already in `crate_drops.status='pending'` at deploy time keep their existing semantics — they will be drained by the existing `crate-sol-payout` handler (SOL crates) or were already grant-effective (points crates). No retroactive update.
5. **Source-of-truth for inventory.** `GET /crates/inventory` is the only endpoint that joins both tables. Per-source endpoints (`/crates/daily/pending`, `/crates/mine`) keep their current shapes minus the masked fields.
6. **Idempotent claim.** The new `POST /crates/drops/:dropId/claim` is idempotent in the same way as `POST /crates/daily/claim`: replay on a non-`awaiting_open` row returns the persisted outcome and emits no event.

---

## Functional Requirements

### FR-1: Schema additions (additive migration)

A new migration adds the `'awaiting_open'`, `'awaiting_funds'`, and `'held'` statuses to `crate_drops.status_check`, plus nullable `opened_at` and `hold_reason` columns. No existing data is rewritten.

```sql
-- backend/migrations/0NN_crate_open.sql

ALTER TABLE crate_drops DROP CONSTRAINT crate_drops_status_check;
ALTER TABLE crate_drops ADD CONSTRAINT crate_drops_status_check
  CHECK (status IN ('awaiting_open', 'pending', 'awaiting_funds', 'held', 'granted', 'failed'));

ALTER TABLE crate_drops
  ADD COLUMN opened_at TIMESTAMPTZ,
  ADD COLUMN hold_reason TEXT
    CHECK (hold_reason IS NULL OR hold_reason IN ('global_pause','above_threshold','fraud_flag','manual_hold'));

-- Partial index to drive the inventory query
CREATE INDEX idx_crate_drops_user_awaiting_open
  ON crate_drops (user_id, created_at DESC)
  WHERE status = 'awaiting_open';
```

**Acceptance Criteria:**
- [ ] Migration file exists under `backend/migrations/` with the next sequential prefix.
- [ ] After running migrations, `crate_drops` accepts INSERTs with `status='awaiting_open'`.
- [ ] Existing `'pending'` rows remain valid (CHECK constraint passes).
- [ ] `idx_crate_drops_user_awaiting_open` is created and used by the inventory query (verified via EXPLAIN in a test).

### FR-2: Crate-drop handler — roll and freeze, no auto-deliver

The `crate-drop` queue handler is refactored to:

1. Roll the same `Math.random()`-driven outcome as today (preserves current odds and distributions).
2. Insert the `crate_drops` row with `status='awaiting_open'` (instead of relying on the column default).
3. **Not** decrement `reward_pool`.
4. **Not** emit `POINTS_GRANT` or `CRATE_SOL_PAYOUT`.
5. Log the roll outcome (preserve current observability).

The SOL-crate suppression rule ("suppress if `payoutLamports < solMinValue`") moves to open time — at roll time we still compute the candidate `payoutLamports` (so the row carries a frozen contents amount), but a payout that would have been suppressed under current rules now lands as a row with `crate_type='sol'` and a frozen amount, and the player will hit `awaiting_funds` / pool gate at open. **This is a semantic change** and is intentional: the current "wasted roll" path is replaced by deferred reservation. If we want to preserve "no row when amount < min", we instead skip insertion entirely; the spec chooses **skip insertion** (no row, no inventory item) to keep parity with current player visibility.

**Acceptance Criteria:**
- [ ] `crate-drop` handler inserts rows with `status='awaiting_open'`.
- [ ] `crate-drop` handler does not call `decrementRewardPool` (deleted from this code path).
- [ ] `crate-drop` handler does not call `emitEvent(POINTS_GRANT|CRATE_SOL_PAYOUT)`.
- [ ] If `payoutLamports < solMinValue`, no row is inserted (parity with current "suppressed" behavior).
- [ ] Existing handler tests are updated: where they previously asserted "event emitted" they now assert "row inserted in awaiting_open + no event emitted".
- [ ] Idempotency guard (`UNIQUE(user_id, trigger_type, trigger_id)`) still works; duplicate events do not insert a second row.

### FR-3: `POST /crates/drops/:dropId/claim` — manual open endpoint

A new authenticated player endpoint mirrors `POST /crates/daily/claim`:

- **Path:** `POST /crates/drops/:dropId/claim`
- **Auth:** required (JWT)
- **Request body:** none (the `:dropId` path param identifies the row)
- **Response (200):** `{ ok: true, data: CrateOpenResponse }`
- **Errors:** `401 AUTH_REQUIRED`, `403` (wallet mismatch — drop's `user_id` ≠ caller), `404 CRATE_NOT_FOUND`, `409 CRATE_NOT_OPENABLE` (status not `awaiting_open` on first call only; replay returns 200 with persisted state), `5xx` for handled failures.

Transactional sequence inside the handler (locked via `SELECT ... FOR UPDATE`):

1. Load `crate_drops` row; 404 if missing.
2. Verify `user_id === caller.userId`; 403 otherwise.
3. If `status !== 'awaiting_open'`, this is a replay — return the persisted contents and current `status` with no event emit (idempotency).
4. Resolve canonical `wallet` from `getProfileByUserId(userId)`.
5. **If `crate_type='points'`:** set `status='granted'`, `opened_at=now()`, `granted_at=now()`; emit `POINTS_GRANT` with `sourceType='crate_points'`, `sourceId='crate-{dropId}'`, `amount=contents_amount`.
6. **If `crate_type='sol'`:** run the gate (mirrored from `gateAndQueueDailyCrateSolPayout`):
   - Evaluate spec-307 gate via `evaluateGate`. If held → `status='held'`, `hold_reason=...`, `opened_at=now()`.
   - Otherwise `lockAndReadRewardPool` + `decrementRewardPool`. If `balance < contents_amount` → `status='awaiting_funds'`, `opened_at=now()` (no pool change); else `status='pending'`, `opened_at=now()`, emit `CRATE_SOL_PAYOUT` with the existing payload shape so `crate-sol-payout.ts` legacy branch handles it unchanged.
7. Return `CrateOpenResponse`.

Response shape:

```ts
type CrateOpenResponse = {
  dropId: string;
  source: 'challenge' | 'bonus';        // mapped from trigger_type
  crateType: 'points' | 'sol';
  contentsAmount: string;               // lamports as string
  status: 'granted' | 'pending' | 'awaiting_funds' | 'held';
  openedAt: string;                     // ISO timestamp
};
```

For replays (`status` was already non-`awaiting_open`), the response includes the persisted `openedAt` and the persisted terminal/in-flight status.

**Acceptance Criteria:**
- [ ] Endpoint registered with OpenAPI route definition.
- [ ] Wallet mismatch returns 403, not 404.
- [ ] Missing crate returns 404.
- [ ] First claim on `awaiting_open` row: row updates and event is emitted (one row in `event_queue`).
- [ ] Replay (second call): row state unchanged; no new event in `event_queue`; response shape identical.
- [ ] SOL gate held: row has `status='held'`, `hold_reason` set, no pool decrement, no event emitted.
- [ ] SOL pool insufficient: row has `status='awaiting_funds'`, no pool decrement, no event emitted.
- [ ] SOL queued: pool decremented atomically, row has `status='pending'`, exactly one `CRATE_SOL_PAYOUT` event in `event_queue`.
- [ ] Points crate: row goes directly to `'granted'`, one `POINTS_GRANT` event emitted.
- [ ] Existing `crate-sol-payout.ts` handler picks up the new `'pending'` rows without code changes (regression test).

### FR-4: Pool retry tail — challenge SOL `awaiting_funds`

When `reward_pool` is later funded (via `REWARD_POOL_FUND` event), the existing daily-crate retry tail re-checks `daily_crate_rewards.status='awaiting_funds'`. The same retry must now also drain `crate_drops.status='awaiting_funds'`. This is the single explicit cross-source piece of work.

Implementation: extend `reward-pool-fund` handler (or its equivalent retry tail) to scan `crate_drops` rows with `status='awaiting_funds'`, evaluate the gate per-row, and queue payouts identical to the daily-crate path.

**Acceptance Criteria:**
- [ ] Funding the pool drains both daily-crate and crate-drops `awaiting_funds` rows in priority order (FIFO by `opened_at`).
- [ ] A test inserts one of each type, funds the pool, and asserts both transition to `'pending'`.

### FR-5: `GET /crates/inventory` — unified unopened list

A new authenticated endpoint returning all of the player's unopened crates from both sources, in one paginated list, with contents masked.

- **Path:** `GET /crates/inventory`
- **Query:** `?cursor=...&limit=20`
- **Response (200):**

```ts
type CrateInventoryItem = {
  id: string;                      // opaque — includes source prefix, e.g. "daily:42" or "drop:99"
  source: 'daily' | 'challenge' | 'bonus';
  createdAt: string;
  rarityHint: 'common' | 'rare' | 'epic' | null;   // derived from tier (daily) or crate_type (drop); null acceptable in v1
};
type CrateInventoryResponse = { items: CrateInventoryItem[]; nextCursor: string | null };
```

Inventory item rules:
- **Daily:** include rows where `daily_crate_rewards.status='earned'` for the caller.
- **Challenge/bonus:** include rows where `crate_drops.status='awaiting_open'` for the caller, mapping `trigger_type` to `source` (`challenge_completed`→`challenge`, `bonus_completed`→`bonus`).
- Sort: union, ORDER BY `createdAt DESC`. Cursor uses the timestamp.
- `rarityHint` v1 implementation: for daily, use the row's `tier` (e.g. tier 1 → common, tier 2 → rare, tier 3+ → epic — exact bucketing in code via a helper). For challenge/bonus, return `null` (frontend can color by `source`).

**Acceptance Criteria:**
- [ ] Endpoint registered, authenticated, returns `CrateInventoryResponse`.
- [ ] Response omits `crateType` / `contentsAmount` / `rewardHash` / `tier` / `dayLamports` — all hidden.
- [ ] Items from both sources appear in the same paginated stream sorted by `createdAt DESC`.
- [ ] Pagination cursor is stable across pages (no duplicates, no skips for inserts during pagination).
- [ ] Returns 401 without auth.

### FR-6: Masking contents in existing list responses

The existing per-source list endpoints must be updated so they no longer leak unopened contents:

- `GET /crates/daily/pending` — for rows with `status='earned'`, omit `contentsAmount`, `crateType`, `rewardHash`, `dayLamports`, `tier`. For non-`earned` rows (`grant_queued`, `awaiting_funds`, `payout_queued`, `pending`, `held`), keep the current full shape (contents are post-open; player has already seen them).
- `GET /crates/mine` (challenge history) — for rows with `status='awaiting_open'`, omit `crateType` and `contentsAmount`. For other statuses (`pending`/`granted`/`failed`/`awaiting_funds`/`held`), keep current shape.

**Acceptance Criteria:**
- [ ] `GET /crates/daily/pending` returns earned-row items without contents fields.
- [ ] `GET /crates/daily/pending` still returns full shape for post-claim statuses (regression test asserts `contentsAmount` is present for `grant_queued`).
- [ ] `GET /crates/mine` returns awaiting-open items without `crateType` / `contentsAmount`.
- [ ] OpenAPI schemas updated to reflect optional fields gated on status (use discriminated union or `nullable` where appropriate).

### FR-7: Contracts module + error codes

A new module `backend/src/contracts/crates.ts` exports the shared types:

```ts
export type CrateSource = 'daily' | 'challenge' | 'bonus';
export type CrateDropStatus = 'awaiting_open' | 'pending' | 'awaiting_funds' | 'held' | 'granted' | 'failed';
export type CrateInventoryItem = { /* per FR-5 */ };
export type CrateOpenResponse = { /* per FR-3 */ };

export const CRATE_DROPS_STATUS = {
  AWAITING_OPEN: 'awaiting_open',
  PENDING: 'pending',
  AWAITING_FUNDS: 'awaiting_funds',
  HELD: 'held',
  GRANTED: 'granted',
  FAILED: 'failed',
} as const;
```

`API_ERROR_CODES` is extended with:
- `CRATE_NOT_FOUND` → 404 when the drop id doesn't exist (or belongs to a different user — see note).
- `CRATE_NOT_OPENABLE` → 409 when the drop is in a non-replayable state. (Replays of non-`awaiting_open` return 200 with persisted state, not this code.)

Wallet-mismatch decision: return `404 CRATE_NOT_FOUND` rather than 403, to avoid leaking existence of others' drops. This is consistent with public-route hygiene.

**Acceptance Criteria:**
- [ ] `backend/src/contracts/crates.ts` exists and is imported by both routes.
- [ ] `API_ERROR_CODES.CRATE_NOT_FOUND` and `CRATE_NOT_OPENABLE` added to the central catalog.
- [ ] Wallet-mismatch returns 404, not 403 (matches the security note above — update FR-3 acceptance criterion accordingly).

### FR-8: OpenAPI contract

Per backend CLAUDE.md, every new public route gets an OpenAPI path module and matching contract test.

**Acceptance Criteria:**
- [ ] OpenAPI path module exists for `POST /crates/drops/:dropId/claim`.
- [ ] OpenAPI path module exists for `GET /crates/inventory`.
- [ ] OpenAPI path module updated for `GET /crates/daily/pending` (masked shape).
- [ ] OpenAPI path module updated for `GET /crates/mine` (masked shape for `awaiting_open`).
- [ ] `backend/src/__tests__/openapi-contract.test.ts` passes.

---

## Success Criteria

- All four crate sources (daily, challenge, completion-bonus) require a manual player click to deliver contents.
- A player who opens DevTools cannot see crate contents before clicking "open".
- `GET /crates/inventory` returns both daily and challenge/bonus unopened crates in one list.
- Reward pool is never decremented from an un-opened roll.
- Existing legacy `crate_drops` rows in `'pending'` continue to drain via the existing payout handler.
- `./scripts/verify` exit 0.

---

## Dependencies

- Spec 307 payout gate (`evaluateGate`, `payout_attempts`).
- Spec 402 daily-crate plumbing (gate + retry tail patterns to mirror).
- Existing `crate-sol-payout.ts` legacy branch — unchanged but depended on by the new claim flow.
- Existing `reward-pool-fund.ts` retry tail — to be extended.

## Assumptions

- The webapp team will replace its current auto-grant chest UX with an inventory page + per-crate open call. This is tracked as a separate frontend MR, out of scope here.
- No production rows currently sit in `crate_drops.status='pending'` for points crates that depend on the row being treated as terminal "granted" (the spec preserves their semantics: they remain queryable; no new client code path treats them as un-opened).
- `Math.random()`-based fairness for challenge crates is acceptable for v1. A future spec may introduce committed-blockhash fairness for these crates (out of scope here).

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | crate-drop handler inserts `awaiting_open`, no events emitted | Vitest in `backend/src/__tests__/crate-drop-handler.test.ts` | Assert `event_queue` count unchanged, `crate_drops.status='awaiting_open'` |
| 2 | Pool not decremented at roll time | Same test as above | Assert `reward_pool.balance_lamports` unchanged |
| 3 | First open succeeds, second open returns persisted state | New `crate-drops-claim.test.ts` | Two POST calls, assert single event in queue, identical response on second call |
| 4 | Wallet mismatch returns 404 | New test | POST as user B for drop owned by user A |
| 5 | SOL gate / pool / queue sequence matches daily semantics | New test | Insert awaiting_open SOL row, set pool=0, claim → `awaiting_funds`; fund pool → drained to `pending` |
| 6 | Inventory returns both sources sorted by createdAt DESC | New `crates-inventory-route.test.ts` | Mix daily + drop rows, assert order |
| 7 | Inventory masks all contents fields | Same test | Assert response body has no `crateType` / `contentsAmount` / `rewardHash` / `tier` |
| 8 | Daily-pending masks contents for `earned` rows, retains for post-claim rows | Update `points-and-crates-routes.test.ts` | Two rows with different statuses, two assertions |
| 9 | Existing legacy `crate_drops.status='pending'` still drains via crate-sol-payout | Regression test in `crate-sol-payout.test.ts` | Insert legacy 'pending' row, fire event, assert 'granted' |
| 10 | Migration is additive — pre-existing rows unchanged | Vitest migration test | Pre-populate row in `pending`, run migration, SELECT row, assert all columns intact |

---

## Completion Signal

### Implementation Checklist

- [ ] Write migration `backend/migrations/0NN_crate_open.sql` (additive: new status values, `opened_at`, `hold_reason`, partial index).
- [ ] Create `backend/src/contracts/crates.ts` with `CrateSource`, `CrateInventoryItem`, `CrateOpenResponse`, `CRATE_DROPS_STATUS`.
- [ ] Add `CRATE_NOT_FOUND` and `CRATE_NOT_OPENABLE` to `backend/src/contracts/api-errors.ts`.
- [ ] Refactor `backend/src/queue/handlers/crate-drop.ts`: roll + insert `awaiting_open`, no pool decrement, no event emit.
- [ ] Update `backend/src/__tests__/crate-drop-handler.test.ts` for new semantics.
- [ ] Add `backend/src/services/crate-drop-payout.ts` exporting `gateAndQueueCrateDropSolPayout` (sibling to daily's; targets `crate_drops` instead).
- [ ] Add `backend/src/routes/crates-drops.ts` with `POST /crates/drops/:dropId/claim` and matching OpenAPI module.
- [ ] Add `backend/src/routes/crates-inventory.ts` with `GET /crates/inventory` and matching OpenAPI module.
- [ ] Mount both new route modules in the root app (wherever `crates-daily` is mounted).
- [ ] Update `GET /crates/daily/pending` to mask `earned`-status rows (in `crates-daily.ts`).
- [ ] Update `GET /crates/mine` to mask `awaiting_open`-status rows (in `points.ts`).
- [ ] Extend `backend/src/queue/handlers/reward-pool-fund.ts` retry tail to also drain `crate_drops.status='awaiting_funds'`.
- [ ] Add vitest coverage per Validation Plan (rows 3–10).
- [ ] Update OpenAPI contract tests.
- [ ] Run `cd backend && pnpm verify`.
- [ ] [test] N/A for `e2e/local/**` — this is a backend-only contract change; webapp consumption is a separate MR.
- [ ] [test] N/A for `e2e/visual/**` — no UI in this spec.
- [ ] [test] N/A for `e2e/devnet/**` — no on-chain provider integration changes.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality (per Validation Plan)
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled: replay claim, wallet mismatch, SOL pool empty, SOL gate held, points crate, missing drop id
- [ ] Error states handled: 401, 404, 409, 5xx

#### Integration Verification
- [ ] Devnet E2E: N/A (backend contract change, no chain provider integration)
- [ ] API contracts documented in OpenAPI; contract test passes
- [ ] Settlement flow not touched (no on-chain changes)

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, run `/gap-analysis 406 --non-interactive` to:
1. Audit every FR acceptance criterion against the codebase
2. Write `docs/specs/406-unified-crate-claim/gap-analysis.md`
3. Annotate FR checkboxes with HTML comment evidence

---

## Future Work (not in this spec)

- **Verifiable fairness for challenge crates.** Replace `Math.random()` with a deterministic hash seeded by a committed Solana blockhash captured at challenge-completion time, mirroring the daily-crate model. Requires plumbing a blockhash into the `CRATE_DROP` event payload and a `/verify` endpoint per challenge crate.
- **Table consolidation.** If operational pain from two tables emerges, design a unified `user_crates` table and a backfill migration with rollback story. Not justified by current evidence.
- **Crate rarity tiers for challenge/bonus.** Today `crate_type` is `points`/`sol`. A future spec could add a `rarity` field (common/rare/epic) populated at roll time, surfaced in `rarityHint`.
