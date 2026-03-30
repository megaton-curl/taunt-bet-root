# Specification Quality Checklist: 008 User Profile — Transaction History

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-03-19
**Spec**: [spec.md](./spec.md)

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
- [ ] No implementation details leak into specification

> Note: Developer Reference section intentionally includes implementation
> details (file paths, table schemas) per user request — this is a pragmatic
> choice to reduce repeated discovery overhead. The FR sections themselves
> remain technology-agnostic where possible.

---

## Open Items

| # | Item | Category | Blocking? | Status |
|---|------|----------|-----------|--------|
| 1 | Aggregate stats (win rate, P&L) deferred to next iteration | Scope | No | Deferred by design |
| 2 | Other player profile visibility deferred | Scope | No | Deferred by design |
| 3 | Close Call settle worker path needs verification | FR-2 | No | Resolved — file is `closecall-clock.ts`, function `settleRound()` |

## Refinement Decisions (2026-03-19)

- **Amounts**: SOL + USD estimate (Pyth SOL/USD feed)
- **Refunds**: Close Call only — coinflip/lord refunds are permissionless on-chain, backend doesn't process them
- **Lord joins**: Skipped — PDA watcher sees round state, not individual entries. Win/loss only at settlement
- **Close Call joins**: Written at settlement time (not at /bet route) — avoids false positives from unsubmitted txs
- **Coinflip joins**: Creator at create route, opponent at PDA watcher lock detection
- **Game name mapping**: DB `lord`/`closecall` → API `lord-of-rngs`/`close-call`

## Notes

- Developer Reference section is non-standard but requested to reduce onboarding friction
- The checklist item "No implementation details" is partially violated by design
