# Foundations

Cross-cutting patterns that affect every game and every package. These topics require firm decisions before major implementation work.

**Status key**: `[DECIDED]` = locked, `[OPEN]` = needs discussion, `[DRAFT]` = proposal exists but not locked.

---

## 1) Testing Methodology `[DECIDED]`

### Principles
- **Local-first**: All testing optimized for local dev experience. CI shape is deferred.
- **No blanket methodology**: Different features need different test approaches. Define strategy per feature/package, not one-size-fits-all.
- **Coverage guides, not gates**: Strive for coverage on critical paths but no hard thresholds that block work.
- **Zero mocks target**: Mocks are retired as real implementations land. No adapter layers or feature flags — delete the mock.
- **Test data is setup/teardown**: Each test seeds its own state (airdrop SOL, create accounts, deploy programs as needed). No shared fixtures.

### Layers

| Layer | Scope | Tooling | Runs Against |
|-------|-------|---------|--------------|
| Unit | State machines, payout math, fee calc, commit-reveal hashing | vitest | In-process (no chain) |
| Component | React components — structural regression | @testing-library/react + vitest (DOM snapshots) | JSDOM |
| On-chain (program) | Anchor program correctness (instructions, accounts, constraints) | bankrun | In-process simulated validator |
| Integration | Frontend ↔ chain round-trips (connect, bet, resolve, payout) | Playwright + solana-test-validator | Local validator + headless Chromium |
| Visual regression | Key pages/flows — pixel-diff to catch UI breakage | Playwright screenshot comparison | Local dev server + headless Chromium |

### Key Decisions
- **bankrun** for pure Anchor program tests: fast, in-process, no RPC server needed. Handles account creation, program deployment, slot advancement internally.
- **solana-test-validator** for anything the frontend touches: exposes localhost RPC so the browser can connect. Setup script deploys programs + seeds accounts before tests run.
- **Playwright** over Cypress: runs headless Chromium natively in devcontainers, lighter footprint.
- **DOM snapshots** (vitest) for lightweight structural regression on components.
- **Playwright screenshot comparison** for visual regression on full pages/flows — catches design and UX breakage when adding features.
- **No Storybook**: not adding a component catalog build artifact.

### Per-Feature Test Strategy (Define As We Go)
Not every test type applies to every feature. When implementing a feature, define which layers apply. Example thinking:
- Coinflip state machine → unit tests (vitest)
- Coinflip settlement → on-chain program test (bankrun)
- Coinflip full flow → integration (Playwright + local validator)
- Challenge engine handlers → integration tests (vitest + real Postgres)
- API endpoints → integration tests (Hono test client + real Postgres)

---

## 2) On-Chain Dev Loop `[DECIDED]`

### Iteration Flow
Default loop: `anchor test` (spins up local validator → deploys programs → runs tests → tears down).
No persistent local validator during regular dev. Devnet is not the iteration target.

### Program Architecture
Separate deployable programs per game + a platform program for shared on-chain state.

| Program | Type | Purpose |
|---------|------|---------|
| `solana/programs/coinflip` | Deployable | Coinflip game logic, settlement |
| `solana/programs/lordofrngs` | Deployable | Jackpot (Lord of RNGs) game logic, settlement |
| `solana/programs/closecall` | Deployable | Close Call game logic, oracle-based settlement |
| `solana/programs/platform` | Deployable | Platform settings (fee config, treasury, pause) |
| `solana/shared` | Rust lib crate (not deployed) | Escrow helpers, lifecycle state machine, timeout logic, pause controls, commit-reveal verifier, fee calculation, constants |

- Games CPI into `platform` to read settings and update player profiles after settlement.
- Each game program has its own program ID and can be deployed/upgraded independently.
- `shared` is compiled into each program at build time, not deployed on-chain. Consistency is enforced at compile time, not via CPI at runtime.
- **Lifecycle phases**: Every round follows `WAITING → ACTIVE → LOCKED → RESOLVING → SETTLED / REFUNDED`. See `docs/specs/004-shared-infrastructure/spec.md` FR-5 for invariants.
- **Settlement payouts**: Backend submits settlement transactions that reveal the secret, derive the winner, and transfer funds. Settlement is permissionless on-chain (anyone with the secret can settle), but the backend holds the secret. Timeout refunds are fully permissionless as a liveness guarantee. See `004-shared-infrastructure` FR-1.

