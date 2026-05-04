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

An admin-controlled gate sitting in front of every claimable SOL payout. Today the only consumer is referral claims (spec 300); future SOL-bearing crate redemptions and any other claimable will plug in by setting `claim_kind` and reusing the same gate. The gate gives operators three knobs:

1. **Emergency pause** — a per-`claim_kind` switch that halts every new SOL transfer until cleared.
2. **Review threshold** — claims at or above a configured amount are held for explicit admin approval before any transfer.
3. **Above-threshold delay** — an optional cooldown applied to held claims before they appear in the review queue, giving the team time to investigate.

Held claims surface in a dedicated peek "Payouts" page where a single admin role can approve, reject, or hold them further. Rejected claims restore the user's claimable balance — reject is "we're not paying *this* request right now", not "we're confiscating earnings." Every operator action is recorded in the existing `operator_events` audit log.

The implementation is a small, additive layer on top of the existing referral claim queue handler — the queue handler remains the single choke point where the gate runs before any transfer.

## User Stories

- As an admin, I want a single emergency pause that immediately stops all referral payouts so that I can react to an active incident without a deploy.
- As an admin, I want claims above a configured amount to require my explicit approval so that suspicious or high-value transfers do not auto-execute.
- As an admin, I want above-threshold claims to optionally sit in a delay window before review so that I can investigate before being prompted to decide.
- As an admin, I want a dedicated review queue with approve / reject / hold actions so that I do not have to dig through SQL or the queue page.
- As an admin, I want every pause toggle, threshold change, and per-claim decision to be auditable so that internal access and decisions can be reviewed.
- As a referrer, I want my claim status to remain coherent (pending or under review) when controls are in effect so that I am not surprised by silent failures.
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

- New: `backend/src/services/payout-gate.ts` — single function `evaluateGate(claim, controls)` returning `{ proceed: true } | { proceed: false, holdReason, releaseAt? }`.
- New: `backend/src/db/payout-controls.ts` — DB accessors for `payout_controls` and held-claim queries (or extension of `db.ts` following the existing pattern).
- New: `peek/src/server/db/queries/get-held-claims.ts` — read model for the review queue.
- New: `peek/src/server/mutations/payout-controls.ts` — `setPayoutPause`, `updatePayoutControls`.
- New: `peek/src/server/mutations/claim-review.ts` — `holdClaim`, `releaseClaim`, `rejectClaim`.
- Update: backend response shape for `GET /referral/claim/:claimId` adds `holdReason` and `releaseAt` fields.
- No public OpenAPI breaking changes; additions are additive.

---

## System Invariants

These are non-negotiable for correctness and treasury safety:

1. **Single choke point.** Every SOL transfer for a claimable payout MUST pass through the queue handler, which MUST call `payout-gate.evaluateGate` before initiating any transfer. No code path may bypass the gate.
2. **Gate evaluation order.** When evaluating a claim, checks run in this order: pause check (always first) → admin-approved short-circuit (skip remaining checks if `reviewed_at` is set) → threshold check (with optional delay sub-case). `manual_admin_hold` is set by an admin action, not by the gate. Pause always wins, even over admin-approved claims.
3. **Atomic hold transition.** Marking a claim `held` and writing its `hold_reason` MUST occur in a single DB update; the queue handler MUST NOT call `SystemProgram.transfer` after observing any hold condition.
4. **Reject preserves balance.** A `rejected` claim row MUST NOT be subtracted from the user's pending balance. The user can re-request a claim, which lands back in the gate.
5. **Active-claim uniqueness.** The partial unique index that prevents concurrent claims per wallet MUST treat `held` rows as active (in addition to `pending` and `processing`).
6. **Audit completeness.** Every mutation — pause toggle, controls update, hold/release/reject of a specific claim — MUST write a row to `operator_events` with actor, action, target, before, and after. No silent admin actions.
7. **Lamports-only accounting.** `review_threshold_lamports` and any monetary value transported by APIs are integer lamports (`BIGINT` in DB, string in JSON).
8. **Per-`claim_kind` controls.** Pause, threshold, and delay are scoped per `claim_kind`. Future claimables (e.g., `crate`) get their own row in `payout_controls`; `referral` controls do not affect them.
9. **Idempotency preserved.** Existing handler idempotency (re-processing the same event is a safe no-op) MUST hold; held / rejected / completed claims short-circuit before any transfer attempt.

