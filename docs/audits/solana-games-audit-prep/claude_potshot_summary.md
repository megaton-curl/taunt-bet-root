# Pot Shot Audit Pass — Summary

**Pass type:** Internal audit-prep, Pot Shot–only.
**Plan followed:** `docs/audits/solana-games-audit-prep/potshot.md` (Tasks 1–6
on code; Task 7 deferred — see PS-13).
**Scope:** `solana/programs/potshot`, `solana/programs/platform`,
`solana/shared`, backend create + settlement
(`backend/src/routes/potshot-create.ts`, `backend/src/worker/settle-tx.ts`,
`backend/src/worker/settlement.ts`), `solana/tests/potshot.ts`.
**Out of scope per CLAUDE.md:** `webapp/`, `waitlist/` (read-only references).

## TL;DR

The Pot Shot on-chain program is small, the cumulative-range weighted draw is
boundary-safe, and refund / force-close paths handle duplicate-player
aggregation correctly. The bankrun suite is **green (25 / 1 pending)**, and
two of the three FlipYou Must-Fix issues from the prior pass (FY-1 backend
SlotHashes parsing, FY-5 ±8 skip-window) are already resolved in shared code
on this commit. There are no Must-Fix-Before-External-Audit findings for Pot
Shot.

The main gaps are **test coverage** and **cross-game consistency**:

1. **`cancel_round` has zero tests (PS-2).** It is a real funds-handling
   instruction with no positive or negative bankrun assertions. Audit
   packets should not ship untested fund paths.
2. **`claim_payout` rent goes to `caller`, every other close goes to `server`
   (PS-1).** Cross-game with FY-3. Pot Shot's rent (~0.0195 SOL/round) is
   ~10× FlipYou's, so the blast radius if the secret ever leaks is bigger.
3. **Pause checks are correct on-chain (PS-4) but no test asserts them.**
   The inverse of FY-2: code does the right thing, CI doesn't enforce it. A
   future regression that drops `check_not_paused(...)` would ship green.
4. **The `/pot-shot/verify/:pda` pre-settle secret gate (PS-5) is correct
   but not test-asserted** (mirror of FY-7).

The remaining findings are pattern-style (state-mutate-after-transfer in
PS-3; `init_if_needed` re-unpause in PS-6), cleanup (deprecated `start_spin`
shim in PS-7; duplicate `buy_more_entries` / `join_round` in PS-8;
`lifecycle::transition` drift in PS-9), and operational/UX (Sybil DoS in
PS-10; Waiting-only timeout gap in PS-11). One question is reserved for the
external auditor: slot-rate sensitivity of the `target_entropy_slot` math
(PS-12). One open item — the devnet compute-budget reality check (PS-13) —
must be closed before the external packet ships.

## Test Run Captured

Command:
`cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/potshot.ts`

Result on this commit: **25 passing, 1 pending**.
- The single pending case is `claim_payout requires SlotHashes entropy
  (tested via devnet E2E)` — intentional skip, deferred to devnet integration.

No failing tests.

## Findings Index (see `claude_potshot_findings.md` for full bodies)

| ID | Severity | Category | Subject |
|----|----------|----------|---------|
| PS-1 | MEDIUM | Needs Test Proof | `claim_payout` rent goes to `caller`, not `server` |
| PS-2 | MEDIUM | Needs Test Proof | `cancel_round` has zero test coverage |
| PS-3 | MEDIUM | Needs Test Proof | `claim_payout` and `timeout_refund` mutate phase after lamport transfers |
| PS-4 | LOW | Needs Test Proof | Pause checks present but not test-asserted |
| PS-5 | LOW | Needs Test Proof | Verify endpoint pre-settle secret gate not test-asserted |
| PS-6 | LOW | Document As Trust Assumption | `initialize_config` uses `init_if_needed`, silently re-unpauses |
| PS-7 | LOW | To Do Soon | `start_spin` is a deprecated no-op shim still in IDL |
| PS-8 | INFO | To Do Soon | `buy_more_entries` is a renamed clone of `join_round` |
| PS-9 | INFO | To Do Soon | `lifecycle::transition()` does not model Pot Shot's flow |
| PS-10 | INFO | Document As Trust Assumption | Sybil DoS: one wallet can fill 64 entries |
| PS-11 | INFO | Document As Trust Assumption | `cancel_round` creator-only; no permissionless escape for stuck Waiting rounds |
| PS-12 | LOW | Ask External Auditor | Slot-rate sensitivity of `target_entropy_slot` math |
| PS-13 | OPEN | Open Investigation | Compute and account-load reality check not yet performed |

