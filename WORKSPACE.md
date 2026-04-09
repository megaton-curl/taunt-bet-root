# Taunt Bet Workspace

**Multi-repo orchestration workspace for the Taunt Bet gaming platform.**

---

## Structure

```
solana/          — git submodule (taunt-bet/solana.git): Anchor programs
backend/         — git submodule (taunt-bet/backend.git): Hono API + shared packages
chat/            — git submodule (taunt-bet/chat.git): Chat service + realtime/event feeds
telegram/        — git submodule (taunt-bet/telegram.git): Telegram bot service
docs/            — Specs, decisions, lessons, architecture
scripts/         — Cross-repo: verify, deploy, IDL sync, fee checks
e2e/             — Devnet E2E tests (Playwright)
test-tools/      — Development-only local diagnostics and harnesses
CLAUDE.md        — AI behavior rules and project context
```

---

## Quick Start

Active day-to-day development should happen on `dev` for the root workspace and
for owned service repos that expose a `dev` branch.

```bash
git submodule update --init --recursive
cd backend && pnpm install && cd ..
cd chat && pnpm install && cd ..
cd telegram && pnpm install && cd ..
cd solana && pnpm install --ignore-workspace && cd ..
./scripts/verify
cd chat && pnpm verify && cd ..
cd telegram && pnpm verify && cd ..
```

---

## Submodules

| Path | Repo | Purpose |
|------|------|---------|
| `solana/` | `taunt-bet/solana.git` | Anchor programs (flipyou, closecall, potshot, platform) + shared Rust crate |
| `backend/` | `taunt-bet/backend.git` | Hono REST API, settlement workers, shared TS packages (anchor-client, game-engine, fairness) |
| `chat/` | `taunt-bet/chat.git` | Dedicated chat service, room/message domain, and separate event-feed transport |
| `telegram/` | `taunt-bet/telegram.git` | Stateless Telegram bot service that consumes backend public contracts |

---

## Entry Points

- **Scope**: `docs/SCOPE.md`
- **Decisions**: `docs/DECISIONS.md`
- **Verification**: `./scripts/verify`
- **Chat Verification**: `cd chat && pnpm verify`
- **Telegram Verification**: `cd telegram && pnpm verify`
- **Deploy**: `./scripts/deploy-devnet.sh <program>`
- **IDL Sync**: `./scripts/sync-idl`
- **Chat Test Tool**: `test-tools/chat/`
