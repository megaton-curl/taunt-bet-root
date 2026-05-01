# Specification: 306 Fee Accounting Audit

## Meta

| Field | Value |
|-------|-------|
| Status | Complete |
| Priority | P0 |
| Track | Core |
| NR_OF_TRIES | 13 |

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
- [x] Each allocation row stores source type, source id, game type, wallet, optional user id, wager lamports, fee lamports, referrer user id, referral rate bps, referral lamports, promotions lamports, profit lamports, and created timestamp. <!-- satisfied: backend/migrations/026_fee_accounting_audit.sql:12-45 -->
- [x] Allocation rows are idempotent by source type, source id, and player wallet. <!-- satisfied: UNIQUE at migrations/026:28-29 + ON CONFLICT DO NOTHING at db/fee-accounting.ts:293 -->
- [x] The database rejects allocations where `fee_lamports != referral_lamports + promotions_lamports + profit_lamports`. <!-- satisfied: CHECK at migrations/026:31-32, covered by fee-accounting.test.ts -->
- [x] Settlement records allocation rows even when the player has no referral link. <!-- satisfied: worker/settle-tx.ts:132-217 writes regardless of link; integration-fee-allocation.test.ts:217-225 -->
- [x] FlipYou (`settleMatch`), Pot Shot (`settleLordRound`), and Close Call settlement paths each write one allocation row per unique player per round. <!-- satisfied: settle-tx.ts:454,742 + closecall-clock.ts:525; integration-fee-allocation.test.ts -->
- [x] Allocations are go-forward only: rounds settled before migration `026` are not retroactively reconstructed; the audit snapshot reports its `audit_from` cutoff timestamp so finance reviewers know what era is covered. <!-- satisfied: db/fee-accounting.ts:412 MIN(created_at) AS audit_from in snapshot -->

### FR-2: Deterministic Fee Split

The split is deterministic and integer-safe.

**Acceptance Criteria:**
- [x] Referral allocation is `floor(fee_lamports * referral_rate_bps / 10000)`. <!-- satisfied: db/fee-accounting.ts:160 -->
- [x] Promotions allocation is `floor((fee_lamports - referral_lamports) * 2000 / 10000)`. <!-- satisfied: db/fee-accounting.ts:161-162 -->
- [x] Profit allocation is the remainder after referral and promotions, absorbing rounding dust. <!-- satisfied: db/fee-accounting.ts:163; tested in fee-accounting.test.ts dust cases -->
- [x] Referral rate must be between 0 and 10000 bps inclusive. <!-- satisfied: helper validation db/fee-accounting.ts:149-158 + DB CHECK migrations/026:34-35 -->

### FR-3: Bucket Debit Ledger

Claims and future spends are recorded as debits against explicit buckets.

**Acceptance Criteria:**
- [x] Referral claim requests insert a `referral` bucket debit keyed by claim id. <!-- satisfied: routes/referral.ts:723-731; asserted in referral-claim-ledger.test.ts -->
- [x] Claim processing keeps the debit status in sync with the claim status. <!-- satisfied: queue/handlers/referral-claim.ts:71-74,87-92,144-147,164-170 (all four sites wrapped in db.withTransaction) -->
- [x] Audit checks treat `pending`, `processing`, `error`, and `completed` debits as reserved/spent and exclude `failed` debits. <!-- satisfied: db/fee-accounting.ts:172-178 RESERVED_OR_SPENT_STATUSES used by getReferralBucketAvailable, getUserReferralAvailable, getFeeAuditSnapshot -->
- [x] Debit rows are idempotent by bucket, debit type, and source id. <!-- satisfied: UNIQUE at migrations/026:70-71 + ON CONFLICT DO NOTHING at db/fee-accounting.ts:322 -->

### FR-4: Audit Snapshot

The backend exposes a derived snapshot that reconciles allocations, debits, and available balances.

**Acceptance Criteria:**
- [x] Snapshot reports total fees, bucket allocations, active/completed debits, pending claim reserves, failed debits, available balances, allocation count, and debit count. <!-- satisfied: db/fee-accounting.ts:395-533 getFeeAuditSnapshot returns full FeeAuditSnapshot shape -->
- [x] Snapshot reports invariant failures when allocations do not sum to fees. <!-- satisfied: db/fee-accounting.ts:435-453 returns invariantViolations -->
- [x] Snapshot reports overdrawn buckets when active/completed debits exceed allocated bucket balances. <!-- satisfied: db/fee-accounting.ts:498-512 populates overdrawnBuckets -->
- [ ] Admin API exposes the snapshot behind existing admin API key auth. <!-- gap: no GET /admin/fee-audit/snapshot route in backend/src/routes/admin.ts; no OpenAPI module; no admin-fee-audit.test.ts -->

### FR-5: Bounded Historical Audit

