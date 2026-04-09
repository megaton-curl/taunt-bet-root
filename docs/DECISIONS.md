# Decision Log

Track key architectural and product decisions as they're made.

---

## 2026-02-09 - Initial Setup

### Decision: FlipYou First, Lord of the RNGs Second
**Date**: 2026-02-09
**Decision**: Delivery order starts with FlipYou, then Lord of the RNGs
**Rationale**: FlipYou and Lord of the RNGs share a backend-assisted, non-real-time settlement shape, letting us validate core fairness and settlement flows before tackling Crash timing complexity.
**Status**: ✅ Locked

### Decision: Standard Anchor Programs (Not BOLT ECS)
**Date**: 2026-02-17 (revised from 2026-02-09)
**Decision**: Use standard Anchor `#[program]` / `#[derive(Accounts)]` architecture. Legacy BOLT ECS code removed.
**Rationale**: BOLT ECS adds unnecessary abstraction for our use case (simple 1v1 games). Standard Anchor is well-documented, widely supported by tooling (bankrun, IDL gen), and simpler to debug. Separate programs per game (flipyou, platform) + shared lib crate for constants.
**Alternatives considered**: BOLT ECS (original choice, too complex for current requirements), single monolith program (poor separation of concerns).
**Status**: ✅ Locked

### Decision: Normal Wallets First, Privy Later
**Date**: 2026-02-09
**Decision**: Ship normal Solana wallet flow first (Phantom/Solflare); evaluate Privy embedded wallets later
**Rationale**: Normal wallets are simpler to validate. Privy adds complexity (session keys, embedded wallet creation) that can be added after core game loop is proven.
**Status**: ✅ Locked

### Decision: Two-Repo Structure
**Date**: 2026-02-09
**Decision**: Root repo for project management/docs, the code submodules (`solana/`, `backend/`) as git submodule pointing to code repo
**Status**: ❌ Superseded by Multi-Repo Structure (2026-03-30)

### Decision: Multi-Repo Structure
**Date**: 2026-03-30
**Decision**: Split monorepo into independent repos with root orchestration:
- `solana/` — submodule → `taunt-bet/solana.git` (Anchor programs + shared Rust crate)
- `backend/` — submodule → `taunt-bet/backend.git` (Hono API + shared TS packages)
- `chat/` — submodule → `taunt-bet/chat.git` (dedicated chat service + event-feed transport)
- Root repo → `megaton-curl/taunt-bet-root.git` (docs, scripts, e2e tests, submodule orchestration)
- Frontend and waitlist — separate repos (being reworked independently)
**Rationale**: Independent deploy cycles per domain. Backend deploys without touching programs. Solana builds without Node backend. Eliminates monorepo install bloat. Each repo is self-contained and deployable.
**Status**: ✅ Implemented

### Decision: FE Entrypoint
**Date**: 2026-02-11 (updated 2026-03-30)
**Decision**: Frontend is being reworked in a separate repo. Not part of this workspace currently.
**Status**: 🟡 In Transition

---

## 2026-02-25 - Architecture Pivot

### Decision: Solana Settlement & Fairness Standard (Pivot Doc)
**Date**: 2026-02-25
**Decision**: Program-per-game + shared Rust crate (`solana/shared/`), standardized lifecycle with timeout/pause/fee/refund invariants across all 8 games.
**Rationale**: Consistency across all games, single audit path, compile-time guarantees via shared crate. No shared on-chain kernel — consistency from compilation, not CPI. See `docs/DESIGN_REFERENCE.md` for full architecture.
**Alternatives considered**: Shared on-chain EscrowKernel program (CPI overhead, larger blast radius), per-game bespoke state machines (inconsistent, harder to audit).
**Status**: ✅ Locked

### Decision: VRF Provider = Orao (MagicBlock dropped)
**Date**: 2026-02-25
**Decision**: Replace MagicBlock Ephemeral VRF with **Orao** as the single VRF provider in the baseline architecture at that time.
**Rationale**: Orao proved straightforward devnet integration and fast fulfillment in live smoke tests. This gives us one VRF integration path for FlipYou and Lord of RNGs while preserving the pivot architecture.
**Alternatives considered**: Switchboard (reachable on devnet but required additional callback-consumer wiring for equivalent end-to-end benchmarking), keeping MagicBlock VRF (limited VRF focus, uncertain long-term support).
**Status**: ❌ Reversed

### Decision: Crash Fairness Model — VRF + Commit-Reveal (Not HMAC-Only)
**Date**: 2026-02-25
**Decision**: Crash uses VRF seed (requested pre-round) + commit-reveal for server result verification. Replaces the HMAC seed chain model.
**Rationale**: VRF provides unpredictable seed generation without pre-commitment chains. Commit-reveal proves server honesty for the off-chain engine. Same two fairness primitives used across all games — no per-game mechanisms.
**Alternatives considered**: HMAC seed chain (Bustabit model — works but requires separate pre-commitment infrastructure not shared with other games).
**Status**: ❌ Reversed