---

## Functional Requirements

### FR-1: Payout Gate Service

A pure function evaluating a claim against the active controls and returning whether to proceed or hold (and why).

**Inputs:**
- `claim`: `{ id, claim_kind, amount_lamports, status, hold_reason?, release_at?, reviewed_at? }`
- `controls`: `{ pause_enabled, review_threshold_lamports, above_threshold_delay_seconds }` for that `claim_kind`
- `now`: timestamp (injected for testability)

**Output:**
- `{ proceed: true }` — handler may continue to `processing`/transfer
- `{ proceed: false, holdReason: 'global_pause' | 'above_threshold' | 'delay_timer' | 'manual_admin_hold', releaseAt?: timestamp }`

**Evaluation order (short-circuits on first match):**

1. **Pause check (always runs, even on admin-approved claims):** if `controls.pause_enabled` → hold with reason `global_pause`. Pause is the emergency override and overrides everything else.
2. **Admin-approved short-circuit:** if `claim.reviewed_at IS NOT NULL` (an admin has explicitly approved this claim by releasing it from a held state) → `proceed: true`. The threshold and delay checks are skipped because the admin has already accepted the risk.
3. **Threshold check:** if `claim.amount_lamports >= controls.review_threshold_lamports`:
   - If `above_threshold_delay_seconds > 0` AND the claim is being seen by the gate for the first time (no prior `delay_timer` hold has been applied — see note below) → hold with reason `delay_timer` and `releaseAt = now + above_threshold_delay_seconds`.
   - Otherwise → hold with reason `above_threshold`.
4. **Default:** `proceed: true`.

**"Already-delayed" detection:** the gate is pure (no DB), so it cannot directly track "we already delayed this claim once." Instead, the sweeper (FR-3) is responsible for transitioning a `held / delay_timer` claim to `held / above_threshold` when `release_at` elapses — meaning the gate never sees a `pending` claim with a stale `release_at`. By construction, when the gate runs against a `pending` claim, that claim has either never been delayed or has just been admin-approved (reviewed_at set, short-circuiting at step 2).

**Acceptance Criteria:**
- [ ] `evaluateGate` is a pure function with no DB or RPC side effects (DB writes happen in the handler, not the gate)
- [ ] Unit tests cover all four hold reasons and the proceed path
- [ ] Unit tests cover the precedence order: pause beats threshold, threshold beats delay
- [ ] Function is exported from `backend/src/services/payout-gate.ts` and imported by the referral claim handler

### FR-2: Claim Handler Integration

The existing referral claim handler is updated to call the gate before any transfer attempt.

**Updated flow:**
1. Load claim by ID.
2. Idempotency check: if status is `completed`, `failed`, or `rejected` → no-op return.
3. If status is `held` → call gate to determine if it should be released; if still held, no-op return (sweeper will re-queue when conditions clear).
4. Load `payout_controls` row for the claim's `claim_kind`.
5. Call `evaluateGate(claim, controls, now)`.
6. If `proceed: false` → atomically update claim to `status='held'`, `hold_reason=...`, `release_at=...` (where applicable). Do NOT call `SystemProgram.transfer`. Return without scheduling a retry.
7. If `proceed: true` → existing flow: update to `processing`, re-verify available balance (defense-in-depth), execute transfer, record `tx_signature`, update to `completed`. On transfer error, existing retry/backoff logic applies (the gate is not consulted on retries unless conditions change).

**Acceptance Criteria:**
- [ ] Handler calls `evaluateGate` after idempotency check and before any `SystemProgram.transfer` call
- [ ] When the gate returns a hold, the claim is updated to `held` with the correct `hold_reason` and (where applicable) `release_at`, and no transfer is attempted
- [ ] When the gate proceeds, existing transfer + retry behavior is preserved unchanged
- [ ] Re-processing a `held` claim is a safe no-op (idempotent under at-least-once delivery)
- [ ] Re-processing a `rejected` claim is a safe no-op and is not retried by the queue
- [ ] Integration test: pause toggled on → enqueue claim → claim is held with reason `global_pause`, no transfer occurs

### FR-3: Sweeper for Auto-Release

A periodic task that re-queues held claims whose hold condition has cleared.

