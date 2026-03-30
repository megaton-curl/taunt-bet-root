# Architecture Pivot — Solana Settlement & Fairness Standard

**Date:** 2026-02-25  
**Status:** Approved for implementation  
**Inputs:** Gemini, GPT, Opus resolution docs + synthesis discussion

---

## Context

We have 8 games to ship on Solana. Coinflip is built (Anchor program, escrow PDAs, VRF resolution, fee-to-treasury, player profile CPI). Crash is drafted but unbuilt. The remaining 6 are design-only.

Before building the next 7 games, we're locking down a shared contract pattern so they're all consistent, auditable, and maintainable.

This document is the canonical reference for that pattern.

---

## 1. Non-Negotiable Principles

- **All user funds live on-chain in PDA vaults.** No game server ever holds custody of user SOL.
- **Every game follows the same on-chain lifecycle.** No bespoke state machines per game.
- **Two fairness approaches cover all games.** No per-game fairness mechanisms.
- **Failure modes are first-class.** Every round has a resolve deadline. Unresolved rounds always end in refund.

---

## 2. Contract Topology

**Program-per-game + shared Rust crate.**

Each game is its own Anchor program. All games depend on `solana/shared/` for escrow helpers, lifecycle management, fairness verification, fee math, tier validation, and timeout logic. The platform program handles player profiles and treasury config via CPI. Games can be audited, upgraded, and paused independently.

No shared on-chain EscrowKernel program. The consistency guarantees come from the shared crate at compile time, not from CPI at runtime. This avoids CPI overhead and keeps the blast radius of any single game program contained.

If audit scope later demands a dedicated vault program (audit money-handling once, trust it everywhere), the shared crate design makes extraction straightforward. We don't pay that cost now.

---

## 3. On-Chain Lifecycle

Every game, every round, every time:

```
WAITING → ACTIVE → LOCKED → RESOLVING → SETTLED
                                      ↘ REFUNDED (on timeout or cancel)
```

| Phase | What happens |
|---|---|
| **WAITING** | Round PDA created. Players can join. SOL deposited to PDA. |
| **ACTIVE** | Minimum players met. Round is live. Entry may still be open (game-specific). |
| **LOCKED** | No more entries. Resolution process begins (VRF request, game engine start, oracle read). |
| **RESOLVING** | Outcome is being determined. `resolve_deadline` timestamp is set. |
| **SETTLED** | Outcome verified. Winners and amounts recorded on PDA. Winners call `claim_payout` to pull funds. Fee sent to treasury. PDA closed after all claims. |
| **REFUNDED** | Timeout hit or round cancelled. Depositors call to pull their refund. PDA closed after all refunds. |

### Claim-Based Payout Pattern

For VRF games, there is no separate settle/resolve transaction. The `claim_payout` instruction reads the Orao randomness account at claim time, derives the winner, and transfers funds — all in one tx. Either participant can trigger claim; payout goes to the derived winner regardless of caller.

**Three-transaction flow for VRF games:**
1. `create` — creator deposits, phase = WAITING
2. `join` — opponent deposits + requests Orao VRF, phase = LOCKED, `resolve_deadline` set
3. `claim` — either player calls. Reads fulfilled Orao randomness, derives winner, transfers payout + fee, emits audit event, closes PDA.

Frontend reads the Orao randomness PDA (free, no tx) to show the result and maintain a **claimable / unresolved games list** per user.

For commit-reveal games, the server submits a reveal (writes outcome), then players claim. Same pull-based pattern, but with an extra RESOLVING phase for the server's reveal.

Why claim-based: the settle instruction doesn't need all winner accounts (unwieldy with N-player games), it's more gas-efficient on Solana (smaller instruction), and it puts the payout tx cost on the person who benefits.

### Hard Invariants (from shared crate)

- **Timeout invariant:** Every round entering RESOLVING gets a `resolve_deadline`. After expiry, anyone can trigger refund. No round hangs forever.
- **Pause invariant:** Global pause (platform-level) and per-game pause (game config). Paused games reject new rounds but existing rounds can still settle or refund.
- **Fee invariant:** Fee calculation and treasury transfer live exclusively in the shared crate. Games never implement their own fee math.
- **Refund invariant:** Any round that doesn't reach SETTLED before its deadline is refundable. No player funds get stuck.
- **Claim invariant:** Payouts and refunds are pull-based (winner/depositor calls claim). Double-claim returns error. PDA only closes after all claims processed.

---

## 4. Fairness — Two Approaches, All Games

### What we're proving

Every game answers one or both of two questions:

1. **"Was the random input fair?"** — Needs an unpredictable, unmanipulable number.
2. **"Did the server report honestly?"** — Needs proof the server didn't tamper with off-chain results.

Oracle price feeds (Pyth) are a data source, not a fairness mechanism. The contract reads them directly — no trust in server relay.

### Approach 1: VRF (randomness)

A single VRF provider supplies all randomness for all games. One integration, one audit, one trust assumption.

- Game requests VRF during the LOCKED phase.
- VRF callback writes output to the Round PDA.
- Contract derives game outcome deterministically from VRF output.
- For real-time games (Crash): VRF is requested during the waiting/lobby phase. The VRF output becomes the seed. Latency is absorbed before gameplay starts.

