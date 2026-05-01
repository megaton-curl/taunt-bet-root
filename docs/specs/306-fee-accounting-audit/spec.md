# Specification: 306 Fee Accounting Audit

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P0 |
| Track | Core |
| NR_OF_TRIES | 9 |

---

## Overview

Create a durable accounting trail for platform fees so the backend can prove, at any point, where settled fees have been allocated and whether any claim, promotion spend, or profit withdrawal would overdraw its bucket.

Every settled fee is split into virtual buckets:

1. referral allocation according to the effective referrer rate, if any
2. promotions/crates allocation equal to 20% of the post-referral remainder
3. profit allocation equal to the remaining 80% of the post-referral remainder

Claims and future promotion/profit spending are recorded as bucket debits. Audit views derive balances from allocations minus active/completed debits instead of trusting mutable counters.

## User Stories

- As an operator, I want to reconcile all settled fees against referral liabilities, promotion budget, and profit so that we do not overspend treasury funds.
- As an engineer, I want deterministic accounting invariants so that settlement, claims, and future reward spend cannot double count the same fee.
- As a finance reviewer, I want bounded audit checkpoints so that repeated checks do not require a full historical scan.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Platform fee accounting, backend settlement, rewards economy, referral claims.
- **Current baseline fit**: In Progress.
- **Planning bucket**: Core.

## Required Context Files

- `backend/src/worker/settle-tx.ts` (FlipYou + Pot Shot settlement, calls `recordReferralEarnings`)
- `backend/src/worker/settlement.ts` (Close Call settlement loop)
- `backend/src/worker/closecall-clock.ts` (Close Call round resolution)
- `backend/src/db/referrals.ts`
- `backend/src/queue/handlers/referral-claim.ts`
- `backend/src/routes/referral.ts`
- `backend/src/routes/admin.ts`
- `backend/migrations/010_referral.sql`
- `backend/migrations/018_reward_economy.sql`
- `docs/specs/300-referral-system/spec.md`
- `docs/specs/401-reward-economy/spec.md`

## Contract Files

- `backend/src/db/fee-accounting.ts`
- `backend/migrations/026_fee_accounting_audit.sql`
- `backend/src/__tests__/fee-accounting.test.ts`
- `backend/src/__tests__/integration-settlement.test.ts`
- `backend/src/__tests__/referral-routes.test.ts`
- `backend/src/__tests__/admin-fee-audit.test.ts`

---

## Functional Requirements

### FR-1: Immutable Fee Allocation Ledger

For each unique player fee observed during settlement, the backend records one allocation event. This event preserves the economic inputs and derived buckets for that fee.

**Acceptance Criteria:**
- [ ] Each allocation row stores source type, source id, game type, wallet, optional user id, wager lamports, fee lamports, referrer user id, referral rate bps, referral lamports, promotions lamports, profit lamports, and created timestamp.
- [ ] Allocation rows are idempotent by source type, source id, and player wallet.
- [ ] The database rejects allocations where `fee_lamports != referral_lamports + promotions_lamports + profit_lamports`.
- [ ] Settlement records allocation rows even when the player has no referral link.
- [ ] FlipYou (`settleMatch`), Pot Shot (`settleLordRound`), and Close Call settlement paths each write one allocation row per unique player per round.
- [ ] Allocations are go-forward only: rounds settled before migration `026` are not retroactively reconstructed; the audit snapshot reports its `audit_from` cutoff timestamp so finance reviewers know what era is covered.

### FR-2: Deterministic Fee Split

The split is deterministic and integer-safe.

**Acceptance Criteria:**
- [ ] Referral allocation is `floor(fee_lamports * referral_rate_bps / 10000)`.
- [ ] Promotions allocation is `floor((fee_lamports - referral_lamports) * 2000 / 10000)`.
- [ ] Profit allocation is the remainder after referral and promotions, absorbing rounding dust.
- [ ] Referral rate must be between 0 and 10000 bps inclusive.

### FR-3: Bucket Debit Ledger

Claims and future spends are recorded as debits against explicit buckets.

**Acceptance Criteria:**
- [ ] Referral claim requests insert a `referral` bucket debit keyed by claim id.
- [ ] Claim processing keeps the debit status in sync with the claim status.
- [ ] Audit checks treat `pending`, `processing`, `error`, and `completed` debits as reserved/spent and exclude `failed` debits.
- [ ] Debit rows are idempotent by bucket, debit type, and source id.

### FR-4: Audit Snapshot

The backend exposes a derived snapshot that reconciles allocations, debits, and available balances.

