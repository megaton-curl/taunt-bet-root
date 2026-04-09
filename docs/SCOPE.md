# Taunt Bet - Capability Baseline

Non-custodial P2P gaming platform on Solana. This document captures current implementation state, architectural constraints, and planning direction.

Last updated: 2026-04-04

---

## 1) Product Focus

- Real-money P2P gaming with on-chain settlement and verifiable fairness
- Progression and retention via challenges, points, and loot crates
- Referral-driven growth with on-chain earnings
- Operational safety: pause, monitoring, incident response

---

## 2) Shipped Capabilities

### Games (3 live)
- **FlipYou** (spec 001) — 1v1, commit-reveal + SlotHashes fairness, custom wagers
- **Lord of the RNGs / Jackpot** (spec 101) — Multiplayer weighted-entry jackpot, commit-reveal fairness
- **Close Call** (spec 100) — Pari-mutuel BTC price prediction, Pyth oracle settlement, minute-boundary candle cache

### On-Chain Programs
- **Per-game programs**: FlipYou, Lord of RNGs, Close Call — each independently deployable
- **Platform program**: PlatformConfig (fee BPS, treasury, pause state), admin-updatable via `update_platform_config`
- **Shared Rust crate** (`solana/shared/`): Escrow helpers, lifecycle state machine, timeout logic, pause controls, commit-reveal verifier, fee calculation, constants
- **Operational controls**: `set_paused` (per-game pause/unpause), `timeout_refund` (permissionless liveness guarantee), `force_close` (stuck round recovery)

### Settlement & Workers
- **PDA watcher**: WebSocket `onAccountChange` for instant join/settle detection
- **Polling fallback**: 1s interval for resilience, ~3-5s total settlement latency
- **Close Call clock**: Minute-boundary BTC price capture from Pyth Hermes, automatic round creation and settlement
- **Retry worker**: Exponential backoff for failed settlement transactions
- **Dogpile worker**: Status transitions (scheduled → active → ended) on 10s poll

### Auth & Identity
- **JWT auth** (spec 007) — Challenge-response via wallet signature, HS256 tokens
- **Player profiles** (spec 008) — Auto-created on first auth, username with 30-day change cooldown
- **Player stats**: Games played, total wagered, wins, win rate, win streaks (current + all-time), net PnL, per-game breakdown
- **Public profiles**: Stats visible to other players (no wallet or transaction history exposed)
- **Weekly leaderboard**: Volume-based ranking per game type with win rate and PnL

### Fairness & Pricing
- **Commit-reveal fairness** (spec 006): `SHA256(secret || entropy || PDA || algo_ver)`, public verification endpoints
- **SOL/USD price service**: Pyth Hermes REST (`GET /price/sol-usd`), 60s cache, used for points USD conversion
- **Fee structure**: 500 bps flat to single treasury, on-chain PlatformConfig canonical. CI guard: `scripts/check-fees.sh`

### Reward & Retention
- **Challenge engine** (spec 400) — Daily/weekly/onboarding challenges, template-based, adapter-driven
- **Points** — Earned per $ wagered (USD-converted), Dogpile multiplier, free to mint (pre-TGE allocation signal)
- **Loot crates** — Random drops after settled games (points crates + SOL crates from reward pool)
- **Reward pool** — Accounting-only ledger, configurable share of platform fees (default 20%)
- **Dogpile events** — Scheduled windows with boosted point multipliers, admin-managed
- **Completion bonus** — Meta-reward for completing all daily challenges (configurable)

### Growth
- **Referral system** (spec 300) — Unique codes/links, 1000 bps of fee as referral earnings, on-chain SOL claims, KOL rate overrides
- **Onboarding chain** — 4-step guided first session (set nickname, play, win, try all game types)

### Backend Infrastructure
- **Async event queue** (spec 301) — Postgres-backed, `FOR UPDATE SKIP LOCKED`, handler registry, exponential backoff (5s → 30s → 300s), dead-letter after 3 attempts
- **Event-driven pipeline** — `game.settled` → challenge progress + points + crate drops + pool funding; `profile.username_set` → onboarding challenge progress
- **Admin API** — Campaign/challenge CRUD, reward config tuning, Dogpile scheduling, reward pool monitoring (X-Admin-Key auth)
- **Rate limiting**: Per-wallet and global rate limits on game creation endpoints
- **Health endpoint**: `GET /health` — DB connectivity, worker status, unsettled queue depth
- **Transaction history**: Per-player ledger of on-chain deposits, payouts, refunds with game context

### Cross-Repo Tooling
- `scripts/verify` — Full lint + typecheck + test across all packages
- `scripts/deploy-devnet.sh` — Build → deploy → IDL sync → config init → ID verification
- `scripts/check-program-ids.sh` — Anchor.toml / declare_id! / IDL address consistency
- `scripts/check-fees.sh` — Fee constant parity across Rust and TypeScript
- `scripts/sync-idl` — Copy built IDLs from solana/target/ to backend anchor-client

