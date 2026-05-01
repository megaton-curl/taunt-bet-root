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

---

## Iteration 3 — 2026-05-01

**Item**: Add `backend/src/__tests__/fee-accounting.test.ts` covering `calculateFeeAllocation` and the `fee_allocation_events` CHECK constraint.

**Outcome**: Success.

**Changes**:
- Added `backend/src/__tests__/fee-accounting.test.ts` with 12 tests:
  - Pure unit coverage for `calculateFeeAllocation`: 0% bps, 10000 bps, mid-range bps, dust always lands in profit (single-lamport + 7-lamport mid-bps cases), `feeLamports = 0` across the bps grid, max-bps absorbs the entire fee, components-sum-to-fee invariant on a 9 × 10 grid of (fee, bps) pairs, and input-validation throws (negative/non-integer fee, negative/over-10000/non-integer bps).
  - DB-backed coverage: a hand-crafted `INSERT` whose components don't sum to `fee_lamports` is rejected with the exact constraint name `ck_fee_allocation_components_sum`, and a parallel valid insert succeeds and is cleaned up.
- Added `src/__tests__/fee-accounting.test.ts` to `vitest.integration.files.ts` (test holds a Postgres handle, so it belongs in the integration job).

**Verification**:
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/fee-accounting.test.ts` — 12/12 passed.
- `cd backend && pnpm lint` — exit 0 (only pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.

**Notes**:
- Migration `026_fee_accounting_audit.sql` had not been applied to the local dev DB; ran it through `psql` and inserted a `_migrations` row so the test can rely on the table being present. Production runs migrations on startup, so no follow-up needed.
- The DB constraint test uses random `source_id` + `wallet` strings to stay isolated from any concurrent fixture data and explicitly cleans up its own row.

## Iteration 3 — 2026-05-01T19:48:00Z — OK
- **Log**: iteration-003.log

## Iteration 3 — 2026-05-01T19:50:06Z — OK
- **Log**: iteration-003.log

---

## Iteration 4 — 2026-05-01

**Item**: `[review]` retrospective for the Foundations section (migration + helpers + unit tests).

**Outcome**: No change after review.

**What I looked at**:
- `backend/migrations/026_fee_accounting_audit.sql` — three tables, CHECK constraints + partial indexes already in place; `wallet`/`updated_at` adds on `fee_bucket_debits` are cheap and forensically useful.
- `backend/src/db/fee-accounting.ts` — `calculateFeeAllocation` is integer-safe with input validation; the `RESERVED_OR_SPENT_STATUSES` constant maps 1:1 to the FR-3 acceptance language; insert helpers are idempotent on the spec-mandated unique keys; snapshot uses BigInt composition to avoid Number precision loss across many high-value rows.
- `backend/src/__tests__/fee-accounting.test.ts` — covers helper edge cases (0 fee, dust, max bps, validation throws) plus a DB CHECK round-trip with the exact constraint name.

**Considered, rejected**:
- Tightening `insertFeeBucketDebit.amountLamports` from `number | string` to `number` only — permissive form doesn't hurt callers; no force-multiplier benefit.
- Wrapping `getFeeAuditSnapshot` in a `REPEATABLE READ` transaction — snapshot is forensic, not a hot path; the natural inter-query race is acceptable for accounting evidence.
- Merging `active` + `completed` accumulators in the snapshot — keeping them separate preserves forensic visibility into how much capacity is reserved vs. permanently spent.

**Verification**:
- Spec-only edit (one checkbox flip + history append). No code changed.

## Iteration 4 — 2026-05-01 — review (no diff)

## Iteration 4 — 2026-05-01T19:52:13Z — OK
- **Log**: iteration-004.log

---

## Iteration 5 — 2026-05-01

**Item**: Extend `recordReferralEarnings` in `backend/src/worker/settle-tx.ts` so FlipYou's `settleMatch` writes one `fee_allocation_events` row per unique player (referred and non-referred).

**Outcome**: Success.

**Changes**:
- `backend/src/worker/settle-tx.ts`:
  - Imported `calculateFeeAllocation` from `../db/fee-accounting.js`.
  - Restructured `recordReferralEarnings` to no longer short-circuit when the player has no profile or no referral link. Every unique player now produces a `fee_allocation_events` row via `db.insertFeeAllocation`. Non-referred players get `referrer_user_id = null`, `referral_rate_bps = 0`, `referral_lamports = 0`. The legacy `referral_earnings` insert still happens only when a referrer exists.
  - The split is computed once via `calculateFeeAllocation(feeLamports, referrerRateBps)`, and `referrerEarnedLamports` is now sourced from the helper instead of a duplicate `Math.floor` so the two ledgers cannot drift.
  - Updated docstring + log strings to reflect the broader purpose ("fee accounting row" vs. "referral earning"); preserved the existing duplicate-key idempotent-skip branch.
  - Function still runs inside the caller's `txDb` so allocation writes share atomicity with the rest of settlement.

**Notes**:
- The function is shared between FlipYou (`settleMatch`) and Pot Shot (`settleLordRound`). Extending it in place naturally satisfies the next checklist item too — the dedupe map already produces one row per `(round, wallet)` for Pot Shot. The Pot Shot iteration will confirm the wiring and check off.
- Close Call settles via a different path (`worker/settlement.ts` / `closecall-clock.ts`), so it remains unwired and is the third settlement-producer item.
- Allocation rows are go-forward only — no backfill of pre-migration rounds (per FR-1).

**Verification**:
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: integration test for the new write path lands in the dedicated test item further down the section.

## Iteration 5 — 2026-05-01T19:56:29Z — OK
- **Log**: iteration-005.log

---

## Iteration 6 — 2026-05-01

**Item**: Apply the allocation write inside `settleLordRound` (Pot Shot) in `backend/src/worker/settle-tx.ts`, summing multiple entries per wallet into one allocation row per (round, wallet).

**Outcome**: Success — confirmation iteration. The wiring already lands correctly because of how iteration 5 was structured.

**What was verified**:
- `recordReferralEarnings` is shared between FlipYou and Pot Shot. Iteration 5 made it write `fee_allocation_events` for every unique player (referred or not). The dedupe map at `settle-tx.ts:144-148` sums multiple entries per wallet into a single `wagerLamports` total before any DB work runs.
- `settleLordRound` already calls the same hook inside its `db.withTransaction` block (`settle-tx.ts:741-751`) with `serializedEntries.map((e) => ({ wallet: e.player, wagerLamports: e.amountLamports }))`. The hook then collapses repeated wallets to one row keyed by the spec-mandated `(source_type, source_id, wallet)` UNIQUE.
- Idempotency: a Pot Shot retry hits the UNIQUE-conflict path inside `insertFeeAllocation` (ON CONFLICT DO NOTHING + re-select) and is logged as an idempotent skip — same shape as FlipYou.
- Per-player attribution: per-wallet `feeLamports = floor(walletWagerSum * feeBps / 10_000)`. The sum across wallets approximates (within at most N−1 lamports of floor-rounding dust) the on-chain `floor(totalAmountLamports * feeBps / 10_000)`. This per-player basis is the right accounting unit per FR-1; the on-chain treasury figure remains the source of truth for treasury inflow.

**Changes**:
- No code changes. Spec checkbox flipped + history entry appended.

**Verification**:
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: integration coverage for the Pot Shot allocation write lands in the dedicated `[test]` checklist item later in the section.

**Notes**:
- Close Call still settles via a different path (`worker/settlement.ts` / `closecall-clock.ts`). It remains unwired and is the next checklist item.

## Iteration 6 — 2026-05-01T19:59:19Z — OK
- **Log**: iteration-006.log

