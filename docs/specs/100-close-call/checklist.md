# Specification Quality Checklist: 100 Close Call

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-02-12
**Updated**: 2026-03-17
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

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Pyth BTC/USD push oracle account address for devnet — resolved during iteration 1 | FR-3 | No |
| 2 | Max entries per side (32) compute budget validation — deferred to devnet testing | FR-2 | No |
| 3 | Betting window duration (30s) UX validation with real users — post-implementation | FR-1 | No |
| 4 | Future asset support (SOL/USD, ETH/USD) not scoped | Scope | No |
| 5 | Existing FE mock scaffolding has outdated types — cleaned up in FE Phase 4 | Frontend | No |

## Refinement Carry-Forward

- [x] ~~Define Close Call proof contract fields~~ → Oracle-resolved, no commit-reveal needed
- [x] ~~Lock determinism boundary~~ → Program reads Pyth price directly, deterministic
- [x] ~~Specify timeout/refund behavior~~ → FR-6: permissionless timeout_refund after resolve_deadline
- [x] ~~Define replay/idempotency protections~~ → Phase state machine prevents double-settle
- [x] ~~Add failure-mode acceptance checks~~ → FR-5: equal price, one-sided, single player all specified

## Notes

- Spec rewritten 2026-03-17 with lessons from coinflip + lord-of-rngs shipping
- Removed: DOJI threshold, carryover mechanics, audio section, provably fair section
- Added: strict price comparison, auto-payout, invalid round refunds, 2 PDA architecture
- Oracle-resolved (Pyth) replaces commit-reveal — simpler, no server secret
- 6 instructions, 2 PDA types — minimal surface area
- Fee model matches platform standard (500 bps flat fee, single treasury via PlatformConfig)
