# Specification: 309 Timeout-Refund Worker

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 0 |
| Audit reference | `docs/audits/solana-games-audit-2026-05-06.md` § H-2 |

---

## Overview

When a round cannot be settled (entropy expired, server outage past
`resolve_deadline`, missing commit-reveal secret), the on-chain instructions
`flipyou::timeout_refund`, `potshot::timeout_refund`, and
`closecall::timeout_refund` exist to return funds to participants. They are
**permissionless** — anyone can call them. Today the backend never does.

`backend/src/worker/retry.ts` records `timeout_detected` operator events when a
round crosses its deadline and stops retrying, but never builds or submits the
refund transaction. `buildCloseCallTimeoutRefundTx` is exported by
`backend/src/worker/settle-tx.ts` with zero callers; equivalents for FlipYou
and Pot Shot don't exist at all.

This spec defines a **timeout-refund worker** that detects refundable rounds,
submits the appropriate on-chain instruction, and reconciles backend DB rows
idempotently across all three games.

## User Stories

- As a player whose round expired, I want my stake refunded to my wallet
  without having to assemble and sign a `timeout_refund` transaction myself.
- As an operator, I want failed-settlement lifecycles to reach a terminal
  state in the DB (`refunded`) so dashboards, leaderboards, and accounting
  rows are consistent without manual intervention.
- As an integrator, I want `/flipyou/by-id`, `/pot-shot/by-id`, and
  `/closecall/by-id` to converge on a terminal phase instead of staying stuck
  in `locked` / `expired` indefinitely.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: settlement lifecycle completion;
  cross-game operational consistency.
- **Current baseline fit**: Planned. Today only manual on-chain calls or
  third-party tools can complete the lifecycle.
- **Planning bucket**: Core.

## Required Context Files

- `backend/src/worker/retry.ts` — current timeout detection / classification
- `backend/src/worker/settle-tx.ts` — existing refund tx builder for Close Call
- `backend/src/worker/settlement.ts` — settlement worker loop
- `backend/src/worker/pda-watcher.ts` — onAccountChange driver for low-latency triggers
- `backend/src/worker/closecall-clock.ts` — Close Call lifecycle entry point
- `solana/programs/flipyou/src/instructions/timeout_refund.rs`
- `solana/programs/potshot/src/instructions/timeout_refund.rs`
- `solana/programs/closecall/src/instructions/timeout_refund.rs`
- `backend/src/db.ts` — round / `transactions` / `game_entries` schema

## Contract Files

- `backend/src/contracts/api-errors.ts` — extend with refund-specific codes if
  any new failure modes surface to clients.
- `docs/specs/309-timeout-refund-worker/spec.md` — this document.

---

## Functional Requirements

### FR-1: Refundable round detection across all three games

A worker MUST identify rounds eligible for `timeout_refund` by combining DB
phase with on-chain account state.

**Acceptance Criteria:**

- [ ] FlipYou: detect matches whose on-chain phase is `Locked`, `now >
      resolve_deadline`, and DB phase is `locked` or `expired`.
- [ ] Pot Shot: detect rounds whose on-chain phase is `Locked` /
      `Resolving`, `now > resolve_deadline`, and DB phase is `locked`,
      `settling`, or `expired`.
- [ ] Close Call: detect rounds whose on-chain phase is `Open`, `now >
      resolve_deadline`, and DB phase is not yet `refunded` or `settled`.
- [ ] Detection runs on the existing settlement-worker tick AND on
      `pda-watcher` events, with module-level deduplication so no two
      submissions race for the same PDA.

### FR-2: Per-game refund tx submission

The worker MUST build, sign, and submit the correct `timeout_refund`
instruction for each game.

**Acceptance Criteria:**

- [ ] FlipYou: build `flipyou::timeout_refund` with the match PDA, creator,
      opponent (if joined), server (rent receiver), and `system_program`.
- [ ] Pot Shot: build `potshot::timeout_refund` with the round PDA, creator,
      server, and one `AccountInfo` per distinct entry-account in the same
      order the program expects.
- [ ] Close Call: build `closecall::timeout_refund` with the round PDA,
      `platform_config`, server (rent receiver), and one `AccountInfo` per
      bettor in `[green_entries..., red_entries...]` order. (Reuse
      `buildCloseCallTimeoutRefundTx`.)
- [ ] Transactions go through the same `sendAndConfirm` + retry classifier
      used by settlement, so RPC errors, blockhash expiration, and
      simulation failures are handled identically.

### FR-3: DB reconciliation is idempotent

After a refund tx confirms on-chain, the backend MUST converge the round's
DB rows on a terminal state without producing duplicates if the worker is
restarted, the watcher fires twice, or the same PDA is processed by two
instances.

