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
- **Coinflip** (spec 001) — 1v1, commit-reveal + SlotHashes fairness, custom wagers
- **Lord of the RNGs / Jackpot** (spec 101) — Multiplayer weighted-entry jackpot, commit-reveal fairness
- **Close Call** (spec 100) — Pari-mutuel BTC price prediction, Pyth oracle settlement

### Platform Infrastructure
- **On-chain programs**: Per-game Anchor programs + shared Rust crate + platform config program (`solana/`)
- **Settlement**: PDA watcher (WebSocket) + 1s polling fallback, ~3-5s total latency
- **Fairness**: Backend-assisted commit-reveal with SlotHashes entropy, public verification endpoints (spec 006)
- **Auth**: JWT challenge-response via wallet signature (spec 007)
- **Profiles**: Auto-created on first auth, username with cooldown, stats aggregation (spec 008)
- **Fees**: 500 bps flat to single treasury, read from on-chain PlatformConfig

### Reward & Retention
- **Challenge engine** (spec 400) — Daily/weekly/onboarding challenges, template-based, adapter-driven
- **Points** — Earned per $ wagered, Dogpile multiplier, free to mint (pre-TGE allocation signal)
- **Loot crates** — Random drops after settled games (points crates + SOL crates from reward pool)
- **Reward pool** — Accounting-only ledger, 20% of platform fees reserved for crate economics
- **Dogpile events** — Scheduled windows with boosted point multipliers

### Growth
- **Referral system** (spec 300) — Unique codes/links, 1000 bps of fee as referral earnings, on-chain SOL claims
- **Onboarding chain** — 4-step guided first session (set nickname, play, win, try all game types)

### Backend Infrastructure
- **Async event queue** (spec 301) — Postgres-backed, polling worker, handler registry, exponential backoff
- **Event-driven reward pipeline** — `game.settled` → challenge progress + points + crate drops + pool funding
- **Admin API** — Campaign/challenge CRUD, reward config tuning, Dogpile scheduling (X-Admin-Key auth)

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
| 001 | Coinflip | Shipped, hybrid fairness |
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
