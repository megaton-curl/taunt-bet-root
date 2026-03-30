# Specification Quality Checklist: 101 Lord of the RNGs

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-02-12
**Refined**: 2026-02-26
**Spec**: [spec.md](spec.md)

---

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] Acceptance criteria are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

---

## Open Items

| # | Item | Category | Blocking? | Resolution |
|---|------|----------|-----------|------------|
| 1 | No maximum entry limit per player | FR-3 | No | **Resolved** — confirmed whale-friendly. Entries is a u32 counter per PlayerEntry, not account allocation. |
| 2 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes | **Resolved** — Fee is now 500 bps (5%), single treasury via PlatformConfig on-chain. |
| 3 | Edge case: player buys all entries (single winner guaranteed) | Edge Case | No | **Accepted** — whale-friendly by design. No cap. |
| 4 | Edge case: player disconnects during countdown (refund policy) | Edge Case | No | **Resolved** — entries are committed on-chain. "Leave" is UI-only. Funds stay in round. Timeout refund available if VRF fails. |
| 5 | Edge case: exactly 2 players, one disconnects before spin | Edge Case | No | **Resolved** — same as #4. Once joined, entries are committed. Round continues to spin with all committed players. |
| 6 | No contract files for deferred games | Contract | No | **Resolved** — building contracts as part of this spec. |

## Refinement Decisions (2026-02-26)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tier amounts | SOL from shared crate | Same tiers as coinflip (0.005–1.0 SOL). Concept doc USD values outdated. |
| Entry cap | No cap (whale-friendly) | Entries is u32 counter per player. Account size bounded by max players, not entries. |
| Max players | 20 per round | Vec\<PlayerEntry\> in round PDA. 20 × 36 bytes = ~720 bytes. Conservative for V1. |
| Account design | Vec in round PDA | Single account per round. Simpler than separate PDAs per player. |
| Spin trigger | "Spin" button + permissionless idempotent instruction | Button enables after countdown expires. Any player can press it. On-chain rejects if already Locked (idempotent). All clients poll for phase change. |
| Claim model | Pull-based + auto-send | On-chain: winner calls claim. Frontend: auto-sends after reveal. Matches coinflip pattern. |
| Game discriminator | Add to platform CPI | game_type field in update_player_profile. Coinflip=0, Lord=1. |
| Audio | Deferred | Same decision as coinflip FR-8. Dedicated audio spec later. |

## Refinement Carry-Forward (Pivot)

- [x] Lock Lord of the RNGs fairness proof contract fields and verification flow for selected VRF provider. → **Resolved**: Orao VRF reused from coinflip. RoundSettled event emits randomness + winning_slot + vrf_request_key. Verification re-derives slot from randomness.
- [x] Confirm determinism boundary: wheel outcome and payouts derive solely from verified VRF output and on-chain state. → **Resolved**: `winning_slot = randomness[0..8] as u64 % total_entries`. Pure deterministic from Orao on-chain randomness.
- [x] Specify timeout/refund behavior for unresolved rounds and countdown cancellation paths. → **Resolved**: `timeout_refund` instruction refunds all players if VRF unfulfilled after 2 minutes. `force_close` for admin cleanup.
- [x] Define replay/idempotency protections for entry purchase, resolve, and payout distribution. → **Resolved**: join_round rejects duplicate players. buy_more_entries requires existing player. claim_payout closes round PDA (double-claim impossible). start_spin rejects non-Active phase.
- [x] Add failure-mode acceptance checks for low-player rounds, disconnections, and VRF resolution failures. → **Resolved**: min 2 players enforced. Disconnect = entries committed. VRF failure → timeout_refund. Paused config rejects new rounds.

## Gap Analysis Carry-Forward (004 Shared Infrastructure)

- [ ] Extend platform profile update path with a game discriminator before/with Lord implementation. → **In scope**: Adding game_type parameter to update_player_profile as part of Phase B checklist items.
- [ ] Update shared CPI helper contract to carry game identity for per-game attribution in profile/history. → **In scope**: Same as above.
- [ ] Add acceptance checks that settlement updates both aggregate and per-game stats correctly. → **In scope**: Bankrun tests will verify profile CPI with game_type for both winner and losers.

## Notes

- Source material (LORD_OF_THE_RNGS.md) is well-specified
- Simple game mechanics (buy entries → spin → winner takes all)
- 9 functional requirements (FR-8 audio fully deferred, FR-9 fairness verification added)
- Multi-entry mechanic is the distinguishing feature — probability math is straightforward
- VRF reuse from Coinflip simplifies on-chain implementation
- Existing frontend mock (types, components, context, mock-simulation) provides the contract shape
- 22 implementation checklist items across 6 phases (A–F)
- Max 20 players per round, no entry cap per player, SOL-denominated tiers