**Behavior:**
- Runs alongside the existing event queue worker on the same tick (no new service or process).
- On each tick, scans `referral_claims WHERE status='held'` and:
  - For `hold_reason='global_pause'`: if `payout_controls.pause_enabled = false` for that `claim_kind`, set `status='pending'`, clear `hold_reason`, emit a fresh `referral.claim_requested` event.
  - For `hold_reason='delay_timer'` AND `release_at <= now`: transition the row in place to `hold_reason='above_threshold'`, clear `release_at`. The status stays `held`, no event is emitted, and no transfer is attempted. The claim now appears in the admin review queue.
  - For `hold_reason='above_threshold'` or `'manual_admin_hold'`: never touched. These require explicit admin action.
- Sweeper writes are idempotent: scanning the same claim repeatedly with the same admin/timer state is a no-op.

**Acceptance Criteria:**
- [ ] Sweeper runs on the existing worker tick — no separate cron or process
- [ ] When `pause_enabled` flips off, all `held / global_pause` claims for that `claim_kind` are returned to `pending` and re-emitted within one tick
- [ ] When a claim's `release_at` has elapsed, it is returned to `pending` and re-emitted within one tick
- [ ] `held / above_threshold` and `held / manual_admin_hold` are never modified by the sweeper
- [ ] Sweeper does not double-emit for the same claim (existing partial unique index on active claims acts as a guard, plus emission is conditional on the status update succeeding)

### FR-4: Database Schema

One new table and additive columns on `referral_claims`. Migration is forward-safe and additive — no destructive operations on existing data.

```sql
-- New: per-claim-kind controls
CREATE TABLE payout_controls (
  claim_kind                    TEXT PRIMARY KEY,
  pause_enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  review_threshold_lamports     BIGINT  NOT NULL DEFAULT 1000000000, -- 1 SOL
  above_threshold_delay_seconds INTEGER NOT NULL DEFAULT 0,
  updated_by                    TEXT,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (review_threshold_lamports >= 0),
  CHECK (above_threshold_delay_seconds >= 0)
);
INSERT INTO payout_controls (claim_kind) VALUES ('referral');

-- Extend referral_claims
ALTER TABLE referral_claims
  ADD COLUMN claim_kind  TEXT NOT NULL DEFAULT 'referral',
  ADD COLUMN hold_reason TEXT,
  ADD COLUMN release_at  TIMESTAMPTZ,
  ADD COLUMN reviewed_by TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Update status check constraint to include 'held' and 'rejected'
ALTER TABLE referral_claims DROP CONSTRAINT IF EXISTS referral_claims_status_check;
ALTER TABLE referral_claims ADD CONSTRAINT referral_claims_status_check
  CHECK (status IN ('pending','held','processing','completed','failed','rejected','error'));

-- Hold reason check (NULL when not held; values match gate enum)
ALTER TABLE referral_claims ADD CONSTRAINT referral_claims_hold_reason_check
  CHECK (
    (status = 'held' AND hold_reason IN ('global_pause','above_threshold','delay_timer','manual_admin_hold'))
    OR (status <> 'held' AND hold_reason IS NULL)
  );

-- Widen concurrent-claim guard to include 'held'
DROP INDEX IF EXISTS idx_referral_claims_wallet_active;
CREATE UNIQUE INDEX idx_referral_claims_wallet_active
  ON referral_claims (wallet)
  WHERE status IN ('pending','held','processing');

-- Index for sweeper + held-queue listing
CREATE INDEX idx_referral_claims_held
  ON referral_claims (claim_kind, hold_reason, release_at)
  WHERE status = 'held';
```

**`getPendingBalanceByUserId` update:** the query that subtracts active and completed claims from earnings MUST treat `rejected` rows as if they never happened (do not include them in the subtraction). Held rows continue to be subtracted (so a user cannot double-request while one is held).

**Acceptance Criteria:**
- [ ] Migration creates `payout_controls` with the `referral` row pre-inserted
- [ ] Migration adds the new columns to `referral_claims` without breaking existing rows (`claim_kind` defaults to `'referral'` for backfill)
- [ ] Updated status check constraint includes `held` and `rejected`
- [ ] `hold_reason` check constraint enforces the held↔reason invariant
- [ ] Concurrent-claim partial unique index includes `held`
- [ ] Sweeper-supporting partial index on `(claim_kind, hold_reason, release_at) WHERE status='held'` exists
- [ ] `getPendingBalanceByUserId` excludes `rejected` claims from the subtraction
- [ ] Migration is verified forward-only with existing devnet data

