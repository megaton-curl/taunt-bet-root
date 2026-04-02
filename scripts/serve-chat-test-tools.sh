#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-3400}"

cd "$ROOT/test-tools/chat"
python3 -m http.server "$PORT"
