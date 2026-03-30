# [ARCHIVED REFERENCE] RNG Utopia: Peer-to-Peer On-Chain Casino Platform

> Status: archived reference (not authoritative for active implementation).
>
> Authoritative docs: `CLAUDE.md`, `docs/WORKFLOW.md`, `docs/SCOPE.md`, `docs/DECISIONS.md`, `docs/TECH_DEBT.md`, `docs/LESSONS.md`, `docs/CONTEXT.md`.

**Bird's Eye View & Knowledge Transfer**

---

## 🎯 What is RNG Utopia?

RNG Utopia is a **peer-to-peer (P2P) on-chain casino platform built on Solana** where players compete against each other, not against the house. All game outcomes are provably fair using verifiable random functions (VRF) and commit-reveal schemes. The platform is non-custodial - all funds are escrowed in on-chain PDAs, never held by the platform.

**Think of it as:** A blockchain-native casino where players bet against each other in real-time games, with 100% RTP (Return to Player) on applicable games, and the platform only takes a transparent 3% fee for coordination and infrastructure.

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        RNG UTOPIA PLATFORM                       │
│                                                                   │
│  ┌───────────────────────┐     ┌───────────────────────────┐   │
│  │   FRONTEND (React)    │     │   SOLANA PROGRAMS (Rust)   │   │
│  │                       │     │                            │   │
│  │  - Platform Shell     │────▶│  - pool-manager           │   │
│  │  - 8 Game Apps        │     │  - vrf-consumer           │   │
│  │  - Shared UI          │     │  - game-config            │   │
│  │  - Wallet (Privy)     │     │                            │   │
│  └───────────┬───────────┘     └──────────┬─────────────────┘   │
│              │                             │                      │
│  ┌───────────▼───────────┐     ┌──────────▼─────────────────┐   │
│  │  COORDINATION SERVER  │     │   INDEXER SERVICE          │   │
│  │  (Real-time state)    │     │   (Historical data)        │   │
│  │  - WebSocket          │     │   - PostgreSQL             │   │
│  │  - Round arbiter      │     │   - Helius webhooks        │   │
│  └───────────────────────┘     └────────────────────────────┘   │
│                                                                   │
│  External:                                                        │
│  - Pyth Network (price feeds for BTC/USD)                       │
│  - VRF Provider (Switchboard/Orao - on-chain randomness)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎮 The Games (8 Total)

### 1. **Close Call** ✅ Specified
**Type:** Pari-mutuel prediction game
**Concept:** Bet on whether the next 1-minute BTC candle will close green (up) or red (down)
**Mechanics:**
- Rounds sync to minute boundaries (12:00, 12:01, 12:02...)
- During minute N, bet on candle N+1
- Winners split losers' pool proportionally to bet size
- Flexible betting (any amount, no tiers)
- DOJI handling: If close ≈ open, pool carries over to next round (jackpot builds)

**Payout Formula:**
```
winner_payout = (player_bet / winning_pool) × net_pool
net_pool = total_pool × 0.97  (3% platform fee)
```

**Price Source:** Pyth Network (on-chain BTC/USD feed)

---

### 2. **Crypto Crash Simulator** ✅ Specified
**Type:** P2P competitive crash game
**Concept:** Multiplier climbs exponentially; last player to cash out before crash wins the tier pool

**Two Modes:**
1. **P2P Mode (Primary):** Tier-based, highest cashout in each tier wins entire pool
2. **Classic Mode:** Play against house, any cashout wins (bet × multiplier)

**Mechanics:**
- **Betting Phase (20s):** Choose tier, place bet
- **Running Phase (variable):** Multiplier climbs from 1.00x exponentially
- **Cash Out:** Lock in current multiplier, winner determined after crash
- **Crashed Phase (3s):** Game ends, crash point revealed
- **Winner Reveal (3s):** Highest valid cashout in each tier wins

