---
name: refine
description: Refine a spec's Implementation Checklist into granular, iteration-sized work items for the autonomous spec loop.
argument-hint: <spec-id> (e.g., 001-coinflip)
---

# /refine — Spec Refinement Interview

Refine a spec's Implementation Checklist into granular, iteration-sized work items.

**Usage**: `/refine <spec-id>` (e.g., `/refine 001-coinflip`)

**Spec argument**: $ARGUMENTS

---

## Your Role

You are a spec refinement interviewer. Your job is to take a high-level spec and break its Implementation Checklist into **granular checkboxes** — each one small enough for a single autonomous iteration (one `claude -p` invocation) to complete.

## Process

### Phase 1: Read and Analyze

1. Read the spec: `docs/specs/$ARGUMENTS/spec.md`
2. Read the checklist: `docs/specs/$ARGUMENTS/checklist.md`
3. Read the codebase state:
   - Check what's already implemented (git log, existing code)
   - Check what tests exist and their pass/fail state
   - Check `docs/DECISIONS.md` and `docs/FOUNDATIONS.md` for architecture context
4. Read contract files listed in the spec to understand the target shape

### Phase 2: Identify Issues

Check for:
- **Blocking items** in checklist.md — these MUST be resolved before refinement
- **Ambiguous requirements** — anything the autonomous agent would need to ask about
- **Missing context** — contract files that don't exist, unclear dependencies
- **Tier/amount mismatches** between spec, shared crate, and frontend
- **Scope creep** — items that belong in a different spec or phase
- **Visual regression impact** — does this spec change any page's visual appearance?
- **Coverage completeness for user-facing specs** — ensure checklist includes local deterministic E2E, visual coverage, and (when applicable) devnet real-provider E2E

#### Visual Regression Assessment

`./scripts/verify` runs `pnpm test:visual` (baseline screenshots). Every spec must pass visual regression or explicitly update the affected baselines.

Determine which category this spec falls into:
1. **No visual changes** (backend-only, engine logic, test infra): visual tests pass as-is — no extra checklist items needed.
2. **Incidental visual changes** (e.g., wallet swap changes a small icon): identify which specific screenshots will break, add a baseline update checklist item.
3. **Intentional redesign** (new page, layout overhaul, theme change): identify all affected screenshots, add a baseline update checklist item, note which are new vs updated.

Ask the user during Phase 3 if unclear which pages will be visually affected.

When adding a baseline update checklist item, use this template (adapt the screenshot list):

```markdown
- [ ] [test] Update visual baselines for [list pages]. Run `pnpm test:visual` to identify failures, then `pnpm test:visual:update` to regenerate. **Before committing**: read old baseline and new screenshot for each changed page (use Read tool on PNG files). Evaluate:
  - **PASS** (changes clearly match spec intent, only expected areas changed) → commit updated baselines
  - **REVIEW** (changes look plausible but unexpected areas also changed, or uncertain) → do NOT commit baselines. Save the diff images from `test-results/` to `docs/specs/{id}/visual-review/`, describe concerns in `history.md`, output `<blocker>Visual review needed: [describe what looks off]</blocker>`
  - **FAIL** (layout broken, elements missing, clearly wrong) → fix the code, do NOT update baselines
```

### Phase 3: Interview the User

Use `AskUserQuestion` to resolve each blocker and ambiguity. Ask focused, specific questions with concrete options. Do NOT ask open-ended questions. Group related questions together (max 4 per call).

Common things to clarify:
- Which items from the checklist are already done?
- Are there items that should be split into smaller pieces?
- Are there missing items not in the checklist?
- What order should items be tackled? (dependencies matter)
- Are any items deferred to a later spec/phase?

### Phase 4: Rewrite the Implementation Checklist

Replace the spec's `### Implementation Checklist` section with granular checkboxes.

**Rules for each checkbox item:**
- **One iteration's worth of work** — implementable in a single focused session
- **Unambiguous** — the autonomous agent needs zero clarification
- **Ordered** — items that depend on earlier items come later
- **Testable** — each item has a clear "done" signal (test passes, build succeeds, etc.)
- **Prefixed by layer** — `[on-chain]`, `[engine]`, `[frontend]`, `[test]`, `[docs]`
- **Already-done items are pre-checked** — `[x]` with a note
- **Mandatory for user-facing web specs**:
  - one `[test]` item using this canonical wording: `Add local deterministic E2E coverage for primary user flow(s) in e2e/local/** (or mark N/A with reason for non-web/non-interactive specs)`
  - one `[test]` item using this canonical wording: `Add visual route/state coverage in e2e/visual/**; run pnpm test:visual and update baselines only for intentional UI changes`
  - one `[test]` item using this canonical wording when provider-backed flows are in scope: `If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in e2e/devnet/** with env validation + retry/backoff (or mark N/A with reason)`

Example format:
```markdown
### Implementation Checklist
- [x] [on-chain] CoinflipConfig PDA + initialize_config instruction (done: iteration 0)
- [ ] [on-chain] join_match instruction — transfer escrow, set opponent, phase WAITING→LOCKED
- [ ] [on-chain] resolve_match instruction — oracle authority check, randomness→winner, phase LOCKED→SETTLED
- [ ] [test] All resolve_match bankrun tests pass (HEADS/TAILS/unauthorized/wrong phase)
```

### Phase 5: Update the Spec

1. Update `docs/specs/$ARGUMENTS/spec.md`:
   - Replace the Implementation Checklist with the refined version
   - Update Status from `Draft` to `Ready` (if all blockers resolved)
   - Clear any resolved items in checklist.md
2. Update `docs/specs/$ARGUMENTS/checklist.md`:
   - Mark resolved open items
   - Add any new items discovered during refinement
3. Show the user the final checklist and get explicit approval
4. Commit the changes: `spec($ARGUMENTS): refine implementation checklist`

### Phase 6: Ready Signal

After the user approves:
- Confirm the spec is ready for `./scripts/spec-loop.sh $ARGUMENTS`
- Show the total count of unchecked items (= expected iterations)
- Remind: "Run `./scripts/spec-loop.sh $ARGUMENTS` to start the autonomous loop"
