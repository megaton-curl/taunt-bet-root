#!/usr/bin/env bash
# Reset the backend database via the admin endpoint.
# Dev/devnet only — requires ADMIN_TOKEN to be set on the backend.
#
# Usage:
#   ./scripts/reset-db.sh                           # uses defaults
#   BACKEND_URL=https://api.example.com ./scripts/reset-db.sh
#
# Env vars (or sourced from .env.devnet):
#   ADMIN_TOKEN   — required, must match backend's ADMIN_TOKEN
#   BACKEND_URL   — optional, default http://localhost:3100

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Source .env.devnet if it exists and vars aren't already set
if [[ -z "${ADMIN_TOKEN:-}" && -f "$ROOT_DIR/.env.devnet" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.devnet"
fi

if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ERROR: ADMIN_TOKEN is not set. Set it in env or .env.devnet" >&2
  exit 1
fi

BACKEND_URL="${BACKEND_URL:-http://localhost:3100}"
ENDPOINT="$BACKEND_URL/internal/reset-db"

echo "Resetting database at $ENDPOINT ..."

HTTP_CODE=$(curl -s -o /tmp/reset-db-response.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

BODY=$(cat /tmp/reset-db-response.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "OK: $BODY"
  echo "Backend will restart with fresh database."
else
  echo "FAILED (HTTP $HTTP_CODE): $BODY" >&2
  exit 1
fi