**Multiplier Growth:** `multiplier = 1.12 ^ elapsed_seconds`
**Crash Distribution:** Balanced for P2P (frequent high multipliers), conservative for house mode
**Boost Mechanic:** 20% of rounds get 1.5x-3.0x boost on crash point

**No Winner:** If nobody cashes out in a tier, pool carries over to next round

---

### 3. **Lord of the RNGs** ✅ Specified
**Type:** Winner-takes-all jackpot wheel
**Concept:** Spinning wheel, winner selected via on-chain VRF, takes entire tier pool (minus fees)

**Mechanics:**
- **Waiting Phase:** Players join by selecting tier
- **Countdown (60s):** Once pool reaches minimum, countdown starts
- **Spin Phase:** Wheel spins, VRF determines winner
- **Resolution (3s):** Winner announced, payout processed

**Visual:** Color-coded wheel segments, each player gets space proportional to bet size
**Fairness:** On-chain VRF proof stored and verifiable

---

### 4. **Coinflip** ✅ Specified
**Type:** 1v1 50/50 coin flip
**Concept:** Two players bet equal amounts, winner takes both (minus fees)

**Mechanics:**
- **Lobby Creation:** Player creates match, picks tier, chooses heads/tails
- **Matchmaking:** Second player joins, gets opposite side
- **Flip Phase (3s):** Coin animates, VRF determines outcome
- **Resolution (2s):** Winner announced, payout instant

**Fairness:** On-chain VRF, 50/50 odds, no house edge (3% fee only)

---

### 5-8. **Upcoming Games** 📝 Pending Specs
- **Game of Trades:** Multiplayer trading competition (buy/sell simulation)
- **Slots Utopia:** P2P slots with 3x3 grid (loyalty-gated)
- **Chart the Course:** Price trajectory prediction
- **Tug of Earn:** Team-based tap battle

---

## 💰 Economics & Fee Structure

### Platform Fee: 3%
Collected from all game pools, allocated as:
- **2.2%** → Platform revenue (treasury PDA)
- **0.5%** → Rakeback pool (distributed daily to active players)
- **0.3%** → Referral rewards

### Betting Tiers
| Tier | Amount | Use Case |
|------|--------|----------|
| Iron | 0.005 SOL | Casual play (~$1) |
| Bronze | 0.01 SOL | Small bets (~$2) |
| Silver | 0.1 SOL | Mid-tier (~$20) |
| Gold | 0.25 SOL | High rollers (~$50) |
| Platinum | 0.5 SOL | Serious players (~$100) |
| Diamond | 1 SOL | Whales (~$200) |

**Note:** Close Call uses flexible betting (any amount, no tiers)

### Target Metrics
- **Monthly GGR:** $500,000 by March
- **Presale Raise:** $2,000,000
- **100% RTP:** Players get full pool (minus 3% fee), no house edge on P2P games

---

## 🔐 Provable Fairness System

RNG Utopia uses two approved randomness patterns depending on game requirements:

### Pattern 1: Commit-Reveal + Future Chain Seed
**Used by:** Crash Simulator (predetermined outcomes)

```
1. Before betting: Server generates serverSeed, publishes commitment = sha256(serverSeed)
2. During betting: Players place bets (server can't change serverSeed)
3. At round start: Capture publicSeed from future Solana blockhash
4. After round: Server reveals serverSeed
5. Outcome: HMAC-SHA256(serverSeed, publicSeed || roundId || gameId)
6. Verification: Anyone can verify sha256(serverSeed) == commitment
```

**Why this works:**
- Server commits BEFORE knowing publicSeed → can't manipulate
- publicSeed from future block → server can't predict during betting
- Commitment public → server can't change serverSeed after commitment

### Pattern 2: On-Chain VRF
**Used by:** Lord of the RNGs, Coinflip (requires on-chain winner selection)

```
1. Round enters resolution
2. Program requests VRF (Switchboard/Orao)
3. VRF provider fulfills with cryptographic proof
4. Program verifies proof and stores result on-chain
5. Winner selected using VRF output
```

