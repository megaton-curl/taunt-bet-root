# Specification: [NNN] [Feature Name]

## Meta

| Field | Value |
|-------|-------|
| Status | Draft / Ready / In Progress / Done |
| Priority | P0 / P1 / P2 / P3 |
| Track | Core / Extended / Backlog |
| NR_OF_TRIES | 0 |

---

## Overview

[Brief description - what this feature does and why it matters to the user/platform]

## User Stories

- As a [user type], I want to [action] so that [benefit]

---

## Capability Alignment

- **`docs/SCOPE.md` references**: [specific section(s) in SCOPE.md]
- **Current baseline fit**: [Implemented / In Progress / Planned]
- **Planning bucket**: [Core / Extended / Backlog]

## Required Context Files

- [file paths needed to understand or implement this spec]

## Contract Files

- [mock/spec/interface files that define the expected shape]

---

## Functional Requirements

<!-- FR acceptance criteria checkboxes are audited by /gap-analysis after completion.
     Each checkbox gets an HTML comment annotation: satisfied/deferred/gap with evidence. -->

### FR-1: [Requirement Name]

[Description of the requirement]

**Acceptance Criteria:**
- [ ] [Specific, testable criterion]
- [ ] [Specific, testable criterion]

### FR-2: [Requirement Name]

[Description of the requirement]

**Acceptance Criteria:**
- [ ] [Specific, testable criterion]

---

## Success Criteria

[Measurable, technology-agnostic outcomes]

- [Criterion 1]
- [Criterion 2]

---

## Dependencies

- [Dependency 1]
- [Dependency 2]

## Assumptions

- [Assumption 1]
- [Assumption 2]

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | [criterion from FR] | [how to verify] | [what proves it] |

---

## Completion Signal

### Implementation Checklist
- [ ] [Deliverable 1]
- [ ] [Deliverable 2]
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is included, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Visual Regression
- [ ] `pnpm test:visual` passes (all baselines match)
- [ ] If this spec changes UI: affected baselines regenerated and committed
- [ ] Local deterministic E2E passes (`pnpm test:e2e`) for user-facing flows, or N/A documented
- [ ] Devnet real-provider E2E passes (`pnpm test:e2e:devnet`) when provider-backed flows are included

#### Visual Verification (if UI)
- [ ] Desktop view correct
- [ ] Mobile view correct

#### Console/Network Check (if web)
- [ ] No JS console errors
- [ ] No failed network requests

#### Smoke Test (Human-in-the-Loop)

Before declaring done, trace every user-facing flow and verify the experience
makes sense from a player's perspective. Customize this list per spec.

- [ ] Primary flow works end-to-end (create → play → result)
- [ ] Wallet prompts show expected amounts (no surprise rent/fee charges)
- [ ] UI state is correct at each phase transition
- [ ] Win/loss outcomes display correct payouts
- [ ] Error states show meaningful messages, not raw codes
- [ ] [Add spec-specific checks here]

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