### FR-5: Backend API Surface

Minimal additive changes to existing endpoints. No new public endpoints.

**`GET /referral/claim/:claimId`** — response gains two optional fields:
```json
{
  "claimId": "uuid",
  "amountLamports": "string",
  "status": "pending | held | processing | completed | failed | rejected",
  "txSignature": "string?",
  "holdReason": "global_pause | above_threshold | delay_timer | manual_admin_hold | null",
  "releaseAt": "ISO-8601 timestamp | null"
}
```

**`POST /referral/claim`** — unchanged contract. The held-vs-pending decision happens later in the handler, not at request time. The user always gets `202` with `status: "pending"` initially.

**Authorization on internal payout operations:** all admin actions (pause, threshold, hold/release/reject) live in peek (server actions, not public API). They are never exposed on the public backend.

**Acceptance Criteria:**
- [ ] `GET /referral/claim/:claimId` includes `holdReason` (nullable) and `releaseAt` (nullable) in the response
- [ ] Status values returned to clients include `'held'` and `'rejected'` where applicable
- [ ] `POST /referral/claim` continues to return `202` with `status: 'pending'` regardless of whether the claim will subsequently be held
- [ ] No new public endpoint or breaking change is introduced
- [ ] Lamports values continue to be strings in JSON

### FR-6: Peek Admin — Payouts Page

A new server-rendered page in peek for operators to manage controls and review held claims.

**Route:** `peek/app/operations/payouts/page.tsx`

**Page sections (top to bottom):**

1. **Controls strip** — one card per `claim_kind` (only `referral` initially):
   - Prominent **Emergency pause** toggle. Confirmation dialog on enable. On change, calls `setPayoutPause(claim_kind, enabled)` server action.
   - **Review threshold** (input in SOL, stored as lamports) and **above-threshold delay** (input in seconds). "Save" button calls `updatePayoutControls(...)`.
   - Last-updated-by + last-updated-at displayed inline.
2. **Held queue table** — every claim where `status='held'`:
   - Columns: kind, user (id + handle if available), wallet, amount (SOL), `hold_reason`, `release_at` (if set), age (since `requested_at`).
   - Row actions: **Approve** (returns to `pending`), **Reject** (terminal), **Hold longer** (sets `release_at` in the future, switches reason to `manual_admin_hold` if not already).
   - Reject opens a small dialog requiring a `note` (free text, stored in the existing `error` column for context).
3. **Recent decisions** — last 50 admin actions on payouts, pulled from `operator_events` filtered to relevant action types. Read-only.

**Access:** the page and all mutations are gated by the existing peek admin role. No new role split for v1 — see Tech Debt note.

**Acceptance Criteria:**
- [ ] Route `peek/app/operations/payouts/page.tsx` exists and is reachable from the admin shell nav (under Operations)
- [ ] Controls strip renders the current `payout_controls` row for `referral` and supports pause toggle, threshold edit, delay edit
- [ ] Held queue table lists every `referral_claims` row with `status='held'` with the columns above and approve/reject/hold-longer actions
- [ ] Recent decisions list shows the last 50 payout-related `operator_events` rows
- [ ] Page is gated behind the existing peek admin role check; unauthorized users see the existing access-denied component

### FR-7: Peek Mutations

All mutations follow the existing `peek/src/server/mutations/` pattern: server-only, role-checked, audit-logged, before/after captured.

**`setPayoutPause(claim_kind, enabled): void`**
- Loads current row, updates `pause_enabled`, sets `updated_by`, `updated_at`.
- Audit: `{ action: 'payout.pause.set', target: claim_kind, before: { enabled }, after: { enabled } }`.

**`updatePayoutControls(claim_kind, threshold_lamports, delay_seconds): void`**
- Validates `threshold_lamports >= 0` and `delay_seconds >= 0`.
- Updates row, sets `updated_by`, `updated_at`.
- Audit: `{ action: 'payout.controls.update', target: claim_kind, before: {...}, after: {...} }`.

**`holdClaim(claim_id, note?): void`**
- Loads claim; if status is not `pending` or `held`, error.
- Sets `status='held'`, `hold_reason='manual_admin_hold'`, `reviewed_by`, `reviewed_at`. If `note`, store in `error` column (current convention) for context.
- Audit: `{ action: 'payout.claim.hold', target: claim_id, before: {...}, after: {...} }`.

