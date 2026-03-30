# Specification Quality Checklist: 002 Crash

**Purpose**: Validate specification completeness and quality before implementation
**Created**: 2026-02-12
**Spec**: [spec.md](spec.md)

---

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] Acceptance criteria are defined
- [ ] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

---

## Open Items

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Contract files not identified (frontend mocks, on-chain interfaces) | Contract | Yes |
| 2 | Platform fee inconsistency: game docs use 3%, PLATFORM.md says 2.0-2.2% | Assumption | Yes |
| 3 | Real-time sync approach undecided (WebSocket vs polling) | Dependency | Yes |
| 4 | Client-server sync for cash-out timing fairness | Dependency | Yes |
| 5 | Round synchronization approach undecided (DB-backed vs computed) | Dependency | No |
| 6 | Acceptable latency for cash-out registration | Edge Case | No |
| 7 | Network jitter handling / latency compensation for cash-outs | Edge Case | No |
| 8 | Edge case: all players in a tier disconnect mid-round | Edge Case | No |
| 9 | Edge case: player attempts cash-out at exact crash moment (race condition) | Edge Case | No |
| 10 | HMAC-SHA256 crash point leaks implementation detail (spec says "cryptographic function" is sufficient) | Content Quality | No |

## Refinement Carry-Forward (Pivot)

- [ ] Define Crash fairness proof contract fields (seed/proof envelope, result payload, proof versioning).
- [ ] Lock determinism boundary between on-chain recomputation and off-chain engine reporting.
- [ ] Specify timeout/refund trigger behavior, deadline source, and caller expectations for unresolved rounds.
- [ ] Define replay/idempotency protections for cash-out actions and settle calls.
- [ ] Add failure-mode acceptance checks for late reveals, invalid proofs, and race conditions around crash boundary.

## Notes

- Source material (CRASH.md) is very detailed for P2P mode; Classic house mode explicitly deferred
- More blocking items than Coinflip due to real-time infrastructure decisions
- 11 functional requirements extracted (most complex game spec)
- Crash point generation uses HMAC-SHA256 (different verification path than Coinflip's VRF)
- Boost mechanic adds complexity: needs separate validation
- The CRASH.md Technical Research Notes section documents several open architecture decisions
- Item #10: spec references HMAC-SHA256 directly - consider abstracting to "deterministic cryptographic function" for purity, but retained for precision since it's specified in source
