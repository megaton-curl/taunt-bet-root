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

---

## Iteration 7 — 2026-05-01

**Item**: Add allocation write to the Close Call settlement path so the third game wires into `fee_allocation_events`.

**Outcome**: Success.

**Changes**:
- `backend/src/worker/settle-tx.ts`: exported the existing `recordReferralEarnings` helper. No logic change — same dedupe map, same per-player allocation write, same idempotent error handling. The helper has always been the right tool here; only a one-keyword visibility change was required.
- `backend/src/worker/closecall-clock.ts`:
  - Imported `recordReferralEarnings` from `./settle-tx.js`.
  - Added `referralDefaultRateBps: number` to `CloseCallClockDeps` so the helper can resolve KOL rates with the same default as FlipYou/Pot Shot.
  - Inside `settleRound`'s existing `db.withTransaction` block, after `txDb.insertTransactions(txParams)` and before `upsertGameEntries`, called `recordReferralEarnings(txDb, …)` with `gameType: "closecall"`, `roundId` (= `String(Number(minuteTs))`), the resolved `feeBps` from `PlatformConfig`, and `players` mapped from `allEntries`. The hook only runs on non-refund settlements (refunds take no on-chain fee → no allocation to record). The transaction guarantees allocation writes share atomicity with the rest of Close Call settlement.
- `backend/src/index.ts`: passed `referralDefaultRateBps: config.referralDefaultRateBps` to `createCloseCallClockWorker`.
- `backend/src/__tests__/integration-settlement.test.ts`: passed `referralDefaultRateBps: 1000` to the in-test worker (matches the FlipYou/Pot Shot fixtures already in this file).

**Notes**:
- Used `sourceType: "closecall"` (via `gameType` reuse) rather than the spec's loose hint `'closecall_round'` to stay aligned with the existing FlipYou/Pot Shot rows (`flipyou`, `potshot`). Source-type strings only tag provenance — the spec accepts the iteration's call here, and consistency across the three games matters more than a per-game suffix.
- Per-wallet attribution: each wallet's `feeLamports = floor(walletWagerSum × feeBps / 10_000)` (helper-internal). Across many wallets this can drift up to a few lamports from the on-chain `floor(totalPool × feeBps / 10_000)` because the on-chain fee is computed on the aggregate pool, not per wallet. This is the same accounting-vs-treasury split the Pot Shot iteration accepted: per-player allocation is the audit unit; treasury inflow stays anchored on chain.
- Refunds (zero or one entrant on either side, equal close, or zero entries total): on-chain takes 0 fee, so no allocation rows. The `if (!isRefund && allEntries.length > 0)` guard makes this explicit.
- Allocation rows are go-forward only — no backfill of pre-migration rounds (per FR-1).

**Verification**:
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: integration coverage for the Close Call allocation write lands in the dedicated `[test]` checklist item later in the section, alongside FlipYou + Pot Shot integration assertions.

## Iteration 7 — 2026-05-01T20:03:59Z — OK
- **Log**: iteration-007.log

---

## Iteration 8 — 2026-05-01

**Item**: Add settlement integration coverage asserting that after FlipYou + Pot Shot + Close Call settlement, `fee_allocation_events` contains the expected rows for both referred and non-referred players, components sum to `fee_lamports`, and a duplicate settle attempt is a no-op.

**Outcome**: Success.

**Changes**:
- Added `backend/src/__tests__/integration-fee-allocation.test.ts` with three tests:
  1. **FlipYou full lifecycle** — creates a match via the route, runs the settlement worker (full settle path through `settleMatch`), then asserts two `fee_allocation_events` rows: a non-referred creator (referrer null, rate 0, referral 0) and a referred opponent (referrer + rate set, referral split via the default 1000 bps). Components sum to `fee_lamports` for both rows. A direct replay of `recordReferralEarnings` for the same `(round, wallet)` does not duplicate rows (UNIQUE + ON CONFLICT DO NOTHING).
  2. **Pot Shot dedupe** — calls the shared `recordReferralEarnings` helper directly with `gameType: "potshot"` and three entries (two from one wallet, one from another). Asserts two allocation rows, the multi-entry wallet's `wager_lamports` is the summed total, and components sum to `fee_lamports`. Replay is a no-op. Helper-direct because Pot Shot lacks the on-chain test infrastructure (decoders, program-id, mock account shapes) FlipYou and Close Call have; iteration 6 already established that the production path goes through this exact helper.
  3. **Close Call clock tick** — sets up a closed round on the mock connection plus a Hermes price closing higher than open, runs `clock.tick()`, asserts two `fee_allocation_events` rows (referred green + non-referred red). Components sum to `fee_lamports`.
