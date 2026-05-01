# Implementation History — 306-fee-accounting-audit

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — 2026-05-01

**Item**: Create `backend/migrations/026_fee_accounting_audit.sql`.

**Outcome**: Success.

**Changes**:
- Added `backend/migrations/026_fee_accounting_audit.sql` with three tables:
  - `fee_allocation_events` — allocation ledger. UNIQUE on `(source_type, source_id, wallet)`, CHECK that the three component lamport columns sum to `fee_lamports`, CHECK `referral_rate_bps BETWEEN 0 AND 10000`, plus a non-negative-amount guard. Indexed on `created_at`, with partial indexes on `referrer_user_id` and `user_id` (the audit snapshot's per-user/per-referrer queries).
  - `fee_bucket_debits` — bucket debit ledger. UNIQUE on `(bucket, debit_type, source_id)`, CHECK `bucket IN ('referral','promotions','profit')`, CHECK status enum matches the spec. Indexed on `(bucket, status)` and `(created_at)`. Partial index on `(user_id, bucket, status)` for `getUserReferralAvailable`.
  - `fee_audit_checkpoints` — bounded acceleration snapshots. Stores period bounds, row counts, bucket totals, ending balances, hashes. UNIQUE on `period_end`, plus a `period_end > period_start` guard.

**Verification**:
- `cd backend && pnpm lint` — exit 0 (one pre-existing warning in `contracts/api-envelope.ts`, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: this iteration is SQL only, no TS code changed.

**Notes**:
- Added a `wallet` column to `fee_bucket_debits` to allow per-user queries to be human-debuggable; not strictly required by the spec but cheap.
- Added an `updated_at` column on debits — needed for the lockstep claim/debit status sync in a later iteration.
- No data migration: ledger is go-forward only per FR-1 last bullet.

## Iteration 1 — 2026-05-01T19:36:11Z — OK
- **Log**: iteration-001.log

---

## Iteration 2 — 2026-05-01

**Item**: Create `backend/src/db/fee-accounting.ts` with `calculateFeeAllocation` helper and typed DB methods. Wire onto the `Db` interface.

**Outcome**: Success.

**Changes**:
- Added `backend/src/db/fee-accounting.ts`:
  - `calculateFeeAllocation(feeLamports, referrerRateBps)` — pure FR-2 split (referral floor → promotions floor on remainder × 20% → profit absorbs dust). Validates non-negative integer fee + bps in `[0, 10000]`.
  - `insertFeeAllocation` — writes one allocation row, idempotent on `(source_type, source_id, wallet)` via `ON CONFLICT DO NOTHING` + re-select.
  - `insertFeeBucketDebit` — writes one debit row, idempotent on `(bucket, debit_type, source_id)`.
  - `updateFeeBucketDebitStatus(bucket, debitType, sourceId, status)` — transitions debit status, bumps `updated_at`. Returns `undefined` if the row is missing.
  - `getReferralBucketAvailable()` — global referral bucket: sum of allocation referral_lamports minus sum of `pending|processing|error|completed` referral debits.
  - `getUserReferralAvailable(userId)` — per-user referrer balance, same shape.
  - `getFeeAuditSnapshot()` — totals + per-bucket allocated/active/completed/pendingClaimReserves/failed/available, plus `invariantViolations` (rows where components ≠ fee) and `overdrawnBuckets`. Treats `pending|processing|error|completed` as reserved/spent, excludes `failed`. `auditFrom` is `MIN(created_at)`.
- Wired `FeeAccountingDb` into `backend/src/db.ts`: extended the `Db` interface, spread `createFeeAccountingDb(sql)` into `createDb`, exported types + the helper. The factory consumes the same `sql` argument so transactional `createDb(_, txSql)` calls compose without code changes.

**Verification**:
- `cd backend && pnpm lint` — exit 0 (one pre-existing warning in `contracts/api-envelope.ts`, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: no call sites yet — the dedicated unit test file lands in the next checklist item.

**Notes**:
- `getFeeAuditSnapshot` is implemented now rather than stubbed — the SQL is small and deferring it would force the next `[review]` iteration to re-revisit shape decisions. The dedicated audit-snapshot section can refine if needed.
- All large lamport sums are returned as strings (matching `getPendingBalanceByUserId`), with `BigInt` arithmetic in the snapshot composition to avoid Number precision loss across many high-value allocations.
- Insert helpers return the row whether newly-inserted or pre-existing, so retry-driven settlement code can rely on the return type.

## Iteration 2 — 2026-05-01T19:43:31Z — OK
- **Log**: iteration-002.log

