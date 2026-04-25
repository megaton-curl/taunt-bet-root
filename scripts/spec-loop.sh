#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# spec-loop.sh — Autonomous spec implementation loop
#
# Usage: ./scripts/spec-loop.sh <spec-id-or-prefix>
# Example: ./scripts/spec-loop.sh 001-flip-you
# Example: ./scripts/spec-loop.sh 004
#
# Runs claude in pipe mode, one iteration per unchecked checklist item.
# Commits after each iteration. Exits on: DONE, BLOCKER, no progress, max iters.
# =============================================================================

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SPEC_INPUT="${1:?Usage: ./scripts/spec-loop.sh <spec-id-or-prefix>}"
SPECS_ROOT="$ROOT_DIR/docs/specs"

resolve_spec_id() {
    local query="$1"
    local spec_dir
    local sid
    local -a matches=()

    for spec_dir in "$SPECS_ROOT"/[0-9]*/; do
        [ -d "$spec_dir" ] || continue
        sid="$(basename "$spec_dir")"
        if [[ "$sid" == "$query"* ]]; then
            matches+=("$sid")
        fi
    done

    if [ "${#matches[@]}" -eq 0 ]; then
        echo "ERROR: No spec matches prefix: $query" >&2
        echo "Available specs:" >&2
        ls -d "$SPECS_ROOT"/[0-9]*/ 2>/dev/null | xargs -I{} basename {} >&2 || echo "  (none)" >&2
        exit 1
    fi

    if [ "${#matches[@]}" -gt 1 ]; then
        echo "ERROR: Ambiguous spec prefix '$query'" >&2
        echo "Matches:" >&2
        printf '  %s\n' "${matches[@]}" >&2
        echo "Use a longer prefix or full spec id." >&2
        exit 1
    fi

    echo "${matches[0]}"
}

SPEC_ID="$(resolve_spec_id "$SPEC_INPUT")"
SPEC_DIR="$ROOT_DIR/docs/specs/$SPEC_ID"
SPEC_FILE="$SPEC_DIR/spec.md"
HISTORY_FILE="$SPEC_DIR/history.md"
GAP_ANALYSIS_FILE="$SPEC_DIR/gap-analysis.md"
LOG_DIR="$SPEC_DIR/logs"
MAX_ITERATIONS=50

# Writable (owned) submodules the loop commits into. Consult-only repos
# (waitlist, webapp) are intentionally excluded — see CLAUDE.md.
OWNED_SUBMODULES=(backend solana chat telegram peek)

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ "$SPEC_INPUT" != "$SPEC_ID" ]; then
    echo "Resolved spec prefix '$SPEC_INPUT' -> '$SPEC_ID'"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
count_remaining() {
    # Count unchecked items only inside "### Implementation Checklist".
    # Avoid grep exit-code quirks that can print duplicate "0" lines.
    awk '
        /^### Implementation Checklist/ { in_section=1; next }
        /^### / && in_section { in_section=0 }
        in_section && /^\- \[ \]/ { n++ }
        END { print n+0 }
    ' "$SPEC_FILE"
}

count_completed() {
    # Count checked items only inside "### Implementation Checklist".
    awk '
        /^### Implementation Checklist/ { in_section=1; next }
        /^### / && in_section { in_section=0 }
        in_section && /^\- \[x\]/ { n++ }
        END { print n+0 }
    ' "$SPEC_FILE"
}

# Extract only assistant text from a stream-json log (excludes tool results,
# thinking blocks, and user/system messages that could contain false matches).
extract_assistant_text() {
    jq -r '
        select(.type == "assistant")
        | .message.content[]?
        | select(.type == "text")
        | .text // empty
    ' "$1" 2>/dev/null
}

increment_tries() {
    local current
    current=$(grep 'NR_OF_TRIES' "$SPEC_FILE" | grep -oP '\d+' | head -1 || true)
    if [ -z "$current" ]; then
        echo -e "${YELLOW}  Warning: NR_OF_TRIES not found in spec, skipping increment${NC}" >&2
        return 0
    fi
    local next=$((current + 1))
    sed -i "s/| NR_OF_TRIES | $current |/| NR_OF_TRIES | $next |/" "$SPEC_FILE" 2>/dev/null || true
}

