# Taunt Bet Workspace

**Multi-repo orchestration workspace for the Taunt Bet gaming platform.**

---

## Structure

```
solana/          — git submodule (taunt-bet/solana.git): Anchor programs
backend/         — git submodule (taunt-bet/backend.git): Hono API + shared packages
docs/            — Specs, decisions, lessons, architecture
scripts/         — Cross-repo: verify, deploy, IDL sync, fee checks
e2e/             — Devnet E2E tests (Playwright)
CLAUDE.md        — AI behavior rules and project context
```

---

## Quick Start

```bash
git submodule update --init --recursive
cd backend && pnpm install && cd ..
cd solana && pnpm install --ignore-workspace && cd ..
./scripts/verify
```

---

## Submodules

| Path | Repo | Purpose |
|------|------|---------|
| `solana/` | `taunt-bet/solana.git` | Anchor programs (coinflip, closecall, lordofrngs, platform) + shared Rust crate |
| `backend/` | `taunt-bet/backend.git` | Hono REST API, settlement workers, shared TS packages (anchor-client, game-engine, fairness) |

---

## Entry Points

- **Scope**: `docs/SCOPE.md`
- **Decisions**: `docs/DECISIONS.md`
- **Verification**: `./scripts/verify`
- **Deploy**: `./scripts/deploy-devnet.sh <program>`
- **IDL Sync**: `./scripts/sync-idl`