**VRF Requirements:**
- On-chain verifiability
- Sub-second latency (real-time games)
- Cost efficiency at scale
- Providers under evaluation: Switchboard VRF, Orao Network

---

## 🏛️ Custody Model: Non-Custodial

**Key Principle:** Platform NEVER holds user balances. All funds go directly on-chain into escrow PDAs.

### Fund Flow

**Entry:**
```
1. Player clicks to join round
2. Frontend constructs transaction:
   - Transfer SOL to round-specific escrow PDA
   - Register player in pool state
3. Player signs transaction (wallet)
4. Pool-manager program accepts entry atomically
5. Player's entry now escrowed on-chain
```

**Payout:**
```
1. Round resolves (outcome determined)
2. Settlement transaction:
   - Pool-manager calculates payouts
   - Fees → treasury PDA
   - Winnings → winner wallets directly
3. All transfers atomic in single transaction
```

**UX Optimization (without custodial balances):**
- Batched entries (multiple bets in one tx)
- Session keys via Privy (user-controlled delegation)
- Transaction sponsorship (platform pays gas for small bets)
- Pre-approved limits (user pre-authorizes max bet per session)

---

## 📦 Monorepo Structure

```
rng-utopia/
├── apps/                          # Frontend applications
│   ├── platform/                  # Main shell (routing, layout, state)
│   ├── close-call/                # Close Call game app
│   ├── crash-simulator/           # Crash game app
│   ├── lord-of-rngs/              # Wheel game app
│   ├── coinflip/                  # Coinflip game app
│   ├── game-of-trades/            # Trading competition
│   ├── slots-utopia/              # P2P slots
│   ├── chart-the-course/          # Price trajectory
│   └── tug-of-earn/               # Tap battle
│
├── packages/                      # Shared client-side libraries
│   ├── ui/                        # Design system, reusable components
│   ├── game-engine/               # Client-side game state (UI only, NOT authoritative)
│   ├── fairness/                  # Provable fairness verification utilities
│   ├── wallet/                    # Privy integration, transaction helpers
│   ├── vrf/                       # VRF client integration
│   ├── price-feeds/               # Real-time price data (Pyth)
│   └── config/                    # Shared config (eslint, tsconfig)
│
├── solana/                        # Solana programs (Anchor framework)
│   ├── pool-manager/              # Core: manages pools, entries, payouts
│   ├── vrf-consumer/              # VRF request and fulfillment
│   └── game-config/               # Per-game configuration and controls
│
├── crates/                        # Shared Rust libraries
│   ├── payout-math/               # Payout calculation invariants
│   └── fairness-core/             # Commit-reveal and verification logic
│
└── services/                      # Off-chain services
    ├── coordinator/               # Real-time game coordination (Node.js/Rust)
    └── indexer/                   # On-chain event indexing (Postgres)
```

**Stats:**
- ~189 TypeScript/TSX files
- pnpm workspace monorepo
- Turborepo for build orchestration

---

## 🧩 Big Components Explained

### 1. **Frontend Apps** (`apps/`)
Each game is a separate Vite + React + TypeScript app with:
- Game-specific UI and animations
- WebSocket connection to coordinator
- Transaction construction and signing
- Client-side state (cosmetic only, NOT authoritative)

**Platform Shell** orchestrates:
- Routing between games
- Shared layout (header, sidebar)
- Wallet connection (Privy)
- Global state (user profile, balances)

---

### 2. **Solana Programs** (`solana/`)

#### **pool-manager** (Core)
Manages lifecycle of game pools:
- Create pool for game round (PDA: `[game_id, tier, round_id]`)
- Accept player entries (idempotent bet IDs)
- Lock pool when round starts
- Distribute winnings based on outcome
- Handle refunds for void rounds
- Prize pool carryover (no winner scenarios)
- Single-claim enforcement