### On-Chain State (Platform Program)
- **PlatformConfig account**: Fee BPS, treasury address, pause state, authority. Admin-updatable via `update_platform_config`.

### IDL Pipeline
1. `anchor build` → generates IDL JSON in `target/idl/` + TS types in `target/types/`
2. `scripts/sync-idl` → copies generated types into a TS package (e.g. `packages/anchor-client/`)
3. Frontend imports typed program interfaces from that package.

Script is manual (`pnpm sync-idl`), not a post-build hook.

### Mock Retirement
Mocks are deleted as real implementations land. No adapter layers, no feature flags. When a program is deployed and testable via `anchor test`, the corresponding mock goes away.

---

## 3) Wallet Strategy `[DECIDED: wallet-adapter]`

**Decision**: Use `@solana/wallet-adapter-react` in the frontend. Privy/embedded wallets evaluated post-launch.
**Ref**: `docs/DECISIONS.md` — "Normal Wallets First, Privy Later"

- Supported wallets: Phantom, Solflare, Backpack (wallet-adapter defaults)
- Connection flow: standard `useWallet()` → `connect()` → sign transaction
- Frontend is a separate project — wallet integration is their domain

---

## 4) Error Taxonomy `[DECIDED]`

### Architecture
- **Programs** define `#[error_code]` enums with numeric codes + short dev messages (for logs/debugging).
- **Shared TS package** (`packages/errors/` or within `packages/anchor-client/`) maps error codes → user-facing strings + severity + category.
- **Frontend** reads severity and picks the presentation pattern. No retry logic — user always retries manually.

### Error Code Ranges (Per Program)
Each deployable program owns a code range to avoid collisions:
- `platform`: 6000–6099
- `coinflip`: 6100–6199
- `crash`: 6200–6299
- (Reserve ranges for future games)

### Error Categories
| Source | Examples | Handling |
|--------|----------|----------|
| Program error | Insufficient funds, invalid bet, game already resolved | Map code → user message via shared package |
| Transaction failure | RPC timeout, slot expired, blockhash expired | Surface to user, manual retry |
| Wallet rejection | User cancelled in wallet popup | Informational, no retry prompt |
| Network error | WebSocket disconnect, RPC unreachable | Surface to user, manual retry |

### UX Presentation (Severity-Based)
- **Toast**: Transient/retryable errors (network timeout, RPC hiccup, slot expired)
- **Inline**: Validation errors near the action (bet too low, insufficient balance)
- **Modal**: Blocking/fatal errors needing acknowledgment (game cancelled, unexpected on-chain state)

### Principles
- English only in the current baseline. No i18n.
- User-facing copy lives client-side, never in on-chain programs.
- No automatic retry — always surface the error and let the user decide.
- Same error code can have different UX in different contexts (e.g. "insufficient funds" is inline on bet form, toast on auto-cashout failure).

### Open Questions (Planned)
- Exact error enum definitions: defined when each program is implemented.
- Toast/notification component: depends on UI package decisions.

---

## 5) Randomness & Fairness Strategy `[DECIDED: Backend-Assisted Hybrid]`

**Primary model**: Backend-assisted hybrid fairness — commit-reveal + SlotHashes entropy. Used by all shipped games. See `DECISIONS.md` 2026-03-11.

**VRF (Orao)**: Optional for future games, not default infrastructure. Orao integration was explored and reversed — VRF adds latency and a third-party dependency that isn't needed for current game types. May revisit for games requiring pre-committed randomness seeds (e.g., Crash, Slots).

### Commit-Reveal + SlotHashes (Primary)

Server proves it didn't cheat. Self-built in the shared crate (~50 lines Rust).

- **Commit phase**: Server submits `commitment = SHA256(secret)` to the Round PDA at creation.
- **Entropy capture**: SlotHashes sysvar read at join/lock time — immutable, unpredictable at commitment time.
- **Settle phase**: Server reveals `secret`. Contract verifies `SHA256(secret) == commitment`, derives result from `SHA256(secret || entropy || PDA || algorithm_ver)`.
- **No third-party dependency**. Auditable in isolation.

### Current Game × Fairness Map

See `docs/DESIGN_REFERENCE.md` for the full 8-game roadmap including planned games.