## What I Confirmed Holds

- **PDA seeds.** `PotShotRound` (`["potshot_round", match_id]`) and
  `LordConfig` (`["lord_config"]`) match `Anchor.toml`, `declare_id!` in
  `solana/programs/potshot/src/lib.rs:9`, the IDL, and
  `backend/src/tx-builder.ts:53`. The Pot Shot row in `solana/CLAUDE.md`
  matches the on-chain source on this commit.
- **Wager bounds.** All four entry-creating instructions (`create_round`,
  `join_round`, `buy_more_entries`) call `validate_wager(amount)` and then
  `require!(amount > 0, ZeroAmount)`. The shared `MIN_WAGER_LAMPORTS = 1e6`
  and `MAX_WAGER_LAMPORTS = 1e11` clamp the per-entry value.
- **Pause behavior.** `create_round`, `join_round`, `buy_more_entries` all
  call `check_not_paused(false, config.paused)`. `claim_payout`,
  `timeout_refund`, `cancel_round`, `force_close` correctly do **not** —
  pause does not strand in-flight rounds. (No test asserts this; see PS-4.)
- **Distinct-player counting.** `is_new_player = !round.has_player(player)`
  is computed before the entry is pushed, so the `distinct_players` counter
  increments only on the first entry from a wallet. The bankrun suite
  asserts this in three positive and one same-player-no-increment cases.
- **Countdown trigger and entropy slot.** The countdown starts exactly when
  the second distinct player joins, and `target_entropy_slot` is set once
  and never re-set on subsequent joins. Confirmed by code reading and by
  `tests/potshot.ts:464` (3rd-player case).
- **Entries-cap and countdown-window guards.**
  `require!(entries.len() < MAX_ENTRIES, MaxEntriesReached)` and
  `now < countdown_ends_at` are both checked **before** any lamport transfer
  in `join_round` and `buy_more_entries`. State mutations happen after the
  transfer (PS-3 flag), but the guards are right.
- **Weighted-draw math.** `winning_offset = u64_from_le(result_hash[0..8]) %
  total_amount_lamports` followed by a cumulative-range scan that breaks on
  `winning_offset < cumulative` is boundary-safe given `total > 0`
  (enforced upstream) and `winning_offset < total`. The last entry's
  cumulative reaches `total`, so the loop always finds a winner.
  Modulo bias at the worst-case total (~2^42 lamports) is bounded by
  `~2^-22` and not material.
- **Result derivation domain.** `derive_result(secret, entropy, round_pda,
  algo_ver)` salts with the round PDA, so cross-round secret reuse cannot
  steer outcomes. The on-chain code passes `round.key().to_bytes()` and
  the backend passes `roundPubkey.toBuffer()` — same value, same hash.
- **Refund aggregation.** `timeout_refund.rs:60–69` and
  `force_close.rs:55–64` both walk `round.entries`, aggregate by player
  with `checked_add`, then require
  `remaining.len() == refunds.len()` and a per-index
  `require_keys_eq!(remaining[i].key(), refund.player)`. Duplicate
  remaining-account ordering or extra wallets are rejected by the count or
  key check. (Not adversarially tested; see notes in PS-2 / PS-13.)
- **Treasury validation.** `claim_payout` reads
  `(fee_bps, treasury_key) = read_platform_config(...)` (which validates
  owner = platform program, discriminator, fee cap) and then
  `require!(ctx.accounts.treasury.key() == treasury_key, AccountMismatch)`.
  Matches the shared invariant — game cannot redirect fees.
- **SlotHashes account binding.** `slot_hashes: AccountInfo<'info>` is
  constrained to `address = SLOT_HASHES_ID` via Anchor's `#[account(...)]`
  attribute, so attacker-controlled entropy substitution is rejected at
  the account-loading boundary.
