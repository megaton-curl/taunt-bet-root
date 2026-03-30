# [ARCHIVED REFERENCE] RNG Utopia Quick Reference

> Status: archived reference (not authoritative for active implementation).
>
> Authoritative docs: `CLAUDE.md`, `docs/WORKFLOW.md`, `docs/SCOPE.md`, `docs/DECISIONS.md`, `docs/TECH_DEBT.md`, `docs/LESSONS.md`, `docs/CONTEXT.md`.

## One-Liner
**Peer-to-peer on-chain casino on Solana where players compete against each other with provably fair outcomes using VRF and commit-reveal schemes.**

---

## The 8 Games

| Game | Type | Concept | Status |
|------|------|---------|--------|
| **Close Call** | Pari-mutuel | Bet on next 1-min BTC candle (green/red) | ✅ Specified |
| **Crypto Crash** | P2P competitive | Last to cash out before crash wins tier pool | ✅ Specified |
| **Lord of RNGs** | Winner-takes-all | Wheel spin, VRF selects winner | ✅ Specified |
| **Coinflip** | 1v1 50/50 | Two players, winner takes both | ✅ Specified |
| **Game of Trades** | Multiplayer trading | Buy/sell simulation | 📝 Pending |
| **Slots Utopia** | P2P slots | 3x3 grid, loyalty-gated | 📝 Pending |
| **Chart the Course** | Price prediction | Trajectory prediction | 📝 Pending |
| **Tug of Earn** | Team battle | Tap battle | 📝 Pending |

---

## Game Mechanics Cheat Sheet

### Close Call
```
Duration: 1-minute rounds (synced to minute boundaries)
Betting: During minute N, bet on candle N+1
Options: GREEN (close > open) or RED (close < open)
Payout: Pari-mutuel (winners split losers' pool)
Tiers: Flexible betting (any amount)
DOJI: Pool carries over if close ≈ open
Fairness: Pyth Network on-chain price feed
```

### Crypto Crash
```
Phases: Betting (20s) → Running (variable) → Crashed (3s) → Winner Reveal (3s)
Multiplier: Starts at 1.00x, grows exponentially (1.12 ^ elapsed_seconds)
Cash Out: During running phase, lock current multiplier
Winner: Highest valid cashout in each tier wins entire pool
Tiers: 6 tiers (Iron to Diamond)
No Winner: Pool carries over to next round
Fairness: Commit-reveal + future blockhash
```

### Lord of the RNGs
```
Phases: Waiting → Countdown (60s) → Spin → Resolution (3s)
Visual: Color-coded wheel, space proportional to bet size
Winner: One player selected via on-chain VRF
Payout: Winner takes entire tier pool (minus 3% fee)
Tiers: 6 tiers (Iron to Diamond)
Fairness: On-chain VRF with cryptographic proof
```

### Coinflip
```
Phases: Lobby Create/Join → Flip (3s) → Resolution (2s)
Players: 1v1 (equal bet amounts)
Options: Heads or Tails
Winner: VRF determines outcome, 50/50 odds
Payout: Winner takes both bets (minus 3% fee)
Fairness: On-chain VRF with cryptographic proof
```

---

## Platform Economics

### Betting Tiers
```
Iron:     0.005 SOL (~$1)
Bronze:   0.01 SOL  (~$2)
Silver:   0.1 SOL   (~$20)
Gold:     0.25 SOL  (~$50)
Platinum: 0.5 SOL   (~$100)
Diamond:  1 SOL     (~$200)
```

### Fee Structure (3% Total)
```
2.2% → Platform Revenue (treasury PDA)
0.5% → Rakeback Pool (distributed daily to active players)
0.3% → Referral Rewards (credited per round)
```

### Target Metrics
```
Monthly GGR: $500,000 by March
Presale Raise: $2,000,000
RTP: 100% on P2P games (players get full pool minus 3% fee)
```

---

## Architecture Map

```
Frontend (React)
    ├── Platform Shell (routing, layout, wallet)
    ├── 8 Game Apps (Vite, TypeScript)
    └── Shared Packages (ui, game-engine, fairness, wallet, price-feeds)

Solana Programs (Anchor/Rust)
    ├── pool-manager (core: pools, entries, settlements)
    ├── vrf-consumer (VRF requests and proofs)
    └── game-config (per-game configuration, pause/unpause)

Services
    ├── Coordinator (real-time WebSocket, round arbiter)
    └── Indexer (Helius → PostgreSQL, historical data)

External
    ├── Pyth Network (on-chain BTC/USD price feed)
    └── VRF Provider (Switchboard/Orao - under evaluation)
```

---

## Source of Truth