| Game | Fairness | Status |
|------|----------|--------|
| **Coinflip** | Commit-reveal + SlotHashes | Shipped |
| **Jackpot (Lord of RNGs)** | Commit-reveal + SlotHashes | Shipped |
| **Close Call** | Pyth oracle (BTC/USD) via Hermes REST | Shipped |

---

## 6) Event System `[DECIDED: async event queue + PDA watcher]`

### Architecture

Two complementary systems:

**On-chain state detection** (settlement trigger):
1. **PDA watcher**: WebSocket `onAccountChange` for instant join/settle detection
2. **Polling fallback**: 1s interval for resilience
3. Backend watches on-chain state directly via RPC subscriptions + polling (coordinator removed)

**Async event queue** (side-effects):
1. **Postgres-backed queue** (`event_queue` table): producer-consumer with `FOR UPDATE SKIP LOCKED`
2. **Handler registry**: One handler per event type, typed via `EventTypes` constants
3. **Events**: `game.settled`, `reward.pool_fund`, `points.grant`, `crate.drop`, `crate.sol_payout`, `profile.username_set`, `referral.*`
4. **Emission**: `emitEvent(tx, type, payload)` within DB transactions — atomic with the triggering write
5. **Retry**: Exponential backoff (5s → 30s → 300s), max 3 attempts, then dead-lettered

See spec 301 (async event queue) for details. Challenge engine (spec 400) is the primary consumer.

---

## 7) State Reconciliation `[DECIDED: backend authoritative for reads]`

### Principle
On-chain state is authoritative for money and settlement outcomes. Backend DB is the read model — frontend queries backend APIs, not the chain directly (except for wallet balance).

### Current Pattern
- Backend settlement workers detect on-chain state changes (PDA watcher + polling)
- Backend writes round outcomes to DB within the same transaction as event emission
- Frontend polls backend APIs for round status, challenge progress, points, etc.
- Frontend does NOT poll on-chain state for game rounds (backend is the intermediary)
- Timeout refund trigger is permissionless on-chain; backend detects and reconciles

### Frontend Concern (separate project)
Optimistic updates, polling intervals, and rollback UX are frontend decisions. Backend provides consistent API state within seconds of on-chain settlement.

---

## 8) Fee Math Source of Truth `[DECIDED: PlatformConfig]`

### Fee Structure

| Component | BPS | % | Source |
|-----------|-----|---|--------|
| **Total fee** | 500 | 5.0% | `PlatformConfig.fee_bps` on-chain |
| Treasury | 500 | 5.0% | `PlatformConfig.treasury` on-chain |

- Single flat fee to a single treasury address. No split buckets (rakeback/chest removed).
- Player sees **500 bps (5%) fee** deducted from the pot at settlement.
- Referral share: referrer earns 1000 bps of the total fee (= 50 bps of wager). See spec 300.

### Canonical Source
- **On-chain `PlatformConfig` account is canonical**. `fee_bps` and `treasury` are stored on-chain, updatable via `update_platform_config` by the platform authority.
- All game programs read `fee_bps` and `treasury` from PlatformConfig at settlement time. Per-game configs no longer store treasury.
- TS packages read fee values from the IDL / synced types — no independent TS constant definitions.

### Rules
- **Admin-configurable on-chain**: Fee is stored in `PlatformConfig.fee_bps`, changeable without redeploying programs.
- **Integer math only**: Basis points (u16), lamports (u64). No floats anywhere in the fee path.
- **Amounts use lamports functionally**: Convert SOL input to lamports at the first boundary and keep lamports in app state, APIs, persistence, tests, and on-chain instruction args. Convert back to SOL only for display.
- **Rounding**: Fee rounds down (favors player).
- **Safety cap**: `MAX_FEE_BPS: 1000` (10%) stays as a compile-time constant for future-proofing.

---

## How to Use This Doc

1. **Pick a topic** with `[OPEN]` status.
2. **Discuss** in a session — gather constraints, evaluate trade-offs.
3. **When decided**, change status to `[DECIDED: summary]` and log in `docs/DECISIONS.md`.
4. **If a draft proposal exists** but isn't locked, mark `[DRAFT]`.
5. **Keep sections concise** — implementation details go in code or per-package READMEs.
