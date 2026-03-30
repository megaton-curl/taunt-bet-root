# Checklist: 004 Shared Infrastructure

## Pre-Refinement Review

| # | Item | Category | Blocking? | Resolution |
|---|------|----------|-----------|------------|
| 1 | Orao VRF uses request-then-read model (not callback like MagicBlock) | Architecture | No | Confirmed: game requests randomness at join, Orao fulfills to PDA, game reads at claim time (3-tx flow) |
| 2 | Coinflip rewrite scope: on-chain only or include TS? | Scope | Yes | Resolved: on-chain + IDL sync only. Game-engine + frontend wiring handled separately |
| 3 | VRF testing approach: bankrun vs devnet | Testing | Yes | Resolved: `mock-vrf` feature flag for bankrun + devnet smoke test separately |
| 4 | Submodule CLAUDE.md still lists MagicBlock in locked decisions | Docs | No | Resolved: update as part of final cleanup iteration |
| 5 | Existing coinflip phases (u8 constants) don't match new RoundPhase enum | Migration | No | Handled: coinflip rewrite replaces u8 phases with shared RoundPhase enum |
| 6 | `ephemeral-vrf-sdk` dependency must be removed | Dependency | No | Handled: removed during coinflip state rewrite iteration |
| 7 | No visual changes — backend/on-chain only | Visual | No | Confirmed: no visual regression impact |

## Architecture Notes

- **Shared crate pattern**: Pure Rust modules with types, validation functions, and helper functions. No Anchor `#[account]` structs (those stay per-program). Games import and call shared helpers.
- **Orao integration**: Request-then-read. `request_orao_randomness()` CPIs into Orao. `read_orao_randomness()` reads fulfilled `RandomnessAccountData` PDA. `mock-vrf` feature flag bypasses Orao CPI in bankrun tests.
- **Coinflip phases migration**: WAITING(0)/LOCKED(1)/SETTLED(2)/CANCELLED(3) → shared `RoundPhase` enum. Coinflip uses subset: Waiting→Locked→Settled/Refunded (skips Active and Resolving — 1v1 VRF game with 3-tx flow reads result at claim time).
- **Claim-based payout**: 3-tx pattern for VRF games — claim reads Orao randomness, derives winner, transfers funds in one tx. No separate settle/resolve instruction. Extraction formalizes deposit/payout/refund as shared helpers.
- **Existing fee split**: fees.rs uses 200/70/30 bps. This is canonical per `docs/FOUNDATIONS.md` §8.
