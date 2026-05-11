#!/bin/bash
# Rule-audit keyword sweep.
#
# Scans the last N Claude Code transcripts for this project, extracts only
# user + assistant text (skipping tool params, results, and system reminders),
# and counts how many sessions contain each rule's topic keywords.
#
# Use to evaluate which rules in CLAUDE.md / docs/WORKFLOW.md actually surface
# in real conversations. Stable-low (<5% in both 30d and 60d windows) =
# safe delete candidate. Defensive rules (context decay, edit integrity, etc.)
# will read 0% by design — keep regardless.
#
# Suggested cadence: quarterly, or after major rule revisions.
#
# Usage:
#   ./sweep.sh                  # 60 sessions, default project
#   ./sweep.sh 30               # 30 sessions
#   ./sweep.sh 60 /path/to/proj # custom transcript dir
#
# Output: a table of (rule label, files-with-match, percentage).

set -u

N="${1:-60}"
DEFAULT_PROJECT_DIR="$HOME/.claude/projects/-workspaces-rng-utopia"
PROJECT_DIR="${2:-$DEFAULT_PROJECT_DIR}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Transcript dir not found: $PROJECT_DIR" >&2
  exit 1
fi

CLEAN_DIR="$(mktemp -d)"
trap 'rm -rf "$CLEAN_DIR"' EXIT

# Pick the N most-recently-modified .jsonl files.
cd "$PROJECT_DIR"
file_list="$(mktemp)"
ls -t *.jsonl 2>/dev/null | head -"$N" > "$file_list"

actual_n=$(wc -l < "$file_list")
if [ "$actual_n" -eq 0 ]; then
  echo "No .jsonl transcripts in $PROJECT_DIR" >&2
  exit 1
fi

# Parse each transcript: keep only user.content text and assistant text
# segments. Drop tool params, tool results, system reminders, slash commands.
while IFS= read -r f; do
  base="${f%.jsonl}"
  jq -r '
    if .type == "user" then
      (.message.content // empty) |
      if type == "string" then .
      else map(select(.type? == "text") | .text) | join("\n")
      end
    elif .type == "assistant" then
      (.message.content // []) | map(select(.type == "text") | .text) | join("\n")
    else empty
    end
  ' "$f" 2>/dev/null \
  | grep -v -e '<system-reminder>' -e '<command-name>' -e '<local-command-caveat>' -e '<command-message>' \
  > "$CLEAN_DIR/$base.txt"
done < "$file_list"
rm -f "$file_list"

# Keyword sweep.
cd "$CLEAN_DIR"
printf "Window: %s sessions (%s)\n\n" "$actual_n" "$PROJECT_DIR"
printf "%-50s %5s %5s\n" "RULE / TOPIC" "FILES" "PCT"
printf "%-50s %5s %5s\n" "----" "----" "---"

run() {
  local label="$1"
  local pat="$2"
  local hits
  hits=$(rg -l --no-messages -e "$pat" -- *.txt 2>/dev/null | wc -l)
  local pct
  pct=$(awk -v h="$hits" -v t="$actual_n" 'BEGIN { printf "%.0f%%", (h/t)*100 }')
  printf "%-50s %5s %5s\n" "$label" "$hits" "$pct"
}

# Patterns are intentionally rule-specific (the exact phrasing or distinctive
# domain terms), not generic English. Add/remove rows as rules evolve.
run "lamports / amount-units"          '\blamports\b|amountLamports'
run "HTTP-status / envelope"           'HTTP status|status code|"ok": false'
run "submodule workflow"               '\bsubmodule\b'
run "pnpm policy"                      'pnpm verify|pnpm lint|pnpm test'
run "production data safety"           'production data|live data|backfill'
run "subagent stall / timebox"         'stalled subagent|DONE_WITH_CONCERNS|subagent stall'
run "subagent takeover discipline"     'takeover|false-pass|vitest false'
run "context decay (rule wording)"     'context decay'
run "edit integrity (rule wording)"    'edit integrity|stale context'
run "failure recovery (two attempts)"  'two attempts|third attempt|third time'
run "complexity / branch-heavy"        'branch-heavy|guard clause'
run "grep all references"              'grep for all|barrel file|all references'
run "dead code cleanup"                'dead code|orphaned import|unused export'
run "third-party version pin"          'pin the version|latest stable|docs\.rs'
run "supply-chain freshness"           'freshly published|package age'
run "untrusted external content"       'curl \| sh|curl \| bash'
run "guard secrets"                    'expose secrets|least-privilege|leaked secret'
run "UX verified / player flow"        'player flow|UX[- ]verified|smoke test'
run "test role/structure"              'getByRole|getByLabel'
run "frontend out of scope"            'consult-only|read-only reference|frontend team'
run "surface assumptions (auto mode)"  'assuming|assumption:|i.ll assume'
