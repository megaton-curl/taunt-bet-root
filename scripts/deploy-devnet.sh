#!/usr/bin/env bash
# Deploy one or all programs to devnet with full lifecycle:
#   build → deploy → copy IDL → init config → verify sync
#
# Usage:
#   ./scripts/deploy-devnet.sh flipyou        # deploy one program
#   ./scripts/deploy-devnet.sh all             # deploy all programs
#   ./scripts/deploy-devnet.sh flipyou --fresh # close + new keypair + deploy

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLANA_DIR="$ROOT/solana"
CLIENT_DIR="$ROOT/backend/packages/anchor-client/src"
RPC="https://lb.drpc.live/solana-devnet/AvfNVeH0_E7ajvkIaZ0OS6QiksDa5ZMR76q4qi5fk9AX"

PROGRAMS=("flipyou" "potshot" "closecall" "platform")

get_toml_id() {
  sed -n "s/^${1} *= *\"\([^\"]*\)\"/\1/p" "$SOLANA_DIR/Anchor.toml" | tail -1
}
FRESH=false

usage() {
  echo "Usage: $0 <program|all> [--fresh]"
  echo "Programs: ${PROGRAMS[*]}"
  echo "  --fresh: close program, generate new keypair, redeploy (resets all state)"
  exit 1
}

[ $# -lt 1 ] && usage

TARGET="$1"
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --fresh) FRESH=true; shift ;;
    *) usage ;;
  esac
done

# Safeguard: --fresh is never allowed on mainnet
if $FRESH && [[ "$RPC" == *"mainnet"* ]]; then
  printf '\033[31mFATAL: --fresh is not allowed on mainnet. Use anchor upgrade.\033[0m\n'
  exit 1
fi

if [ "$TARGET" = "all" ]; then
  DEPLOY_LIST=("${PROGRAMS[@]}")
else
  found=false
  for p in "${PROGRAMS[@]}"; do
    [ "$p" = "$TARGET" ] && found=true
  done
  $found || { echo "Unknown program: $TARGET"; usage; }
  DEPLOY_LIST=("$TARGET")
fi

cd "$SOLANA_DIR"

deploy_program() {
  local name="$1"
  printf '\n\033[1;36m═══ %s ═══\033[0m\n' "$name"

  # Fresh mode: close existing program, generate new keypair
  if $FRESH; then
    local current_id
    current_id=$(sed -n "s/^${name} *= *\"\([^\"]*\)\"/\1/p" Anchor.toml | tail -1)
    if [ -n "$current_id" ]; then
      printf '  Closing program %s...\n' "$current_id"
      solana program close "$current_id" --url "$RPC" --bypass-warning 2>/dev/null || true
    fi
    printf '  Generating new keypair...\n'
    solana-keygen new --no-bip39-passphrase -o "target/deploy/${name}-keypair.json" --force 2>/dev/null
    local new_id
    new_id=$(solana-keygen pubkey "target/deploy/${name}-keypair.json")
    printf '  New program ID: %s\n' "$new_id"

    # Update all references
    if [ -n "$current_id" ]; then
      sed -i "s/$current_id/$new_id/g" \
        Anchor.toml \
        "programs/$name/src/lib.rs" \
        "$CLIENT_DIR/$name.json" \
        "$CLIENT_DIR/$name.ts" \
        2>/dev/null || true
      # Also update .env files in backend
      find "$ROOT/backend" -maxdepth 2 -type f -name ".env*" -not -path "*/node_modules/*" \
        -exec sed -i "s/$current_id/$new_id/g" {} + 2>/dev/null || true
    fi
  fi

  # Build
  printf '  Building...\n'
  anchor build -p "$name" 2>&1 | tail -1

  # Deploy — use upgrade if program exists, deploy if new
  printf '  Deploying...\n'
  local program_id
  program_id=$(get_toml_id "$name")
  if solana program show "$program_id" --url "$RPC" &>/dev/null && ! $FRESH; then
    printf '  Using anchor upgrade (preserves accounts)...\n'
    anchor upgrade "target/deploy/${name}.so" \
      --program-id "$program_id" \
      --provider.cluster "$RPC" 2>&1 | grep -E "Program Id:|Deploy success|Upgrade success|Error" || true
    # Re-upload IDL
    anchor idl upgrade --filepath "target/idl/${name}.json" \
      --provider.cluster "$RPC" "$program_id" 2>&1 | tail -1 || true
  else
    anchor deploy --provider.cluster "$RPC" -p "$name" 2>&1 | grep -E "Program Id:|Deploy success|Error"
  fi

  # Copy IDL + types to backend
  cp "target/idl/$name.json" "$CLIENT_DIR/"
  cp "target/types/$name.ts" "$CLIENT_DIR/"
  printf '  IDL + types copied to backend/packages/anchor-client/src/\n'

  # Init config (program-specific)
  printf '  Initializing config...\n'
  init_config "$name"
}

init_config() {
  local name="$1"
  local idl_path="target/idl/$name.json"
  local kp_path="$HOME/.config/solana/id.json"

  node --input-type=module -e "
import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('${idl_path}', 'utf8'));
const conn = new Connection('${RPC}', 'confirmed');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('${kp_path}', 'utf8'))));
const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' });
const program = new Program(idl, provider);

try {
  const methods = program.methods;
  if ('initializeConfig' in methods) {
    $(case "$name" in
      closecall)
        echo "
    const feedHex = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
    const feedId = Array.from(Buffer.from(feedHex, 'hex'));
    await methods.initializeConfig(feedId, 30, 10).rpc();
    "
        ;;
      *)
        echo "await methods.initializeConfig().rpc();"
        ;;
    esac)
    console.log('  Config initialized');
  } else {
    console.log('  No initializeConfig instruction');
  }
} catch (e) {
  if (e.message?.includes('already in use')) {
    console.log('  Config already exists (OK)');
  } else {
    console.error('  Config init failed:', e.message?.slice(0, 100));
  }
}
" 2>&1
}

for prog in "${DEPLOY_LIST[@]}"; do
  deploy_program "$prog"
done

# Expire orphaned rounds — after a --fresh deploy, any unsettled rounds
# for that game are stranded (old program closed, PDAs can never settle).
if $FRESH; then
  printf '\n\033[1;36m═══ Cleaning orphaned rounds ═══\033[0m\n'
  DB_URL="${DATABASE_URL:-postgresql://vscode@localhost:5432/taunt_bet_dev}"
  for prog in "${DEPLOY_LIST[@]}"; do
    game_name="$prog"
    # Map program names to DB game names
    case "$prog" in
      potshot) game_name="lord" ;;
      closecall)  game_name="closecall" ;;
    esac
    node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres('${DB_URL}');
const expired = await sql\`
  UPDATE rounds SET phase = 'expired', updated_at = now()
  WHERE game = '${game_name}' AND phase NOT IN ('settled', 'expired')
  RETURNING pda, phase
\`;
if (expired.length > 0) {
  console.log('  Expired ${game_name} rounds:', expired.length);
  for (const r of expired) console.log('    ', r.pda.slice(0, 16) + '...');
} else {
  console.log('  No orphaned ${game_name} rounds');
}
await sql.end();
" 2>&1
  done
fi

# Verify sync
printf '\n\033[1;36m═══ Verification ═══\033[0m\n'
"$ROOT/scripts/check-program-ids.sh"

printf '\n\033[32m✓ Deploy complete. Remember to restart the backend.\033[0m\n'
