---
name: devnet
description: Devnet operations — list/join matches, check settlement, deploy programs, manage state. Defaults to the live dev backend (api.dev.taunt.bet).
argument-hint: <subcommand> [args] — matches | join [matchId|PDA] | settle | balance | deploy [program] | cleanup | health | feed
---

# /devnet — Devnet Operations

Multi-purpose skill for interacting with the devnet deployment.

## Environment

- **Solana directory**: `solana/` (submodule)
- **IDL location**: `solana/target/idl/` — always read program addresses from `idl.address`, never hardcode.
- **RPC**: `https://lb.drpc.live/solana-devnet/AvfNVeH0_E7ajvkIaZ0OS6QiksDa5ZMR76q4qi5fk9AX`
- **Wallet**: `~/.config/solana/id.json` (devnet-funded)
- **Dev backend API**: `https://api.dev.taunt.bet` (default for lookups). Local backend at `http://localhost:3100` is only used when explicitly running it; do not assume it's up.
- **Dev chat**: `https://scream.dev.taunt.bet` — system feed at `GET /feeds/system/stream`.
- **DB**: managed Postgres (dev/prod) — not directly reachable from this workspace. Local DB `postgresql://vscode@localhost:5432/taunt_bet_dev` only exists if you started a local backend.

## Subcommands

Parse the first word of the argument to determine the subcommand. If no argument is given, default to `health`.

### `matches`

List all open flipyou matches on devnet.

```bash
cd solana && node --input-type=module -e "
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('target/idl/flipyou.json', 'utf8'));
const conn = new Connection(process.env.RPC_URL ?? 'https://lb.drpc.live/solana-devnet/AvfNVeH0_E7ajvkIaZ0OS6QiksDa5ZMR76q4qi5fk9AX', 'confirmed');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))));
const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' });
const program = new Program(idl, provider);

// Anchor 0.32 lowercases first letter of IDL account names: FlipYouMatch -> flipYouMatch.
const accountKey = Object.keys(program.account).find(k => k.toLowerCase() === 'flipyoumatch');
const all = await program.account[accountKey].all();
const phases = ['WAITING', 'LOCKED', 'SETTLED', 'REFUNDED'];
for (const m of all) {
  const d = m.account;
  const phase = phases[d.phase] ?? d.phase;
  if (phase === 'SETTLED' || phase === 'REFUNDED') continue;
  const sol = (Number(d.entryAmount) / 1e9).toFixed(4);
  const side = d.creatorSide === 0 ? 'heads' : 'tails';
  console.log(m.publicKey.toBase58(), '|', sol, 'SOL |', side, '|', phase, '| creator:', d.creator.toBase58().slice(0, 8) + '...');
}
"
```

### `join [MATCH_ID_OR_PDA]`

Join a flipyou match on devnet. The script accepts:

- **16-char hex matchId** (the URL form, e.g. `6dda7ab30056f18d` from `app.dev.taunt.bet/flip-you/<matchId>`) — resolved to a PDA via `GET https://api.dev.taunt.bet/flip-you/by-id/:matchId`.
- **base58 on-chain PDA**.
- **No argument** — lists open matches and joins the first one.

```bash
cd solana && npx tsx scripts/join-devnet-match.ts <matchId|PDA>
```

Override env if needed: `RPC_URL`, `API_BASE_URL`. Requires `dangerouslyDisableSandbox: true`.

If the match is already in `phase != WAITING`, the script exits early — that's fine, the dev backend's PDA watcher likely already settled it. To verify a settle round-trip, immediately follow with the `feed` subcommand to see the ticker event.

### `feed`

Check the chat system feed (the on-site news ticker) — useful to verify a settlement actually triggered the `chat.ticker_publish` event.

```bash
curl -s https://scream.dev.taunt.bet/feeds/system/events | python3 -m json.tool
```

To live-tail: `curl -N https://scream.dev.taunt.bet/feeds/system/stream` (SSE; `event: feed` lines carry the JSON).

### `lookup <matchId>`

Resolve a 16-hex matchId to its full DB+chain state via the dev API. Works for any game prefix.

```bash
curl -s https://api.dev.taunt.bet/flip-you/by-id/<matchId> | python3 -m json.tool   # flip-you
curl -s https://api.dev.taunt.bet/pot-shot/by-id/<matchId> | python3 -m json.tool   # pot-shot
curl -s https://api.dev.taunt.bet/closecall/by-id/<roundId> | python3 -m json.tool  # close-call (numeric round id)
```

### `settle`

Check the settlement status of active matches. **Only valid against a local backend**; for dev, prefer `/flip-you/by-id/:matchId` lookups.

1. `curl -s http://localhost:3100/health` — confirm local backend is up
2. If not running, tell the user: `cd backend && pnpm run dev`
3. List any rounds in non-settled phases from the local DB:
   ```bash
   node --input-type=module -e "
   import postgres from 'postgres';
   const sql = postgres('postgresql://vscode@localhost:5432/taunt_bet_dev');
   const rows = await sql\`SELECT pda, phase, amount_lamports, created_at FROM rounds WHERE phase NOT IN ('settled', 'expired') ORDER BY created_at\`;
   for (const r of rows) console.log(r.pda.slice(0,12) + '...', '|', r.phase, '|', (r.amount_lamports/1e9).toFixed(4), 'SOL |', r.created_at);
   if (rows.length === 0) console.log('No unsettled rounds');
   await sql.end();
   "
   ```

### `balance`

Check the local wallet balance on devnet.

```bash
solana balance --url $RPC_URL  # or the default URL above
solana address
```

### `deploy [program]`

Deploy a program to devnet using the root deploy script.

```bash
./scripts/deploy-devnet.sh <program>
```

Valid program names: `flipyou`, `potshot`, `closecall`, `platform`. Requires `dangerouslyDisableSandbox: true`. Use `--fresh` only when struct layouts changed.

### `cleanup`

Clear stale rounds from a **local** backend database. Never run against managed dev/prod DBs.

```bash
node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres('postgresql://vscode@localhost:5432/taunt_bet_dev');
const del = await sql\`DELETE FROM rounds WHERE phase NOT IN ('settled', 'expired') RETURNING pda, phase\`;
for (const r of del) console.log('Deleted:', r.pda.slice(0,12) + '...', r.phase);
if (del.length === 0) console.log('No stale rounds to clean');
await sql.end();
"
```

### `health`

Quick health check of the dev environment. Run in parallel:

1. `solana balance --url <RPC_URL>` — wallet SOL
2. `curl -s https://api.dev.taunt.bet/health` — dev backend status
3. `curl -s -o /dev/null -w "%{http_code}" https://scream.dev.taunt.bet/health || echo "no health route"` — chat reachability
4. `solana slot --url <RPC_URL>` — current devnet slot

Display a summary table.

## Rules

- All `node --input-type=module -e` commands need `dangerouslyDisableSandbox: true`
- All network-touching commands (`anchor deploy`, `npx tsx scripts/`, `solana`, `curl`) need `dangerouslyDisableSandbox: true`
- Always read program addresses from `idl.address` — hardcoded constants drift after every redeploy.
- Anchor 0.32 lowercases the first letter of PascalCase IDL account names. `FlipYouMatch` is `program.account.flipYouMatch`. When unsure, `Object.keys(program.account)` reveals the canonical key.
- Always `cd solana` before running anchor/program commands.
- Format output clearly — use tables or aligned columns.
- If a command fails, diagnose (common issues: PDA already closed/settled, account-name casing, wrong program ID, wallet unfunded, RPC rate limit, dev API path mismatch).
