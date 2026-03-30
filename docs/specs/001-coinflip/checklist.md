# Specification Quality Checklist: 001 Coinflip

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-02-12
**Refined**: 2026-02-17
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

| # | Item | Category | Blocking? | Status |
|---|------|----------|-----------|--------|
| 1 | Contract files not identified (frontend mocks, on-chain interfaces) | Contract | Yes | **Resolved** — all contract files identified in spec §Contract Files |
| 2 | Platform fee inconsistency: game docs use 3%, PLATFORM.md says 2.0-2.2% | Assumption | Yes | **Resolved** — Fee is now 500 bps (5%), single treasury via PlatformConfig on-chain. |
| 3 | One-active-match-per-player limit not specified in source docs | FR-1 | No | **Resolved** — enforced by PDA seeds `[b"match", creator]` (one match per creator) |
| 4 | Estimated wait time data source undefined | FR-6 | No | **Deferred** — post-MVP polish, noted in FR-6 AC |
| 5 | Edge case: creator cancels before opponent joins | Edge Case | No | **Resolved** — cancel_match instruction handles this (WAITING phase only) |
| 6 | Edge case: timeout on unjoined matches (expiry policy) | Edge Case | No | **Deferred** — no auto-expiry in V1, creator must cancel manually |
| 7 | Edge case: wallet disconnect during flip/settlement | Edge Case | No | **In scope** — frontend error handling checklist item covers this |
| 8 | Edge case: VRF request timeout or failure handling | Edge Case | No | **Resolved** — timeout_cancel instruction handles VRF-never-fulfilled case (2 min timeout, either player can trigger) |

## Refinement Decisions (2026-02-17)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tier amounts | Frontend/spec values canonical | Iron→Diamond, [0.005, 0.01, 0.1, 0.25, 0.5, 1.0] SOL. On-chain shared crate updated to match. |
| Coin side discriminants | 0/1 (on-chain canonical) | heads=0, tails=1. Game-engine updated to match. |
| VRF approach | Orao VRF (post-004 rewrite) | join_match embeds Orao VRF request CPI. claim_payout reads randomness at claim time. Mock-vrf feature for bankrun tests. |
| Platform program | Included in spec | CPI for player profile updates on settlement. |
| Spec scope | On-chain + engine + frontend | Audio, fairness UI, animation polish, Playwright tests deferred. |
| PDA structure | Rewrite game-engine | Delete old BOLT ECS PDAs, use simple creator-based PDAs matching on-chain. |

## Refinement Carry-Forward (Pivot)

- [x] Lock Coinflip fairness proof contract fields and verification path for selected VRF provider. → **Resolved**: Orao VRF integrated (spec 004). MatchSettled event emits vrf_request_key + randomness. verification.ts confirms VRF fulfillment. (iteration 14-17, 19)
- [x] Confirm determinism boundary: contract derives final outcome from verifiable on-chain/public inputs only. → **Resolved**: from_randomness(byte) is pure deterministic (shared/src/constants.rs:15). Orao randomness account is on-chain public data. (iteration 19)
- [x] Add explicit timeout/refund acceptance checks aligned to shared lifecycle invariants. → **Resolved**: timeout_cancel uses shared::timeout::is_expired + shared::vrf_orao::is_fulfilled guards. 3 bankrun tests cover timeout scenarios. (iteration 19)
- [x] Reconfirm idempotency/replay protection requirements for join, resolve, and payout/claim paths. → **Resolved**: join_match rejects non-WAITING (lifecycle::transition). claim_payout rejects claimed==true. resolve_match deleted in 004 rewrite — claim reads VRF at claim time. Match PDA closed after claim. (iteration 19)
- [x] Add failure-mode acceptance checks for VRF callback delay/failure and pause-state behavior. → **Resolved**: create_match calls check_not_paused. claim_payout propagates error if VRF unfulfilled (read_orao_randomness). timeout_cancel handles VRF-never-fulfilled case. (iteration 19)

## Gap Analysis Carry-Forward (004 Shared Infrastructure)

- [x] Add `fetchClaimableMatches(connection, playerPubkey)` in coinflip `chain.ts` for claimable/unresolved matches. → **Resolved**: chain.ts fetchClaimableMatches with dual memcmp queries (creator offset 8, opponent offset 40), claimed==false filter. (iteration 12)
- [x] Ensure claimable query covers player as creator OR opponent, `claimed == false`, and non-terminal phases that can still be claimed. → **Resolved**: Two parallel getProgramAccounts queries merged with dedup, non-terminal phase post-filter. (iteration 12)
- [x] Expose claimable matches in frontend UX (for example, "Pending Claims" or equivalent unresolved matches list). → **Resolved**: "Your Matches" section in CoinflipPage above lobby list with claim/cancel/view actions per match. (iteration 13)

## Phase 2 Refinement (2026-02-26)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Re-refinement scope | Full gap closure except audio | Address TIER_AMOUNTS bug, tier rename, claimable matches, fairness verification UI, quick rematch. Audio deferred to dedicated spec. |
| TIER_AMOUNTS values | SOL values (not USD/credits) | On-chain amounts are canonical. Display and charge in SOL: {0.005, 0.01, 0.1, 0.25, 0.5, 1.0}. |
| Tier 4 naming | "platinum" (rename from "emerald") | Matches on-chain Rust comments and spec canonical terminology. Platform-wide rename. |
| FR-5 approach | Event-based verification | MatchSettled event + Orao account lookup. No PDA persistence change needed. vrf_request_key added to event. |
| FR-7.6 rematch | Creates new open match | Player clicks "Play Again" → new match with same tier/side. Opponent must find and join from lobby — no forced rematch. |
| FR-6.5 estimated wait time | Still deferred | Requires match fill-rate analytics infrastructure that doesn't exist. |
| FR-8 audio | Deferred to dedicated audio spec | All 4 audio items out of scope for this pass. |
| Carry-forward items | Included as validation checklist item | One combined validation item covers all 5 pivot carry-forward checks. |

## Notes

- Source material (COINFLIP.md) is well-specified for core flows
- All blocking items resolved during /refine interview (2026-02-17)
- 32 total checklist items in spec (13 Phase 1 + 19 Phase 2), all completed across 20 iterations
- 8 functional requirements extracted, all with acceptance criteria
- Validation plan covers all critical paths
- Phase 2 refinement (2026-02-26): 19 items for gap closure after 004 rewrite — all completed
- 31 bankrun tests passing (26 coinflip + 5 platform), 0 frontend tests, 0 E2E tests
- All 5 refinement carry-forward items and 3 gap-analysis carry-forward items resolved
