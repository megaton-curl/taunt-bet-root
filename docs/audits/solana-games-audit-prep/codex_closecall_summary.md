# Close Call Audit Summary - Codex

> Internal audit pass over Close Call per `docs/audits/solana-games-audit-prep/closecall.md`.
> Focus areas: oracle validation, proportional payout math, remaining-account safety, refunds, pause behavior, and configured entry limits.

## Scope

- `solana/programs/closecall/src/state.rs`
- `solana/programs/closecall/src/instructions/bet.rs`
- `solana/programs/closecall/src/instructions/settle_round.rs`
- `solana/programs/closecall/src/instructions/timeout_refund.rs`
- `solana/programs/closecall/src/instructions/force_close.rs`
- `solana/programs/closecall/src/instructions/initialize_config.rs`
- `solana/programs/closecall/src/error.rs`
- `solana/tests/closecall.ts`
- `backend/src/routes/closecall.ts`
- `backend/src/worker/closecall-clock.ts`
- `backend/src/worker/settle-tx.ts`

## Pass Summary

| Category | Count |
|----------|-------|
| Must Fix Before External Audit | 2 |
| Needs Test Proof | 3 |
| To Do Soon | 1 |
| Document As Trust Assumption | 1 |
| Open Investigation | 1 |
| Ask External Auditor | 1 |

## Key Findings

The two blocking findings are:

- `CCC-1`: `settle_round` still accepts backend-supplied close prices as instruction arguments and does not validate a Pyth price update account against `CloseCallConfig.pyth_feed_id`, freshness, or exponent normalization.
- `CCC-2`: `initialize_config` accepts any `max_entries_per_side: u8`, but the round account allocates vectors with `#[max_len(32)]`. Values above 32 can let betting proceed past the allocated vector capacity and fail late after lamport transfer is attempted.

Important coverage gaps:

- There are no Close Call pause tests, despite `bet` being pause-gated and settlement/refund paths intentionally not being pause-gated.
- Existing tests cover happy-path remaining-account order, but not substitution, wrong ordering, missing accounts, or extra accounts for settlement/refund paths.
- `settle_round`, `timeout_refund`, and `force_close` mutate soon-to-be-closed account state after direct lamport transfers. This is not an immediate exploit under Anchor atomicity, but it violates the audit packet's lamport-movement baseline and should be cleaned up.

## Positive Notes

- Minute alignment is enforced on-chain for bets: `minute_ts` must equal `(Clock::get()?.unix_timestamp / 60) * 60`.
- Late bets at or after the configured betting window are rejected with a strict `< betting_window` check.
- One-wallet-one-bet is enforced across both sides.
- Settlement, timeout refund, and force close return rent to `round.server` via a validated `rent_receiver`.
- Remaining-account transfers check each supplied key against the stored bettor key before moving lamports.
- Decisive proportional payout assigns rounding remainder to the last winner, so dust is not stranded in the round account before close.

## Verification

No tests were run in this pass. This was a targeted code audit and artifact-writing pass.

Recommended targeted command before closing the Close Call pass:

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/closecall.ts)
```

Then run:

```bash
./scripts/check-fees.sh
./scripts/check-program-ids.sh
```
