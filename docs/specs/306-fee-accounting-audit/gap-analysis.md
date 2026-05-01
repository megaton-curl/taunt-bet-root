# Gap Analysis: 306 — Fee Accounting Audit

- **Date**: 2026-05-01
- **Spec status**: Ready
- **Previous analysis**: First run

## Implementation Inventory

### Database Schema (`backend/migrations/026_fee_accounting_audit.sql`)
| Object | Details | Line |
|--------|---------|------|
| `fee_allocation_events` | Allocation ledger; UNIQUE(source_type, source_id, wallet); CHECK components sum; CHECK rate_bps∈[0,10000] | 12-45 |
| Index `idx_fee_allocation_events_created_at` | Audit-snapshot ordering | 47-48 |
| Index `idx_fee_allocation_events_referrer` (partial) | Per-referrer queries | 50-52 |
| Index `idx_fee_allocation_events_user` (partial) | Per-user queries | 54-56 |
| `fee_bucket_debits` | Bucket debit lifecycle ledger; UNIQUE(bucket, debit_type, source_id); CHECK bucket; CHECK status enum | 58-81 |
| Index `idx_fee_bucket_debits_bucket_status` | Snapshot reserved/spent grouping | 83-84 |
| Index `idx_fee_bucket_debits_user` (partial) | `getUserReferralAvailable` query | 89-91 |
| `fee_audit_checkpoints` | Acceleration snapshot table (no generator yet) | 93-128 |

### Backend Helpers (`backend/src/db/fee-accounting.ts`)
| Export | Purpose | Line |
|--------|---------|------|
| `calculateFeeAllocation(feeLamports, referrerRateBps)` | Pure FR-2 split with input validation | 142-166 |
| `insertFeeAllocation` | Idempotent allocation insert | 272-307 |
| `insertFeeBucketDebit` | Idempotent debit insert | 309-334 |
| `updateFeeBucketDebitStatus` | Status transition for debit row | 336-346 |
| `getReferralBucketAvailable` | Global referral bucket available | 348-367 |
| `getUserReferralAvailable(userId)` | Per-user referrer available | 369-393 |
| `getFeeAuditSnapshot` | Full reconciliation snapshot (totals, buckets, invariantViolations, overdrawnBuckets, auditFrom) | 395-533 |

### Settlement Producers
| Path | Source | Line |
|------|--------|------|
| Shared helper `recordReferralEarnings` | `backend/src/worker/settle-tx.ts` | 132-217 |
| FlipYou `settleMatch` call site | `backend/src/worker/settle-tx.ts` | 454 |
| Pot Shot `settleLordRound` call site | `backend/src/worker/settle-tx.ts` | 742 |
| Close Call `settleRound` call site | `backend/src/worker/closecall-clock.ts` | 525 |

### Claim Hot Path
| Path | Source | Line |
|------|--------|------|
| `POST /referral/claim` ledger caps + debit insert | `backend/src/routes/referral.ts` | 665-746 |
| Queue handler debit lifecycle sync (4 sites, all wrapped in `withTransaction`) | `backend/src/queue/handlers/referral-claim.ts` | 71-74, 87-92, 144-147, 164-170 |

### Admin Endpoints
| Path | Status |
|------|--------|
| `GET /admin/fee-audit/snapshot` | **Not implemented** — no route in `backend/src/routes/admin.ts` |
| `POST /admin/fee-audit/checkpoint` | **Not implemented** — no route in `backend/src/routes/admin.ts` |

### Tests
| Test | Type | File | Status |
|------|------|------|--------|
| `calculateFeeAllocation` unit + DB CHECK | unit + DB | `backend/src/__tests__/fee-accounting.test.ts` | passing (12 tests, iter 3 log) |
| FlipYou + Pot Shot + Close Call ledger writes | integration | `backend/src/__tests__/integration-fee-allocation.test.ts` | passing (3 tests, iter 8 log) |
| Referral claim ledger caps + debit lifecycle | integration | `backend/src/__tests__/referral-claim-ledger.test.ts` | passing (7 tests, iter 12 log) |
| Existing referral-routes regression | integration | `backend/src/__tests__/referral-routes.test.ts` | passing (29 tests with ledger seeding) |
| Admin fee audit + checkpoint | route | `backend/src/__tests__/admin-fee-audit.test.ts` | **Not implemented** |

---

## Acceptance Criteria Audit

