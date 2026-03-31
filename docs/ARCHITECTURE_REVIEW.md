# Architecture Review — Honest Assessment

**Date**: 2026-03-28
**Scope**: Full codebase — Solana programs, frontend, backend, infra, monorepo
**Method**: Deep read of source, not just file names

> **Note (2026-03-30)**: Written pre-split. Frontend assessment applies to the old monorepo, not current structure (frontend is now a separate repo). Turbo was also removed post-split.

---

## TL;DR

The on-chain programs and backend are solid — well-structured, properly separated, production-aware. The frontend is the weak link: 3,400 lines of context files acting as god objects, 3,440 lines of mock simulation code for unbuilt games, 17,000 lines of monolithic CSS, and heavy copy-paste between game features. The monorepo setup and shared packages are clean. The project is architecturally sound at the foundation level but has accumulated significant frontend debt from shipping features fast.

**Verdict**: Good bones, messy skin.

---

## Scorecard

| Layer | Rating | One-line |
|-------|--------|----------|
| Solana Programs | **8/10** | Clean Anchor usage, strong shared lib, proper commit-reveal |
| Backend | **8/10** | Type-safe DB, robust settlement worker, clean Hono routes |
| Shared Packages | **9/10** | Best part of the codebase — clean boundaries, no circular deps |
| Frontend Architecture | **5/10** | God-object contexts, massive duplication, no abstraction layer |
| CSS/Styling | **3/10** | 17K-line monolith, no scoping, no design system |
| Build/Tooling | **8/10** | Professional Vite config, Turbo pipeline, defensive scripts |
| Documentation | **8/10** | Thorough specs, decision logs, architecture docs |
| Test Coverage | **6/10** | Good program unit tests, backend endpoint tests. FE E2E exists but gaps |

**Overall: 6.5/10** — Above average for a pre-launch project, but the frontend needs a reckoning before scaling to more games.

---

## What's Genuinely Good

### 1. Shared Rust Library (`solana/shared/`) — Best Code in the Repo

878 lines covering escrow, fees, commit-reveal, entropy, lifecycle, pause, timeout, wager validation. Every module has unit tests. No unsafe code. No duplication. Every program imports from here instead of rolling its own.

This is how shared code should work. The `escrow.rs` (three transfer patterns), `lifecycle.rs` (state machine with explicit transition rules), and `fairness.rs` (O(1) SlotHashes lookup) are all well-designed. The fee system reads from an on-chain PlatformConfig at settlement time — runtime-configurable, not hardcoded.

**Could it be better?** Barely. Maybe move CloseCall's timeout constants into the shared `timeout.rs`, but that's nitpicking.

### 2. Backend Settlement Worker — Properly Paranoid

The commit-reveal flow is the hardest thing to get right in this system, and it's done well:

- **PDA watcher** (WebSocket `onAccountChange`) for instant join detection
- **Polling fallback** (1s cycle) in case WebSocket drops
- **Exponential backoff retry** with `settle_attempts` tracking in DB
- **Idempotent operations** — duplicate settlement attempts are safe
- **Audit trail** — `operator_events` table logs every phase transition

The separation between discovery (`settlement.ts`), transaction building (`settle-tx.ts`), and retry logic (`retry.ts`) is clean. The 918-line `settle-tx.ts` is getting large but the code inside it is straightforward.

### 3. Database Layer (`db.ts`) — Type-Safe Without an ORM

974 lines of hand-written, typed SQL methods. No Prisma, no Drizzle, no abstraction layer — just a `postgres` driver with explicit types on every query. This is a legitimate choice for a project this size: you get full control, no migration headaches from ORM schema drift, and the queries are readable.

Migration system is professional: versioned SQL files, idempotent execution, `_migrations` tracking table.

### 4. Package Boundaries — Textbook Monorepo

```
packages/
  anchor-client/  → Generated IDL types (no hand-written code)
  fairness/       → Pure crypto functions (verify commitment, compute crash point)
  game-engine/    → Client-side game state (React-facing)
  wallet/         → Multi-backend wallet adapter (mock/real/test)
  ui/             → Shared React components
  price-feeds/    → Pyth oracle wrapper
  config/         → Shared ESLint + TypeScript configs
```

No circular dependencies. Each package has explicit exports. Backend only imports what it needs. This is the cleanest part of the codebase.

### 5. Deploy Scripts — Actually Defensive

`deploy-devnet.sh` (208 lines) does build → deploy → copy IDL → init config → verify ID sync. Has a `--fresh` flag for struct layout changes (closes program, new keypair). **Refuses `--fresh` on mainnet.** Pre-commit hooks verify program ID consistency across Anchor.toml, `declare_id!()`, and IDL JSON.

---

## What's Genuinely Bad

### 1. Frontend Contexts Are God Objects

The 8 game contexts total **3,374 lines** and each one mixes:

