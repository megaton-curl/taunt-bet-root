# Specification Quality Checklist: 103 Chart the Course

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-02-12
**Spec**: [spec.md](spec.md)

---

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [ ] Acceptance criteria are defined
- [ ] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

---

## Open Items

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Historical data amount and timeframe undefined | FR-1 | Yes |
| 2 | Real-time market events display undefined | FR-1 | Yes |
| 3 | Drawing mechanics undefined (freehand vs structured) | FR-2 | Yes |
| 4 | Redraw/undo rules undefined | FR-2 | Yes |
| 5 | Time limit for drawing undefined | FR-2 | Yes |
| 6 | Scoring formula undefined (directional vs magnitude weighting) | FR-3 | Yes |
| 7 | Scoring granularity undefined | FR-3 | Yes |
| 8 | Number of rounds per session undefined | FR-4 | Yes |
| 9 | Payout distribution among top performers undefined | FR-4 | Yes |
| 10 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes |
| 11 | Historical data source undefined | Dependency | No |
| 12 | No contract files | Contract | No (deferred) |

## Refinement Carry-Forward (Pivot)

- [ ] Define Chart the Course proof contract fields for scoring output and commit-reveal verification.
- [ ] Lock determinism boundary for what scoring inputs are canonical and what must be verifiable on-chain.
- [ ] Specify timeout/refund behavior for missing reveal, disputed scoring, and unresolved rounds.
- [ ] Define replay/idempotency protections for prediction submission and settlement.
- [ ] Add failure-mode acceptance checks for scoring disputes, tie handling, and late/invalid reveals.

## Notes

- **Most underspecified game** - source (CHART_THE_COURSE.md) says "Specifications to be defined"
- 10 blocking items - virtually all core mechanics need design from scratch
- The concept is interesting (mystery chart + drawing prediction) but nothing is defined
- Scoring formula is the most critical design decision - determines entire game balance
- Requires a full product design session before spec can advance
- 4 functional requirements extracted, almost all with incomplete acceptance criteria
- Open question from STORIES.md: "How should scoring weight directional accuracy vs magnitude accuracy?"