---

## 3) Architecture Direction (Locked)

Decisions are recorded in `docs/DECISIONS.md`. Key constraints:

- **Chain**: Solana only. No multichain.
- **Custody**: Non-custodial. All money movement on-chain.
- **Programs**: Standard Anchor, per-game + shared crate. No BOLT ECS, no monolith program.
- **Fairness**: Commit-reveal + SlotHashes (default). VRF optional for future games, not default infrastructure.
- **Wallets**: Normal wallet-adapter flow. Privy/embedded wallets evaluated later.
- **Frontend**: Separate project and team. Backend provides API contracts. See `docs/DECISIONS.md` (2026-04-02).
- **Backend**: Hono API monolith with event-driven side-effects. Challenge engine extraction to separate service deferred (see `docs/TECH_DEBT.md`).

---

## 4) Trust Boundaries

### On-Chain (source of truth)
- All money movement (escrow, payout, refund, fee collection)
- Round settlement outcomes
- Payout eligibility and claim state
- Platform config (fee rate, pause state)

### Off-Chain (backend)
- Secret generation and commitment
- Settlement submission (permissionless on-chain, but backend holds the secret)
- Player profiles, stats, transaction history
- Challenge/reward evaluation and grant
- Points and reward pool accounting
- Referral tracking and claim processing

### Rule
If it changes user funds or determines payouts, it must be validated on-chain.

---

## 5) Near-Term Direction

### In progress
- **Chat service** (spec 009) — Separate repo (`chat/`), global chat + event feed transport
- **Dogpile events** — Scheduled, admin-managed. Infrastructure shipped, needs operational tuning.

### Next priorities
- SOL crate payout production hardening (tech debt: review transfer handler before enabling)
- Challenge pool rotation (M2: per-player daily draws from template pool)
- Additional verification adapters (streak, volume, unique opponents)
- KOL-triggered challenge campaigns
- Quest completion leaderboard

### Explicitly deferred
- **Crash** (spec 002) — Deferred to Phase 2 (decision 2026-03-30). Real-time multiplier game needs different fairness model.
- **Future game concepts** (specs 102-105) — Not ideated. Placeholders only.
- **Custodial balance model** — Not planned.
- **Multichain** — Not planned.
- **Token utility / TGE mechanics** — Points are the pre-TGE signal. Token integration is post-launch.

---

## 6) Repo Ownership

| Area | Repo | Ownership |
|------|------|-----------|
| On-chain programs | `solana/` submodule | This workspace |
| Backend API + workers | `backend/` submodule | This workspace |
| Chat service | `chat/` submodule | This workspace |
| Docs, scripts, E2E | Root repo | This workspace |
| Frontend | Separate repo | Separate team |
| Waitlist | `waitlist/` | Separate repo (npm, DigitalOcean) |

---

## 7) Success Metrics

- Settlement correctness and claim success rate
- Game round completion rate
- Challenge completion rate and reward ROI (SOL spent per $ additional wager volume)
- Referral conversion rate
- Points/crate engagement (% of active players interacting with challenge UI)
- Critical error rate within acceptable threshold

---

## 8) Spec Index

### Shipped (Done)
| Spec | Name | Notes |
|------|------|-------|
| 001 | FlipYou | Shipped, hybrid fairness |
| 006 | Fairness Backend | Shipped |
| 007 | JWT Session Auth | Shipped |
| 008 | User Profile | Shipped (redesigned 2026-03-12) |
| 100 | Close Call | Shipped, Pyth oracle |
| 101 | Lord of the RNGs | Shipped |
| 200 | Visual Regression | Shipped (frontend deferred) |
| 203 | E2E Integration | Active |
| 300 | Referral System | Shipped |
| 301 | Async Event Queue | Shipped |
| 400 | Challenge Engine | Shipped M1 |

### Active
| Spec | Name | Notes |
|------|------|-------|
| 004 | Shared Infrastructure | Living doc, on-chain lifecycle patterns |
| 009 | Chat | In progress, separate service |
| 999 | Enhancements | Rolling backlog |

### Deferred
| Spec | Name | Notes |
|------|------|-------|
| 002 | Crash | Phase 2 (decision 2026-03-30) |
| 102-105 | Future games | Not ideated, placeholders |

### Out of Scope (frontend)
| Spec | Name | Notes |
|------|------|-------|
| 204 | Multi-Page Flows | Frontend team |
| 205 | Real Wallet | Frontend team |

### Archived / Superseded
| Spec | Name | Notes |
|------|------|-------|
| 003 | Platform Core | Superseded by DESIGN_REFERENCE.md |
| 005 | Hybrid Fairness | Superseded by DECISIONS.md (2026-03-11) + spec 006 |
| 201 | Unit Tests | Covered by FOUNDATIONS.md testing methodology |
| 202 | Component Tests | Covered by FOUNDATIONS.md testing methodology |