**Account Structure:**
```rust
Pool PDA: seeds = [game_id, tier, round_id]
├── state: PoolState (betting, locked, settled)
├── total_entries: u64
├── entries: Vec<PlayerEntry>
├── outcome: Option<Outcome>
└── settlement_tx: Option<Signature>

PlayerEntry PDA: seeds = [round_id, player_pubkey, tier]
├── amount: u64
├── claimed: bool
└── payout: Option<u64>
```

#### **vrf-consumer**
- Request VRF for specific round
- Store and verify VRF proofs
- Emit events when randomness fulfilled

#### **game-config**
- Pause/unpause games (emergency stop)
- Configure limits (min/max bet, fee bounds)
- Allowed assets and VRF providers
- Multisig authority for config updates

**Hard-coded safety limits:**
- `MAX_FEE_BPS = 1000` (10% max, cannot exceed)
- `MAX_PLAYERS_PER_ROUND = 10000`
- `MAX_BET_LAMPORTS = 1_000_000_000_000` (1000 SOL absolute max)

---

### 3. **Shared Packages** (`packages/`)

#### **packages/game-engine**
**CRITICAL:** UI state management ONLY. Not authoritative for settlement.

```typescript
// ALLOWED: UI state machines and prediction
class CrashGameState {
  phase: 'betting' | 'running' | 'crashed' | 'reveal';
  multiplier: number;  // Client-predicted, cosmetic only

  predictMultiplier(elapsedMs: number): number; // For display
}

// ALLOWED: Helpers for constructing instructions
function buildEntryInstruction(...): TransactionInstruction;
function buildCashoutInstruction(...): TransactionInstruction;

// NOT ALLOWED: Settlement logic (happens on-chain in pool-manager)
```

#### **packages/fairness**
Client-side verification utilities:
```typescript
verifyCommitment(serverSeed, commitment): boolean;
computeCrashPoint(serverSeed, publicSeed, roundId): number;
verifyVrfProof(proof, result): boolean;
verifyRound(round): VerificationResult;
```

#### **packages/ui**
Reusable components:
- Core: Buttons, inputs, modals, cards
- Charts: Candlestick (Close Call), multiplier displays (Crash)
- Game primitives: Countdown timers, tier grids, bet controls (1/2, x2, MAX)
- Animations: Wheel spin, coin flip, crash visuals
- Feedback: Win/loss overlays, confetti, payout displays

#### **packages/wallet**
Privy integration:
- Wallet connection/disconnection
- Transaction signing
- Balance queries
- Session key management

#### **packages/price-feeds**
Real-time price data:
- WebSocket to price providers
- Pyth Network integration (on-chain verification)
- BTC/USD feed for Close Call (1-minute candles)
- Candle boundary synchronization

---

### 4. **Rust Crates** (`crates/`)

#### **crates/payout-math**
Shared payout logic used by pool-manager:
```rust
calculate_parimutuel_payout(player_bet, winning_pool, total_pool, fee_bps) -> u64;
calculate_winner_payout(total_pool, fee_bps) -> u64;
verify_payout_invariant(payouts, fees, total_pool) -> bool;
```

**Invariant:** `total_payouts + fees == total_pool` (always)

#### **crates/fairness-core**
Commit-reveal and verification:
```rust
compute_crash_point(...) -> f64;
verify_commitment(...) -> bool;
hash_to_crash_point(hash: &[u8; 32]) -> f64;
```

---

### 5. **Coordination Server** (`services/coordinator/`)
For real-time multiplayer games:
- Maintains authoritative game state (off-chain, cosmetic)
- Accepts player actions with signature verification
- Issues monotonic sequence numbers (seqNo)
- Broadcasts state updates via WebSocket
- Triggers on-chain settlement at round end
- **Round Arbiter:** Resolves timing disputes with server timestamps