**Acceptance Criteria:**

- [ ] Round phase is set to `refunded` exactly once.
- [ ] One `transactions` row of type `refund` per refunded entry, keyed by
      `(pda, player_wallet, kind='refund')` so re-runs are no-ops.
- [ ] `game_entries.is_winner = false`, `settled_at = now()` for all entries
      in the round.
- [ ] An operator event `timeout_refund_submitted` is appended on success;
      `timeout_refund_failed` on terminal failure with a `reason` code from
      `API_ERROR_CODES`.
- [ ] If the on-chain account is already closed (someone else refunded
      first), the worker MUST detect that, mark the round refunded in DB,
      and emit `timeout_refund_already_done` instead of erroring.

### FR-4: Operator alerting on persistent failure

If the same PDA fails refund submission three times in a row, the worker
MUST emit `timeout_refund_stuck` and stop attempting further refunds for
that PDA until the next process restart or admin reset.

**Acceptance Criteria:**

- [ ] After three consecutive failures, no further submissions until reset.
- [ ] `operator_events` row contains the failing tx logs / error message in
      the payload.
- [ ] An admin endpoint (or DB-level update) can reset the failure counter
      for a given PDA.

### FR-5: Test coverage

**Acceptance Criteria:**

- [ ] Bankrun integration test per game: drive a round into a refundable
      state, run the worker once, assert on-chain account closed and DB
      reconciled.
- [ ] Backend unit test: `timeout_refund_already_done` path when the
      on-chain account is missing.
- [ ] Backend unit test: idempotency — call the worker twice for the same
      PDA, assert exactly one `transactions` row per entry and one
      `timeout_refund_submitted` event.
- [ ] Coverage in `e2e/local/**` is N/A — refund flows are background work
      with no UI surface beyond eventual `phase=refunded` reads.

---

## Success Criteria

- Zero manual operator interventions to refund a stuck round on devnet for a
  rolling 30-day observation window after rollout.
- 100% of rounds detected as `timeout_detected` reach `refunded` (or
  `settled` if they recover) in the DB within 5 minutes of detection.
- No duplicate `transactions` rows for the same `(pda, player, kind)`.

---

## Dependencies

- Existing PDA watcher + settlement worker scaffolding
  (`backend/src/worker/{pda-watcher,settlement,retry,settle-tx}.ts`).
- On-chain `timeout_refund` instructions exist and are unchanged.
- Backend has a sufficiently funded server keypair to pay refund-tx fees;
  the program reimburses from PDA-rent on close where applicable.

## Assumptions

- `resolve_deadline` on each round is enforced on-chain — the worker only
  needs to read the value, not reproduce the calculation.
- Player accounts that received funds at create/join time are still
  derivable from on-chain `entries` lists; we do not need DB joins for the
  remaining-accounts list.
- We tolerate up to 5 minutes between detection and refund confirmation.

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | FR-1 detection (per game) | Bankrun: drive a round past deadline, assert worker classifies it as refundable | Test name + assertion |
| 2 | FR-2 per-game tx submission | Bankrun: run worker, assert tx confirms and on-chain account closes | Tx signature + account fetch returns null |
| 3 | FR-3 idempotency | Backend test: call worker twice on same PDA, assert single row per entry | DB query result count = 1 |
| 4 | FR-3 already-refunded path | Backend test: pre-close account, run worker, assert no error and DB converges | Operator event row + phase assertion |
| 5 | FR-4 stuck-PDA backoff | Backend test: simulate 3 failures, assert no 4th attempt | Mock-call counter |

---

## Completion Signal

### Implementation Checklist
- [ ] FlipYou detection + tx builder + worker hookup
- [ ] Pot Shot detection + tx builder + worker hookup
- [ ] Close Call worker hookup (builder already exists)
- [ ] Shared idempotency layer for DB reconciliation
- [ ] `timeout_refund_submitted` / `_failed` / `_stuck` /
      `_already_done` operator events
- [ ] Bankrun tests for all three games
- [ ] Backend unit tests for idempotency + already-done
- [ ] [test] `e2e/local/**` — N/A (background lifecycle, no UI surface)
- [ ] [test] `e2e/visual/**` — N/A (no UI changes)
- [ ] [test] `e2e/devnet/**` — replace skipped lifecycle tests with refund
      coverage where reasonable

### Testing Requirements

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled (already-closed account, double-fire, restart)
- [ ] Error states handled (RPC failure, simulation failure, missing
      remaining-accounts)

#### Integration Verification
- [ ] API contracts unchanged (refund flow is internal)
- [ ] Settlement and refund workers do not race on the same PDA
- [ ] Operator events appear in `peek` admin tooling

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`