| What | Where | Why |
|------|-------|-----|
| User funds | On-chain (wallet + escrow PDAs) | Trustless |
| Pool state | On-chain (pool-manager PDAs) | Financial settlement |
| Round outcomes | On-chain (settlement tx) | Auditability |
| Fees collected | On-chain (treasury PDA) | Transparency |
| Live game state | Coordinator server | Low latency |
| User profiles | Off-chain DB | Non-financial |
| Leaderboards | Indexer DB | Derived (recomputable) |
| Round history | Indexer DB | Derived (recomputable) |

**Golden Rule:** Anything involving money MUST be on-chain.

---

## Provable Fairness

### Pattern 1: Commit-Reveal + Future Blockhash
**Used by:** Crash Simulator

```
1. Server generates serverSeed, publishes commitment = sha256(serverSeed)
2. Players bet (server can't change serverSeed now)
3. Capture publicSeed from future Solana blockhash
4. Server reveals serverSeed after round
5. Outcome = HMAC-SHA256(serverSeed, publicSeed || roundId)
6. Anyone can verify: sha256(serverSeed) == commitment
```

### Pattern 2: On-Chain VRF
**Used by:** Lord of the RNGs, Coinflip

```
1. Program requests VRF (Switchboard/Orao)
2. VRF provider fulfills with cryptographic proof
3. Program verifies proof on-chain
4. Winner selected using VRF output
5. Result stored on-chain with proof
```

---

## Custody Model: Non-Custodial

```
Platform NEVER holds user balances.

Entry Flow:
Player wallet → Escrow PDA (on-chain) → Pool state updated

Payout Flow:
Pool settlement → Fees to treasury PDA → Winnings to winner wallets
(all atomic in single transaction)
```

**UX Optimization Without Custody:**
- Session keys (Privy delegation)
- Transaction sponsorship (platform pays gas)
- Batched entries
- Pre-approved limits

---

## Key Account Structures

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

GameConfig PDA: seeds = [game_id]
├── paused: bool
├── min_bet / max_bet
├── fee_bps: u16 (max 1000 = 10%)
└── authority: Pubkey (multisig)
```

---

## Idempotency Guarantees

```typescript
// Deterministic IDs prevent double-actions
betId = hash(roundId, playerId, tier)        // Prevents double-bet
settlementId = roundId                       // One settlement per round
claimId = hash(roundId, playerId)            // One claim per player

// On-chain enforcement
PlayerEntry.claimed: bool   // Second claim fails
Pool PDA existence check    // Second bet fails (PDA already exists)
```

---

## Safety Controls

### On-Chain (pool-manager)
```
Emergency Pause: Multisig can pause/unpause any game
Configurable Limits: Min/max bet, fee bounds
Hard Limits: MAX_FEE = 10%, MAX_BET = 1000 SOL
Emergency Refund: Multisig can refund void rounds
```

### Off-Chain (Coordinator)
```
Rate Limiting:
  - 100 actions/min/wallet
  - 500 actions/min/IP
  - 10k actions/sec global

Circuit Breakers:
  - Auto-pause on settlement failure threshold
  - Auto-pause on anomaly detection
  - Alert on-call team

Anomaly Detection:
  - Unusual cashout patterns
  - Bot-like behavior
  - Circular referrals
```

---

## Testing Requirements

### On-Chain Invariants
```rust
✓ total_payouts + fees == total_pool (ALWAYS)
✓ Sum(payouts) <= pool - fees (ALWAYS)
✓ fee_bps <= MAX_FEE_BPS (ALWAYS)
✓ Double-bet fails
✓ Double-claim fails
✓ Double-settlement fails
✓ Late entry fails (after lock)
✓ Unauthorized settlement fails
✓ Overflow protection on large amounts
```

### Fairness Tests
```rust
✓ sha256(serverSeed) == commitment
✓ Same inputs → same crash point (deterministic)
✓ VRF proof verification works
✓ Invalid VRF proof rejected
```

### Scale Tests
```
✓ 5k concurrent WebSocket connections
✓ 1k actions/second sustained
✓ Settlement with MAX_PLAYERS_PER_ROUND doesn't exceed compute
✓ Network partition recovery
✓ Coordinator restart during active round
```

---

## Development Commands

```bash
# Root-level
pnpm dev                    # Run all apps in dev mode
pnpm build                  # Build platform only
pnpm build:all              # Build all packages
pnpm lint                   # Lint all packages
pnpm test                   # Run all tests
pnpm clean                  # Clean all node_modules

# Specific apps
pnpm dev:platform           # Run platform shell
pnpm build:platform         # Build platform shell

# Solana programs
pnpm dev:programs           # Build Anchor programs
pnpm test:programs          # Test Anchor programs