- **Backend ↔ on-chain entropy parity.** `parseSlotHashEntropy` in
  `backend/src/worker/settle-tx.ts:115` correctly walks the
  `count(8) || (slot, hash)*` SlotHashes layout and matches the on-chain
  `read_slot_hash_entropy_from_data` at
  `solana/shared/src/fairness.rs:70`. This closes the FY-1 cross-game
  carry-over for Pot Shot.
- **Verification endpoint secret gating (code-level).**
  `formatPotShotRound` at `backend/src/routes/potshot-create.ts:611–612`
  only writes `response.secret` inside `if (isSettled) {...}`. The gate is
  correct; the **test** is missing (PS-5).
- **Account closure semantics.** `claim_payout`, `timeout_refund`,
  `cancel_round`, `force_close` all close the round PDA. Subsequent
  re-entry on the same PDA fails on account-not-found, so
  double-settle / double-refund / settle-after-cancel paths are rejected
  by the runtime, not by phase guards.

## Suggested Triage Before External Packet Ships

In rough priority order:

1. **Resolve PS-13 (devnet 64-entry compute reality check)** — this is a
   straight measurement task, but the audit packet must not ship without it.
   Run the three settlement / refund worst-case scenarios on devnet, capture
   CU and account-load numbers, and either confirm ≥ 20 % headroom or
   promote PS-13 to Must Fix.
2. **Add coverage for PS-2 (`cancel_round`) and PS-4 (pause checks).** Both
   are "tests-not-code" gaps. Ship a `describe("cancel_round")` block with
   the four cases listed in PS-2 and a `describe("pause")` block with the
   four cases listed in PS-4. The audit packet's authoritative test file is
   green today but under-covers two load-bearing paths.
3. **Decide PS-1 + FY-3 together.** The cross-game decision (rent → server
   everywhere, or rent → caller everywhere) wants to be made once, not
   twice. After deciding, add a bankrun test in each program to assert the
   rent destination.
4. **Add the verification-endpoint pre-settle test (PS-5).** Mirrors the
   FY-7 ask. One vitest case lands the assertion.
5. **Drop PS-3 phase writes.** The Anchor close zeros the data immediately,
   so the writes are dead. Removing them resolves the audit-baseline
   transfer-then-mutate violation without changing observable behavior.
6. **Decide PS-7 (`start_spin`) and PS-8 (`buy_more_entries` / `join_round`
   duplication) together.** Both are IDL-shrinking opportunities and
   reduce the surface area the external auditor has to read.

PS-6, PS-9, PS-10, PS-11, PS-12 are independent and can be triaged into the
larger audit budget. PS-10 (Sybil DoS) and PS-11 (Waiting-stuck) deserve
explicit lines in README §Trust Assumptions if they will not be code-fixed
before mainnet.

## Files Read During the Pass

On-chain:
- `solana/programs/potshot/src/{lib.rs, state.rs, error.rs}`
- `solana/programs/potshot/src/instructions/{initialize_config.rs,
  create_round.rs, join_round.rs, buy_more_entries.rs, start_spin.rs,
  claim_payout.rs, cancel_round.rs, timeout_refund.rs, force_close.rs,
  set_paused.rs, mod.rs}`
- `solana/programs/platform/src` (read via shared platform_config.rs;
  full read deferred to the shared baseline pass which already covered it)
- `solana/shared/src/{lib.rs, escrow.rs, fairness.rs, fees.rs,
  platform_config.rs, wager.rs, pause.rs, timeout.rs, lifecycle.rs,
  constants.rs, commit_reveal.rs}`
- `solana/Anchor.toml` (program-ID parity)

Backend:
- `backend/src/routes/potshot-create.ts` (full)
- `backend/src/worker/settle-tx.ts` (FlipYou + Pot Shot sections,
  including `parseSlotHashEntropy`)
- IDL: `solana/target/idl/potshot.json` (`start_spin` shape)

Tests:
- `solana/tests/potshot.ts` (full + executed)

Audit packet:
- `docs/audits/solana-games-audit-prep/{README.md, potshot.md,
  findings.md, flipyou.md, claude_findings.md, claude_audit_summary.md}`
