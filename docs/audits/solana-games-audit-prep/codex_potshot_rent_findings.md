# Pot Shot Rent Audit Findings - Codex

> Internal audit pass over Pot Shot rent flow per `potshot.md`.
> Focus: rent should be contributed by the server and paid back to the server.

## Resolved Findings

### [MEDIUM] CPSR-1 - `claim_payout` closed round rent to `caller` instead of stored `server`

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/potshot/src/instructions/create_round.rs`, `solana/programs/potshot/src/instructions/claim_payout.rs`, `solana/programs/potshot/src/instructions/cancel_round.rs`, `solana/programs/potshot/src/instructions/timeout_refund.rs`, `solana/programs/potshot/src/instructions/force_close.rs`
- **Game:** Pot Shot
- **Threat actor:** Backend operator with leaked secret access; permissionless caller who obtains a valid settlement secret before the backend settles
- **Invariant:** Pot Shot round rent is funded by the server at account initialization and must be returned to the stored `round.server` on every terminal close path.
- **Original Issue:** `create_round` documents the server as the rent payer and uses `payer = server` for the round PDA. The refund/administrative close paths return rent to `round.server`, but successful settlement closed to the unconstrained settlement `caller`. The `claim_payout` account comment said "caller/server", but the program did not require those keys to match.
- **Exploit Path:** A valid server secret leaks before settlement. An attacker submits `claim_payout` first with themselves as `caller`, the correct derived winner account, treasury, slot hashes, and secret. The outcome and player payout remain pinned by the on-chain checks, but Anchor closes the round PDA to the attacker's signer because `close = caller`.
- **Impact:** Server-paid rent can be diverted on the successful settlement path. Player principal and winner payout are not redirected by this issue, but repeated leaked/raced settlements can drain the server's rent refunds and violate the documented lifecycle contract.
- **Proof:** `create_round.rs:18` describes the server as paying rent, `create_round.rs:31-33` initializes with `payer = server`, and `create_round.rs:62` says "Server pays rent via `init`." `claim_payout.rs:14-21` accepts any mutable signer as `caller` and closes `round` to `caller`. In contrast, `cancel_round.rs:47-67`, `timeout_refund.rs:16-20` plus `timeout_refund.rs:50`, and `force_close.rs:16-20` plus its `rent_receiver == round.server` validation all route rent back to the stored server.
- **Discovered via:** Codex prompt: "run an audit as per docs/audits on potshot ... rent should be contributed by the server and paid back to the server"
- **Confidence:** High
- **Fix Applied:** `ClaimPayout` closes to a dedicated `rent_receiver` account, validates that account equals `round.server`, and backend settlement plus generated IDLs pass the server wallet.
- **Status:** Resolved - `claim_payout` now closes to a `rent_receiver` account validated against `round.server`; backend settlement and generated IDLs pass the server wallet.

## Notes

This finding intentionally focuses on the rent contract rather than broader Pot Shot payout math. A prior internal Pot Shot pass already identified the same divergence as PS-1; this artifact restates it under the stricter invariant requested here: server funds rent, server gets rent back.