ensure_history_file() {
    mkdir -p "$LOG_DIR"
    if [ ! -f "$HISTORY_FILE" ]; then
        cat > "$HISTORY_FILE" <<EOF
# Implementation History — $SPEC_ID

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

EOF
    fi
}

# ---------------------------------------------------------------------------
# Submodule helpers — generalize over OWNED_SUBMODULES so iterations that
# touch peek/chat/telegram (not just backend/solana) get committed and
# counted as progress.
# ---------------------------------------------------------------------------
submodules_have_changes() {
    local sub
    for sub in "${OWNED_SUBMODULES[@]}"; do
        [ -d "$ROOT_DIR/$sub" ] || continue
        if ! git -C "$ROOT_DIR/$sub" diff --quiet \
           || ! git -C "$ROOT_DIR/$sub" diff --cached --quiet \
           || [ -n "$(git -C "$ROOT_DIR/$sub" ls-files --others --exclude-standard)" ]; then
            return 0
        fi
    done
    return 1
}

commit_submodule_work() {
    local iteration="$1"
    local sub
    for sub in "${OWNED_SUBMODULES[@]}"; do
        [ -d "$ROOT_DIR/$sub" ] || continue
        if ! git -C "$ROOT_DIR/$sub" diff --quiet \
           || ! git -C "$ROOT_DIR/$sub" diff --cached --quiet \
           || [ -n "$(git -C "$ROOT_DIR/$sub" ls-files --others --exclude-standard)" ]; then
            git -C "$ROOT_DIR/$sub" add -A
            git -C "$ROOT_DIR/$sub" commit -m "spec($SPEC_ID): iteration $iteration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
        fi
    done
}

# Stage spec dir + every owned submodule pointer so the root commit captures
# any submodule advances from this iteration.
stage_root_paths() {
    git -C "$ROOT_DIR" add docs/specs/"$SPEC_ID"/ "${OWNED_SUBMODULES[@]}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Blocker — single exit path for all blockers
# Usage: handle_blocker <iteration> <reason> [log_file]
# ---------------------------------------------------------------------------
handle_blocker() {
    local iteration="${1:-0}"
    local reason="$2"
    local log_file="${3:-}"

    echo ""
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}  BLOCKED at iteration $iteration${NC}"
    echo -e "${RED}  Reason: $reason${NC}"
    echo -e "${RED}============================================${NC}"

    # Ensure history file exists (blocker may fire before loop starts)
    ensure_history_file

    # Log the blocker
    {
        echo "## Iteration $iteration — $(date -u +%Y-%m-%dT%H:%M:%SZ) — BLOCKED"
        echo "- **Blocker**: $reason"
        [ -n "$log_file" ] && echo "- **Log**: $log_file"
        echo ""
    } >> "$HISTORY_FILE"

    # Commit whatever partial work exists. Commit submodule work first so
    # any pointer advances flow into the root commit.
    cd "$ROOT_DIR"
    commit_submodule_work "$iteration"
    if ! git diff --quiet -- . 2>/dev/null || ! git diff --cached --quiet -- . 2>/dev/null; then
        stage_root_paths
        git commit -m "spec($SPEC_ID): iteration $iteration — blocked

Blocker: $reason

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
    fi

    echo ""
    echo -e "${CYAN}History: $HISTORY_FILE${NC}"
    [ -n "$log_file" ] && echo -e "${CYAN}Log: $LOG_DIR/$log_file${NC}"
    exit 1
}

# ---------------------------------------------------------------------------
# Preflight — all checks use the standard blocker path
# ---------------------------------------------------------------------------
if [ ! -f "$SPEC_FILE" ]; then
    # Can't use handle_blocker (no history dir yet), just exit
    echo -e "${RED}ERROR: Spec not found: $SPEC_FILE${NC}"
    echo "Available specs:"
    ls -d "$ROOT_DIR"/docs/specs/[0-9]*/ 2>/dev/null | xargs -I{} basename {} || echo "  (none)"
    exit 1
fi

SPEC_STATUS=$(grep '| Status |' "$SPEC_FILE" | head -1 | awk -F'|' '{print $3}' | xargs)
if [ "$SPEC_STATUS" = "Draft" ]; then
    handle_blocker 0 "Spec is still Draft. Run '/refine $SPEC_ID' to break down the checklist."