### FR-1: Immutable Fee Allocation Ledger

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Allocation row stores all required columns | SATISFIED | `migrations/026_fee_accounting_audit.sql:12-45` (all 13 columns + created_at) |
| 2 | Idempotent by (source_type, source_id, wallet) | SATISFIED | UNIQUE at `migrations/026:28-29`; `ON CONFLICT DO NOTHING` at `db/fee-accounting.ts:293` |
| 3 | DB rejects rows where components ≠ fee | SATISFIED | CHECK at `migrations/026:31-32`; covered by `fee-accounting.test.ts` constraint test |
| 4 | Settlement records allocation rows even with no referral link | SATISFIED | `worker/settle-tx.ts:132-217` writes allocation regardless of `link`; non-referred case in `integration-fee-allocation.test.ts:217-225` |
| 5 | FlipYou + Pot Shot + Close Call each write one row per unique (round, player) | SATISFIED | `worker/settle-tx.ts:454,742`, `worker/closecall-clock.ts:525`; integration test in `integration-fee-allocation.test.ts` (3 game lifecycle assertions) |
| 6 | Go-forward only; snapshot reports `audit_from` cutoff | SATISFIED (data) | `db/fee-accounting.ts:412` `MIN(created_at) AS audit_from` returned in snapshot. Note: snapshot is not externally exposed yet (see FR-4#4). |

### FR-2: Deterministic Fee Split

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `floor(fee × bps / 10000)` for referral | SATISFIED | `db/fee-accounting.ts:160` |
| 2 | `floor((fee − referral) × 2000 / 10000)` for promotions | SATISFIED | `db/fee-accounting.ts:161-162` |
| 3 | Profit = remainder; absorbs dust | SATISFIED | `db/fee-accounting.ts:163`; tested in `fee-accounting.test.ts` dust cases |
| 4 | bps ∈ [0, 10000] inclusive | SATISFIED | Helper validation `db/fee-accounting.ts:149-158`; DB CHECK `migrations/026:34-35` |

### FR-3: Bucket Debit Ledger

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `POST /referral/claim` inserts a `referral` debit keyed by claim id | SATISFIED | `routes/referral.ts:723-731`; asserted in `referral-claim-ledger.test.ts` |
| 2 | Claim processing keeps debit status in sync | SATISFIED | `queue/handlers/referral-claim.ts:71-74,87-92,144-147,164-170` (all four sites wrapped in `db.withTransaction`) |
| 3 | Audit treats `pending\|processing\|error\|completed` as reserved/spent; excludes `failed` | SATISFIED | `db/fee-accounting.ts:172-178` `RESERVED_OR_SPENT_STATUSES`; used by `getReferralBucketAvailable`, `getUserReferralAvailable`, `getFeeAuditSnapshot` |
| 4 | Idempotent by (bucket, debit_type, source_id) | SATISFIED | UNIQUE at `migrations/026:70-71`; `ON CONFLICT DO NOTHING` at `db/fee-accounting.ts:322` |

### FR-4: Audit Snapshot

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Snapshot reports totals, bucket allocations, active/completed debits, pending claim reserves, failed debits, available, allocation count, debit count | SATISFIED (data layer only) | `db/fee-accounting.ts:395-533`; `FeeAuditSnapshot` shape covers all fields |
| 2 | Snapshot reports invariant failures when components ≠ fee | SATISFIED (data layer only) | `db/fee-accounting.ts:435-453` returns `invariantViolations` |
| 3 | Snapshot reports overdrawn buckets when reserved/spent > allocated | SATISFIED (data layer only) | `db/fee-accounting.ts:498-512` populates `overdrawnBuckets` |
| 4 | Admin API exposes the snapshot behind admin API key auth | **GAP** | No route in `backend/src/routes/admin.ts`; no OpenAPI module; no `admin-fee-audit.test.ts` |

### FR-5: Bounded Historical Audit

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Checkpoint table stores period bounds, counts, totals, ending balances, hashes, created_at | SATISFIED (table) | `migrations/026_fee_accounting_audit.sql:93-128` |
| 2 | Checkpoints are acceleration; raw ledgers remain authoritative | SATISFIED (architectural) | Documented in `migrations/026:1-10` and `db/fee-accounting.ts:8-12`; nothing reads checkpoints as source of truth |
| 3 | Generator function reads `[previous_ending_at, cutoff_at)`, computes totals + ending balances, writes one row | **GAP** | No `generateFeeAuditCheckpoint` exists in `db/fee-accounting.ts` (only the table comment at line 10 references "a separate generator in a later iteration") |
| 4 | Generator validates `new_start_balance == previous_ending_balance`, refuses to write on mismatch | **GAP** | No generator implementation exists |
| 5 | Admin endpoint exposes manual checkpoint generation behind admin API key | **GAP** | No `POST /admin/fee-audit/checkpoint` route in `backend/src/routes/admin.ts` |

### FR-6: Claim Limits Derived From Buckets

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Claim rejects when amount > per-user available | SATISFIED | `routes/referral.ts:679-690` (ZERO_BALANCE/BELOW_THRESHOLD via `getUserReferralAvailable`); covered by `referral-claim-ledger.test.ts` ZERO_BALANCE test |
| 2 | Claim rejects when amount > global bucket available | SATISFIED | `routes/referral.ts:704-713` PRECONDITION_FAILED via `getReferralBucketAvailable`; covered by `referral-claim-ledger.test.ts` PRECONDITION_FAILED test |
| 3 | Legacy `getPendingBalanceByUserId` removed from claim route; ledger is single source of truth | SATISFIED | `routes/referral.ts` no longer calls `getPendingBalanceByUserId` (grep). Helper still used in `queue/handlers/referral-claim.ts:78` as a defensive secondary check, which the spec explicitly permits ("optional policy layers"). Iteration 13 review log explicitly flagged this as out-of-scope follow-up. |
| 4 | Per-claim, per-user daily, and global daily caps remain optional policy layers | SATISFIED (architectural) | No daily caps exist today; ledger-derived caps are the gate. Architecture supports stacking additional caps without replacing the ledger derivation. |

---

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|----|-----------|----------|----------|------------|-----------|
| 1 | FR-4 | Admin API exposes snapshot behind admin API key | moderate | backend/route | none | Add `GET /admin/fee-audit/snapshot` to `routes/admin.ts` calling `db.getFeeAuditSnapshot()`; emit via `ok(c, ...)`; add OpenAPI path module; add `admin-fee-audit.test.ts` covering 401 without key + 200 shape with key + overdraw/invariant assertions |
| 2 | FR-5 | Checkpoint generator function | moderate | backend/db | none | Add `generateFeeAuditCheckpoint(cutoffAt)` to `db/fee-accounting.ts`: read previous checkpoint, compute totals over `[prev.period_end, cutoffAt)`, hash row IDs deterministically, insert one row |
| 3 | FR-5 | Generator continuity check (new_start == prev_end, refuse on mismatch) | moderate | backend/db | gap #2 | Inside generator, validate `new_start_balance == previous.ending_balance` per bucket; throw structured error before insert on mismatch |
| 4 | FR-5 | Admin endpoint for manual checkpoint generation | low | backend/route | gap #2, gap #3 | Add `POST /admin/fee-audit/checkpoint` to `routes/admin.ts` accepting optional `cutoffAt`, returning new checkpoint as `202 Accepted`; cover with checkpoint tests in `admin-fee-audit.test.ts` |

Severity legend: critical (blocks launch) / moderate (degrades operability or audit guarantees) / low (polish).
Category: on-chain / frontend / engine / test / docs / backend.

---

## Deferred Items

None. The spec contains no deferral language; every gap above is an explicit unfinished checklist item from the "Audit snapshot" and "Checkpoint generator" sections of the Implementation Checklist.

---

## Recommendations

1. **The spec is not done.** History iteration 13 is marked `COMPLETE`, but the unchecked items in the spec's Implementation Checklist (Audit snapshot section + Checkpoint generator section + Coverage stubs section's review of N/A justifications) mean the FR-4 (admin route) and FR-5 (generator + admin route) acceptance criteria are not yet met. Either reopen the spec loop and execute iterations 14-21 (per the checklist) or transition the spec status from "Ready" to "In Progress".
2. **Closing FR-4 is a 1-2 hour task**: `getFeeAuditSnapshot` already returns the full shape — the only missing pieces are the route wrapper, OpenAPI module, and route test. There is no design risk left.
3. **FR-5 generator design is fully specified** in the Implementation Checklist and does not require additional brainstorming. The only design question is `source_hash` determinism (canonical row-id ordering, SHA-256), which is already noted in the checklist.
4. **The `getPendingBalanceByUserId` callsite in `queue/handlers/referral-claim.ts:78`** is not a gap for FR-6 (the criterion targets the claim *route*, which is satisfied), but it is a known follow-up flagged in iteration 13. Consider lifting it to the ledger for full single-source-of-truth alignment in a successor spec or under spec 999-enhancements.
5. **No deferrals to cross-check** — this spec stands on its own and does not punt work to other specs.

