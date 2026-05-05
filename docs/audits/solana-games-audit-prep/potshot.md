# Pot Shot Audit Prep Plan

> **For agentic workers:** Treat weighted accounting as the highest-risk surface. Every finding must explain how entries, weights, settlement, refunds, or entropy can be misused.

**Goal:** Audit Pot Shot's weighted-entry pot so entries are counted correctly, the winner is selected fairly, and all settlement/refund paths preserve funds.

**Architecture:** Pot Shot uses a round PDA seeded by `match_id`. The backend commits a secret at round creation, players append independent weighted entries, the second distinct player starts countdown and precomputes a future entropy slot, and `claim_payout` reveals the secret to pay one winner.

**Tech Stack:** `solana/programs/potshot`, `solana/shared`, `solana/programs/platform`, `solana/tests/potshot.ts`, backend Pot Shot create/settle/verify routes.

---

## Primary Files

- Program entrypoint: `solana/programs/potshot/src/lib.rs`
- State and events: `solana/programs/potshot/src/state.rs`
- Instructions: `solana/programs/potshot/src/instructions`
- Errors: `solana/programs/potshot/src/error.rs`
- Shared helpers: `solana/shared/src/escrow.rs`, `solana/shared/src/fees.rs`, `solana/shared/src/fairness.rs`, `solana/shared/src/commit_reveal.rs`, `solana/shared/src/lifecycle.rs`, `solana/shared/src/pause.rs`, `solana/shared/src/timeout.rs`, `solana/shared/src/wager.rs`
- Platform config: `solana/programs/platform/src`
- Tests: `solana/tests/potshot.ts`
- Backend paths: `backend/src/routes/potshot-create.ts`, `backend/src/worker/settlement.ts`, `backend/src/worker/settle-tx.ts`, rounds verification endpoint
- Specs: `docs/specs/101-pot-shot/spec.md`, `docs/specs/005-hybrid-fairness/spec.md`, `docs/specs/006-fairness-backend/spec.md`

## Core Invariants

- A round PDA is unique for `["potshot_round", match_id]`.
- Every entry stores the depositing player and exact lamport amount.
- `total_amount_lamports` equals the sum of all entry amounts.
- `distinct_players` equals the count of unique player wallets, not entry count.
- Countdown starts only after two distinct players have entries.
- New entries are accepted only before `countdown_ends_at`.
- The entry vector cannot exceed `MAX_ENTRIES`.
- Winner selection uses cumulative lamport ranges over ordered entries.
- `winning_offset` is always less than `total_amount_lamports`.
- Fee is collected only on successful settlement.
- Timeout refund and force close refund each player's aggregate principal with no fee.
- Remaining accounts for winners/refunds cannot redirect payouts to attacker accounts.

## Review Tasks

### Task 1: Round Creation And Entry Accounting

- [ ] Review `create_round.rs`, `join_round.rs`, and `buy_more_entries.rs` for account constraints and signer requirements.
- [ ] Confirm the creator's first entry is included exactly once.
- [ ] Confirm a repeat buyer appends an independent entry without incrementing `distinct_players`.
- [ ] Confirm the second unique player starts countdown exactly once.
- [ ] Confirm entry amount validation uses shared wager bounds.
- [ ] Confirm vector capacity checks happen before transfer or state mutation.
- [ ] Confirm arithmetic for total pool updates uses checked math.

### Task 2: Countdown And Close Semantics

- [ ] Confirm entries are rejected at or after `countdown_ends_at`.
- [ ] Confirm `target_entropy_slot` is set when countdown starts and cannot be updated by later entries.
- [ ] Confirm `start_spin`, if used, cannot reopen entries, change entropy, or bypass settlement checks.
- [ ] Confirm countdown and entropy assumptions are documented for auditors, including the fixed slot estimate.
- [ ] Test boundary timestamps around exactly `countdown_ends_at - 1`, `countdown_ends_at`, and `countdown_ends_at + 1`.

### Task 3: Weighted Winner Selection