- **State** (14 useState calls in CoinflipContext alone)
- **Polling logic** (manual interval management with refs, race condition guards)
- **Transaction building and sending** (auth retry, error parsing)
- **Animation timers** (countdown refs, flip animation refs)
- **URL sync** (deep-link state management)
- **Auth flow** (token refresh, 401 retry)

CoinflipContext is 734 lines. CloseCallContext is 681. These aren't contexts — they're monolithic controllers pretending to be React hooks.

**What should have been done**: Extract reusable hooks:
- `useGamePolling(fetchFn, interval)` — shared polling with race-condition guard
- `useAuthenticatedAction(actionFn)` — wrap any action with auth retry
- `useDeepLinkSync(matchId)` — URL ↔ state sync

Each context would shrink to ~150 lines of game-specific logic.

### 2. 3,440 Lines of Mock Simulation Code — Dead Weight

Five games that aren't implemented on-chain have full mock simulation engines:

| File | Lines |
|------|-------|
| game-of-trades/mock-simulation.ts | 945 |
| boss-raid/mock-simulation.ts | 703 |
| crypto-crash/mock-simulation.ts | 672 |
| player-profile/mock-simulation.ts | 569 |
| quests/mock-simulation.ts | 551 |

These simulate game state, fake RNG, animate results — all for games that don't exist yet. This is **3,440 lines of throwaway code** that:
- Ships in the production bundle
- Creates a false sense of "working features"
- Will be entirely replaced when real programs are built
- Adds maintenance burden (imports break when shared types change)

**What should have been done**: Either don't build the frontend until the program exists, or use a single generic mock provider (50 lines max) that returns canned responses.

### 3. CSS is a 17,161-Line Monolith

One file. `index.css`. Seventeen thousand lines. No modules, no scoping, no design tokens, no responsive breakpoints. Every game's styles live in the same global namespace with BEM-ish class names:

```css
.coinflip-sidebar__section { ... }
.lotr-sidebar { ... }
.close-call-history-result { ... }
.boss-raid-modal__damage-feed { ... }
```

Adding a new game means adding 200+ new classes to this file. Changing a color means grep-and-pray. There's no design system — spacing, colors, typography are ad-hoc per component.

**What should have been done**: CSS Modules (zero config with Vite), or Tailwind, or even just one `.css` file per feature directory. Anything but this.

### 4. Game Feature Code Is Copy-Paste

Each game reimplements the same patterns:

**Chain utilities** (coinflip: 664 lines, lord-of-rngs: 763 lines):
- Program instance creation
- PDA derivation
- Account fetching
- Transaction building
- On-chain → UI state mapping

**Page components** (200-450 lines each):
- Sidebar JSX (50+ lines of wager input, buttons, stats)
- History entry formatting
- Loading states
- Button handlers

The three implemented games (coinflip, lord-of-rngs, close-call) share maybe 70% of their chain.ts logic. There's no generic game adapter, no shared transaction builder, no template.

**What should have been done**: A `createGameAdapter<TMatch, TConfig>()` factory that takes game-specific config (program ID, PDA seeds, account decoders) and returns standard `fetchMatches()`, `buildCreateTx()`, `buildJoinTx()` functions. Each game's chain.ts shrinks to ~100 lines of config.

### 5. No Production Observability

- No error tracking (Sentry, LogRocket)
- No analytics (game joins, transaction success rate, drop-off points)
- No backend metrics (Prometheus, OpenTelemetry)
- No alerting on settlement failures
- Console.log is the monitoring strategy

The backend has an `operator_events` table (good), but nothing reads from it automatically. If settlement breaks at 3am, nobody knows until a user complains.

---

## What Could Have Been Done Differently

### Architecture Decisions That Were Right

1. **Commit-reveal over VRF** — Simpler, cheaper, no oracle dependency. Correct for V1.
2. **Hono over Express** — Lightweight, type-safe, modern. Good call.
3. **No ORM** — At this scale, raw SQL with types is faster to iterate on than fighting Prisma migrations.
4. **Anchor with shared lib** — The right abstraction level for Solana programs.
5. **Feature-based frontend structure** — The directory layout is correct even if the code inside isn't.
6. **pnpm + Turbo** — Industry standard monorepo tooling. No complaints.

### Architecture Decisions That Were Wrong

1. **Building frontends for 8 games when only 3 have programs** — 5 features are pure mock code. Should have shipped 3 polished games instead of 8 half-baked ones. The mock simulation code creates an illusion of progress while adding real maintenance cost.

2. **Single CSS file from day one** — This was probably expedient at 500 lines. At 17,000 lines it's a liability. Should have started with CSS Modules or component-scoped styles. Migrating now is a multi-day effort.

3. **No shared game abstraction layer** — Each game was built as a standalone island. This made sense for the first game. By game three, the pattern was clear and should have been extracted. Now there are three 600+ line chain.ts files that are 70% identical.