**`releaseClaim(claim_id): void`**
- Loads claim; if status is not `held`, error.
- Sets `status='pending'`, clears `hold_reason` and `release_at`, sets `reviewed_by`, `reviewed_at`. Emits a fresh `referral.claim_requested` event in the same DB tx so the handler picks it up.
- Audit: `{ action: 'payout.claim.release', target: claim_id, before: {...}, after: {...} }`.

**`rejectClaim(claim_id, note): void`**
- Loads claim; if status is not `held`, error. Note is required (cannot be empty).
- Sets `status='rejected'`, clears `hold_reason`, sets `reviewed_by`, `reviewed_at`, stores `note` in `error` column. Terminal — no event emission.
- The `getPendingBalanceByUserId` query (FR-4) ensures the user's claimable balance is restored.
- Audit: `{ action: 'payout.claim.reject', target: claim_id, before: {...}, after: { note } }`.

**Acceptance Criteria:**
- [ ] All five mutations exist in `peek/src/server/mutations/` and are exported from the registry
- [ ] Each mutation calls the existing role check before touching DB
- [ ] Each mutation writes an `operator_events` row with actor email, action, target, before, after
- [ ] `holdClaim`, `releaseClaim`, `rejectClaim` reject invalid status transitions with a clear error
- [ ] `releaseClaim` emits a fresh `referral.claim_requested` event in the same DB transaction as the status update
- [ ] `rejectClaim` requires a non-empty note
- [ ] Unit tests cover the happy path and at least one invalid-transition path per mutation

### FR-8: Peek Read Models

**`get-held-claims.ts`** — read model for the review queue:
- Returns `{ claimId, claimKind, userId, wallet, amountLamports, holdReason, releaseAt, requestedAt, error }` for every `status='held'` row, joined with player handle/identity if available (via existing `peek-user-detail` patterns).
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

Adding one state plus an enum captures four distinct hold conditions without state explosion. The state machine stays readable, the FE/admin UI maps reasons to copy without branching on status, and future hold conditions (e.g., per-user manual freeze) only need a new enum value, not a new column or state.

### Why the queue handler stays the only choke point

The existing handler already serializes per-claim work via the queue. Putting the gate inside it avoids any new locking concerns and keeps "before any transfer" trivially true: there is one place that calls `SystemProgram.transfer`, and the gate sits directly above it.

### Why above-threshold and manual holds never auto-release

These represent explicit operator suspicion or policy. Time-based release would defeat their purpose. Pause and delay holds are mechanical and safe to auto-release.

### Why reject restores the balance instead of zeroing it

A rejected claim is a refusal to send *this* request, not a confiscation of earnings. Users may have legitimate claims later (or the request may have been spurious). Subtracting the rejected row from balance would penalize the user for an admin decision and would make UX/audit harder when a hold is overturned.

### Why per-`claim_kind` controls

Future SOL-bearing crates (and any later claimable) will have different risk profiles, fraud models, and acceptable thresholds. A single global pause/threshold would either be too coarse (one pause kills everything) or require schema change later.

### Why no new role split

Peek already gates every mutation via the same admin role and writes audit on every change. Splitting `treasury_operator` from generic `admin` adds friction without addressing a specific present threat. We log this in TECH_DEBT and revisit when there is a concrete reason (e.g., new operator onboarded with limited scope).

### Why no public-facing claim cancellation

Spec scope is admin-side controls. User-side claim cancellation, claim re-request UX, and any "your claim is under review" copy are frontend concerns handled by the separate frontend team. We surface `holdReason`/`releaseAt` on the existing claim status endpoint so the frontend has data when it chooses to use it.

---

## Success Criteria

