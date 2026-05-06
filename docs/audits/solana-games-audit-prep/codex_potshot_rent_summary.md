# Pot Shot Rent Audit Summary - Codex

> Internal audit pass focused on Pot Shot rent handling per `docs/audits/solana-games-audit-prep/potshot.md`.
> Requested focus: rent should be contributed by the server and paid back to the server.

## Scope

- `solana/programs/potshot/src/instructions/create_round.rs`
- `solana/programs/potshot/src/instructions/claim_payout.rs`
- `solana/programs/potshot/src/instructions/cancel_round.rs`
- `solana/programs/potshot/src/instructions/timeout_refund.rs`
- `solana/programs/potshot/src/instructions/force_close.rs`
- `solana/programs/potshot/src/state.rs`
- IDL/test/backend references found by targeted `rent`, `server`, and `claim_payout` searches

## Result

One finding was identified and resolved:

- `codex_potshot_rent_findings.md` - `[MEDIUM] CPSR-1: claim_payout closed round rent to caller instead of stored server`

The invariant is otherwise implemented consistently:

- `create_round` initializes the round with `payer = server` and stores `round.server`.
- `cancel_round` validates `rent_receiver == round.server` and manually closes remaining lamports to that account.
- `timeout_refund` uses `close = rent_receiver` and validates `rent_receiver == round.server`.
- `force_close` uses `close = rent_receiver` and validates `rent_receiver == round.server`.

The successful settlement path was the outlier:

- `claim_payout` now uses `close = rent_receiver`.
- `rent_receiver` is constrained to `round.server`.
- Backend settlement and generated IDLs pass the server wallet as `rent_receiver`.

## Applied Fix

`claim_payout` now closes to a dedicated server/rent receiver account validated against `round.server`, matching the other Pot Shot close paths.

Suggested account shape:

```rust
#[account(mut)]
pub caller: Signer<'info>,

#[account(
    mut,
    close = rent_receiver,
    seeds = [b"potshot_round", &match_id],
    bump = round.bump,
)]
pub round: Account<'info, PotShotRound>,

/// Server wallet that paid rent on round creation.
/// CHECK: Validated against round.server in handler.
#[account(mut)]
pub rent_receiver: AccountInfo<'info>,
```

Then add:

```rust
require_keys_eq!(
    ctx.accounts.rent_receiver.key(),
    ctx.accounts.round.server,
    PotShotError::AccountMismatch
);
```

The backend settlement transaction and generated IDLs were updated to pass the server account.

## Verification

- Generated Pot Shot IDLs include `rent_receiver`.
- Backend settlement account construction includes the server wallet as `rent_receiver`.
- Full `claim_payout` settlement remains covered by devnet E2E because bankrun cannot precisely simulate the SlotHashes entropy path used by this instruction.