**WebSocket Protocol:**
```typescript
// Client → Server
interface ClientMessage {
  type: 'join' | 'bet' | 'cashout' | 'subscribe';
  payload: any;
  nonce: string;         // Prevents replay
  expiresAt: number;     // Timestamp validity
  signature: string;     // Player signature
}

// Server → Client
interface ServerMessage {
  type: 'state' | 'event' | 'error' | 'ack';
  seqNo: number;         // Monotonic sequence
  timestamp: number;     // Arbiter timestamp
  payload: any;
}
```

---

### 6. **Indexer Service** (`services/indexer/`)
Builds queryable views from on-chain data:
- Subscribes to Solana via Helius webhooks or Geyser plugin
- Stores historical data in PostgreSQL
- Provides fast APIs for:
  - Round history (all games)
  - Player statistics
  - Leaderboards (daily, all-time)
  - Pool states (current and historical)
  - Fee collection records
  - Fairness verification data (commitments, reveals)

**API Endpoints:**
```
GET /rounds/:gameId/:roundId
GET /rounds/:gameId?limit=50&offset=0
GET /players/:playerId/stats
GET /players/:playerId/history
GET /leaderboard/daily
GET /leaderboard/alltime
GET /fairness/:roundId/verify
```

---

## 🎲 Source of Truth Rules

| Data Type | Source of Truth | Why |
|-----------|-----------------|-----|
| User funds | On-chain (wallet + escrow PDAs) | Trustless custody |
| Pool state | On-chain (pool-manager PDAs) | Financial settlement |
| Round outcomes | On-chain (settlement tx) | Auditability |
| Fee collection | On-chain (treasury PDA) | Transparency |
| Game state (live) | Coordination server | Low latency, UX |
| User profiles | Off-chain DB | Non-financial |
| Leaderboards | Indexer DB (derived) | Recomputable from chain |
| Round history | Indexer DB (derived) | Recomputable from chain |

**Rule:** Anything involving money settlement MUST be on-chain. Derived views can be off-chain but must be recomputable from on-chain data.

---

## ⚡ Event Ordering & Idempotency

### Idempotency Enforcement

Every mutating action has deterministic IDs:
```typescript
betId = hash(roundId, playerId, tier)        // Prevents double-betting
settlementId = roundId                       // One settlement per round
claimId = hash(roundId, playerId)            // One claim per player per round
```

**On-chain enforcement:**
```rust
#[account]
pub struct PlayerEntry {
    pub round_id: u64,
    pub player: Pubkey,
    pub tier: u8,
    pub amount: u64,
    pub claimed: bool,  // Prevents double-claim
}

// Entry instruction checks PDA doesn't exist (prevents double-bet)
// Claim instruction checks claimed == false, then sets to true
```

### Replay Protection

All signed requests include:
- `nonce`: Unique per request (UUID or incrementing counter)
- `expiresAt`: Timestamp after which request is invalid
- Server validates signature + freshness before processing
- Used nonces tracked with TTL cleanup

### Tie-Break Policy (Time-Sensitive Games)

For games like Crash where timing matters:
1. **Server authoritative:** Arbiter timestamp is final
2. **Sequence-based:** Within same millisecond, lower seqNo wins
3. **Deterministic:** Same events → same winner every time
4. **No latency compensation:** Fairness through transparency, not adjustment

---

## 🔄 Rewards Distribution

### Rakeback (0.5% of fees)

**Accumulation (On-Chain):**
- Each settlement deposits 0.5% to Rakeback Pool PDA
- Pool accumulates throughout the day

**Distribution (Daily, Off-Chain Triggered):**
```
1. At 00:00 UTC, snapshot leaderboard from indexer
2. Calculate share: (player_points / total_points) × pool
3. Execute distribution transaction (batched if needed)
4. Clear daily points, reset pool
```

**Anti-Double-Credit:**
- Distribution transaction includes `distribution_id = date_string`
- PDA tracks last distribution ID
- Instruction fails if already distributed

### Referral (0.3% of fees)

**Accumulation:**
- 0.3% allocated per round
- Tracked per referee in off-chain DB
- Periodically reconciled to on-chain

