---
name: gap-analysis
description: Audit a completed spec's FR acceptance criteria against the codebase — produces a gap report and annotates the spec.
argument-hint: <spec-id> [--non-interactive] (e.g., 001-flip-you)
---

# /gap-analysis — Post-Completion Gap Analysis

Audit a completed spec's Functional Requirements against the actual codebase.
Produces `docs/specs/{id}/gap-analysis.md` and annotates FR checkboxes in the spec.

**Usage**: `/gap-analysis <spec-id>` (interactive) or `/gap-analysis <spec-id> --non-interactive` (from spec-loop)

**Arguments**: $ARGUMENTS

---

## Mode Detection

Parse `$ARGUMENTS` for `--non-interactive`. If present: no `AskUserQuestion` calls, no
clarification — treat unknowns as GAP and proceed. If absent: you may ask up to 2
rounds of clarifying questions when genuinely uncertain about a criterion's status.

---

## Phase 1: Read Context

1. Read the spec: `docs/specs/{id}/spec.md`
2. Read previous gap analysis (if exists): `docs/specs/{id}/gap-analysis.md`
3. Read history: `docs/specs/{id}/history.md`
4. Read `docs/SCOPE.md` and `docs/DECISIONS.md`
5. Collect all spec IDs and their statuses:
   - For each `docs/specs/[0-9]*/spec.md`, extract `| Status |` value
   - This powers the cross-spec deferral check in Phase 4

## Phase 2: Inventory the Codebase

Systematically inventory what exists. Use Glob/Grep/Read — do NOT guess.

Build tables for each layer:
- **On-chain instructions**: grep for `pub fn` in `solana/programs/{name}/src/`
- **Shared crate exports**: check `solana/shared/src/lib.rs` and submodules
- **Game engine exports**: check `backend/packages/game-engine/src/` and `backend/packages/anchor-client/`
- **Backend routes**: check `backend/services/backend/src/routes/`
- **Tests**: check `solana/tests/`, backend vitest files, `e2e/` playwright files

Record file paths and line numbers for everything found.

## Phase 3: Audit FR Acceptance Criteria

**Think deeply about each criterion.** Do not rush verdicts. For each criterion,
trace the full path from user action → frontend → API → backend → DB (or on-chain)
and verify evidence exists at every layer the criterion touches. A partial
implementation is a GAP, not SATISFIED.

For each `### FR-N` section in the spec, evaluate every acceptance criterion checkbox:

**Status categories:**
- **SATISFIED**: Evidence exists in the codebase. Requires `file:line` or test name.
- **DEFERRED**: Explicitly deferred in spec's Scope Decisions, DECISIONS.md, or SCOPE.md. Requires document reference.
- **GAP**: Not implemented and not explicitly deferred. Requires description of what's missing.

**Rules:**
- Conservative: if you can't find clear evidence, it's a GAP
- Check both on-chain AND frontend layers — a criterion may be partially satisfied
- Test coverage counts as supporting evidence but doesn't satisfy functional criteria alone
- "Mock" or "stub" implementations are NOT satisfied — they're gaps

## Phase 4: Cross-Spec Deferral Check

For each DEFERRED item:
1. Does the deferral reference a target spec? (e.g., "deferred to 002-crash")
2. If yes: does that spec exist? What's its status?
3. If the target spec is Done: did it actually cover the deferred item? (grep its FR section)

Flag results:
- **TRACKED**: target spec exists and is not Done yet — deferral is valid
- **COVERED**: target spec is Done and covers the item — deferral is resolved
- **STALE DEFERRAL**: target spec is Done but didn't cover the item
- **UNTRACKED DEFERRAL**: no target spec exists for the deferred item

## Phase 5: Write `docs/specs/{id}/gap-analysis.md`

Create or overwrite with this structure:

```markdown
# Gap Analysis: {id} — {Feature Name}

- **Date**: {ISO date}
- **Spec status**: {status from Meta}
- **Previous analysis**: {date or "First run"}

## Changes Since Last Analysis

<!-- Omit this section on first run -->

| Item | Previous | Current | Notes |
|------|----------|---------|-------|

## Implementation Inventory

### On-Chain Instructions
| Instruction | Program | File | Line |
|------------|---------|------|------|

### Game Engine Exports
| Export | Package | File | Line |
|--------|---------|------|------|

### Frontend Components
| Component | File | Line |
|-----------|------|------|

### Tests
| Test | Type | File | Status |
|------|------|------|--------|

## Acceptance Criteria Audit

### FR-1: {name}
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|

<!-- Repeat for each FR -->

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|

Severity: critical (blocks launch) / moderate (degrades UX) / low (polish)
Category: on-chain / frontend / engine / test / docs

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|

## Recommendations

<!-- Actionable next steps: what the next spec should address, stale deferrals to resolve, items safe to keep deferred -->
```

## Phase 6: Update Spec FR Checkboxes

For each acceptance criterion in the spec's FR section, update the checkbox with an
HTML comment annotation (invisible in rendered markdown):

```markdown
- [x] Player can select one of six tiers <!-- satisfied: shared/tiers.rs:6 TIER_AMOUNTS, CoinSideSelector.tsx -->
- [ ] Estimated wait time <!-- deferred: post-MVP polish (SCOPE.md §8) -->
- [ ] Quick rematch option <!-- gap: not implemented in ActiveMatchView.tsx -->
```

**Rules:**
- SATISFIED items get `[x]` + `<!-- satisfied: evidence -->`
- DEFERRED items stay `[ ]` + `<!-- deferred: reason (source) -->`
- GAP items stay `[ ]` + `<!-- gap: what's missing -->`
- Preserve existing checkbox state — only ADD annotations, don't remove `[x]` from items already checked
- Do NOT modify the Implementation Checklist section — only FR acceptance criteria

## Phase 7: Output Summary

Print a concise summary (NOT wrapped in `<promise>` or `<blocker>` tags):

```
## Gap Analysis Complete: {id}

- Satisfied: N / Total
- Deferred: N (tracked: N, stale: N, untracked: N)
- Gaps: N (critical: N, moderate: N, low: N)

Report: docs/specs/{id}/gap-analysis.md
```

In non-interactive mode, also state: "Spec FR checkboxes updated with evidence annotations."

---

## Edge Cases

- **No FR section in spec**: Output minimal report with warning, skip Phase 6
- **First run (no previous gap-analysis.md)**: Skip "Changes Since Last Analysis" section
- **Re-run after changes**: Include diff section showing status changes vs previous
- **Non-interactive + uncertain**: Default to GAP (conservative)
