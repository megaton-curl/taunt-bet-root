# Technical Debt & Temporary Fixes

Track temporary hacks, relaxed rules, and shortcuts here. 
**Goal**: Eliminate these items before V1 Launch (or explicitly defer them).

---

## High Priority (Fix ASAP)

(none)

---

## Medium Priority (Before Launch)

### [Challenge Engine] SOL crate payout handler needs production review
- **Date**: 2026-04-03
- **Location**: `backend/services/backend/src/queue/handlers/crate-sol-payout.ts`
- **What**: `CRATE_SOL_PAYOUT` handler sends SOL from server keypair to player wallet. Needs manual review before production enablement — verify transfer amounts, error handling, retry behavior, and rate limiting against real treasury wallet.
- **Current mitigation**: Handler marks failed transfers as terminal (no retry). Integration-tested with mock connection only.
- **Proper solution**: (1) Add retry logic with max attempts (like referral-claim handler), (2) Add rate limiting per user, (3) Verify payout amounts against pool balance, (4) Test with real devnet treasury wallet, (5) Add monitoring/alerting for failed payouts.
- **Why not now**: M1 launch — handler structure is correct, needs ops hardening before real SOL flows through it.

### ~~[Jackpot] Backend game-engine PDA helper uses stale `roundNumber` seed~~
- **Resolved**: 2026-04-02 — `getRoundPda(matchId: Buffer)` already uses correct seed. Confirmed in gap analysis for spec 101.

---

## Low Priority (Post-Launch cleanup)

### [Challenge Engine] Extract to separate service
- **Date**: 2026-04-04
- **Location**: `backend/services/backend/src/queue/handlers/` (game-settled, reward-pool-fund, points-grant, crate-drop, crate-sol-payout), `routes/` (challenges, points, dogpile, admin)
- **What**: The reference spec (`docs/references/challenge-engine-spec.md`) calls for `challenge-engine` as a standalone internal service with separate verification-workers and reward-service components. M1 implementation lives in the backend monolith for simplicity.
- **Current mitigation**: Event-driven architecture already decouples all components — handlers communicate via the event queue, not direct function calls. Extraction is mechanical when scale demands it.
- **Proper solution**: Move challenge engine handlers, routes, and DB helpers to a new `services/challenge-engine/` package. Share the event queue and DB connection. Separate deploy cycle.
- **Why not now**: At M1 scale, a second service adds deployment complexity for zero benefit. The event queue boundary makes future extraction straightforward.

---

## Post-V1 Backlog (Revisit When More Advanced)

Items that work today but deserve a proper implementation once the platform matures.

### [On-Chain] Stale account cleanup after program redeploys
- **Date**: 2026-03-15
- **Location**: `services/backend/src/worker/settlement.ts`, on-chain accounts
- **What**: Program redeploys can leave old accounts with incompatible layouts (different enum encoding, removed/reordered fields). Currently the settlement worker caches undecodeable PDAs and skips them after one warning. There's also one permanently undecodeable 888-byte Lord account on devnet from a pre-IDL-change deploy.
- **Current mitigation**: `undecodeablePdas` set in settlement worker, try/catch per-account in poll loop.
- **Proper solution**: (1) Admin "close any PDA" instruction that skips deserialization (transfer lamports + zero data), (2) Pre-deploy cleanup script that closes all game accounts before upgrade, (3) Account versioning (`version: u8` as first field) so decoders can branch on layout version.
- **Why not now**: Dev phase — redeploys are frequent, accounts are low-value, and the workaround is adequate.