- `backend/src/__tests__/integration-test-helpers.ts`: added `fee_allocation_events`, `fee_bucket_debits`, and `fee_audit_checkpoints` to `RESET_TABLES` so subsequent test runs start clean.
- `backend/vitest.integration.files.ts`: registered the new test file so the integration job picks it up.

**Verification**:
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/integration-fee-allocation.test.ts` — 3/3 passed (≈9s).
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/integration-settlement.test.ts` — 8/8 still passing (regression check on the helpers change).
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.

**Notes**:
- Source-type strings asserted in the test (`flipyou`, `potshot`, `closecall`) match what iterations 5–7 already wired up via the shared helper.
- The replay assertions rely on the helper's logger producing an "idempotent skip" for the conflicting wallet, which is the production retry path under settlement worker exponential backoff.

## Iteration 8 — 2026-05-01T20:11:30Z — OK
- **Log**: iteration-008.log

## Iteration 8 — 2026-05-01T20:12:05Z — OK
- **Log**: iteration-008.log

---

## Iteration 9 — 2026-05-01

**Item**: `[review]` retrospective for the Settlement producers section (FlipYou + Pot Shot + Close Call allocation writes + integration coverage).

**Outcome**: No change after review.

**What I looked at**:
- `backend/src/worker/settle-tx.ts` — `recordReferralEarnings` (lines 132-217) is a single shared helper with one signature: `{ roundId, gameType, feeBps, referralDefaultRateBps, players }`. The dedupe map at lines 144-148 collapses repeated wallets to one allocation row before any DB work runs.
- Three call sites use it identically: `settleMatch` (FlipYou) at line 454, `settleLordRound` (Pot Shot) at line 742, and `settleRound` (Close Call) in `closecall-clock.ts:525`. Each call wraps in the caller's existing `withTransaction` block so allocation writes share atomicity with settlement.
- `backend/src/__tests__/integration-fee-allocation.test.ts` exercises all three games through this single helper (FlipYou via the worker path; Pot Shot helper-direct because the on-chain test infra isn't there; Close Call via `clock.tick()`).

**Considered, rejected**:
- Renaming `recordReferralEarnings` → `recordSettlementFeeAccounting` to reflect the broader scope (the helper now writes a `fee_allocation_events` row for every player, with referral earnings as a side action only when a link exists). The name is mildly stale, but the rename touches 5 sites for a stylistic-only win — not high conviction.
- Hoisting the helper into `db/fee-accounting.ts`. The helper bridges three sources (profile, referral link, allocation insert) and uses settlement-only context. It belongs near the settlement worker; moving it would muddy the `db/` layer's pure-DB seam.
- Building a per-game adapter to compute `feeLamports` on-chain-style (single floor on the aggregate pool) instead of per-wallet floor. Iterations 6 and 7 already documented the per-wallet vs. on-chain dust discrepancy as the right accounting unit per FR-1; surfacing it again would just re-litigate that decision.

The unifying abstraction the review item asks about already exists, was iterated on through the section, and is exercised end-to-end. Proceeding to the claim hot path section.

**Verification**:
- Spec-only edit (one checkbox flip + history append). No code changed.

## Iteration 9 — 2026-05-01 — review (no diff)

## Iteration 9 — 2026-05-01T20:14:09Z — OK
- **Log**: iteration-009.log

---

## Iteration 10 — 2026-05-01

**Item**: Replace `getPendingBalanceByUserId` in `POST /referral/claim` with ledger-derived caps and insert a matching `fee_bucket_debits` row inside the same transaction as the claim insert + queue event.

**Outcome**: Success.

**Changes**:
- `backend/src/routes/referral.ts` `POST /claim`:
  - Replaced the `getPendingBalanceByUserId` snapshot with two ledger-derived calls: `getUserReferralAvailable(userId)` → `userAvailable` (claim amount + per-user cap), then `getReferralBucketAvailable()` → `globalAvailable` (global cap, defends against ledger drift). The 422 codes preserve `ZERO_BALANCE` (≤ 0) and `BELOW_THRESHOLD` (< `referralMinClaimLamports`); the new "user > global" rejection uses `PRECONDITION_FAILED` 422 (no dedicated code in `API_ERROR_CODES` and the existing waitlist contract doesn't need one — this is forensic-only since allocation/debit math should keep them in sync).
  - Switched the atomic block from raw `sql.begin` to `db.withTransaction(async (txDb) => …)` so `txDb.insertReferralClaim`, `txDb.insertFeeBucketDebit({ bucket: 'referral', debitType: 'claim', sourceId: claim.id, status: 'pending' })`, and `emitEvent(txDb.rawSql, …)` all share the same transaction. Bucket debit rows are now produced in lockstep with the `referral_claims` row.
  - Removed the unused `sql` destructure inside `createReferralRoutes`. The deps interface still carries `sql: postgres.Sql` so all five call sites (`index.ts`, `index-waitlist.ts`, three test files) keep the same shape — narrowing the deps would be unnecessary churn for a single non-hot-path route.
- `backend/src/__tests__/referral-routes.test.ts`:
  - Added `fee_allocation_events` and `fee_bucket_debits` to the per-test `TRUNCATE` so prior runs don't leak ledger state into the suite.
  - Added a local `seedFeeAllocation()` helper that mirrors an `insertReferralEarning` fixture into the new ledger (computes the FR-2 split: floor referral, floor 20% promotions on the post-referral remainder, profit absorbs dust). Existing tests that exercise `/referral/claim` (BELOW_THRESHOLD, creates pending claim, prevents double-claim, GET status owner check, GET status auth check) now seed the ledger alongside the legacy table so the new ledger-derived caps see the same balance. Tests that only exercise `/earnings` were left alone — they still hit `referral_earnings` directly.

**Confirmation that the legacy helpers are still used elsewhere** (per the spec item):
- `getPendingBalanceByUserId`: still used in `backend/src/queue/handlers/referral-claim.ts:72` (the next checklist item rewires that call site). Also self-referenced by `db/fee-accounting.ts` in a doc comment and used by the unchanged `getReferralStatsByUserId` aggregate (separate query, same shape). Kept.
- `insertReferralEarning`: still used in `backend/src/worker/settle-tx.ts:180` to write the legacy `referral_earnings` row alongside the new `fee_allocation_events` row, plus by 7 fixture call sites in `referral-routes.test.ts`. The legacy table is still consulted by `/referral/earnings`, `/referral/stats`, and `/referral/leaderboard`. Kept.

**Verification**:
- `cd backend && pnpm typecheck` — exit 0.
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning).
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/referral-routes.test.ts` — 29/29 passed (including all 4 `POST /claim` cases and 3 `GET /claim/:claimId` cases now exercising the ledger path).
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/fee-accounting.test.ts src/__tests__/integration-fee-allocation.test.ts` — 15/15 passed (regression check on the underlying helpers).
- `pnpm exec vitest run src/__tests__/openapi-contract.test.ts src/__tests__/waitlist-contract.test.ts` — 75/75 passed (the route's deps shape and the public envelope/contract are intact).

**Notes**:
- The route still claims the user's full available balance — the public API hasn't gained a request body. The "claim ≤ requested amount" wording in FR-6 is satisfied by setting requested = `userAvailable`; the per-user check is then trivially satisfied unless the ledger drifts mid-request, and the global check protects against the case where many simultaneous claims would overdraw the bucket as a whole.
- The dedicated test file extension (`referral-claim-ledger.test.ts` or new cases inside `referral-routes.test.ts`) lands in the next checklist item; this iteration was scoped to the producer code + keeping the existing suite green.

## Iteration 10 — 2026-05-01 — OK

## Iteration 10 — 2026-05-01T20:22:47Z — OK
- **Log**: iteration-010.log

---

## Iteration 11 — 2026-05-01

**Item**: In `backend/src/queue/handlers/referral-claim.ts`, after every `db.updateClaimStatus` call (and the insufficient-balance permanent-fail branch), call `updateFeeBucketDebitStatus` so the debit moves through `processing → completed | failed | error` in lockstep with the claim.

**Outcome**: Success.

**Changes**:
- `backend/src/queue/handlers/referral-claim.ts`: added a paired `db.updateFeeBucketDebitStatus("referral", "claim", claimId, status)` call immediately after each `db.updateClaimStatus(claimId, status, …)` call. Four sites now keep the debit row's status in lockstep with the claim:
  - `pending → processing` after the initial transition (line 71).
  - `processing → failed` on the insufficient-balance permanent-fail branch (line 84).
  - `processing → completed` on transfer success (line 136).
  - `processing → error | failed` in the catch branch, where `nextStatus = isFinal ? "failed" : "error"` (line 157).
- The handler currently does not wrap claim status updates in a `db.withTransaction` block, so I followed the same shape (sequential calls, not a new transaction). The spec's wording — "reuse the same DB transaction *where* claim status updates already use one" — explicitly conditions on existing transactions; introducing a new one would be a structural change beyond this checklist item. The audit snapshot tolerates the brief sequential window because both calls hit the same row keyed by `claim_id`.
- `updateFeeBucketDebitStatus` returns `undefined` for legacy claims that pre-date migration `026` (no debit row exists). That is the documented no-op behavior; no extra guard needed.

**Verification**:
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.
- Skipped vitest: dedicated handler-lifecycle coverage is the next checklist item ("queue handler success/transient-error/permanent-fail each update the debit's status to match the claim").

## Iteration 11 — 2026-05-01 — OK

## Iteration 11 — 2026-05-01T20:26:03Z — OK
- **Log**: iteration-011.log

---

## Iteration 12 — 2026-05-01

**Item**: Add coverage for the ledger-derived claim caps + bucket debit lifecycle: ledger cap enforcement (per-user and global) returns 422 with the documented `API_ERROR_CODES` envelope; successful claim writes a `fee_bucket_debits` row with `status='pending'`; queue handler success / transient-error / permanent-fail each update the debit's status to match the claim.

**Outcome**: Success.

**Changes**:
- Added `backend/src/__tests__/referral-claim-ledger.test.ts` with 7 tests:
  1. **`POST /referral/claim` ledger caps — ZERO_BALANCE**: user with no allocations → 422 / `ZERO_BALANCE`.
  2. **`POST /referral/claim` ledger caps — PRECONDITION_FAILED**: user A has 50M referral allocation; user B has 50M allocation + 60M completed referral debit → per-user available (50M) > global available (40M). Sanity-asserts `getUserReferralAvailable` and `getReferralBucketAvailable` before the request, then asserts 422 / `PRECONDITION_FAILED` and that no `referral_claims` row was created.
  3. **`POST /referral/claim` debit insertion**: user A has 50M allocation, claim → 202; asserts a `fee_bucket_debits` row exists with `bucket='referral'`, `debit_type='claim'`, `source_id=claimId`, `status='pending'`, `amount_lamports=50000000`, `user_id`/`wallet` populated (proving the same-tx insert from the route).
  4. **Handler success → debit `completed`**: seeds claim+debit (pending) plus a 2× earnings row so the handler's `getPendingBalanceByUserId` check clears, runs `createClaimHandler` with a default `MockConnection` → both rows end at `completed`.
  5. **Handler transient error → debit `error`**: seeds claim+debit, swaps `sendRawTransaction` to throw, expects the handler to rethrow (so the queue retries) → both rows end at `error`.
  6. **Handler insufficient balance → debit `failed`**: seeds claim+debit but no earnings → handler hits the permanent insufficient-balance branch → both rows end at `failed`.
  7. **Handler max retries → debit `failed`**: seeds claim+debit with `retry_count = MAX_CLAIM_RETRIES − 1`, throws on `sendRawTransaction` → catch branch sees `isFinal = true` and marks both rows `failed`.
- Registered the new file in `backend/vitest.integration.files.ts`.

**Verification**:
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/referral-claim-ledger.test.ts` — 7/7 passed.
- `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/referral-routes.test.ts src/__tests__/fee-accounting.test.ts src/__tests__/integration-fee-allocation.test.ts` — 44/44 passed (regression check on the surrounding suites).
- `cd backend && pnpm lint` — exit 0 (only the pre-existing `contracts/api-envelope.ts` warning, unchanged).
- `cd backend && pnpm typecheck` — exit 0.

**Notes**:
- The handler tests exercise the queue-handler-level `pending < amount` check that lives upstream of the ledger. Because `getPendingBalanceByUserId` already counts the *current* claim (status `pending|processing|error|completed`) in its subtraction, the seed helper provisions earnings at `2× amountLamports`. That's the minimum needed for `pending ≥ amount` once the active claim is in flight, and it isolates the test from the production-side question of whether the handler should be migrated off `getPendingBalanceByUserId` entirely (out of scope for this iteration; flagged for the follow-on `[review]`).
- The "global cap" test deliberately stays inside DB seeding rather than driving a second user through the route, so the bucket divergence is unambiguous and not racing the per-user UNIQUE active-claim index.

## Iteration 12 — 2026-05-01 — OK
## Iteration 12 — 2026-05-01T20:34:34Z — OK
- **Log**: iteration-012.log

