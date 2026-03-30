#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ROOT="${BWRAP_CLEANUP_ROOT:-$DEFAULT_ROOT}"

usage() {
  echo "Usage: ./scripts/with-bwrap-cleanup.sh <command> [args...]" >&2
}

cleanup_and_exit() {
  local exit_code="$1"

  "$SCRIPT_DIR/cleanup-bwrap-ghosts.sh" "$TARGET_ROOT" >/dev/null 2>&1 || true
  exit "$exit_code"
}

if [ "$#" -eq 0 ]; then
  usage
  exit 1
fi

trap 'cleanup_and_exit 130' INT
trap 'cleanup_and_exit 143' TERM

"$@"
command_exit=$?

cleanup_and_exit "$command_exit"
