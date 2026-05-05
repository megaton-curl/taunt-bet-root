# FlipYou Audit Prep Plan

> **For agentic workers:** Start with on-chain invariants, then review backend secret and settlement paths. Do not report a finding without an exploit path or a violated invariant.

**Goal:** Audit FlipYou's two-player commit-reveal escrow so equal-wager matches cannot be manipulated, drained, double-settled, or stuck.

**Architecture:** FlipYou uses a match PDA seeded by creator and `match_id`. The backend co-signs creation with a secret commitment, `join_match` locks future `SlotHashes` entropy, and `settle` reveals the secret to pay the winner and treasury.

**Tech Stack:** `solana/programs/flipyou`, `solana/shared`, `solana/programs/platform`, `solana/tests/flipyou.ts`, backend fairness create/settle/verify routes.

---

## Primary Files

- Program entrypoint: `solana/programs/flipyou/src/lib.rs`
- State and events: `solana/programs/flipyou/src/state.rs`, `solana/programs/flipyou/src/events.rs`
- Instructions: `solana/programs/flipyou/src/instructions`
- Errors: `solana/programs/flipyou/src/error.rs`
- Shared helpers: `solana/shared/src/escrow.rs`, `solana/shared/src/fees.rs`, `solana/shared/src/fairness.rs`, `solana/shared/src/commit_reveal.rs`, `solana/shared/src/pause.rs`, `solana/shared/src/timeout.rs`, `solana/shared/src/wager.rs`
- Platform config: `solana/programs/platform/src`
- Tests: `solana/tests/flipyou.ts`
- Backend paths: `backend/src/routes/create.ts`, `backend/src/routes/rounds.ts`, `backend/src/worker/settlement.ts`, `backend/src/worker/settle-tx.ts`
- Specs: `docs/specs/001-flip-you/spec.md`, `docs/specs/005-hybrid-fairness/spec.md`, `docs/specs/006-fairness-backend/spec.md`

## Core Invariants

- A match PDA is unique for `["match", creator, match_id]` and cannot be substituted by the opponent or backend.
- Creator deposits exactly one `entry_amount` during `create_match`.
- Opponent deposits exactly the same `entry_amount` during `join_match`.
- Creator and opponent cannot be the same wallet.
- Creator side is valid and opponent side is implied.
- Commitment is fixed at creation and cannot be changed after opponent joins.
- `target_slot` is set only when the opponent joins and must be in the future.
- Settlement result is derived from `secret`, entropy, match PDA, and algorithm version.
- Fee comes from `PlatformConfig`, is sent to treasury, and is taken only on settlement.
- Cancellation and refund paths return principal without fee.
- Timeout refund is permissionless only after `resolve_deadline`.
- Pausing blocks new matches but does not block settlement or refunds.

## Review Tasks

### Task 1: Account Constraints And PDA Binding

- [ ] Read every account struct in `create_match.rs`, `join_match.rs`, `settle.rs`, `cancel_match.rs`, `timeout_refund.rs`, and `set_paused.rs`.
- [ ] Confirm all PDA seeds match `state.rs` and `solana/CLAUDE.md`.
- [ ] Confirm the match account passed to `join_match`, `settle`, cancel, and refund cannot be swapped for a different creator or `match_id`.
- [ ] Confirm the config and platform accounts are constrained to their canonical seeds.
- [ ] Confirm signer constraints match the intended caller for each instruction.

### Task 2: Deposit, Payout, Fee, And Close Accounting

- [ ] Trace lamports through create, join, settle, cancel, timeout refund, and mutual refund if present.
- [ ] Confirm settlement transfers fee before payout and cannot overdraw the PDA.
- [ ] Confirm payout includes only the intended net pool plus allowable rent surplus, if documented.
- [ ] Confirm cancel and timeout refund never charge a platform fee.
- [ ] Confirm closing or zeroing the match PDA cannot destroy evidence needed by backend verification before it is emitted.
- [ ] Add or identify tests for exact lamport deltas, including rent effects.

### Task 3: Phase Machine And Liveness

- [ ] Enumerate allowed transitions: Waiting to Locked, Locked to Settled, Waiting to canceled/refunded, Locked to timeout/refunded.
- [ ] Confirm every instruction rejects invalid phase transitions.
- [ ] Confirm double join, join after cancel, settle before join, settle twice, cancel after join, and refund before deadline are rejected.
- [ ] Confirm backend failure leads to timeout refund rather than stuck funds.
- [ ] Confirm pause only affects new value entering the game.

### Task 4: Commit-Reveal Fairness

- [ ] Verify `create_match` stores `SHA256(secret)` commitment before any future entropy is selected.
- [ ] Verify `join_match` selects future entropy and does not let either player choose the entropy slot.
- [ ] Verify `settle` checks the revealed secret against commitment.
- [ ] Verify entropy is read from the actual SlotHashes sysvar and target slot.
- [ ] Verify result derivation binds the match PDA and algorithm version.
- [ ] Check whether a backend can selectively reveal losing outcomes, then document the timeout-refund mitigation and residual trust assumption.

### Task 5: Backend Secret And Settlement Path

- [ ] Trace `POST /fairness/flipyou/create` from request validation through transaction construction and DB persistence.
- [ ] Confirm the backend cannot create a transaction with a mismatched wallet, commitment, amount, side, or match PDA.
- [ ] Confirm settlement worker waits until the entropy slot is available before revealing.
- [ ] Confirm permanent errors do not cause unsafe retries and transient errors do retry.
- [ ] Confirm verification endpoint never exposes `secret` before settlement.
- [ ] Confirm health output exposes settlement worker liveness and stuck-match signals.

### Task 6: Tests To Strengthen Before External Audit

- [ ] Add adversarial account-substitution tests for all non-happy-path instructions.
- [ ] Add exact lamport accounting tests for settlement, cancel, and timeout refund.
- [ ] Add fairness-vector tests using fixed secret, entropy, match PDA, and expected side.
- [ ] Add same-wallet create/join rejection test.
- [ ] Add duplicate settlement and duplicate refund rejection tests.
- [ ] Add pause behavior tests for create blocked and settle/refund allowed.
- [ ] Add automated test that `secret` is **not** present on the verification endpoint while phase ≠ settled, and is present after settlement. Code review of this invariant is not sufficient.

## Targeted Verification

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/flipyou.ts)
```

Before closing the FlipYou pass:

```bash
./scripts/check-fees.sh
./scripts/check-program-ids.sh
```

## Auditor Questions

- Is the commit-reveal + SlotHashes construction sufficient for a two-player wager where the backend can choose whether to reveal?
- Are lamport close semantics and rent surplus treatment acceptable and documented clearly enough?
- Are PDA seeds and account constraints strong enough to prevent account substitution in every instruction?
- Should the external audit include backend secret custody and settlement worker behavior as part of the threat model?
