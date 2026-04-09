# Autonomy Integration Plan (Taunt Bet)

Plan to merge RNG Utopia governance with autonomous execution while preserving existing project files, paths, and conventions.

---

## Goal

Enable a reliable autonomous loop from workspace root that can modify both:
- Root repo files (`docs/`, `scripts/`, agent prompts/commands)
- Submodule code (the code submodules (`solana/`, `backend/`))

...without replacing RNG Utopia's current governance model.

---

## Guardrails (Non-Negotiable)

1. `./scripts/verify` remains the completion gate.
2. "No proof = not done" remains the governing principle.
3. `docs/SCOPE.md` remains the product boundary authority.
4. Active spec acceptance criteria must map to explicit validation steps.
5. `<promise>DONE</promise>` can be emitted only after all criteria are validated.

---

## Target Operating Model

### Loop Runtime
- Run loop scripts from root workspace.
- Allow edits in both root and the code submodules (`solana/`, `backend/`).

### Ownership Boundaries
- Root: governance, planning, specs, workflow scripts, progress/debt/lessons.
- Submodule: product implementation and code-level docs.

### Commit Policy
- Loop mode: auto-commit allowed.
- Interactive mode: commit on explicit request OR "big change" threshold.
- When both roots change in one iteration, prefer:
  - One submodule commit (code changes)
  - One root commit (spec/governance/progress changes)

---

## Spec Structure

Specs live at `docs/specs/NNN-short-name/` (directory per game, created).
Template: `docs/specs/_TEMPLATE/` (created).

### Required spec sections (extend existing template)
- Validation Plan (criterion-by-criterion, how to prove each AC is met)
- Evidence Required (what artifacts prove completion)
- Completion Signal (`<promise>DONE</promise>`)

### Gap from current template
Current specs have Status, Priority, Phase, FRs, Contract Files, Assumptions, and Open Items.
Missing: explicit validation mapping per acceptance criterion. Add when specs move to implementation.

---

## Context Loading Policy (Avoid Overflow)

Use 2-phase loading:

### Always-Load (small core)
1. `CLAUDE.md`
2. `docs/WORKFLOW.md`
3. Active spec file (`docs/specs/NNN-*/spec.md`)

### Conditional-Load (only as needed by active spec)
- `docs/SCOPE.md`
- `docs/DECISIONS.md`
- `docs/TECH_DEBT.md`
- `docs/LESSONS.md`
- `docs/FOUNDATIONS.md`
- Relevant contract files under the code submodules (`solana/`, `backend/`)

Rule:
- Scope must still be checked for each new spec and for spec updates.
- Do not preload large reference docs unless required by the active spec.

---

## Preflight Checks (for loop scripts)

1. Print "Loaded Files" list at start of each iteration.
2. Validate required sections exist in active spec.
3. Fail fast if active spec has missing validation mapping.
4. Fail fast if spec conflicts with `docs/SCOPE.md`.
5. Refuse completion if criterion evidence is missing.

Required output block per iteration:
- Loaded files
- Criteria validated
- Validation commands run
- Proof/evidence summary

---

## Implementation Phases

### Phase 1 - Bootstrap ✅ Done
- ~~Add `docs/specs/` directory~~ — done
- ~~Add spec template~~ — done (`docs/specs/_TEMPLATE/`)
- ~~Add per-game specs with checklists~~ — done (9 specs)
- ~~Add ideation status to each spec~~ — done

### Phase 2 - Validation-First Spec Upgrade
- Extend spec template with validation plan and evidence sections.
- Upgrade flipyou spec (first implementation target) with validation mapping.
- Add `docs/AUTONOMY_BOOTSTRAP.md` (mode toggles, loader policy, completion signal rule).

### Phase 3 - Loop Scripts
- Add `scripts/agent-loop.sh`.
- Implement preflight checks and context loading strategy.
- Implement mode-based commit behavior.

### Phase 4 - Command Surface
- Add `.cursor/commands/` adapted to `docs/specs/`.
- Add prompt docs for build/plan loop behavior if desired.

### Phase 5 - Pilot Run
- Execute loop for flipyou spec end-to-end.
- Confirm:
  - Scope gate works
  - Validation mapping is enforced
  - Completion signal is only emitted on proof
- Adjust thresholds (retry limits, auto-commit criteria).

---

## Open Decisions

1. Exact "big change" threshold for interactive auto-commit.
2. Whether root loop should block when submodule has unrelated dirty changes.

---

## Success Criteria

1. Autonomous loop can run from root and correctly touch root + submodule.
2. Active specs have testable acceptance criteria with explicit validation mapping.
3. Context loading remains bounded and deterministic.
4. Scope violations are caught before implementation begins.
5. Completion proof is auditable from logs/report output.