**Provider decision:** **Orao**. It is Solana-native, production-grade, and selected as the single VRF provider for V1 after devnet smoke testing. **MagicBlock VRF is dropped** — their core product is ephemeral rollups, not VRF.

### Approach 2: Commit-Reveal (server verification)

For any game where the server computes results off-chain, the server proves it didn't cheat via commit-reveal. This is self-built in the shared crate.

- **Commit phase:** Server submits `hash = SHA256(server_seed)` to the Round PDA before or at round start.
- **Settle phase:** Server submits `server_seed` + result data. Contract checks `SHA256(server_seed) == stored_hash`. If valid, contract settles. If not, round is invalid → refund.

~50 lines of Rust. No third-party dependency. Auditable in isolation.

### Game × Approach Map

| Game | VRF | Commit-Reveal | Oracle (Pyth) | Notes |
|---|---|---|---|---|
| **Coinflip** | ✓ | — | — | VRF output → flip result. Simplest reference implementation. |
| **Lord of RNGs** | ✓ | — | — | VRF output → wheel position. Same as Coinflip, different payout math. |
| **Slots Utopia** | ✓ | — | — | VRF output → grid assignment. 9-player lobby, fixed distribution. |
| **Close Call** | — | — | ✓ | Contract reads Pyth price at timestamp. Deterministic on-chain. |
| **Crash** | ✓ | ✓ | — | VRF seed pre-round → crash point derived. Server runs engine, commit-reveal proves result matches seed. |
| **Game of Trades** | — | ✓ | ✓ | Pyth prices for PnL. Server computes rankings, commit-reveal for result. |
| **Chart the Course** | — | ✓ | — | Server scores drawings, commit-reveal for scoring result. |
| **Tug of Earn** | ✓ | ✓ | — | VRF for team assignment. Server aggregates taps, commit-reveal for totals. |

---

## 5. Third-Party Dependencies

| Dependency | Purpose | Scope |
|---|---|---|
| **VRF provider (Orao)** | All on-chain randomness | Coinflip, Lord of RNGs, Slots, Crash seed, Tug team assignment |
| **Pyth** | Price oracle feeds | Close Call, Game of Trades |
| **Self-built commit-reveal** | Server result verification | Crash, Game of Trades, Chart the Course, Tug of Earn |

Three dependencies total. One VRF, one oracle, one self-built module.

---

## 6. Shared Crate Scope (`solana/shared/`)

Already has: fee calculation, tier definitions.

Needs to grow to include:

- **Escrow helpers** — deposit to PDA, payout to winner(s), refund to all depositors, close PDA.
- **Lifecycle state machine** — phase enum, transition validation, timestamp tracking.
- **Timeout logic** — `resolve_deadline` enforcement, permissionless refund trigger after expiry.
- **Pause controls** — global and per-game pause flag checks.
- **Commit-reveal verifier** — hash commitment storage, SHA256 verification on reveal.
- **Fee distribution** — treasury transfer (already exists, formalize as the only path for fee math).
- **Platform CPI helpers** — `update_player_profile` calls with game/win/wager/won data.

---

## 7. Game-by-Game Architecture Map (Reference)

| ID | Game | Pattern | Resolution | Players | Payout Model |
|---|---|---|---|---|---|
| 001 | Coinflip | VRF | VRF → flip | 2 | Winner-takes-all minus fee |
| 002 | Crash | VRF + Commit-Reveal | VRF seed → crash point, server engine, commit-reveal settle | N | Cashout multiplier, house edge |
| 100 | Close Call | Oracle | Pyth price at timestamp | N | Green/red binary, pool split |
| 101 | Lord of RNGs | VRF | VRF → wheel position | N | Weighted jackpot |
| 102 | Game of Trades | Commit-Reveal + Oracle | Pyth PnL, server rankings, commit-reveal | N | PnL-ranked payout |
| 103 | Chart the Course | Commit-Reveal | Server scoring, commit-reveal | N | Score-ranked payout |
| 104 | Slots Utopia | VRF | VRF → grid result | 9 | Fixed grid distribution |
| 105 | Tug of Earn | VRF + Commit-Reveal | VRF teams, server tap aggregation, commit-reveal | N | Winning team splits pool |

---

## 8. Next Steps

1. **Formalize shared crate interface.** Define the escrow helpers, lifecycle trait, commit-reveal module, timeout logic. This is the foundation everything else builds on.

2. **Implement Orao as the VRF provider.** Coinflip gets rewritten to use Orao first — that rewrite becomes the VRF reference implementation.

3. **Rewrite Coinflip (001).** Drop MagicBlock VRF. Implement against new shared crate + chosen VRF. Validate lifecycle, timeout, pause, and fee invariants end-to-end.

4. **Build Lord of the RNGs (101) as the second game.** This validates the shared VRF path after Coinflip with a different payout/entry model. Then build one Commit-Reveal game (Crash (002) or Close Call (100), depending on readiness) to validate the full stack.

5. **Decide build order for remaining games** based on which resolution patterns are already validated.