---

## 2026-03-11 - Fairness Realignment

### Decision: Fairness Standard = Backend-Assisted Hybrid Fairness
**Date**: 2026-03-11
**Decision**: Fairness defaults to backend-assisted commit-reveal with future slot-hash entropy, wallet-authenticated create requests, backend-partially-signed create transactions, backend-submitted settlement, and permissionless timeout refunds as the liveness guarantee.
**Rationale**: This aligns product, on-chain, backend, and E2E flows under one default model. It removes the mismatch between frontend docs, backend docs, and newer fairness specs, while preserving public verification and strong timeout guarantees.
**Alternatives considered**: Keeping VRF as the default path (too expensive and inconsistent with the current backend contract), pure client-side secret generation (weaker trust model), HMAC-only server fairness (insufficient on-chain verifiability).
**Status**: ✅ Locked

### Decision: VRF Is Optional, Not Default Infrastructure
**Date**: 2026-03-11
**Decision**: VRF is no longer the default fairness path for game specs. If a future game truly requires VRF, it must be documented explicitly as an exception or planned backlog feature rather than assumed platform-wide.
**Rationale**: The current target architecture is the hybrid fairness model captured in specs `005-hybrid-fairness` and `006-fairness-backend`. Leaving VRF marked as default causes spec drift and incorrect test planning.
**Alternatives considered**: Keeping Orao as the universal default, or removing all mention of VRF entirely.
**Status**: ✅ Locked

---

## 2026-03-12 - Match ID and Profile Removal

### Decision: Remove PlayerProfile, Use Backend-Generated Random Match IDs
**Date**: 2026-03-12
**Decision**: Replace nonce-based PDA derivation (`["match", creator, nonce.to_le_bytes()]`) with backend-generated random 8-byte match IDs (`["match", creator, match_id]`). Remove `PlayerProfile` entirely — stats move off-chain. Allow multiple concurrent matches per user.
**Rationale**: The `PlayerProfile.match_nonce` pattern required a 3-instruction atomic transaction (create_player_profile + increment_match_nonce + create_match), added UX friction (rent for profile PDA), prevented concurrent matches per user, and required CPI from game programs into the platform program during settlement. Random match IDs eliminate all of these issues while keeping PDA derivation deterministic and collision-free (8 random bytes = 2^64 possible IDs).
**Impact**: On-chain: flipyou `nonce: u64` → `match_id: [u8; 8]`, settle instruction drops 3 accounts (creatorProfile, opponentProfile, platformProgram). Platform program loses 3 instructions (create_player_profile, increment_match_nonce, update_player_profile) and the PlayerProfile state. Lord of RNGs claim_payout drops profile CPI. Shared crate `cpi.rs` deleted. Backend: `nonce` removed from request body, auth canonical JSON, and DB schema; replaced with server-generated `match_id`. Frontend: nonce fetching and profile checks removed from create flow.
**Status**: ✅ Locked

---

## 2026-03-24 - Fee Simplification

### Fee Simplification: 500 bps Flat Fee (2026-03-24)
- **Decision**: Simplified fee from 3 buckets (300 bps = 200 rev + 70 rakeback + 30 chest) to a single flat 500 bps fee to one treasury
- **Source of truth**: On-chain PlatformConfig account (fee_bps + treasury), updatable via `update_platform_config` instruction
- **Rationale**: Single source of truth, admin can change without redeploying programs, eliminates dead split_fee() code
- **Impact**: All games read fee_bps and treasury from PlatformConfig at settlement time. Per-game configs no longer store treasury.
- **Status**: ✅ Locked

---

## 2026-04-02 - Frontend Separation

### Decision: Frontend is a Separate Project
**Date**: 2026-04-02
**Decision**: Frontend development is handled by a separate team in a separate repository. This repo (root + solana + backend) does not spec, implement, or modify frontend code unless specifically asked. Frontend repo may be checked out as a read-only reference (like `waitlist/`).
**Rationale**: Team split — frontend rework happening in parallel by different developers. Clear ownership boundary prevents scope creep and conflicting changes.
**Impact**: All existing specs with frontend acceptance criteria are marked "out of scope — separate frontend project". Spec template updated to exclude frontend sections. CLAUDE.md updated to reflect scope boundary. Backend provides API contracts; frontend team consumes them.
**Status**: ✅ Locked

---

## Template for New Decisions

```markdown
### Decision: [Title]
**Date**: YYYY-MM-DD
**Decision**: [What was decided]
**Rationale**: [Why this choice]
**Alternatives considered**: [Other options]
**Status**: [✅ Locked / 🟡 Revisitable / ❌ Reversed]
```

---
