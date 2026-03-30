#!/bin/bash
# =============================================================================
# check-fees.sh — Verify fee constants are consistent and not hardcoded
#
# Enforces:
#   1. Rust DEFAULT_FEE_BPS and TS FEE_CONSTANTS.TOTAL_BPS are in sync
#   2. No hardcoded fee arithmetic in calculation paths
#   3. No hardcoded percentage strings from the old 3-bucket split
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- 1. Sync check: Rust DEFAULT_FEE_BPS == TS TOTAL_BPS ---

RUST_BPS=$(grep -oP 'DEFAULT_FEE_BPS:\s*u16\s*=\s*\K\d+' "$ROOT/solana/shared/src/fees.rs" 2>/dev/null || echo "")
TS_BPS=$(grep -oP 'TOTAL_BPS:\s*\K\d+' "$ROOT/backend/packages/game-engine/src/types.ts" 2>/dev/null || echo "")

if [ -z "$RUST_BPS" ]; then
  echo -e "${RED}[FAIL] Could not read DEFAULT_FEE_BPS from solana/shared/src/fees.rs${NC}"
  ERRORS=$((ERRORS + 1))
elif [ -z "$TS_BPS" ]; then
  echo -e "${RED}[FAIL] Could not read TOTAL_BPS from backend/packages/game-engine/src/types.ts${NC}"
  ERRORS=$((ERRORS + 1))
elif [ "$RUST_BPS" != "$TS_BPS" ]; then
  echo -e "${RED}[FAIL] Fee constant mismatch: Rust DEFAULT_FEE_BPS=$RUST_BPS, TS TOTAL_BPS=$TS_BPS${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}[OK] Fee constants in sync: $RUST_BPS bps${NC}"
fi

# --- 2. No hardcoded fee arithmetic outside canonical functions ---

STALE_BACKEND=$(rg -n '\*\s*\d+n?\s*[)/]\s*10[_,]?000' \
  --type-add 'src:*.{ts,tsx,rs}' -t src \
  --glob '!node_modules' \
  --glob '!**/dist/**' \
  --glob '!scripts/check-fees.sh' \
  --glob '!**/constants.ts' \
  --glob '!**/fees.rs' \
  --glob '!**/payouts.ts' \
  --glob '!**/*.test.*' \
  --glob '!**/tests/**' \
  --glob '!**/e2e/**' \
  "$ROOT/backend" 2>/dev/null || true)

STALE_SOLANA=$(rg -n '\*\s*\d+n?\s*[)/]\s*10[_,]?000' \
  --type-add 'src:*.{ts,tsx,rs}' -t src \
  --glob '!**/target/**' \
  --glob '!**/fees.rs' \
  --glob '!**/tests/**' \
  "$ROOT/solana" 2>/dev/null || true)

STALE="${STALE_BACKEND}${STALE_SOLANA}"

if [ -n "$STALE" ]; then
  echo -e "${RED}[FAIL] Hardcoded fee arithmetic found (should use parameterized functions):${NC}"
  echo "$STALE"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}[OK] No hardcoded fee arithmetic outside canonical sources${NC}"
fi

# --- 3. No old 3-bucket percentage strings ---

OLD_PCT=$(rg -n '"2%"|"0\.7%"|"0\.3%"' \
  --type-add 'src:*.{ts,tsx}' -t src \
  --glob '!node_modules' \
  --glob '!**/dist/**' \
  --glob '!scripts/check-fees.sh' \
  "$ROOT/backend" 2>/dev/null || true)

if [ -n "$OLD_PCT" ]; then
  echo -e "${RED}[FAIL] Old 3-bucket percentage strings found:${NC}"
  echo "$OLD_PCT"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}[OK] No old 3-bucket percentage strings${NC}"
fi

# --- Summary ---

if [ $ERRORS -gt 0 ]; then
  echo -e "\n${RED}Fee check failed with $ERRORS error(s)${NC}"
  exit 1
else
  echo -e "\n${GREEN}All fee checks passed${NC}"
fi