# Format
pnpm format                 # Format all files
pnpm format:check           # Check formatting
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript 5, Vite 5 |
| Monorepo | pnpm workspaces, Turborepo |
| Blockchain | Solana (Anchor framework) |
| Wallet | Privy (embedded + session keys) |
| Randomness | Switchboard VRF or Orao |
| Price Feeds | Pyth Network |
| Real-time | WebSocket (custom server) |
| Database | PostgreSQL |
| Caching | Redis |
| Monitoring | TBD (Datadog/Grafana) |

---

## File Locations

```
Documentation:
├── ARCHITECTURE.md               # Full tech architecture (28KB)
├── docs/PRODUCT.md               # Product overview
├── docs/PLATFORM.md              # Platform features
└── docs/*.md                     # Game specifications

Source Code:
├── apps/                         # Frontend applications
├── packages/                     # Shared client libraries
├── solana/                       # Solana programs (Anchor)
├── crates/                       # Shared Rust libraries
└── services/                     # Off-chain services

Config:
├── package.json                  # Root package.json
├── pnpm-workspace.yaml           # Workspace config
├── turbo.json                    # Turborepo config
└── vercel.json                   # Deployment config
```

---

## Common Patterns

### Adding a New Game
```
1. Create spec in docs/<GAME_NAME>.md
2. Add app in apps/<game-name>/
3. Add entry in apps/platform routing
4. Implement Solana program logic in solana/
5. Add fairness verification in packages/fairness/
6. Update pool-manager for game-specific logic (if needed)
7. Add tests for invariants and fairness
```

### Payout Calculation (Pari-mutuel)
```typescript
total_pool = green_pool + red_pool + carryover_pool
net_pool = total_pool × 0.97  // 3% platform fee
winner_payout = (player_bet / winning_pool) × net_pool
```

### Payout Calculation (Winner-Takes-All)
```typescript
net_pool = total_pool × 0.97  // 3% platform fee
winner_payout = net_pool
```

---

## Debugging Checklist

When something goes wrong:
1. ✅ Check Solana explorer for transaction logs
2. ✅ Check pool-manager PDA state (is it locked? settled?)
3. ✅ Check player entry PDA (claimed flag set?)
4. ✅ Check coordinator logs for WebSocket events
5. ✅ Check indexer DB for consistency with on-chain
6. ✅ Verify VRF proof (if VRF-based game)
7. ✅ Check commitment/reveal logs (if commit-reveal game)
8. ✅ Verify RPC provider is responding
9. ✅ Check rate limits (wallet/IP/global)
10. ✅ Check circuit breaker status

---

## Security Considerations

### Smart Contract
- ✅ All programs audited before mainnet
- ✅ Upgrade authority = multisig (3-of-5 minimum)
- ✅ Bug bounty program for critical vulnerabilities
- ✅ Formal verification for payout logic (under consideration)

### Frontend
- ✅ No private keys stored
- ✅ All sensitive ops require wallet signature
- ✅ Input validation on all user data
- ✅ CSP headers to prevent XSS

### Operational
- ✅ Admin ops require multisig
- ✅ Monitoring and alerting for anomalies
- ✅ Rate limiting on RPC and WebSocket
- ✅ Incident response playbook documented

---

## Open Research Items

1. **VRF Provider:** Switchboard vs Orao comparison (latency, cost, reliability)
2. **Indexer:** Helius webhooks vs custom Geyser plugin
3. **Session Keys:** Privy session authority security implications
4. **Cross-Region:** Geographic coordination server distribution
5. **Scale:** Max concurrent players per tier, compute limits

---

## Project Status

**Phase:** Pre-development (documentation complete)

**Completed:**
- ✅ Full architecture specification
- ✅ 4 games fully specified
- ✅ Provable fairness system designed
- ✅ Monorepo structure established
- ✅ ~189 TypeScript files stubbed

**Next Steps:**
- 🚧 Implement pool-manager Solana program
- 🚧 Implement VRF integration
- 🚧 Build coordination server
- 🚧 Implement first game frontend (Close Call or Crash)
- 🚧 Deploy to Solana devnet for testing

---

## Contact & Resources

- **Architecture Docs:** `ARCHITECTURE.md` (28KB, 1000 lines)
- **Game Specs:** `docs/` directory
- **Code:** `apps/`, `packages/`, `solana/`
- **Package Manager:** pnpm 9.15.0
- **Node Version:** 20.x

---

## Key Principles

1. **Non-Custodial:** Platform never holds user funds
2. **Provably Fair:** All outcomes verifiable on-chain
3. **P2P First:** Players compete, not playing against house
4. **Transparent Fees:** 3% only, no hidden house edge
5. **On-Chain Settlement:** Money MUST be on-chain
6. **Idempotent:** All operations safe to retry
7. **Auditable:** Full history recomputable from chain
8. **Real-time UX:** Off-chain coordination for speed
