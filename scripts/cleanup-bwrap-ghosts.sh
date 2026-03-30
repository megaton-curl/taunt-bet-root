#!/usr/bin/env bash
set -euo pipefail

# Remove only known empty bubblewrap/sandbox ghost paths from the repo root.
# These are safe to clean because we require them to be:
# - in a small allowlist
# - empty
# - untracked by git

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ROOT="${1:-$DEFAULT_ROOT}"
TARGET_ROOT="$(cd "$TARGET_ROOT" && pwd)"

ghost_files=(
  ".bash_profile"
  ".bashrc"
  ".gitconfig"
  ".profile"
  ".ripgreprc"
  ".zprofile"
  ".zshrc"
  "HEAD"
  "config"
  "hooks"
  "objects"
  "refs"
)

ghost_dirs=(
  ".idea"
  ".vscode"
)

is_tracked_path() {
  local path="$1"

  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi

  [ -n "$(git -C "$TARGET_ROOT" ls-files -- "$path" 2>/dev/null)" ]
}

removed_paths=()

cd "$TARGET_ROOT"

for path in "${ghost_files[@]}"; do
  [ -e "$path" ] || continue
  [ -L "$path" ] && continue

  if is_tracked_path "$path"; then
    continue
  fi

  if [ -f "$path" ] && [ ! -s "$path" ]; then
    rm -f -- "$path"
    removed_paths+=("$path")
  fi
done

for path in "${ghost_dirs[@]}"; do
  [ -e "$path" ] || continue
  [ -L "$path" ] && continue
  [ -d "$path" ] || continue

  if is_tracked_path "$path"; then
    continue
  fi

  if [ -z "$(ls -A "$path" 2>/dev/null)" ]; then
    rmdir -- "$path"
    removed_paths+=("$path/")
  fi
done

if [ "${#removed_paths[@]}" -gt 0 ]; then
  printf 'Removed bwrap ghost paths:\n'
  printf ' - %s\n' "${removed_paths[@]}"
fi