- [ ] Review `claim_payout.rs` from result derivation through winner transfer and account close.
- [ ] Confirm secret verification checks the stored commitment.
- [ ] Confirm entropy comes from SlotHashes at `target_entropy_slot`.
- [ ] Confirm result derivation binds secret, entropy, round key or `match_id`, and algorithm version.
- [ ] Confirm modulo operation cannot divide by zero and cannot bias beyond expected modulo bias.
- [ ] Confirm cumulative range logic cannot skip the last lamport or select an out-of-bounds entry.
- [ ] Add deterministic fixed-vector tests for first entry wins, middle entry wins, last entry wins, and exact boundary offsets.

### Task 4: Refund And Force-Close Safety

- [ ] Review `timeout_refund.rs`, `cancel_round.rs`, and `force_close.rs`.
- [ ] Confirm cancel is limited to the intended phase and caller.
- [ ] Confirm timeout refund is permissionless only after `resolve_deadline`.
- [ ] Confirm force close is authority-only and returns principal, not fee-adjusted balances.
- [ ] Confirm remaining accounts map one-to-one to entry owners or aggregate by owner safely.
- [ ] Confirm duplicate players with multiple entries receive their full aggregate refund once.
- [ ] Confirm duplicate or malicious remaining accounts cannot steal another player's refund.

### Task 5: Backend Settlement And Verification

- [ ] Trace backend create path for commitment generation, `match_id` uniqueness, and first-entry transaction construction.
- [ ] Trace settlement worker readiness: countdown expired, entropy slot available, round not already settled/refunded.
- [ ] Confirm transaction builder supplies all required remaining accounts in the same order the program expects.
- [ ] Confirm failed settlement retries cannot submit with stale or incomplete remaining accounts.
- [ ] Confirm verification payload includes ordered entries, total pool, commitment, secret after settlement, entropy, result hash, winning offset, and winner.
- [ ] Confirm pre-settlement payload exposes commitment but never secret.

### Task 6: Tests To Strengthen Before External Audit

- [ ] Add exact total-pool invariant tests after create, join, and buy-more entries.
- [ ] Add distinct-player counting tests for repeat entries and many players.
- [ ] Add max-entry boundary tests at 63, 64, and 65 entries.
- [ ] Add boundary tests for countdown expiry.
- [ ] Add deterministic winner-selection tests with uneven weights.
- [ ] Add refund aggregation tests for one wallet with multiple entries.
- [ ] Add malicious remaining-account ordering tests for settlement and refund.
- [ ] Add pause tests for create/join/buy-more blocked and refund/force-close allowed.

### Task 7: Compute Budget And Account-Load Reality Check (Devnet)

The bankrun tests do not measure real Solana runtime limits. `claim_payout` and `timeout_refund` iterate `entries` (up to `MAX_ENTRIES = 64`) and pay each owner via remaining accounts. If either path exceeds 1.4M CU per tx or the address-loading limit, the round is **permanently stuck** — including the timeout-refund recovery path, which has the same compute ceiling.

- [ ] Build a devnet round with 64 distinct players (one entry each, minimum wager). Settle via `claim_payout`. Capture: CU consumed, accounts loaded, V0 + LUT used yes/no, address-lookup-table contents.
- [ ] Build a devnet round with 64 distinct players (one entry each). Trigger `timeout_refund`. Capture: CU consumed, accounts loaded. This is the worst account-load case and stresses refund aggregation across the maximum unique-player set.
- [ ] Build a devnet round with 64 entries split across 2 distinct players. Trigger `timeout_refund`. Capture: CU consumed. This stresses duplicate-entry aggregation separately from account loading.
- [ ] Confirm headroom is at least 20% under both 1.4M CU and the runtime account-loading limit at the V0+LUT strategy in use.
- [ ] If headroom is insufficient, this is a Must Fix Before External Audit finding — file with exact CU number and recommended remediation (lower MAX_ENTRIES, paged settlement, or both).
- [ ] Record the resulting CU numbers in the External Auditor Packet so the auditor sees evidence, not just a checkbox.

## Targeted Verification

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/potshot.ts)
```

Before closing the Pot Shot pass:

```bash
./scripts/check-fees.sh
./scripts/check-program-ids.sh
```

## Auditor Questions

- Is the cumulative weighted selection implementation unbiased and boundary-safe enough for lamport-weighted entries?
- Are remaining-account payout and refund patterns safe under duplicate players and malicious account ordering?
- Does the countdown-based target entropy slot create any exploitable timing or liveness issue?
- Is `MAX_ENTRIES = 64` compatible with worst-case compute for settlement and refund on the target cluster?
