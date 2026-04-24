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

Production rule:

- Treat all schema and data changes as production-sensitive. Migrations must be additive or carefully staged, preserve existing data, and come with a documented rollout/rollback plan before anything destructive is considered.

---

## Submodules

| Path | Repo | Purpose |
|------|------|---------|
| `solana/` | `taunt-bet/solana.git` | Anchor programs (flipyou, closecall, potshot, platform) + shared Rust crate |
| `backend/` | `taunt-bet/backend.git` | Hono REST API, settlement workers, shared TS packages (anchor-client, game-engine, fairness) |
| `chat/` | `taunt-bet/chat.git` | Dedicated chat service, room/message domain, and separate event-feed transport |
| `telegram/` | `taunt-bet/telegram.git` | Stateless Telegram bot service that consumes backend public contracts |

Authority map:

- Root workspace is authoritative for policy, docs, orchestration, and submodule pointers.
- `backend/` is authoritative for public API contracts and backend data behavior.
- `chat/` is authoritative for chat-service behavior and contracts.
- `waitlist/` and `webapp/` are consult-only references by default. Review them for downstream impact, but do not proactively edit them unless explicitly asked.

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
