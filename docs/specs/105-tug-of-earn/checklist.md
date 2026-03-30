# Specification Quality Checklist: 105 Tug of Earn

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
| 1 | Team assignment algorithm undefined | FR-1 | Yes |
| 2 | Minimum players per team/round undefined | FR-1 | Yes |
| 3 | Tap rate limits/anti-bot rules undefined | FR-2 | Yes |
| 4 | Tap weight rules undefined (equal or variable) | FR-2 | Yes |
| 5 | Tap-to-chart-movement formula undefined | FR-2 | Yes |
| 6 | Ghost line determination method undefined | FR-3 | Yes |
| 7 | Chart data source undefined (synthetic or real) | FR-3 | Yes |
| 8 | Exact ghost line tie handling undefined | FR-4 | Yes |
| 9 | Payout distribution among winning team undefined | FR-4 | Yes |
| 10 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes |
| 11 | No contract files | Contract | No (deferred) |

## Refinement Carry-Forward (Pivot)

- [ ] Define Tug of Earn proof contract fields for team assignment, tap aggregation output, and commit-reveal verification.
- [ ] Lock determinism boundary between verifiable on-chain facts and off-chain aggregation outputs.
- [ ] Specify timeout/refund behavior for missing final aggregates, invalid reveal, and unresolved rounds.
- [ ] Define replay/idempotency protections for tap/event ingestion and settlement calls.
- [ ] Add failure-mode acceptance checks for tie outcomes, anti-bot enforcement failures, and late/invalid reveals.

## Notes

- Source (TUG_OF_EARN.md) is minimal - "Specifications to be defined"
- 10 blocking items - nearly all mechanics need design from scratch
- The concept is clear (team tap game, chart vs ghost line) but no formulas or rules defined
- Key design challenge: making taps feel impactful while preventing bot abuse
- Ghost line determination is critical to game balance (too easy/hard for either side)
- Payout distribution within winning team is an important fairness decision (equal split vs proportional to taps)
- Unique among games: requires real-time tap aggregation infrastructure
- 4 functional requirements extracted, most with incomplete acceptance criteria
