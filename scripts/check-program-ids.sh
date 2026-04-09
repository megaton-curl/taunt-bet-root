#!/usr/bin/env bash
# Verify program IDs are consistent across Anchor.toml, declare_id!(), and IDL JSON.
# Runs in <1s — safe for pre-commit hooks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_DIR="$ROOT/solana"
CLIENT_DIR="$ROOT/backend/packages/anchor-client/src"
ANCHOR_TOML="$SOLANA_DIR/Anchor.toml"

FAIL=0

# Parse all program IDs from Anchor.toml [programs.devnet] section
get_toml_id() {
  local key="$1"
  sed -n "s/^${key} *= *\"\([^\"]*\)\"/\1/p" "$ANCHOR_TOML" | tail -1
}

check_program() {
  local name="$1"
  local lib_rs="$SOLANA_DIR/programs/$name/src/lib.rs"
  local idl_json="$CLIENT_DIR/$name.json"

  local toml_id lib_id idl_id
  toml_id=$(get_toml_id "$name")
  lib_id=""
  idl_id=""

  if [ -f "$lib_rs" ]; then
    lib_id=$(sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p' "$lib_rs" | head -1)
  fi

  if [ -f "$idl_json" ]; then
    idl_id=$(sed -n 's/.*"address": *"\([^"]*\)".*/\1/p' "$idl_json" | head -1)
  fi

  # Need at least two sources to compare
  local sources=0
  [ -n "$toml_id" ] && sources=$((sources + 1))
  [ -n "$lib_id" ] && sources=$((sources + 1))
  [ -n "$idl_id" ] && sources=$((sources + 1))

  if [ "$sources" -lt 2 ]; then
    printf '\033[33m? %s: only %d source(s) found, skipping\033[0m\n' "$name" "$sources"
    return
  fi

  local mismatch=false

  if [ -n "$toml_id" ] && [ -n "$lib_id" ] && [ "$toml_id" != "$lib_id" ]; then
    printf '\033[31m✘ %s: Anchor.toml (%s) ≠ lib.rs (%s)\033[0m\n' "$name" "$toml_id" "$lib_id"
    mismatch=true
  fi
  if [ -n "$toml_id" ] && [ -n "$idl_id" ] && [ "$toml_id" != "$idl_id" ]; then
    printf '\033[31m✘ %s: Anchor.toml (%s) ≠ IDL (%s)\033[0m\n' "$name" "$toml_id" "$idl_id"
    mismatch=true
  fi
  if [ -n "$lib_id" ] && [ -n "$idl_id" ] && [ "$lib_id" != "$idl_id" ]; then
    printf '\033[31m✘ %s: lib.rs (%s) ≠ IDL (%s)\033[0m\n' "$name" "$lib_id" "$idl_id"
    mismatch=true
  fi

  if $mismatch; then
    FAIL=1
  else
    printf '\033[32m✓ %s: %s\033[0m\n' "$name" "${toml_id:-${lib_id:-$idl_id}}"
  fi
}

check_program "flipyou"
check_program "lordofrngs"
check_program "closecall"
check_program "platform"

if [ $FAIL -ne 0 ]; then
  printf '\n\033[31mProgram IDs out of sync!\033[0m\n'
  printf 'Fix: cd solana && anchor build -p <name> && cp target/idl/<name>.json ../backend/packages/anchor-client/src/\n'
  exit 1
fi
