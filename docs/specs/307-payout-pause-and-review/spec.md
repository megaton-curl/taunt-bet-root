# Specification: [307] Payout Pause and Review

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 0 |

---

## Overview

An admin-controlled gate sitting in front of every claimable SOL payout. Today the only consumer is referral claims (spec 300); future SOL-bearing crate redemptions and any other claimable will plug in by setting `claim_kind` and reusing the same gate. The gate gives operators two knobs:

1. **Emergency pause** — a per-`claim_kind` switch that halts every new SOL transfer until cleared.
2. **Review threshold** — claims at or above a configured amount are held for explicit admin approval before any transfer.

Held claims surface in a dedicated peek "Payouts" page where a single admin role can **approve** or **reject** them. There is no separate "hold" action — a claim is either being acted on or it is sitting in the held queue. There is no auto-release except for the global pause; above-threshold claims are released only by explicit admin action.

Rejected claims restore the user's claimable balance — reject is "we're not paying *this* request right now", not "we're confiscating earnings." Every operator action is recorded in the existing `operator_events` audit log.

The user-facing claim status surface stays exactly as in spec 300. A claim that is internally `held` for any reason continues to report `pending` in the public claim status response. A claim that is internally `rejected` is also reported as `pending` so the user can re-claim if they want — operator decisions are not exposed to players.

The implementation is a small, additive layer on top of the existing referral claim queue handler — the queue handler remains the single choke point where the gate runs before any transfer.

## User Stories

- As an admin, I want a single emergency pause that immediately stops all referral payouts so that I can react to an active incident without a deploy.
- As an admin, I want claims above a configured amount to require my explicit approval so that suspicious or high-value transfers do not auto-execute.
- As an admin, I want a dedicated review queue with approve and reject actions so that I do not have to dig through SQL or the queue page.
- As an admin, I want every pause toggle, threshold change, and per-claim decision to be auditable so that internal access and decisions can be reviewed.
- As a referrer, I want my claim status to remain coherent (it stays `pending`) when controls are in effect so that I am not surprised by silent failures and I do not see operator decisions exposed to me.
- As an engineer, I want the gate to live in one module called from the queue handler so that the same controls apply uniformly when future claimable types (e.g., SOL crates) ship.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Internal tooling, off-chain backend visibility, growth/referral operations, treasury safety. Extends spec 305 (peek operations admin) with a payouts surface.
- **Current baseline fit**: Extends spec 300 (referral claims, async via queue) and spec 305 (peek operations admin, mutations + audit). No on-chain program changes.
- **Planning bucket**: Core internal operations / treasury safety.

## Required Context Files

- `docs/specs/300-referral-system/spec.md` — current referral claim flow, state machine, event contract
- `docs/specs/301-async-event-queue/spec.md` — queue worker, retry/backoff behavior
- `docs/specs/305-peek-operations-admin/spec.md` — peek admin shell, role policy, mutation + audit pattern
- `backend/src/queue/handlers/referral-claim.ts` — current claim handler (single choke point for transfers)
- `backend/src/db.ts` — referral claim DB methods (`getReferralClaim`, `updateClaimStatus`, `getPendingBalanceByUserId`, `getReferrerRate`)
- `backend/src/routes/referral.ts` — claim request and status polling endpoints
- `backend/migrations/010_referral.sql` and `012_referral_claim_retry.sql` — current `referral_claims` schema and concurrent-claim guard
- `peek/src/server/mutations/` — existing mutation pattern (`kol-rate.ts`, `fraud-flag.ts`, `auth-whitelist.ts`)
- `peek/src/server/audit/` — `operator_events` writer used by every peek mutation
- `peek/src/server/access-policy.ts` — current local role policy

## Contract Files