Checkpoints prevent routine audits from growing without bound while preserving the ability to recompute history.

**Acceptance Criteria:**
- [x] A checkpoint table stores period bounds, included row counts, bucket totals, ending balances, previous checkpoint hash, source hash, and created timestamp. <!-- satisfied: migrations/026_fee_accounting_audit.sql:93-128 fee_audit_checkpoints -->
- [x] Checkpoints are acceleration records, not the source of truth; raw allocation and debit ledgers remain authoritative. <!-- satisfied: architectural; documented in migrations/026:1-10 and db/fee-accounting.ts:8-12; no code reads checkpoints as source of truth -->
- [ ] A checkpoint generator function reads `[previous_ending_at, cutoff_at)` from the ledger, computes bucket totals + ending balances, and writes one checkpoint row. <!-- gap: no generateFeeAuditCheckpoint function exists in db/fee-accounting.ts (line 10 comment notes "a separate generator in a later iteration") -->
- [ ] The generator validates `new_start_balance == previous_ending_balance` before writing and refuses to write on mismatch (caller receives a structured error, not a corrupt row). <!-- gap: no generator implementation exists -->
- [ ] An admin endpoint exposes manual checkpoint generation behind the existing admin API key. <!-- gap: no POST /admin/fee-audit/checkpoint route in backend/src/routes/admin.ts -->

### FR-6: Claim Limits Derived From Buckets

Claim safety checks are derived from the ledger and replace the legacy `getPendingBalanceByUserId` check on the claim hot path.

**Acceptance Criteria:**
- [x] `POST /referral/claim` rejects when the requested amount exceeds `(user's referral allocations) − (user's active+completed referral debits)`. <!-- satisfied: routes/referral.ts:679-690 ZERO_BALANCE/BELOW_THRESHOLD via getUserReferralAvailable; tested in referral-claim-ledger.test.ts -->
- [x] `POST /referral/claim` rejects when the requested amount exceeds the global referral bucket's available balance (sum of all referral allocations minus all active+completed referral debits). <!-- satisfied: routes/referral.ts:704-713 PRECONDITION_FAILED via getReferralBucketAvailable; tested in referral-claim-ledger.test.ts -->
- [x] The legacy `getPendingBalanceByUserId` call site is removed from the claim route; the ledger-derived computation is the single source of truth for claim caps. <!-- satisfied: routes/referral.ts no longer calls getPendingBalanceByUserId; remaining handler-side use at queue/handlers/referral-claim.ts:78 is a defensive sanity check, not the cap source -->
- [x] Per-claim, per-user daily, and global daily caps remain optional policy layers that may sit on top of the derived caps but cannot replace them. <!-- satisfied: architectural — no daily caps exist today; ledger derivation is the gate; design supports stacking additional caps on top -->

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

- [x] [backend] In `backend/src/routes/referral.ts` `POST /claim`, replace `getPendingBalanceByUserId` with two ledger-derived checks via the new helpers: claim ≤ `getUserReferralAvailable(userId)` and claim ≤ `getReferralBucketAvailable()`. Keep the existing `referralMinClaimLamports` policy gate. Inside the same `sql.begin` transaction that inserts the `referral_claims` row and emits the queue event, also insert a `fee_bucket_debits` row (`bucket='referral'`, `debit_type='claim'`, `source_id=claim.id`, `status='pending'`). Confirm the existing `insertReferralEarning` / `getPendingBalanceByUserId` are still used elsewhere, or delete them with grep evidence. (done: iteration 10)
- [x] [backend] In `backend/src/queue/handlers/referral-claim.ts`, after every `db.updateClaimStatus` call (and the insufficient-balance permanent-fail branch), call `updateFeeBucketDebitStatus` for the same `claim_id` so the debit moves through `processing → completed | failed | error` in lockstep with the claim. Reuse the same DB transaction where claim status updates already use one. (done: iteration 11)
- [x] [test] Extend `backend/src/__tests__/referral-routes.test.ts` (or add `referral-claim-ledger.test.ts`) to cover: ledger cap enforcement (per-user and global) returns 422 with the documented `API_ERROR_CODES` envelope; successful claim writes a `fee_bucket_debits` row with `status='pending'`; queue handler success/transient-error/permanent-fail each update the debit's status to match the claim. (done: iteration 12)
- [x] [review] Now that the ledger-derived claim caps and debit-lifecycle sync are live and tests show the actual claim → debit transitions, look back with fresh eyes. Hot-path replacements often leave dead helpers, race windows around the `sql.begin` boundary, or missed status edges (e.g. `error → completed`). If a higher-conviction simpler/safer shape is now clear, either adapt the code in place or append a new checklist item below before continuing. If nothing better surfaces, note "no change after review" in the iteration log and proceed. (done: iteration 13)

#### Audit snapshot

