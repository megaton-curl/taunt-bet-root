# Specification Quality Checklist: [400] Challenge Engine & Reward System

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-04-03
**Spec**: [spec.md](spec.md)

---

## Content Quality

- [x] Focused on user value and business needs
- [x] All mandatory sections completed
- [x] Design principles stated and enforced

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable (8 criteria in spec)
- [x] Acceptance criteria defined for all 15 FRs
- [x] Edge cases identified (refunds, idempotency, pool exhaustion, concurrent payouts)
- [x] Scope clearly bounded (M1 vs M2 deferred table)
- [x] Dependencies and assumptions identified
- [x] System invariants documented (8 invariants)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User stories cover primary flows (9 stories)
- [x] Implementation checklist refined to iteration-sized items (17 items)
- [x] Admin auth strategy decided: `X-Admin-Key` shared secret header
- [x] Fraud flags explicitly deferred (not in M1 checklist)
- [x] SOL payout in scope with tech debt review note
- [x] Price endpoint reference corrected (`/price/sol-usd`)
- [x] Challenge selection rule specified (sort_order ASC deterministic)
- [x] Template deactivation policy documented
- [x] Pool row-lock requirement made explicit

## Review Tightenings (2026-04-03)

- [x] `progress_events.metadata` JSONB added — unblocks `unique_game_types` condition
- [x] `challenges.scope` CHECK constraint added — prevents silent typo misconfiguration
- [x] `challenges.eligible_if` JSONB added — zero-cost M2 future-proofing
- [x] Deterministic challenge selection rule specified in FR-11
- [x] Template deactivation policy documented in FR-11
- [x] Pool row-lock (`SELECT ... FOR UPDATE`) made explicit in FR-4/FR-5
- [x] Event naming convention reviewed and confirmed consistent
- [x] Known M2 migration points table added to Design Decisions section

---

## Open Items

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| — | No open items | — | — |

## Notes

- Fraud flags (velocity, repeated_opponent) deferred entirely from M1 — revisit after real usage data
- `eligible_if` JSONB column seeded as `'{}'` and ignored by M1 engine — reserved for M2
- SOL crate payout handler flagged for manual review before production enablement (tech debt entry)
- Reference spec at `docs/archive/references/challenge-engine-spec.md` contains full competitor research and M2 feature designs