**Distribution:**
- Real-time credit to off-chain balance
- Claimable on-chain from Referral Pool PDA
- Claim record prevents double-claim

**Anti-Sybil:**
- Minimum wagering threshold before referral rewards activate
- Self-referral detection (same device/IP)
- Suspicious pattern flagging for manual review
- KYC requirement for large payouts (threshold TBD)

---

## 🔒 Operational Safety Controls

### On-Chain Controls (pool-manager)

```rust
#[account]
pub struct GameConfig {
    pub game_id: String,
    pub paused: bool,           // Emergency pause
    pub min_bet: u64,
    pub max_bet: u64,
    pub fee_bps: u16,           // Max 1000 (10%)
    pub allowed_tiers: [bool; 6],
    pub authority: Pubkey,      // Multisig
    pub version: u8,
}

// Instructions (all require multisig authority)
pub fn pause(...) -> Result<()>;
pub fn unpause(...) -> Result<()>;
pub fn update_config(...) -> Result<()>;
pub fn emergency_refund(...) -> Result<()>;
```

### Off-Chain Controls (Coordinator)

**Rate Limiting:**
```typescript
{
  perWallet: { window: '1m', max: 100 },
  perIP: { window: '1m', max: 500 },
  perDevice: { window: '1m', max: 200 },
  global: { window: '1s', max: 10000 },
}
```

**Anomaly Detection:**
- Unusually high join/cashout rate from single wallet
- Repeated failed transaction patterns
- Suspicious "near-crash" cashout clusters (bot signals)
- Circular referral patterns

**Circuit Breakers:**
- Auto-pause if settlement failures exceed threshold
- Auto-pause if anomaly score exceeds threshold
- Alert on-call team for manual review

---

## 🧪 Testing Strategy

### On-Chain Program Tests

**Invariant Tests:**
```rust
test_payout_invariant()               // total_payouts + fees == total_pool
test_cannot_pay_more_than_pool()      // Sum payouts <= pool - fees
test_fee_within_bounds()              // fee_bps <= MAX_FEE_BPS
test_single_claim()                   // Second claim fails
test_single_settlement()              // Second settlement fails
```

**Fairness Tests:**
```rust
test_commitment_verification()        // sha256(server_seed) == commitment
test_crash_point_deterministic()      // Same inputs → same crash point
test_vrf_proof_verification()         // Invalid proof rejected
```

**Adversarial Tests:**
```rust
test_double_entry_fails()             // Same player, same round → error
test_late_entry_fails()               // Entry after lock → error
test_unauthorized_settlement_fails()  // Wrong authority → error
test_overflow_protection()            // Large amounts don't overflow
```

### Off-Chain Tests

**Load Tests:**
- 5k concurrent WebSocket connections
- 1k actions/second sustained
- Measure latency percentiles (p50, p95, p99)

**Chaos Tests:**
- Network partition recovery
- Coordinator restart during active round
- RPC provider failover

---

## 🚀 Tech Stack Summary

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18+, TypeScript 5+, Vite 5+ |
| **Blockchain** | Solana (mainnet-beta), Anchor framework |
| **Wallet** | Privy (embedded wallets + session keys) |
| **Randomness** | Switchboard VRF or Orao (on-chain) |
| **Price Feeds** | Pyth Network (on-chain BTC/USD) |
| **Monorepo** | pnpm workspaces, Turborepo |
| **Backend** | Node.js or Rust (coordinator) |
| **Database** | PostgreSQL (indexer) |
| **Real-time** | WebSocket (custom or managed) |
| **Caching** | Redis (rate limiting) |

---

## 📈 Project Status

**Current Phase:** Pre-development, documentation phase

**Completed:**
- ✅ Full architecture specification
- ✅ 4 games fully specified (Close Call, Crash, Lord of RNGs, Coinflip)
- ✅ Provable fairness system designed
- ✅ Non-custodial custody model defined
- ✅ Monorepo structure established
- ✅ On-chain program architecture designed

