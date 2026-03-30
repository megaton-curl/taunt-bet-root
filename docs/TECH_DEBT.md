# Technical Debt & Temporary Fixes

Track temporary hacks, relaxed rules, and shortcuts here. 
**Goal**: Eliminate these items before V1 Launch (or explicitly defer them).

---

## High Priority (Fix ASAP)

(none)

---

## Medium Priority (Before Launch)

### [Jackpot] Backend game-engine PDA helper uses stale `roundNumber` seed
- **Date**: 2026-03-13 (identified), 2026-03-30 (updated)
- **Location**: `backend/packages/game-engine/src/lordofrngs.ts:17-26`
- **What**: `getRoundPda(roundNumber)` derives PDAs using sequential round counter, but on-chain program uses `["jackpot_round", match_id]` (random 8-byte ID). `tx-builder.ts` has the correct `deriveLordRoundPda(matchId)`.
- **Why**: On-chain PDA redesign completed (tier→match_id) but game-engine helper wasn't updated.
- **Fix Criteria**: Update `getRoundPda` to accept `matchId: Buffer` instead of `roundNumber`, or remove it in favor of `tx-builder.deriveLordRoundPda`.

---

## Low Priority (Post-Launch cleanup)

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