- [x] [backend] Implement `getFeeAuditSnapshot` in `db/fee-accounting.ts`: returns `{ totals: { feeLamports, allocationCount, debitCount }, buckets: { referral: { allocated, activeDebits, completedDebits, pendingClaimReserves, failedDebits, available }, promotions: {...}, profit: {...} }, invariantViolations: [...], overdrawnBuckets: [...], auditFrom: TIMESTAMPTZ }`. `auditFrom` is the earliest `created_at` in `fee_allocation_events` (the go-forward cutoff). Treat `pending|processing|error|completed` as reserved/spent, exclude `failed`. (done in earlier loop iteration; see `db/fee-accounting.ts:395-533`)
- [x] [backend] Add `GET /admin/fee-audit/snapshot` to `backend/src/routes/admin.ts`, gated by the existing `X-Admin-Key` middleware. Returns plain `c.json(snapshot)` to match the rest of the admin sub-router. (done — gap-resolution pass; see `routes/admin.ts` `/fee-audit/snapshot`. Spec text originally said `ok(c, ...)` envelope and OpenAPI module, but `backend/CLAUDE.md` keeps admin routes off the public OpenAPI contract; spec corrected here.)
- [x] [test] Add `backend/src/__tests__/admin-fee-audit.test.ts`: snapshot returns expected shape after seeded allocations + debits; overdrawn bucket triggers `overdrawnBuckets` populated; allocation row whose components have been hand-tampered shows up in `invariantViolations`; admin route returns 401 without key and 200 with key. (done — 12 tests, all passing)
- [x] [review] Audit snapshot review: structure stayed clean — the SQL aggregation and response shape are decoupled (raw rows → in-memory `FeeAuditSnapshot` shape), so no re-coupling risk surfaced. **One spec correction made**: the original checklist said "Add an OpenAPI path module alongside other admin routes" using `ok(c, ...)`, but `backend/CLAUDE.md` explicitly excludes admin routes from the public OpenAPI contract. Matched the existing admin-route pattern (plain Hono, plain `c.json`, plain `{ error: "..." }` shape) instead. No code change needed beyond that, no new checklist items.

#### Checkpoint generator

- [x] [backend] Add `generateFeeAuditCheckpoint(cutoffAt: Date)` in `db/fee-accounting.ts`: reads the previous `fee_audit_checkpoints` row (if any), validates `new_start_balance == previous.ending_balance` for each bucket, computes new totals from allocations/debits in `[previous.period_end, cutoffAt)`, computes `source_hash` (SHA-256 over the canonical-order row IDs in the window) and `previous_checkpoint_hash`, and inserts the new row. Throws `FeeAuditCheckpointContinuityError` (no row written) on continuity mismatch and `FeeAuditCheckpointCutoffError` when `cutoffAt <= previous.period_end`. (done — gap-resolution pass)
- [x] [backend] Add `POST /admin/fee-audit/checkpoint` to `backend/src/routes/admin.ts`, accepting an optional `cutoffAt` ISO-8601 body field (defaulting to `now()`), invoking `generateFeeAuditCheckpoint`, and returning the new checkpoint row as `202 Accepted`. Maps `FeeAuditCheckpointContinuityError` and `FeeAuditCheckpointCutoffError` to `409` with diff details. (done — gap-resolution pass)
- [x] [test] Add checkpoint coverage to `admin-fee-audit.test.ts`: first checkpoint covers an empty ledger; second checkpoint succeeds when continuity holds; corrupted previous-ending-balance triggers `409 CONTINUITY_MISMATCH` with diffs and writes no new row; same-cutoff replay returns `409 INVALID_CUTOFF`; malformed `cutoffAt` returns `400`; auth gate covered. (done — 7 checkpoint tests, all passing)
- [x] [review] Checkpoint generator review: `source_hash` is deterministic over canonical-ordered row IDs (no created_at/clock dependency), boundaries are explicit half-open `[period_start, period_end)`, and the snapshot endpoint deliberately does NOT consult checkpoints — checkpoints are an acceleration record, the live snapshot stays the source of truth (matches FR-5 #2 and the table comment). One real subtlety surfaced and was handled: the cumulative-balance helper deliberately uses `created_at < boundaryAt` so a row created at exactly `cutoffAt` lands in the next checkpoint, never both. No code change beyond that, no new checklist items.

#### Coverage stubs

- [x] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` — **N/A**: spec 306 changes only backend ledger + admin endpoints; no browser flow exists. Coverage is provided by the integration tests (`integration-fee-allocation.test.ts`, `referral-claim-ledger.test.ts`, `admin-fee-audit.test.ts`).
- [x] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes — **N/A**: no frontend surface changes. Admin views live in `peek/` (separate submodule) and are out of scope of this spec.
- [x] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff — **N/A**: no new on-chain provider integration; settlement paths reuse existing FlipYou/Pot Shot/Close Call oracle wiring without modification.

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
