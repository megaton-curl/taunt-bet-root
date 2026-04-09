---
name: devnet
description: Devnet operations — list/join matches, check settlement, deploy programs, manage test state.
argument-hint: <subcommand> [args] — matches | join [PDA] | settle | balance | deploy [program] | cleanup | health
---

# /devnet — Devnet Operations

Multi-purpose skill for interacting with the devnet deployment.

## Environment

- **Solana directory**: `solana/` (submodule)
- **IDL location**: `solana/target/idl/`
- **RPC**: `https://lb.drpc.live/solana-devnet/AvfNVeH0_E7ajvkIaZ0OS6QiksDa5ZMR76q4qi5fk9AX`
- **Wallet**: `~/.config/solana/id.json`
- **Backend**: `http://localhost:3100`
- **DB**: `postgresql://vscode@localhost:5432/rng_utopia_dev`

## Subcommands

Parse the first word of the argument to determine the subcommand. If no argument
is given, default to `health`.

### `matches`

List all open flipyou matches on devnet.

```bash
cd solana && node --input-type=module -e "
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('target/idl/flipyou.json', 'utf8'));
const conn = new Connection('https://lb.drpc.live/solana-devnet/AvfNVeH0_E7ajvkIaZ0OS6QiksDa5ZMR76q4qi5fk9AX', 'confirmed');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))));
const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' });
const program = new Program(idl, provider);

const all = await program.account.flipyouMatch.all([{ dataSize: program.account.flipyouMatch.size }]);
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

Display the results as a formatted table.

### `join [PDA_PREFIX_OR_FULL]`

Join a flipyou match on devnet.

- If a PDA argument is given, first check if it's a prefix (< 32 chars). If so,
  list all open matches and find the one whose base58 address contains the prefix.
- If no PDA given, list open matches and ask the user which one to join.
- Use the existing script: `cd solana && npx tsx scripts/join-devnet-match.ts [FULL_PDA]`
- The script needs `dangerouslyDisableSandbox: true` for network access.

### `settle`

Check the settlement status of active matches.

1. `curl -s http://localhost:3100/health` — check backend is running + unsettled count
2. If backend is not running, tell the user to start it:
   `cd backend/services/backend && pnpm run dev`
3. List any rounds in non-settled phases from the DB:
   ```bash
   node --input-type=module -e "
   import postgres from 'postgres';
   const sql = postgres('postgresql://vscode@localhost:5432/rng_utopia_dev');
   const rows = await sql\`SELECT pda, phase, amount_lamports, created_at FROM rounds WHERE phase NOT IN ('settled', 'expired') ORDER BY created_at\`;
   for (const r of rows) console.log(r.pda.slice(0,12) + '...', '|', r.phase, '|', (r.amount_lamports/1e9).toFixed(4), 'SOL |', r.created_at);
   if (rows.length === 0) console.log('No unsettled rounds');
   await sql.end();
   "
   ```

### `balance`

Check test wallet balances on devnet.

```bash
solana balance  # default wallet
```

Also show the backend server wallet balance from the health endpoint.

### `deploy [program]`

Deploy a program to devnet using the root deploy script.

```bash
./scripts/deploy-devnet.sh <program>
```

Valid program names: `flipyou`, `potshot`, `closecall`, `platform`.

Requires `dangerouslyDisableSandbox: true`.

### `cleanup`

Clear stale rounds from the backend database and list any orphaned on-chain accounts.

```bash
node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres('postgresql://vscode@localhost:5432/rng_utopia_dev');
const del = await sql\`DELETE FROM rounds WHERE phase NOT IN ('settled', 'expired') RETURNING pda, phase\`;
for (const r of del) console.log('Deleted:', r.pda.slice(0,12) + '...', r.phase);
if (del.length === 0) console.log('No stale rounds to clean');
await sql.end();
"
```

### `health`

Quick health check of the devnet environment. Run these in parallel:

1. `solana balance` — wallet SOL
2. `curl -s http://localhost:3100/health` — backend status
3. `solana slot` — current devnet slot

Display a summary table.

## Rules

- All `node --input-type=module -e` commands need `dangerouslyDisableSandbox: true`
- All network-touching commands (`anchor deploy`, `npx tsx scripts/`, `solana`, `curl`) need `dangerouslyDisableSandbox: true`
- Always `cd solana` before running anchor/program commands
- Format output clearly — use tables or aligned columns
- If a command fails, diagnose (common issues: backend not running, wallet unfunded, RPC rate limit)