**Pending:**
- 📝 4 games pending specs (Game of Trades, Slots, Chart the Course, Tug of Earn)
- 🚧 Solana program implementation
- 🚧 Frontend implementation
- 🚧 Coordinator service implementation
- 🚧 Indexer service implementation

**Roadmap:**
1. **Phase 1:** MVP with one game (likely Close Call or Crash) on Solana devnet
2. **Phase 2:** Additional games and platform enhancements
3. **Phase 3:** Token launch and presale ($2M target)
4. **Phase 4:** Multi-chain expansion

---

## 🎓 Knowledge Transfer Tips

### For New Developers:
1. **Start with ARCHITECTURE.md:** Read the full 1000-line architecture doc for deep understanding
2. **Understand the flow:** Pick one game (Close Call is simplest), trace a bet from frontend → on-chain → settlement
3. **Non-custodial is key:** All funds go to PDAs, never platform wallets
4. **Two sources of truth:** On-chain for money, off-chain for UX/speed
5. **Provable fairness:** Every game must document how to verify outcomes

### For Product/Designers:
1. **P2P mindset:** Players compete, not playing against house
2. **100% RTP:** We take 3% fee, not house edge
3. **Tier system:** 6 tiers isolate pools (except Close Call which uses flexible betting)
4. **Real-time matters:** Crash and Close Call have strict timing requirements
5. **Fairness transparency:** Users must be able to verify any round

### For Smart Contract Auditors:
1. **Focus on pool-manager:** Core program handling all financial settlement
2. **Check invariants:** `total_payouts + fees == total_pool` (always)
3. **Idempotency critical:** Double-bet, double-claim, double-settlement must be impossible
4. **Overflow protection:** Large bet amounts must not cause overflows
5. **Authority checks:** Only multisig can pause, update config, refund

### For Operators/DevOps:
1. **RPC provider critical:** Helius or Triton for reliability
2. **WebSocket scale:** Expect 5k+ concurrent connections at scale
3. **Monitoring:** Track settlement success rate, anomaly scores, latency
4. **Circuit breakers:** Auto-pause on anomalies, alert on-call team
5. **Indexer consistency:** Always verify financial queries against on-chain state

---

## 🔮 Open Research Items

1. **VRF Provider Selection:** Switchboard vs Orao - latency, cost, reliability comparison
2. **Indexer Architecture:** Helius webhooks vs custom Geyser plugin
3. **Session Key Implementation:** Privy session authority patterns, security implications
4. **Cross-Region Fairness:** Geographic distribution of coordination servers
5. **Scale Testing:** Maximum concurrent players per tier, compute limits for large payouts

---

## 📚 Key Documentation Files

Must-read for deep understanding:
- `ARCHITECTURE.md` - Full technical architecture (28KB, 1000 lines)
- `docs/PRODUCT.md` - Product overview and game reference
- `docs/PLATFORM.md` - Platform-wide systems and features
- `docs/CRASH.md` - Crypto Crash Simulator specification
- `docs/CLOSE_CALL.md` - Close Call specification
- `docs/LORD_OF_THE_RNGS.md` - Lord of the RNGs specification
- `docs/COINFLIP.md` - Coinflip specification

---

## 🎯 TL;DR

**RNG Utopia is a P2P on-chain casino on Solana where:**
1. Players compete against each other (not the house)
2. All funds escrowed in on-chain PDAs (non-custodial)
3. Outcomes provably fair via VRF + commit-reveal
4. Platform takes 3% fee, distributes via rakeback + referrals
5. 8 games total (4 fully specified, 4 pending)
6. Built as pnpm monorepo with React frontend + Anchor programs

**Architecture:** Non-custodial, on-chain settlement, off-chain coordination for UX

**Status:** Pre-development, documentation complete for core games

**Philosophy:** Transparency over adjustment, fairness through verifiability, 100% RTP on P2P games