- An admin can flip a single switch and stop all referral SOL transfers within one queue tick, with no deploy.
- Claims at or above the configured threshold do not transfer until an admin approves them.
- The above-threshold delay (when set) gives operators a configurable window to investigate before review prompts appear.
- A rejected claim restores the user's claimable balance — the user can re-request without operator intervention.
- A held claim never blocks the user from seeing accurate status (status + hold reason are returned by the existing claim status endpoint).
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
- A single admin role is acceptable for v1; we accept the lack of split privileges as TECH_DEBT.
- The frontend team will surface `holdReason`/`releaseAt` to users when and how they see fit — not a backend concern.
- Devnet is the primary verification environment; production rollout is gated by manual smoke + a documented runbook (out of scope for this spec).

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Gate evaluates pause-first | Unit test: pause + above-threshold both true → reason `global_pause` | Test output |
| 2 | Gate evaluates threshold-second | Unit test: pause off, amount ≥ threshold, no delay → reason `above_threshold` | Test output |
| 3 | Gate evaluates delay-third | Unit test: pause off, amount ≥ threshold, delay > 0, no `release_at` → reason `delay_timer` with `releaseAt = now + delay` | Test output |
| 4 | Gate proceeds when all clear | Unit test: pause off, amount < threshold → `proceed: true` | Test output |
| 5 | Handler writes `held` and skips transfer | Integration test: enable pause, run handler → claim status becomes `held / global_pause`, no `tx_signature` written | Test output + DB check |
| 6 | Handler proceeds when gate clears | Integration test: pause off, low amount → claim becomes `completed` with `tx_signature` | Test output + tx sig |
| 7 | Sweeper releases pause-held on un-pause | Integration test: enable pause → enqueue claim → claim held → disable pause → within one tick claim returns to `pending` and is re-emitted | Test output + DB check |
| 8 | Sweeper transitions delay-held on timer expiry | Integration test: set delay 2s + threshold low → enqueue claim → wait 3s → claim has `hold_reason='above_threshold'`, `release_at` is null, status still `held` | Test output |
| 9 | Sweeper does not touch admin holds | Integration test: above-threshold hold + manual hold → run sweeper → both rows unchanged | Test output |
| 10 | Migration is forward-safe | Apply migration on a copy of devnet data with existing claims → all rows valid, no constraint violations, `claim_kind` defaulted | Migration log + count check |
| 11 | Concurrent-claim guard includes held | DB-level test: insert pending row, then attempt insert second row for same wallet while first is held → conflict | Test output |
| 12 | Reject restores balance | Unit test on `getPendingBalanceByUserId`: with one rejected and one completed claim, balance excludes only completed | Test output |
| 13 | Claim status endpoint exposes hold metadata | API test: held claim → response has `holdReason` and `releaseAt` | Test output |
| 14 | `setPayoutPause` writes audit | Mutation test: toggle pause → `operator_events` row exists with before/after | Test output + DB check |
| 15 | `updatePayoutControls` validates non-negative | Mutation test: pass negative threshold → error, no DB write | Test output |
| 16 | `holdClaim` rejects invalid transitions | Mutation test: try to hold a `completed` claim → error | Test output |
| 17 | `releaseClaim` re-emits event | Mutation test: release a held claim → `operator_events` row + new queue event in same tx | Test output + DB check |
| 18 | `rejectClaim` requires note | Mutation test: empty note → error | Test output |
| 19 | Peek payouts page renders | Visual test: page loads with controls, held queue, recent decisions | Screenshot |
| 20 | Peek payouts page is gated | Access test: non-admin email → access denied | Test output |

---

## Completion Signal

### Implementation Checklist

#### Backend — Database

- [ ] [backend] Migration `028_payout_controls.sql`: create `payout_controls` table with `referral` seed row, extend `referral_claims` with `claim_kind`/`hold_reason`/`release_at`/`reviewed_by`/`reviewed_at`, update status check constraint to include `held` and `rejected`, add `hold_reason` check, recreate `idx_referral_claims_wallet_active` to include `held`, add `idx_referral_claims_held` partial index (FR-4)
- [ ] [backend] Update `getPendingBalanceByUserId` to exclude `rejected` claims from the subtraction (FR-4 + Invariant 4)
- [ ] [backend] Add DB accessors for `payout_controls` (`getPayoutControls(kind)`, `setPayoutPause(...)`, `updatePayoutControls(...)`) and held-claim queries (`listHeldClaims(...)`, `getHeldClaim(id)`) following the existing `db.ts` pattern (FR-7, FR-8)

#### Backend — Gate Service

- [ ] [backend] Create `backend/src/services/payout-gate.ts` exporting `evaluateGate(claim, controls, now)` — pure function, no side effects (FR-1)
- [ ] [backend] Unit tests covering precedence (pause > threshold > delay), each hold reason, and the proceed path (FR-1)

#### Backend — Handler Integration