**Acceptance Criteria:**
- [ ] Snapshot reports total fees, bucket allocations, active/completed debits, pending claim reserves, failed debits, available balances, allocation count, and debit count.
- [ ] Snapshot reports invariant failures when allocations do not sum to fees.
- [ ] Snapshot reports overdrawn buckets when active/completed debits exceed allocated bucket balances.
- [ ] Admin API exposes the snapshot behind existing admin API key auth.

### FR-5: Bounded Historical Audit

Checkpoints prevent routine audits from growing without bound while preserving the ability to recompute history.

**Acceptance Criteria:**
- [ ] A checkpoint table stores period bounds, included row counts, bucket totals, ending balances, previous checkpoint hash, source hash, and created timestamp.
- [ ] Checkpoints are acceleration records, not the source of truth; raw allocation and debit ledgers remain authoritative.
- [ ] A checkpoint generator function reads `[previous_ending_at, cutoff_at)` from the ledger, computes bucket totals + ending balances, and writes one checkpoint row.
- [ ] The generator validates `new_start_balance == previous_ending_balance` before writing and refuses to write on mismatch (caller receives a structured error, not a corrupt row).
- [ ] An admin endpoint exposes manual checkpoint generation behind the existing admin API key.

### FR-6: Claim Limits Derived From Buckets

Claim safety checks are derived from the ledger and replace the legacy `getPendingBalanceByUserId` check on the claim hot path.

**Acceptance Criteria:**
- [ ] `POST /referral/claim` rejects when the requested amount exceeds `(user's referral allocations) − (user's active+completed referral debits)`.
- [ ] `POST /referral/claim` rejects when the requested amount exceeds the global referral bucket's available balance (sum of all referral allocations minus all active+completed referral debits).
- [ ] The legacy `getPendingBalanceByUserId` call site is removed from the claim route; the ledger-derived computation is the single source of truth for claim caps.
- [ ] Per-claim, per-user daily, and global daily caps remain optional policy layers that may sit on top of the derived caps but cannot replace them.

---

## Success Criteria

- Operators can explain every lamport of settled fee as referral liability, promotions/crates budget, or profit.
- Referral claims reserve bucket capacity when requested and release it when permanently failed.
- Routine audits can run from a checkpoint plus recent rows once checkpoint generation is added.
- Settlement remains idempotent under retry.

---

## Dependencies

- Existing settlement worker and referral claim queue.
- Existing admin API key route.
- Postgres `gen_random_uuid()` availability.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Allocation split sums exactly to fee | Unit test | `calculateFeeAllocation` cases with rounding |
| 2 | FlipYou settlement writes referred + non-referred allocation rows | Integration test | `fee_allocation_events` rows after `settleMatch` |
| 3 | Pot Shot settlement writes allocation rows | Integration test | `fee_allocation_events` rows after `settleLordRound` |
| 4 | Close Call settlement writes allocation rows | Integration test | `fee_allocation_events` rows after Close Call resolve |
| 5 | Claim requests insert debit rows in same tx | Route test | `fee_bucket_debits` row with pending status |
| 6 | Claim handler updates debit status | Handler/unit test | debit row completed/failed alongside claim |
| 7 | Claim route enforces ledger-derived caps | Route test | `/referral/claim` returns 422 when amount > derived available |
| 8 | Audit snapshot detects overdraw + invariant breaks | Unit/DB test | snapshot `overdrawnBuckets` + `invariantViolations` populated |
| 9 | Admin snapshot endpoint protects and returns shape | Route test | 401 without key, 200 with key |
| 10 | Checkpoint generator enforces continuity | Unit/DB test | second checkpoint refuses write when `start != previous_end` |
| 11 | Admin checkpoint endpoint protects and triggers generator | Route test | 401 without key, 202 with key, row written |

---

## Completion Signal

### Implementation Checklist

Order matters: schema first, then helpers, then producer wiring (settlement), then consumer wiring (claim hot path + queue handler), then audit/admin surface, then checkpoint generator. Tests sit alongside their producing item where practical, and any item already implemented is marked `[x]` with a note.

Each implementation section ends with a `[review]` retrospective gate. After the section is complete and its outcome is visible, the iteration must look back with fresh eyes and ask whether — with high conviction — a simpler/better approach is now obvious. If yes, either adapt the code in place or append a new item to this checklist before moving to the next section. If no, log "no change after review" and proceed. Treat `[review]` items as full iterations, not bookkeeping — they may produce real diffs.

#### Foundations