fi

if ! command -v claude &>/dev/null; then
    handle_blocker 0 "claude CLI not found. Install Claude Code first."
fi

if ! command -v jq &>/dev/null; then
    handle_blocker 0 "jq not found. Install jq for stream parsing: sudo apt-get install jq"
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
ensure_history_file

# ---------------------------------------------------------------------------
# Generate the prompt for this iteration
# ---------------------------------------------------------------------------
generate_prompt() {
    local iteration=$1
    local remaining
    remaining=$(count_remaining)
    local completed
    completed=$(count_completed)

    cat <<'PROMPT_EOF'
# Autonomous Spec Implementation — Iteration Mode

You are running inside an automated loop. Do NOT ask questions. Do NOT wait for
user input. Do NOT use interactive tools. Work autonomously.

## Rules

1. Read the spec file and history file (paths below).
2. Pick the FIRST unchecked `- [ ]` item from the **Implementation Checklist** section.
3. Implement ONLY that one item — small, focused changes.
4. Run the relevant targeted check:
   - Rust/Anchor changes: `cd solana && anchor build -p flipyou && anchor test --skip-local-validator --skip-deploy`
   - TypeScript changes: `cd backend && pnpm lint && pnpm typecheck`
5. If the targeted check FAILS and you cannot fix it within this iteration:
   - Output `<blocker>DESCRIPTION OF WHAT FAILED AND WHY</blocker>`
   - Do NOT check off the item
   - Stop immediately
6. If the targeted check PASSES:
   - Check the item off in the spec: `- [ ]` → `- [x]`
   - Append `(done: iteration ITERATION_NUMBER)` to the checked item
7. After completing your item, append a brief summary to the history file.
8. **Completion check — MANDATORY before you can output DONE:**
   a. Re-read the Implementation Checklist section of the spec file.
   b. In your response, list EVERY checklist item with its current status, e.g.:
      ```
      ## Checklist Audit
      - [x] Item one (done: iteration 1)
      - [x] Item two (done: iteration 3)
      - [ ] Item three ← STILL OPEN
      ```
   c. If ANY item is still `[ ]` — STOP. Just output your summary. Do NOT claim DONE.
   d. If and ONLY if every single item is `[x]`:
      - Run `./scripts/verify` (full verification)
      - If verify passes → update spec Meta Status to `Done`, output `<promise>DONE</promise>`
      - If verify fails → output `<blocker>Full verification failed: DETAILS</blocker>`
9. Do NOT make git commits — the loop script handles this.
10. Do NOT push to remote.

## Key Constraints

- You have NO human to ask. If something is ambiguous, check the spec, history,
  and codebase. If still unclear, output a `<blocker>` and stop.
- Implement the MINIMUM needed to complete the checklist item. No extras.
- Preserve existing passing tests. If you break one, fix it before finishing.
- Follow patterns in docs/FOUNDATIONS.md and docs/DECISIONS.md.
- **Use parallel agents for exploration**: When you need to understand multiple
  areas of code (e.g., a provider + its consumers + tests), spawn parallel Task
  agents instead of reading files one-by-one. This is faster and protects your
  context window. Example: one agent explores the wallet package, another
  explores FlipYouContext, a third checks existing tests.

## Files to Read First

PROMPT_EOF

    # Inject dynamic paths
    echo "- **Spec**: \`$SPEC_FILE\`"
    echo "- **History**: \`$HISTORY_FILE\`"
    echo "- **Decisions**: \`$ROOT_DIR/docs/DECISIONS.md\`"
    echo "- **Foundations**: \`$ROOT_DIR/docs/FOUNDATIONS.md\`"
    echo ""
    echo "## Current State"
    echo ""
    echo "- Iteration: $iteration"
    echo "- Checklist items remaining: $remaining"
    echo "- Checklist items completed: $completed"
    echo ""
    echo "## Output Format"
    echo ""
    echo "End your response with ONE of:"
    echo "- \`<blocker>reason</blocker>\` — if stuck"
    echo "- \`<promise>DONE</promise>\` — ONLY after the Checklist Audit (rule 8) confirms every item is \`[x]\` AND \`./scripts/verify\` passes"
    echo "- A plain summary of what you did — if items remain after completing yours"
}

