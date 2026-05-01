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