- [x] [backend] Create `backend/migrations/026_fee_accounting_audit.sql` with three tables: `fee_allocation_events` (allocation ledger, UNIQUE on `(source_type, source_id, wallet)`, CHECK that `referral_lamports + promotions_lamports + profit_lamports = fee_lamports`, CHECK `referral_rate_bps BETWEEN 0 AND 10000`); `fee_bucket_debits` (bucket debit ledger, UNIQUE on `(bucket, debit_type, source_id)`, CHECK on `bucket IN ('referral','promotions','profit')`, CHECK on `status IN ('pending','processing','error','completed','failed')`); `fee_audit_checkpoints` (`period_start`, `period_end`, allocation/debit row counts, bucket totals, ending balances, `previous_checkpoint_hash`, `source_hash`, `created_at`, with UNIQUE on `period_end`). Include the indexes the audit snapshot query will rely on (`(bucket, status)`, `(created_at)`). (done: iteration 1)
- [x] [backend] Create `backend/src/db/fee-accounting.ts` exporting `calculateFeeAllocation(feeLamports, referrerRateBps)` (returns `{referralLamports, promotionsLamports, profitLamports}` using floor-with-dust-to-profit math from FR-2) and the typed DB methods `insertFeeAllocation`, `insertFeeBucketDebit`, `updateFeeBucketDebitStatus`, `getReferralBucketAvailable`, `getUserReferralAvailable`, `getFeeAuditSnapshot`. No call sites yet — pure helpers + DB methods. Wire onto the `Db` interface. (done: iteration 2)
- [x] [test] Add `backend/src/__tests__/fee-accounting.test.ts` covering `calculateFeeAllocation`: 0% / 100% / mid-range referral rates, single-lamport rounding (dust always lands in profit), `feeLamports = 0`, max-bps = 10000, and that the three components always sum exactly to `feeLamports`. Include CHECK-constraint test that the DB rejects an inserted row whose components don't sum. (done: iteration 3)
- [x] [review] Now that the migration, helpers, and unit tests exist and the outcome is visible, look back with fresh eyes. If a simpler or better path is now clear with high conviction (e.g. table shape, helper API surface, or test seams), either adapt the code in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed. (done: iteration 4)

#### Settlement producers (allocation writes)