# ---------------------------------------------------------------------------
# Generate the gap analysis prompt (runs after all items complete + verify passes)
# ---------------------------------------------------------------------------
generate_gap_analysis_prompt() {
    cat <<'PROMPT_EOF'
# Post-Completion Gap Analysis — Non-Interactive

You are running inside an automated loop. Do NOT ask questions. Do NOT wait for
user input. Work autonomously.

## Task

Run `/gap-analysis` in non-interactive mode against the completed spec.
Audit every FR acceptance criterion against the actual codebase. Be conservative:
if you cannot find clear evidence, mark it as a GAP.

**Think deeply about each criterion.** Do not rush verdicts. For each criterion,
trace the full path from user action → frontend → API → backend → DB (or on-chain)
and verify evidence exists at every layer the criterion touches. A partial
implementation is a GAP, not SATISFIED.

## Process

Follow the gap-analysis skill phases exactly:

1. Read the spec, previous gap analysis (if any), history, SCOPE.md, DECISIONS.md
2. Inventory the codebase (on-chain instructions, engine exports, frontend components, tests)
3. Audit each FR acceptance criterion → SATISFIED / DEFERRED / GAP
4. Cross-check deferrals against other specs
5. Write/update the gap analysis report
6. Update spec FR checkboxes with HTML comment annotations
7. Output a summary

## Evidence Standard

- SATISFIED: must cite file:line or test name
- DEFERRED: must cite decision document
- GAP: must describe what's missing
- Uncertain = GAP (conservative default)

## Checkbox Annotation Format

Use HTML comments (invisible in rendered markdown):
```
- [x] Criterion text <!-- satisfied: file.rs:42 evidence -->
- [ ] Criterion text <!-- deferred: reason (SCOPE.md §N) -->
- [ ] Criterion text <!-- gap: not implemented in Component.tsx -->
```

Only annotate FR acceptance criteria checkboxes. Do NOT modify the Implementation Checklist.

PROMPT_EOF

    # Inject dynamic paths
    echo "## Files"
    echo ""
    echo "- **Spec**: \`$SPEC_FILE\`"
    echo "- **Gap Analysis Output**: \`$GAP_ANALYSIS_FILE\`"
    echo "- **History**: \`$HISTORY_FILE\`"
    echo "- **Scope**: \`$ROOT_DIR/docs/SCOPE.md\`"
    echo "- **Decisions**: \`$ROOT_DIR/docs/DECISIONS.md\`"
    echo ""

    # Collect all spec statuses for cross-referencing
    echo "## All Spec Statuses"
    echo ""
    echo "| Spec ID | Status |"
    echo "|---------|--------|"
    for spec_dir in "$ROOT_DIR"/docs/specs/[0-9]*/; do
        local sid
        sid=$(basename "$spec_dir")
        local status
        status=$(grep '| Status |' "$spec_dir/spec.md" 2>/dev/null | head -1 | awk -F'|' '{print $3}' | xargs)
        echo "| $sid | $status |"
    done
    echo ""

    echo "## Output"
    echo ""
    echo "End your response with a plain summary of what you wrote. Do NOT use"
    echo "\`<promise>\` or \`<blocker>\` tags — this is not the spec loop."
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
# Start from NR_OF_TRIES so iteration numbers are globally unique across runs
# (avoids overwriting previous log files)
ITERATION_OFFSET=$(grep 'NR_OF_TRIES' "$SPEC_FILE" | grep -oP '\d+' | head -1)
ITERATION_OFFSET=${ITERATION_OFFSET:-0}
ITERATION=$ITERATION_OFFSET
ITERATIONS_THIS_RUN=0

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Spec Loop: $SPEC_ID${NC}"
echo -e "${CYAN}  Items remaining: $(count_remaining)${NC}"
echo -e "${CYAN}  Max iterations: $MAX_ITERATIONS${NC}"
echo -e "${CYAN}========================================${NC}"

# Exit early if nothing to do
if [ "$(count_remaining)" -eq 0 ]; then
    echo -e "${GREEN}All checklist items are already complete.${NC}"
    echo "Running post-completion gap analysis..."

    GAP_LOG_FILE="gap-analysis.log"
    GAP_PROMPT=$(generate_gap_analysis_prompt)

    echo "$GAP_PROMPT" | claude -p \
        --dangerously-skip-permissions \
        --verbose \
        --output-format stream-json 2>/dev/null \
        | tee "$LOG_DIR/$GAP_LOG_FILE" \
        | "$SCRIPT_DIR/parse-stream.sh" || true

    {
        echo "## Gap Analysis (backfill) — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        if [ -f "$GAP_ANALYSIS_FILE" ]; then
            echo "- **Result**: Gap analysis report generated"
            echo "- **Report**: gap-analysis.md"
        else
            echo "- **Result**: Gap analysis did not produce output"
        fi
        echo "- **Log**: $GAP_LOG_FILE"
        echo ""
    } >> "$HISTORY_FILE"

    # Commit any gap-analysis/history updates (plus submodule pointer if needed)
    cd "$ROOT_DIR"
    commit_submodule_work "0"
    if ! git diff --quiet -- . || ! git diff --cached --quiet -- .; then
        stage_root_paths
        git commit -m "spec($SPEC_ID): post-completion gap analysis

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
    fi

    exit 0
fi

while true; do
    ITERATION=$((ITERATION + 1))
    ITERATIONS_THIS_RUN=$((ITERATIONS_THIS_RUN + 1))

    echo ""
    echo -e "${CYAN}──────────────────────────────────────${NC}"
    echo -e "${CYAN}  Iteration $ITERATION (run: $ITERATIONS_THIS_RUN / $MAX_ITERATIONS)${NC}"
    echo -e "${CYAN}  Remaining: $(count_remaining) items${NC}"
    echo -e "${CYAN}──────────────────────────────────────${NC}"

    # Safety cap (per-run)
    if [ "$ITERATIONS_THIS_RUN" -gt "$MAX_ITERATIONS" ]; then
        handle_blocker "$ITERATION" "Max iterations ($MAX_ITERATIONS) reached in this run. Review spec and history, then re-run."
    fi

    # Generate prompt and run claude
    PROMPT=$(generate_prompt "$ITERATION")
    LOG_FILE="iteration-$(printf '%03d' "$ITERATION").log"

    echo -e "${GREEN}  Running claude -p ...${NC}"
    echo "$PROMPT" | claude -p \
        --dangerously-skip-permissions \
        --verbose \
        --output-format stream-json 2>/dev/null \
        | tee "$LOG_DIR/$LOG_FILE" \
        | "$SCRIPT_DIR/parse-stream.sh" || true

    # Bump NR_OF_TRIES immediately so next run won't collide with this log file
    increment_tries

    # -------------------------------------------------------------------
    # Check for DONE signal in assistant text only (not tool results/system).
    # Agent must have performed the Checklist Audit (rule 8) before this.
    # -------------------------------------------------------------------
    if extract_assistant_text "$LOG_DIR/$LOG_FILE" | rg -F -q '<promise>DONE</promise>'; then
        echo ""
        echo -e "${GREEN}============================================${NC}"
        echo -e "${GREEN}  SPEC COMPLETE: $SPEC_ID${NC}"
        echo -e "${GREEN}  Total iterations: $ITERATION${NC}"
        echo -e "${GREEN}============================================${NC}"

        # Log completion
        {
            echo "## Iteration $ITERATION — $(date -u +%Y-%m-%dT%H:%M:%SZ) — COMPLETE"
            echo "- **Result**: All checklist items done, verification passed"
            echo "- **Log**: $LOG_FILE"
            echo ""
        } >> "$HISTORY_FILE"

        # ---------------------------------------------------------------
        # Devnet E2E gate (non-blocking)
        # ---------------------------------------------------------------
        if grep -qiE 'vrf|flipyou|lord.of.the.rngs|potshot' "$SPEC_FILE" 2>/dev/null; then
            echo ""
            echo -e "${CYAN}──────────────────────────────────────${NC}"
            echo -e "${CYAN}  Running devnet E2E verification...${NC}"
            echo -e "${CYAN}──────────────────────────────────────${NC}"
            if ./scripts/verify --devnet; then
                DEVNET_RESULT="PASS"
            else
                DEVNET_RESULT="WARN (non-blocking)"
            fi
            {
                echo "## Devnet E2E — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "- **Result**: $DEVNET_RESULT"
                echo ""
            } >> "$HISTORY_FILE"
        fi

        # ---------------------------------------------------------------
        # Run gap analysis (second claude -p pass)
        # ---------------------------------------------------------------
        echo ""
        echo -e "${CYAN}──────────────────────────────────────${NC}"
        echo -e "${CYAN}  Running post-completion gap analysis...${NC}"
        echo -e "${CYAN}──────────────────────────────────────${NC}"

        GAP_LOG_FILE="gap-analysis.log"
        GAP_PROMPT=$(generate_gap_analysis_prompt)

        echo "$GAP_PROMPT" | claude -p \
            --dangerously-skip-permissions \
            --verbose \
            --output-format stream-json 2>/dev/null \
            | tee "$LOG_DIR/$GAP_LOG_FILE" \
            | "$SCRIPT_DIR/parse-stream.sh" || true

        # Log gap analysis run
        if [ -f "$GAP_ANALYSIS_FILE" ]; then
            echo -e "${GREEN}  Gap analysis written: $GAP_ANALYSIS_FILE${NC}"
            {
                echo "## Gap Analysis — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "- **Result**: Gap analysis report generated"
                echo "- **Report**: gap-analysis.md"
                echo "- **Log**: $GAP_LOG_FILE"
                echo ""
            } >> "$HISTORY_FILE"
        else
            echo -e "${YELLOW}  Warning: Gap analysis did not produce output file${NC}"
            {
                echo "## Gap Analysis — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "- **Result**: Gap analysis did not produce output (agent may have failed)"
                echo "- **Log**: $GAP_LOG_FILE"
                echo ""
            } >> "$HISTORY_FILE"
        fi

        # Final commit (implementation + gap analysis + FR updates)
        cd "$ROOT_DIR"
        commit_submodule_work "$ITERATION"
        if ! git diff --quiet -- . || ! git diff --cached --quiet -- .; then
            stage_root_paths
            git commit -m "spec($SPEC_ID): complete — all checklist items done

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
        fi
        break
    fi

    # -------------------------------------------------------------------
    # Check for BLOCKER signal in assistant text only.
    # -------------------------------------------------------------------
    if extract_assistant_text "$LOG_DIR/$LOG_FILE" | rg -F -q '<blocker>'; then
        BLOCKER_MSG=$(extract_assistant_text "$LOG_DIR/$LOG_FILE" | rg -o '<blocker>.*</blocker>' | head -1 | sed -E 's#^.*<blocker>(.*)</blocker>.*$#\1#')
        handle_blocker "$ITERATION" "$BLOCKER_MSG" "$LOG_FILE"
    fi

    # -------------------------------------------------------------------
    # Check for changes to commit (across all owned submodules + spec dir)
    # -------------------------------------------------------------------
    cd "$ROOT_DIR"

    SUBMODULE_CHANGES=false
    if submodules_have_changes; then
        SUBMODULE_CHANGES=true
    fi

    SPEC_CHANGES=false
    if ! git diff --quiet -- docs/specs/"$SPEC_ID"/; then
        SPEC_CHANGES=true
    fi

    if [ "$SUBMODULE_CHANGES" = false ] && [ "$SPEC_CHANGES" = false ]; then
        handle_blocker "$ITERATION" "No file changes detected — agent made no progress." "$LOG_FILE"
    fi

    # Log success to history
    {
        echo "## Iteration $ITERATION — $(date -u +%Y-%m-%dT%H:%M:%SZ) — OK"
        echo "- **Log**: $LOG_FILE"
        echo ""
    } >> "$HISTORY_FILE"

    # Commit submodule work first so pointer advances flow into the root commit
    if [ "$SUBMODULE_CHANGES" = true ]; then
        commit_submodule_work "$ITERATION"
    fi

    # Commit in parent repo (spec updates + every owned submodule pointer)
    stage_root_paths
    git commit -m "spec($SPEC_ID): iteration $ITERATION

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true

    # Brief pause
    sleep 2
done

echo ""
echo -e "${CYAN}Log files: $LOG_DIR/${NC}"
echo -e "${CYAN}History: $HISTORY_FILE${NC}"