- New: `backend/src/services/payout-gate.ts` — single function `evaluateGate(claim, controls)` returning `{ proceed: true } | { proceed: false, holdReason }`.
- New: DB accessors for `payout_controls` and held-claim queries (extension of `db.ts` following the existing pattern, or a new module — implementer's choice).
- New: `peek/src/server/db/queries/get-held-claims.ts` — read model for the review queue.
- New: `peek/src/server/db/queries/get-payout-controls.ts` — controls strip read model.
- New: `peek/src/server/db/queries/get-recent-payout-decisions.ts` — recent decisions read model.
- New: `peek/src/server/mutations/payout-controls.ts` — `setPayoutPause`, `updatePayoutControls`.
- New: `peek/src/server/mutations/claim-review.ts` — `approveClaim`, `rejectClaim`.
- **No public OpenAPI changes.** The user-facing claim status response shape is unchanged from spec 300.

---

## System Invariants

These are non-negotiable for correctness and treasury safety:

1. **Single choke point.** Every SOL transfer for a claimable payout MUST pass through the queue handler, which MUST call `payout-gate.evaluateGate` before initiating any transfer. No code path may bypass the gate.
2. **Gate evaluation order.** Pause check (always first) → admin-approved short-circuit (skip remaining checks if `reviewed_at` is set) → threshold check → proceed. Pause always wins, even over admin-approved claims.
3. **Atomic hold transition.** Marking a claim `held` and writing its `hold_reason` MUST occur in a single DB update; the queue handler MUST NOT call `SystemProgram.transfer` after observing any hold condition.
4. **Reject preserves balance.** A `rejected` claim row MUST NOT be subtracted from the user's pending balance. The user can re-request a claim, which lands back in the gate.
5. **Active-claim uniqueness.** The partial unique index that prevents concurrent claims per wallet MUST treat `held` rows as active (in addition to `pending` and `processing`). `rejected` rows do NOT count as active (so the user can re-claim).
6. **Audit completeness.** Every mutation — pause toggle, controls update, approve/reject of a specific claim — MUST write a row to `operator_events` with actor, action, target, before, and after. No silent admin actions.
7. **Lamports-only accounting.** `review_threshold_lamports` and any monetary value transported by APIs are integer lamports (`BIGINT` in DB, string in JSON).
8. **Per-`claim_kind` controls.** Pause and threshold are scoped per `claim_kind`. Future claimables (e.g., `crate`) get their own row in `payout_controls`; `referral` controls do not affect them.
9. **Idempotency preserved.** Existing handler idempotency (re-processing the same event is a safe no-op) MUST hold; held / rejected / completed claims short-circuit before any transfer attempt.
10. **No internal state leaks to users.** The public `GET /referral/claim/:claimId` response MUST report `held` and `rejected` claims as `pending`. The public response MUST NOT include `hold_reason`, `reviewed_by`, `reviewed_at`, or any other operator-facing field.

---

## Functional Requirements

### FR-1: Payout Gate Service

A pure function evaluating a claim against the active controls and returning whether to proceed or hold (and why).

**Inputs:**
- `claim`: `{ id, claim_kind, amount_lamports, status, hold_reason?, reviewed_at? }`
- `controls`: `{ pause_enabled, review_threshold_lamports }` for that `claim_kind`
- `now`: timestamp (injected for testability — currently unused but reserved for future per-`claim_kind` policy)

**Output:**
- `{ proceed: true }` — handler may continue to `processing`/transfer
- `{ proceed: false, holdReason: 'global_pause' | 'above_threshold' }`

**Evaluation order (short-circuits on first match):**

1. **Pause check (always first):** if `controls.pause_enabled` → hold with reason `global_pause`. Pause is the emergency override and overrides everything else, including admin approvals.
2. **Admin-approved short-circuit:** if `claim.reviewed_at IS NOT NULL` → `proceed: true`. The threshold check is skipped because the admin has explicitly accepted the risk by approving the claim.
3. **Threshold check:** if `claim.amount_lamports >= controls.review_threshold_lamports` → hold with reason `above_threshold`.
4. **Default:** `proceed: true`.

**Acceptance Criteria:**
- [ ] `evaluateGate` is a pure function with no DB or RPC side effects (DB writes happen in the handler, not the gate)
- [ ] Unit tests cover both hold reasons (`global_pause`, `above_threshold`) and the proceed path
- [ ] Unit tests cover precedence: pause beats admin-approved short-circuit; admin-approved short-circuit beats threshold
- [ ] Function is exported from `backend/src/services/payout-gate.ts` and imported by the referral claim handler

### FR-2: Claim Handler Integration

The existing referral claim handler is updated to call the gate before any transfer attempt.

**Updated flow:**
1. Load claim by ID.
2. Idempotency check: if status is `completed`, `failed`, or `rejected` → no-op return.
3. If status is `held` → no-op return. Held claims only move on admin action (approve = back to `pending` with `reviewed_at` set, plus a fresh queue event) or pause-off (handled by sweeper).
4. Load `payout_controls` row for the claim's `claim_kind`.
5. Call `evaluateGate(claim, controls, now)`.
6. If `proceed: false` → atomically update the claim to `status='held'` with the returned `hold_reason`. Do NOT call `SystemProgram.transfer`. Return without scheduling a retry.
7. If `proceed: true` → existing flow: update to `processing`, re-verify available balance (defense-in-depth), execute transfer, record `tx_signature`, update to `completed`. On transfer error, existing retry/backoff logic applies (the gate is not consulted on retries unless conditions change).

**Acceptance Criteria:**
- [ ] Handler calls `evaluateGate` after idempotency check and before any `SystemProgram.transfer` call
- [ ] When the gate returns a hold, the claim is updated to `held` with the correct `hold_reason` and no transfer is attempted
- [ ] When the gate proceeds, existing transfer + retry behavior is preserved unchanged
- [ ] Re-processing a `held` claim is a safe no-op (idempotent under at-least-once delivery)
- [ ] Re-processing a `rejected` claim is a safe no-op and is not retried by the queue
- [ ] Integration test: pause toggled on → enqueue claim → claim is held with reason `global_pause`, no transfer occurs

### FR-3: Sweeper for Pause Auto-Release

A periodic task that returns pause-held claims to the queue when the global pause clears.

**Behavior:**
- Runs alongside the existing event queue worker on the same tick (no new service or process).
- On each tick, for each `claim_kind` whose `payout_controls.pause_enabled = false`: scans `referral_claims WHERE status='held' AND hold_reason='global_pause' AND claim_kind=...` and, for each row, sets `status='pending'`, clears `hold_reason`, and emits a fresh `referral.claim_requested` event.
- `held / above_threshold` is never touched by the sweeper. Above-threshold claims clear only via admin approval or rejection.
- Sweeper writes are idempotent: scanning the same claim repeatedly with the same pause state is a no-op.

**Acceptance Criteria:**
- [ ] Sweeper runs on the existing worker tick — no separate cron or process
- [ ] When `pause_enabled` flips off, all `held / global_pause` claims for that `claim_kind` are returned to `pending` and re-emitted within one tick
- [ ] `held / above_threshold` claims are never modified by the sweeper
- [ ] Sweeper does not double-emit for the same claim (status update gates emission)

### FR-4: Database Schema

One new table and additive columns on `referral_claims`. Migration is forward-safe and additive — no destructive operations on existing data.

```sql
-- New: per-claim-kind controls
CREATE TABLE payout_controls (
  claim_kind                TEXT PRIMARY KEY,
  pause_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  review_threshold_lamports BIGINT  NOT NULL DEFAULT 1000000000, -- 1 SOL
  updated_by                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (review_threshold_lamports >= 0)
);
INSERT INTO payout_controls (claim_kind) VALUES ('referral');

-- Extend referral_claims
ALTER TABLE referral_claims
  ADD COLUMN claim_kind  TEXT NOT NULL DEFAULT 'referral',
  ADD COLUMN hold_reason TEXT,
  ADD COLUMN reviewed_by TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Update status check constraint to include 'held' and 'rejected'
ALTER TABLE referral_claims DROP CONSTRAINT IF EXISTS referral_claims_status_check;
ALTER TABLE referral_claims ADD CONSTRAINT referral_claims_status_check
  CHECK (status IN ('pending','held','processing','completed','failed','rejected','error'));

-- Hold reason check (NULL when not held; values match gate enum)
ALTER TABLE referral_claims ADD CONSTRAINT referral_claims_hold_reason_check
  CHECK (
    (status = 'held' AND hold_reason IN ('global_pause','above_threshold'))
    OR (status <> 'held' AND hold_reason IS NULL)
  );

-- Widen concurrent-claim guard to include 'held' (rejected does NOT count as active)
DROP INDEX IF EXISTS idx_referral_claims_wallet_active;
CREATE UNIQUE INDEX idx_referral_claims_wallet_active
  ON referral_claims (wallet)
  WHERE status IN ('pending','held','processing');

-- Index for sweeper + held-queue listing
CREATE INDEX idx_referral_claims_held
  ON referral_claims (claim_kind, hold_reason)
  WHERE status = 'held';
```

**`getPendingBalanceByUserId` update:** the query that subtracts active and completed claims from earnings MUST exclude `rejected` rows from the subtraction. Held rows continue to be subtracted (so a user cannot double-request while one is held). Rejected rows do not count, so a user's claimable balance returns to its pre-claim level after a rejection.

**Acceptance Criteria:**
- [ ] Migration creates `payout_controls` with the `referral` row pre-inserted
- [ ] Migration adds `claim_kind`, `hold_reason`, `reviewed_by`, `reviewed_at` columns to `referral_claims` without breaking existing rows (`claim_kind` defaults to `'referral'` for backfill)
- [ ] Updated status check constraint includes `held` and `rejected`
- [ ] `hold_reason` check constraint enforces the held↔reason invariant with exactly two valid values: `global_pause`, `above_threshold`
- [ ] Concurrent-claim partial unique index includes `held` and excludes `rejected`
- [ ] Sweeper-supporting partial index on `(claim_kind, hold_reason) WHERE status='held'` exists
- [ ] `getPendingBalanceByUserId` excludes `rejected` claims from the subtraction
- [ ] Migration is verified forward-only with existing devnet data

### FR-5: Backend API Surface — User-Facing Claim Status

**No changes to the public API contract** beyond the existing spec 300 shape. The user-facing claim status response stays exactly as defined in spec 300:

```json
{
  "claimId": "uuid",
  "amountLamports": "string",
  "status": "pending | processing | completed | failed",
  "txSignature": "string?"
}
```

**Status mapping for the public response:**
- internal `held` → public `pending`
- internal `rejected` → public `pending` (so the user can simply re-request a claim — operator decisions are not exposed)
- internal `pending`, `processing`, `completed`, `failed`, `error` → public passes through unchanged (`error` continues to map to whatever it currently maps to in spec 300)

This mapping lives in the route handler that serves `GET /referral/claim/:claimId`. The internal claim row keeps its true status; only the response is mapped.

**`POST /referral/claim`** — unchanged contract. Returns `202` with `status: "pending"` regardless of any later hold.

**Authorization on internal payout operations:** all admin actions (pause, threshold, approve, reject) live in peek (server actions, not public API). They are never exposed on the public backend.

**Acceptance Criteria:**
- [ ] `GET /referral/claim/:claimId` returns the same JSON shape as in spec 300; no new fields are added
- [ ] When the internal status is `held`, the response reports `status: "pending"`
- [ ] When the internal status is `rejected`, the response reports `status: "pending"`
- [ ] `txSignature` is reported only when the internal status is `completed`
- [ ] `POST /referral/claim` continues to return `202` with `status: 'pending'`
- [ ] No new public endpoint or breaking change is introduced

### FR-6: Peek Admin — Payouts Page

A new server-rendered page in peek for operators to manage controls and review held claims.

**Route:** `peek/app/operations/payouts/page.tsx`

**Page sections (top to bottom):**

1. **Controls strip** — one card per `claim_kind` (only `referral` initially):
   - Prominent **Emergency pause** toggle. Confirmation dialog on enable. On change, calls `setPayoutPause(claim_kind, enabled)` server action.
   - **Review threshold** input (in SOL, stored as lamports). "Save" button calls `updatePayoutControls(claim_kind, threshold_lamports)`.
   - Last-updated-by + last-updated-at displayed inline.
2. **Held queue table** — every claim where `status='held'`:
   - Columns: kind, user (id + handle if available), wallet, amount (SOL), `hold_reason`, age (since `requested_at`).
   - Row actions: **Approve** and **Reject** only. Approve calls `approveClaim(claimId)`, returns claim to pending and re-emits queue event. Reject calls `rejectClaim(claimId, note)` and is terminal.
   - Reject opens a small dialog requiring a `note` (free text, stored in the existing `error` column for context).
3. **Recent decisions** — last 50 admin actions on payouts, pulled from `operator_events` filtered to relevant action types (`payout.*`). Read-only.

**Access:** the page and all mutations are gated by the existing peek admin role. No new role split for v1 — see Tech Debt note.

**Acceptance Criteria:**
- [ ] Route `peek/app/operations/payouts/page.tsx` exists and is reachable from the admin shell nav (under Operations)
- [ ] Controls strip renders the current `payout_controls` row for `referral` and supports pause toggle and threshold edit
- [ ] Held queue table lists every `referral_claims` row with `status='held'` with the columns above and approve/reject actions only (no other row actions)
- [ ] Recent decisions list shows the last 50 payout-related `operator_events` rows
- [ ] Page is gated behind the existing peek admin role check; unauthorized users see the existing access-denied component

### FR-7: Peek Mutations

All mutations follow the existing `peek/src/server/mutations/` pattern: server-only, role-checked, audit-logged, before/after captured.

**`setPayoutPause(claim_kind, enabled): void`**
- Loads current row, updates `pause_enabled`, sets `updated_by`, `updated_at`.
- Audit: `{ action: 'payout.pause.set', target: claim_kind, before: { enabled }, after: { enabled } }`.

**`updatePayoutControls(claim_kind, threshold_lamports): void`**
- Validates `threshold_lamports >= 0`.
- Updates row, sets `updated_by`, `updated_at`.
- Audit: `{ action: 'payout.controls.update', target: claim_kind, before: {...}, after: {...} }`.

**`approveClaim(claim_id): void`**
- Loads claim; if status is not `held`, error.
- Sets `status='pending'`, clears `hold_reason`, sets `reviewed_by` (admin email) and `reviewed_at` (now). Emits a fresh `referral.claim_requested` event in the same DB transaction so the queue handler picks it up.
- The gate's admin-approved short-circuit (FR-1 step 2) ensures the next handler invocation does not re-hold the claim for being above threshold (pause still applies if active).
- Audit: `{ action: 'payout.claim.approve', target: claim_id, before: {...}, after: {...} }`.

**`rejectClaim(claim_id, note): void`**
- Loads claim; if status is not `held`, error. `note` is required (cannot be empty).
- Sets `status='rejected'`, clears `hold_reason`, sets `reviewed_by`, `reviewed_at`, stores `note` in `error` column. Terminal — no event emission.
- The `getPendingBalanceByUserId` query (FR-4) ensures the user's claimable balance is restored.
- Audit: `{ action: 'payout.claim.reject', target: claim_id, before: {...}, after: { note } }`.

**Acceptance Criteria:**
- [ ] All four mutations exist in `peek/src/server/mutations/` and are exported from the registry
- [ ] Each mutation calls the existing role check before touching DB
- [ ] Each mutation writes an `operator_events` row with actor email, action, target, before, after
- [ ] `approveClaim` and `rejectClaim` reject invalid status transitions (anything other than `held`) with a clear error
- [ ] `approveClaim` emits a fresh `referral.claim_requested` event in the same DB transaction as the status update
- [ ] `rejectClaim` requires a non-empty note
- [ ] Unit tests cover the happy path and at least one invalid-transition path per mutation

### FR-8: Peek Read Models

**`get-held-claims.ts`** — read model for the review queue:
- Returns `{ claimId, claimKind, userId, wallet, amountLamports, holdReason, requestedAt, error }` for every `status='held'` row, joined with player handle/identity if available (via existing `peek-user-detail` patterns).
- Sorted oldest-first (longest waiting at top).

**`get-payout-controls.ts`** — returns the single row per `claim_kind` for the controls strip.

**`get-recent-payout-decisions.ts`** — returns the last 50 `operator_events` rows with action prefix `payout.*`.

**Acceptance Criteria:**
- [ ] Each read model is a server-only function in `peek/src/server/db/queries/`
- [ ] `get-held-claims` joins user identity using the existing pattern (no new join logic invented for this spec)
- [ ] Each read model is unit-tested with a fixture row and an empty-state assertion

---

## Design Decisions

### Why a single state `held` with a reason column

Adding one state plus an enum captures both hold conditions (`global_pause`, `above_threshold`) without state explosion. The state machine stays readable, the admin UI maps reasons to copy without branching on status, and future hold conditions (e.g., per-user freeze) only need a new enum value, not a new column or state.

### Why the queue handler stays the only choke point

The existing handler already serializes per-claim work via the queue. Putting the gate inside it avoids any new locking concerns and keeps "before any transfer" trivially true: there is one place that calls `SystemProgram.transfer`, and the gate sits directly above it.

### Why no separate "hold" admin action

A held claim is, by definition, a claim sitting in the review queue waiting for an admin decision. "Hold longer" is operationally identical to "do nothing" — the claim already remains held until acted on. Adding a third action would add UI complexity without changing what is possible. If an admin wants to keep a claim from going through, they leave it alone; if they want to actively block all payouts they use the global pause.

### Why no above-threshold delay

A delay before review is a knob without a clear use case once we already require explicit approval for above-threshold claims. The team can investigate before clicking approve; an artificial waiting period before the row appears in the queue adds latency without adding control.

### Why above-threshold claims never auto-release

These represent explicit operator suspicion or policy. Time-based release would defeat the purpose of having a threshold at all.

### Why reject restores the balance instead of zeroing it

A rejected claim is a refusal to send *this* request, not a confiscation of earnings. Users may have legitimate claims later (or the request may have been spurious). Subtracting the rejected row from balance would penalize the user for an admin decision and would make UX/audit harder when a hold is overturned.

### Why per-`claim_kind` controls

Future SOL-bearing crates (and any later claimable) will have different risk profiles, fraud models, and acceptable thresholds. A single global pause/threshold would either be too coarse (one pause kills everything) or require schema change later.

### Why operator decisions are not exposed to the user

The user-facing surface stays as in spec 300. A held or rejected claim is reported as `pending` so the user does not see operator decisions, internal hold reasons, or admin reviewer identities. If a claim is rejected, the user sees the same surface they would have seen if no claim had ever been processed — they can simply request again. This keeps the public contract narrow and avoids exposing internal policy to clients (and removes the need for the frontend team to design copy for "your claim is under review" states for v1).

### Why no new role split

Peek already gates every mutation via the same admin role and writes audit on every change. Splitting `treasury_operator` from generic `admin` adds friction without addressing a specific present threat. We log this in TECH_DEBT and revisit when there is a concrete reason (e.g., new operator onboarded with limited scope).

---

## Success Criteria

- An admin can flip a single switch and stop all referral SOL transfers within one queue tick, with no deploy.
- Claims at or above the configured threshold do not transfer until an admin approves them.
- A rejected claim restores the user's claimable balance — the user can re-request without operator intervention, and the user does not see any operator decision in the public response.
- Held and rejected claims are reported as `pending` to the user; no internal status leaks to the public API.
- Every pause toggle, threshold change, and per-claim decision is recoverable from `operator_events` with actor + before/after.
- The same gate is reused unchanged when a future `claim_kind` is added: only a new row in `payout_controls` and a `claim_kind` value passed by the new handler are required.
- Settlement-path latency is unaffected (gate runs only at claim time, not settlement).
- Existing referral claim flow continues to function unchanged when no controls are active (no pause, threshold above all real claim sizes).

---

## Dependencies

- Spec 300 (referral system) — claim handler, claim row schema, balance query.
- Spec 301 (async event queue) — worker tick cadence, retry/backoff semantics.
- Spec 305 (peek operations admin) — admin shell, role policy, mutation registry pattern, `operator_events` audit table.
- Existing `referral_claims` partial unique index (concurrent-claim guard) — must be recreated to include `held`.
- Treasury wallet operational continuity — pause and review do not change funding requirements; they only delay outflow.

## Assumptions

- The existing event queue worker can accommodate one additional periodic sweep per tick without measurable performance impact (sweeper queries are bounded by the `idx_referral_claims_held` partial index).
- Peek's `operator_events` audit schema is sufficient for `payout.*` actions without modification.
- A single admin role is acceptable for v1; the lack of split privileges is logged as TECH_DEBT.
- Devnet is the primary verification environment; production rollout is gated by manual smoke + a documented runbook (out of scope for this spec).

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Gate evaluates pause first | Unit test: pause + above-threshold both true → reason `global_pause` | Test output |
| 2 | Gate honors admin-approved short-circuit | Unit test: pause off, amount ≥ threshold, `reviewed_at` set → `proceed: true` | Test output |
| 3 | Gate evaluates threshold | Unit test: pause off, no review, amount ≥ threshold → reason `above_threshold` | Test output |
| 4 | Gate proceeds when all clear | Unit test: pause off, amount < threshold → `proceed: true` | Test output |
| 5 | Pause overrides admin approval | Unit test: pause on, `reviewed_at` set → reason `global_pause` | Test output |
| 6 | Handler writes `held` and skips transfer | Integration test: enable pause, run handler → claim status becomes `held / global_pause`, no `tx_signature` written | Test output + DB check |
| 7 | Handler proceeds when gate clears | Integration test: pause off, low amount → claim becomes `completed` with `tx_signature` | Test output + tx sig |
| 8 | Sweeper releases pause-held on un-pause | Integration test: enable pause → enqueue claim → claim held → disable pause → within one tick claim returns to `pending` and is re-emitted | Test output + DB check |
| 9 | Sweeper does not touch above-threshold holds | Integration test: pre-seed `held / above_threshold` → run sweeper → row unchanged | Test output |
| 10 | Migration is forward-safe | Apply migration on a copy of devnet data with existing claims → all rows valid, no constraint violations, `claim_kind` defaulted | Migration log + count check |
| 11 | Concurrent-claim guard includes held | DB-level test: insert pending row, then attempt second insert for same wallet while first is held → conflict | Test output |
| 12 | Concurrent-claim guard excludes rejected | DB-level test: insert + reject claim, then insert second claim for same wallet → succeeds | Test output |
| 13 | Reject restores balance | Unit test on `getPendingBalanceByUserId`: with one rejected and one completed claim, balance excludes only completed | Test output |
| 14 | Public claim status hides held | API test: held claim → response reports `status: "pending"`, no `holdReason` field | Test output |
| 15 | Public claim status hides rejected | API test: rejected claim → response reports `status: "pending"` | Test output |
| 16 | `setPayoutPause` writes audit | Mutation test: toggle pause → `operator_events` row exists with before/after | Test output + DB check |
| 17 | `updatePayoutControls` validates non-negative | Mutation test: pass negative threshold → error, no DB write | Test output |
| 18 | `approveClaim` re-emits event | Mutation test: approve a held claim → `operator_events` row + new queue event in same tx, `reviewed_at` set | Test output + DB check |
| 19 | `approveClaim` rejects invalid transitions | Mutation test: try to approve a `completed` claim → error | Test output |
| 20 | `rejectClaim` requires note | Mutation test: empty note → error | Test output |
| 21 | `rejectClaim` is terminal | Mutation test: reject a held claim → status becomes `rejected`, `reviewed_at` set, no event emitted | Test output |
| 22 | Peek payouts page renders | Visual test: page loads with controls, held queue, recent decisions | Screenshot |
| 23 | Peek payouts page is gated | Access test: non-admin email → access denied | Test output |

---

## Completion Signal

### Implementation Checklist

#### Backend — Database

- [ ] [backend] Migration `028_payout_controls.sql`: create `payout_controls` table with `referral` seed row, extend `referral_claims` with `claim_kind`/`hold_reason`/`reviewed_by`/`reviewed_at`, update status check constraint to include `held` and `rejected`, add `hold_reason` check (`global_pause` or `above_threshold` only), recreate `idx_referral_claims_wallet_active` to include `held` and exclude `rejected`, add `idx_referral_claims_held` partial index (FR-4)
- [ ] [backend] Update `getPendingBalanceByUserId` to exclude `rejected` claims from the subtraction (FR-4 + Invariant 4)
- [ ] [backend] Add DB accessors: `getPayoutControls(kind)`, `setPayoutPause(...)`, `updatePayoutControls(...)`, `listHeldClaims(...)`, `getHeldClaim(id)` following the existing `db.ts` pattern (FR-7, FR-8)

#### Backend — Gate Service

- [ ] [backend] Create `backend/src/services/payout-gate.ts` exporting `evaluateGate(claim, controls, now)` — pure function, no side effects (FR-1)
- [ ] [backend] Unit tests covering precedence (pause > admin-approved > threshold), each hold reason, and the proceed path (FR-1)

#### Backend — Handler Integration

- [ ] [backend] Update `backend/src/queue/handlers/referral-claim.ts` to load `payout_controls`, call `evaluateGate`, and on hold update claim status atomically without calling `SystemProgram.transfer` (FR-2)
- [ ] [backend] Integration test: pause toggled → claim held with `global_pause`, no transfer (FR-2)
- [ ] [backend] Integration test: amount ≥ threshold → claim held with `above_threshold` (FR-2)
- [ ] [backend] Integration test: gate proceeds → existing transfer + completion flow unchanged (FR-2)
- [ ] [backend] Integration test: reprocessing a `held`/`rejected` claim is a no-op (FR-2 + Invariant 9)

#### Backend — Sweeper

- [ ] [backend] Add a periodic sweep step to the existing event-queue worker tick that re-queues `held / global_pause` claims when pause is off. Never touches `above_threshold` holds (FR-3)
- [ ] [backend] Integration test: pause off → held-by-pause claim returned to pending and re-emitted within one tick (FR-3)
- [ ] [backend] Integration test: above-threshold held claim is not touched by the sweeper (FR-3)

#### Backend — Public API Mapping

- [ ] [backend] Update the `GET /referral/claim/:claimId` route handler to map internal `held` and `rejected` to public `pending` in the response. Internal column values are unchanged in DB (FR-5 + Invariant 10)
- [ ] [backend] API test: held claim → public `status: "pending"`; rejected claim → public `status: "pending"`; no `hold_reason` or operator fields appear in the response (FR-5 + Invariant 10)

#### Peek — Read Models

- [ ] [peek] `peek/src/server/db/queries/get-held-claims.ts` — list held claims with user identity join (FR-8)
- [ ] [peek] `peek/src/server/db/queries/get-payout-controls.ts` — list controls per claim kind (FR-8)
- [ ] [peek] `peek/src/server/db/queries/get-recent-payout-decisions.ts` — last 50 `operator_events` with `payout.*` action (FR-8)
- [ ] [peek] Unit tests with fixture rows and empty-state assertions for each read model (FR-8)

#### Peek — Mutations

- [ ] [peek] `peek/src/server/mutations/payout-controls.ts` — `setPayoutPause`, `updatePayoutControls` with role check + audit (FR-7)
- [ ] [peek] `peek/src/server/mutations/claim-review.ts` — `approveClaim`, `rejectClaim` with role check + audit (FR-7)
- [ ] [peek] Register all four mutations in the existing peek mutation registry (FR-7)
- [ ] [peek] Unit tests: happy path + at least one invalid-transition path for each mutation (FR-7)
- [ ] [peek] `approveClaim` emits a `referral.claim_requested` event in the same DB transaction as the status update (FR-7 + Invariant 9)

#### Peek — Page

- [ ] [peek] `peek/app/operations/payouts/page.tsx` — server-rendered page with controls strip, held queue, recent decisions (FR-6)
- [ ] [peek] Add the page to the admin shell nav under Operations (FR-6)
- [ ] [peek] Components: payouts controls card (pause + threshold), held claims table with approve/reject actions, payout decisions list (FR-6)
- [ ] [peek] Page is gated behind existing peek admin role check; unauthorized users see access-denied (FR-6)
- [ ] [peek] E2E test: pause toggle persists; held claim approve/reject flows update DB and audit (FR-6)
- [ ] [peek] Visual baseline added for the new page (FR-6)

#### Tech Debt

- [ ] [docs] Log in `docs/TECH_DEBT.md`: single combined admin role for pause/approve/reject — split into `treasury_operator` if a concrete role-separation requirement appears

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled (held under pause + threshold simultaneously; reprocessing held/rejected; pause flipping mid-tick)
- [ ] Error states handled (invalid transitions, empty reject note, negative threshold)

#### Visual Regression
- [ ] `cd peek && pnpm test:visual` passes (or N/A documented)
- [ ] If this spec changes UI: affected baselines regenerated and committed

#### Smoke Test (Human-in-the-Loop)

- [ ] Toggle emergency pause on → observe new claim becomes `held / global_pause` and no transfer occurs; user-facing status remains `pending`
- [ ] Toggle pause off → observe held claim returns to `pending` and completes within one tick
- [ ] Set threshold below a normal claim → claim becomes `held / above_threshold` until admin approves; user-facing status remains `pending`
- [ ] Approve a held claim → SOL arrives in user wallet, claim becomes `completed` with `tx_signature`
- [ ] Reject a held claim with a note → claim becomes `rejected` internally, user-facing status remains `pending`, user's claimable balance is restored, audit row exists
- [ ] User issues a fresh claim after rejection → it goes through normally (subject to current pause/threshold)
- [ ] All admin actions visible in `operator_events` and the peek "Recent decisions" list

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

---

## Implementation Reference

(Filled in post-completion by the spec loop or implementer.)