- [x] [backend] In `backend/src/worker/settle-tx.ts` `settleMatch` (FlipYou), extend `recordReferralEarnings` (or add a sibling `recordFeeAllocations`) so that for each unique player it computes the split via `calculateFeeAllocation` and writes one `fee_allocation_events` row per player — including non-referred players (`referrer_user_id = NULL`, `referral_rate_bps = 0`, `referral_lamports = 0`). Reuse the existing `txDb` transaction so allocation insertion shares atomicity with settlement DB writes. Idempotent on retry via the `(source_type, source_id, wallet)` UNIQUE. (done: iteration 5)
- [x] [backend] Apply the same allocation write inside `settleLordRound` (Pot Shot) in `backend/src/worker/settle-tx.ts`. Pot Shot can have multiple entries per wallet — sum to one allocation row per (round, wallet), matching the existing `recordReferralEarnings` dedupe. (done: iteration 6)
- [x] [backend] Add allocation write to the Close Call settlement path (`backend/src/worker/settlement.ts` and/or `closecall-clock.ts` — locate the post-resolve fee/payout step and write one `fee_allocation_events` row per Close Call entry's wallet, using `source_type = 'closecall_round'`, `source_id = round id`). (done: iteration 7)
- [x] [test] Add settlement integration coverage to `backend/src/__tests__/integration-settlement.test.ts` (or a new `integration-fee-allocation.test.ts`) asserting that after FlipYou + Pot Shot + Close Call settlement, `fee_allocation_events` contains the expected rows for both referred and non-referred players, components sum to `fee_lamports`, and a duplicate settle attempt is a no-op. (done: iteration 8)
- [x] [review] Now that fee allocation writes are wired into FlipYou, Pot Shot, and Close Call settlement and the integration tests show the actual ledger rows, look back with fresh eyes. Three near-identical write paths usually point at a shared helper or hook — if a unifying abstraction is now obviously better with high conviction, either refactor in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed. (done: iteration 9)

#### Claim hot path (debit producer + ledger-derived caps)

- [ ] [backend] In `backend/src/routes/referral.ts` `POST /claim`, replace `getPendingBalanceByUserId` with two ledger-derived checks via the new helpers: claim ≤ `getUserReferralAvailable(userId)` and claim ≤ `getReferralBucketAvailable()`. Keep the existing `referralMinClaimLamports` policy gate. Inside the same `sql.begin` transaction that inserts the `referral_claims` row and emits the queue event, also insert a `fee_bucket_debits` row (`bucket='referral'`, `debit_type='claim'`, `source_id=claim.id`, `status='pending'`). Confirm the existing `insertReferralEarning` / `getPendingBalanceByUserId` are still used elsewhere, or delete them with grep evidence.
- [ ] [backend] In `backend/src/queue/handlers/referral-claim.ts`, after every `db.updateClaimStatus` call (and the insufficient-balance permanent-fail branch), call `updateFeeBucketDebitStatus` for the same `claim_id` so the debit moves through `processing → completed | failed | error` in lockstep with the claim. Reuse the same DB transaction where claim status updates already use one.
- [ ] [test] Extend `backend/src/__tests__/referral-routes.test.ts` (or add `referral-claim-ledger.test.ts`) to cover: ledger cap enforcement (per-user and global) returns 422 with the documented `API_ERROR_CODES` envelope; successful claim writes a `fee_bucket_debits` row with `status='pending'`; queue handler success/transient-error/permanent-fail each update the debit's status to match the claim.
- [ ] [review] Now that the ledger-derived claim caps and debit-lifecycle sync are live and tests show the actual claim → debit transitions, look back with fresh eyes. Hot-path replacements often leave dead helpers, race windows around the `sql.begin` boundary, or missed status edges (e.g. `error → completed`). If a higher-conviction simpler/safer shape is now clear, either adapt the code in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed.

#### Audit snapshot

- [ ] [backend] Implement `getFeeAuditSnapshot` in `db/fee-accounting.ts`: returns `{ totals: { feeLamports, allocationCount, debitCount }, buckets: { referral: { allocated, activeDebits, completedDebits, pendingClaimReserves, failedDebits, available }, promotions: {...}, profit: {...} }, invariantViolations: [...], overdrawnBuckets: [...], auditFrom: TIMESTAMPTZ }`. `auditFrom` is the earliest `created_at` in `fee_allocation_events` (the go-forward cutoff). Treat `pending|processing|error|completed` as reserved/spent, exclude `failed`.
- [ ] [backend] Add `GET /admin/fee-audit/snapshot` to `backend/src/routes/admin.ts`, gated by the existing `x-admin-api-key` middleware. Return the snapshot via the standard `ok(c, ...)` envelope. Add an OpenAPI path module alongside other admin routes.
- [ ] [test] Add `backend/src/__tests__/admin-fee-audit.test.ts`: snapshot returns expected shape after seeded allocations + debits; overdrawn bucket triggers `overdrawnBuckets` populated; allocation row whose components have been hand-tampered (or a synthetic `fee_lamports` mismatch) shows up in `invariantViolations`; admin route returns 401 without key and 200 with key.
- [ ] [review] Now that the audit snapshot DB query and admin endpoint are implemented and you can read a real snapshot end-to-end, look back with fresh eyes. Snapshot shapes often grow accidental coupling between SQL aggregation and the response envelope, or miss an obvious-in-hindsight invariant the operator would actually want surfaced. If a higher-conviction simpler structure or extra invariant is now clear, either adapt the code in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed.

#### Checkpoint generator

- [ ] [backend] Add `generateFeeAuditCheckpoint(cutoffAt: Date)` in `db/fee-accounting.ts`: reads the previous `fee_audit_checkpoints` row (if any), validates `new_start_balance == previous.ending_balance` for each bucket, computes new totals from allocations/debits in `[previous.period_end, cutoffAt)`, computes `source_hash` (deterministic — e.g. SHA-256 over the included row IDs in canonical order) and `previous_checkpoint_hash`, and inserts the new row. Throw a structured error (no row written) if the continuity check fails.
- [ ] [backend] Add `POST /admin/fee-audit/checkpoint` to `backend/src/routes/admin.ts` (admin-API-key gated), accepting an optional `cutoffAt` body field (defaulting to `now()`), invoking `generateFeeAuditCheckpoint`, and returning the new checkpoint row as `202 Accepted`.
- [ ] [test] Add checkpoint coverage to `admin-fee-audit.test.ts`: first checkpoint succeeds with empty previous; second checkpoint enforces continuity (write succeeds when balances align, refuses with structured error when start ≠ previous end); admin route returns 401 without key and 202 with key.
- [ ] [review] Now that the checkpoint generator and its admin endpoint are implemented and the continuity test demonstrates the actual rejection path, look back with fresh eyes. Checkpoint logic often hides subtle issues around `source_hash` determinism, period-boundary off-by-ones, or whether the snapshot endpoint should consult the latest checkpoint. If a higher-conviction simpler shape is now clear, either adapt the code in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed.

#### Coverage stubs

- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` — N/A: spec 306 changes only backend ledger + admin endpoints; no browser flow exists. Document N/A with this reason in the test plan summary.
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes — N/A: no frontend surface changes (admin views live in `peek/`, not in scope of this spec).
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff — N/A: no new on-chain provider integration; settlement paths reuse existing oracles.

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
- [ ] Devnet E2E passes (if applicable) — N/A
- [ ] API contracts documented
- [ ] Settlement flow tested end-to-end through DB ledger rows

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`
