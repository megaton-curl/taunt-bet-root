# Pot Shot Audit Summary - Codex

> Fresh internal audit pass over Pot Shot per `docs/audits/solana-games-audit-prep/potshot.md`.
> This is a full Pot Shot pass, separate from the earlier rent-only artifacts.

## Scope

- `solana/programs/potshot/src/state.rs`
- `solana/programs/potshot/src/lib.rs`
- `solana/programs/potshot/src/instructions/create_round.rs`
- `solana/programs/potshot/src/instructions/join_round.rs`
- `solana/programs/potshot/src/instructions/buy_more_entries.rs`
- `solana/programs/potshot/src/instructions/start_spin.rs`
- `solana/programs/potshot/src/instructions/claim_payout.rs`
- `solana/programs/potshot/src/instructions/cancel_round.rs`
- `solana/programs/potshot/src/instructions/timeout_refund.rs`
- `solana/programs/potshot/src/instructions/force_close.rs`
- `solana/programs/potshot/src/instructions/initialize_config.rs`
- `solana/tests/potshot.ts`
- `backend/src/routes/potshot-create.ts`
- `backend/src/worker/settle-tx.ts`
- `backend/packages/game-engine/src/potshot.ts`

## Pass Summary

| Category | Count |
|----------|-------|
| Must Fix Before External Audit | 1 |
| Needs Test Proof | 5 |
| To Do Soon | 0 |
| Document As Trust Assumption | 1 |
| Open Investigation | 1 |
| Ask External Auditor | 2 |

## Key Findings

The blocking finding remains the successful-settlement rent destination:

- `CPS-1`: `claim_payout` closes the round PDA to `caller`, even though `create_round` has the server pay rent and the other terminal paths return rent to `round.server`.

The largest audit-readiness gaps are test proof gaps:

- Bankrun has no executable `claim_payout` coverage; the only test under `describe("claim_payout")` is skipped.
- `cancel_round` has no test coverage.
- Pause behavior is untested.
- Remaining-account substitution/order failures are not adversarially tested for settlement, timeout refund, or force close.
- The public verification endpoint's pre-settlement secret gate is not asserted for Pot Shot.

## Positive Notes

- `create_round` stores the creator's first entry exactly once and initializes `total_amount_lamports` and `distinct_players` consistently.
- `join_round` and `buy_more_entries` check `entries.len() < MAX_ENTRIES` before transferring lamports.
- Active-round entries require `now < countdown_ends_at`, so entries at exactly `countdown_ends_at` are rejected.
- Countdown starts once when the second distinct wallet appears, and later entries cannot rewrite `target_entropy_slot`.
- Winner selection binds the secret, SlotHashes entropy, round PDA key, and algorithm version.
- Timeout and force-close refund aggregation combines duplicate entries by owner and validates remaining-account keys before transfer.
- `start_spin` is a no-op compatibility shim that cannot reopen entries or change entropy.

## Verification

No tests were run in this pass. This was a targeted code audit and artifact-writing pass.

Recommended targeted command before closing the Pot Shot pass:

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/potshot.ts)
```

Then run:

```bash
./scripts/check-fees.sh
./scripts/check-program-ids.sh
```