4. **Contexts as controllers** — React Context is for dependency injection (providing values down the tree), not for business logic orchestration. The game contexts should have been custom hooks + a thin context wrapper. This is a common React anti-pattern and it makes the code hard to test, hard to split, and hard to reason about.

5. **No backend-for-frontend (BFF) pattern** — The frontend builds transactions, manages RPC connections, decodes accounts, and handles retry logic. A thin BFF layer that returns "here's your pre-built transaction, sign and send it" would simplify the frontend dramatically and centralize RPC management. The backend already does this for `create` (returns a partially-signed tx) but not for `join` or other actions.

### Things That Are Fine But Not Ideal

1. **`settle-tx.ts` at 918 lines** — Works, but mixing coinflip/lord/closecall settlement in one file means touching all games when changing one. Splitting by game would be cleaner but isn't urgent.

2. **`db.ts` at 974 lines** — Monolith, but a useful one. Every DB operation is in one file, easy to grep. The cost of splitting (breaking transaction atomicity, managing imports) may not be worth the benefit yet.

3. **In-memory rate limiting** — Works for a single backend instance. Will need Redis if/when you scale horizontally. Not a problem today.

4. **No integration tests against real Solana RPC** — Program tests use bankrun (fast, correct), backend tests mock the chain. There's a gap: the glue between backend settlement and on-chain state is only tested via manual devnet runs. An automated devnet integration test (even running weekly) would catch drift.

---

## The Numbers

| Metric | Value | Assessment |
|--------|-------|------------|
| Total frontend TS/TSX | 25,939 lines | ~13% is mock simulation code |
| Total CSS | 17,161 lines | Single file, no scoping |
| Context files | 3,374 lines | Should be ~1,200 after extraction |
| Mock simulations | 3,440 lines | Should be 0 (or behind feature flag) |
| Chain utilities | 1,427 lines (2 games) | Should be ~400 with generic adapter |
| Backend source | ~46 files | Clean, well-scoped |
| Solana programs | ~2,064 lines (shared + 5 programs) | Lean and correct |
| Deploy scripts | ~300 lines | Professional quality |
| Database migrations | 11 files | Proper versioning |

---

## Priority Recommendations

### Do Now (Before Adding More Games)

1. **Extract shared hooks from contexts** — `useGamePolling`, `useAuthenticatedAction`, `useDeepLinkSync`. This is a 1-2 day effort that cuts each context by 60%.

2. **Kill or feature-flag mock games** — Remove boss-raid, crypto-crash, game-of-trades, quests, player-profile mock simulations from the production build. They're not real features. Show a "Coming Soon" card instead.

3. **Split CSS by feature** — Move each feature's styles into `features/<game>/styles.css` and import them locally. Doesn't require CSS Modules migration — just file splitting. 1 day effort.

### Do Before Mainnet

4. **Build a game adapter factory** — Generic `createGameAdapter<T>()` that encapsulates PDA derivation, account fetching, tx building. Each new game is 100 lines of config instead of 700 lines of copypaste.

5. **Add error tracking** — Sentry or equivalent. You need to know when settlement fails, when transactions error, when users hit unexpected states. Console.log isn't monitoring.

6. **Add basic metrics** — Settlement latency, tx success rate, active users. Even a simple `/metrics` endpoint that Grafana can scrape.

7. **Split `settle-tx.ts` by game** — Before adding game 4, split settlement logic so each game's settlement is independently modifiable.

### Do Eventually

8. **Evaluate a state management library** — React Context works for 3 games. At 8+ concurrent games with shared state (balance, session, notifications), Zustand or Jotai would be cleaner. Not urgent.

9. **Consider a BFF layer** — Move transaction building entirely to the backend. Frontend just signs. Reduces frontend complexity significantly and centralizes RPC connection management.

10. **CSS design system** — Define spacing scale, color tokens, typography scale. Apply globally. Prevents the current drift where every component picks its own values.

---

## What I'd Keep Exactly As-Is

- The shared Rust library architecture
- The commit-reveal implementation
- The Hono backend structure
- The database layer approach (typed SQL, no ORM)
- The package boundary design
- The deploy scripts and pre-commit hooks
- The SessionContext (well-built auth flow)
- The `useSendAndConfirm` hook (handles edge cases correctly)
- The Turbo/pnpm monorepo setup

These are good engineering decisions that don't need second-guessing.

---

## Bottom Line

The infrastructure and backend are built by someone who knows what they're doing. The Solana programs are clean, the settlement flow is robust, the shared code is reusable. The frontend got ahead of itself — building UIs for 8 games when 3 exist, accumulating copy-paste debt, and never pausing to extract patterns. The CSS situation is a ticking time bomb.

The fix isn't a rewrite. It's a focused week of extraction: shared hooks, game adapter factory, CSS splitting, mock code removal. The architecture supports it — the feature-based directory structure is already correct. The code inside just needs to honor the boundaries the directories implied.