- [ ] [backend] Update `backend/src/queue/handlers/referral-claim.ts` to load `payout_controls`, call `evaluateGate`, and on hold update claim status atomically without calling `SystemProgram.transfer` (FR-2)
- [ ] [backend] Integration test: pause toggled → claim held with `global_pause` reason, no transfer (FR-2)
- [ ] [backend] Integration test: amount ≥ threshold → claim held with `above_threshold` (FR-2)
- [ ] [backend] Integration test: gate proceeds → existing transfer + completion flow unchanged (FR-2)
- [ ] [backend] Integration test: reprocessing a `held`/`rejected` claim is a no-op (FR-2 + Invariant 9)

#### Backend — Sweeper

- [ ] [backend] Add a periodic sweep step to the existing event-queue worker tick that re-queues `held / global_pause` claims when pause is off and `held / delay_timer` claims when `release_at <= now`. Never touches `above_threshold` or `manual_admin_hold` (FR-3)
- [ ] [backend] Integration test: pause off → held-by-pause claim returned to pending and re-emitted within one tick (FR-3)
- [ ] [backend] Integration test: delay timer elapsed → held-by-delay claim transitions in place to `held / above_threshold` (does not return to pending; admin must act) (FR-3)

#### Backend — API Surface

- [ ] [backend] Update `GET /referral/claim/:claimId` response to include `holdReason` and `releaseAt` (FR-5)
- [ ] [backend] API test: held claim response shape includes hold metadata; non-held claim returns nulls for the new fields (FR-5)

#### Peek — Read Models

- [ ] [peek] `peek/src/server/db/queries/get-held-claims.ts` — list held claims with user identity join (FR-8)
- [ ] [peek] `peek/src/server/db/queries/get-payout-controls.ts` — list controls per claim kind (FR-8)
- [ ] [peek] `peek/src/server/db/queries/get-recent-payout-decisions.ts` — last 50 `operator_events` with `payout.*` action (FR-8)
- [ ] [peek] Unit tests with fixture rows and empty-state assertions for each read model (FR-8)

#### Peek — Mutations

- [ ] [peek] `peek/src/server/mutations/payout-controls.ts` — `setPayoutPause`, `updatePayoutControls` with role check + audit (FR-7)
- [ ] [peek] `peek/src/server/mutations/claim-review.ts` — `holdClaim`, `releaseClaim`, `rejectClaim` with role check + audit (FR-7)
- [ ] [peek] Register all five mutations in the existing peek mutation registry (FR-7)
- [ ] [peek] Unit tests: happy path + at least one invalid-transition path for each mutation (FR-7)
- [ ] [peek] `releaseClaim` emits a `referral.claim_requested` event in the same DB transaction as the status update (FR-7 + Invariant 9)

#### Peek — Page

- [ ] [peek] `peek/app/operations/payouts/page.tsx` — server-rendered page with controls strip, held queue, recent decisions (FR-6)
- [ ] [peek] Add the page to the admin shell nav under Operations (FR-6)
- [ ] [peek] Components: payouts controls card, held claims table with row actions, payout decisions list (FR-6)
- [ ] [peek] Page is gated behind existing peek admin role check; unauthorized users see access-denied (FR-6)
- [ ] [peek] E2E test: pause toggle persists; held claim approve/reject/hold-longer flows update DB and audit (FR-6)
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
- [ ] Edge cases handled (held under pause + threshold + delay simultaneously; reprocessing held/rejected; mid-flight pause)
- [ ] Error states handled (invalid transitions, empty reject note, negative threshold/delay)

#### Visual Regression
- [ ] `cd peek && pnpm test:visual` passes (or N/A documented)
- [ ] If this spec changes UI: affected baselines regenerated and committed

#### Smoke Test (Human-in-the-Loop)

- [ ] Toggle emergency pause on → observe new claim becomes `held / global_pause` and no transfer occurs
- [ ] Toggle pause off → observe held claim returns to `pending` and completes within one tick
- [ ] Set threshold below a normal claim → claim becomes `held / above_threshold` until admin approves
- [ ] Approve a held claim → SOL arrives in user wallet, claim becomes `completed` with `tx_signature`
- [ ] Reject a held claim with a note → claim becomes `rejected`, user's pending balance is restored, audit row exists
- [ ] Set above-threshold delay > 0 → above-threshold claim sits in `delay_timer` until elapsed, then transitions to `above_threshold`
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
