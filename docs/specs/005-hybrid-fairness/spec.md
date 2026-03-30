# Specification: [005] Hybrid Fairness — Commit-Reveal + Slot Hash Entropy

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 0 |

---

## Overview

Platform-wide fairness primitive replacing per-game VRF with a cheaper, server-efficient
commit-reveal model anchored on-chain. The server commits a hashed secret at round creation
(via pre-signed transaction the user submits). A future Solana slot hash provides public
entropy unknown to either party at commit time. The server settles by revealing the secret;
the program verifies the commitment, derives the outcome deterministically, and pays out.

**Replaces**: Orao VRF as default randomness source for all RNG games.
**Preserves**: Optional VRF upgrade path behind a feature flag for games that justify the cost.

### Why Not VRF

| Amount (Coinflip, per player) | Pool (2 players) | 3% Revenue | VRF Cost (~0.01 SOL) | VRF % of Revenue |
|-------------------------------|------------------|------------|----------------------|------------------|
| 0.0026 SOL (minimum) | 0.0052 SOL | 0.000156 | 0.01 | **6410%** |
| 0.005 SOL | 0.01 SOL | 0.0003 | 0.01 | **3333%** |
| 0.01 SOL | 0.02 SOL | 0.0006 | 0.01 | **1667%** |
| 0.1 SOL | 0.2 SOL | 0.006 | 0.01 | **167%** |
| 1.0 SOL | 2.0 SOL | 0.06 | 0.01 | 17% |

VRF is a money loser at low-stake amounts for 2-player games. The hybrid model
costs ~0.000005 SOL (one settlement tx fee).

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Applies to all RNG-based games (Coinflip, Lord of RNGs, Crash, Slots Utopia, Tug of Earn). Does NOT apply to oracle-settled games (Close Call, Game of Trades) or skill-scored games (Chart the Course uses simple commit-reveal for asset selection only).
- **Scope status**: V1 In Scope
- **Phase boundary**: Shared infrastructure — prerequisite for all RNG game programs.

## Required Context Files

- `docs/FOUNDATIONS.md` — Architecture patterns, fairness strategy
- `docs/DECISIONS.md` — VRF provider decision (to be updated)
- `sources/rng-utopia/solana/shared/src/vrf_orao.rs` — Current VRF integration (to be replaced/feature-gated)
- `sources/rng-utopia/solana/shared/src/commit_reveal.rs` — Existing commit-reveal primitives
- `sources/rng-utopia/solana/shared/src/timeout.rs` — Existing timeout infrastructure

## Contract Files

- `sources/rng-utopia/solana/shared/src/lib.rs` — Shared crate public API

---

## Core Design

### Threat Model

Two adversaries, each holding one half of the entropy:

| Party | Knows | Doesn't Know |
|-------|-------|-------------- |
| Server | `secret` | `slot_hash(target_slot)` at commit time |
| Validator (at target_slot) | `slot_hash` they produce | `secret` |

**Outcome is unpredictable to either party alone.** The attack requiring concern is
**server-validator collusion**: if the server shares its secret with the validator
producing `target_slot`, that validator could manipulate the slot hash to steer outcomes.

**Mitigation**: `K` (the slot offset) spans multiple leader rotations, making it
impractical to pre-arrange collusion with an unknown future leader.

### Result Formula

```
result = sha256(
    secret            // 32 bytes — server-committed, revealed at settlement
    || slot_hash      // 32 bytes — from SlotHashes sysvar at target_slot
    || round_pda      // 32 bytes — globally unique round identifier
    || algorithm_ver  // 1 byte   — supports future formula upgrades
)
```

- `round_pda` replaces separate `game_id + round_id` — already globally unique on-chain.
- `algorithm_ver` starts at `1`. Bumping it forces all parties to use the updated derivation, preventing ambiguity.

### Slot Hash Entropy Rules

#### K Value (Slot Offset)

```
target_slot = capture_slot + K
```

**K = 12** (recommended default, ~4.8 seconds at 400ms slots)

| K | Leader Rotations Spanned | Collusion Difficulty | Latency |
|---|--------------------------|----------------------|---------|
| 1 | 0–1 (same leader likely) | Trivial | 0.4s |
| 4 | 1 (edge of one leader's run) | Low | 1.6s |
| 8 | 2 minimum | Moderate | 3.2s |
| **12** | **3 minimum** | **High** | **4.8s** |
| 20 | 5 minimum | Very high | 8.0s |

Solana assigns **4 consecutive slots per leader**. K=12 guarantees the target slot is
produced by a leader at least 3 rotations away from the capture-time leader. The server
would need to collude with a validator it can't identify until ~2 seconds before the
target slot (leader schedule is public but the exact leader for slot N+12 depends on
schedule position).

K=12 adds ~5 seconds of latency — absorbed by game animations in all current games.

#### Capture Rules

| Rule | Detail |
|------|--------|
| Capture instruction | The instruction that transitions the round to its locked/committed phase |
| `capture_slot` | `Clock::slot()` at capture instruction execution |
| `target_slot` | `capture_slot + K`, stored on round PDA |
| Staleness guard | `SlotHashes` sysvar holds ~150 recent slots (~60s). Settlement must happen within this window. Covered by timeout (120s for most games, 180s for Crash). |
| Skipped slots | If `target_slot` was skipped (no block produced), use the **first available slot hash where `slot >= target_slot`** from the `SlotHashes` sysvar. Program iterates entries to find it. Store the actual slot used alongside the hash for verification. |
| Storage | Round PDA stores: `target_slot: u64`, `entropy: [u8; 32]` (filled at settlement), `actual_entropy_slot: u64` (for skipped-slot cases) |

#### SlotHashes Sysvar Constraint (Security-Critical)

The settlement instruction **must** constrain the entropy account to the SlotHashes sysvar
(`SysvarS1otHashes111111111111111111111111111`). Without this constraint, the settler could
pass an arbitrary account as entropy and choose the game outcome.

Implementation (shared crate `fairness.rs`):
- `SLOT_HASHES_ID` — hardcoded sysvar address constant
- `read_slot_hash_entropy(account, target_slot)` — validates `account.key() == SLOT_HASHES_ID`,
  then iterates the binary sysvar data to find the hash for `target_slot`
- Returns `FairnessError::InvalidEntropyAccount` if wrong account
- Returns `FairnessError::EntropySlotExpired` if target slot rolled off the ~512-slot window

Both `coinflip::settle` and `lordofrngs::claim_payout` use `#[account(address = SLOT_HASHES_ID)]`
to enforce this at the Anchor account validation level.

```rust
// Settlement account constraint
#[account(address = SLOT_HASHES_ID)]
pub slot_hashes: AccountInfo<'info>,

// Reading entropy
let entropy = read_slot_hash_entropy(&ctx.accounts.slot_hashes, target_slot)?;
```

**Note**: The SlotHashes sysvar holds ~512 recent slot hashes (~3.5 minutes). Settlement
must occur within this window. The 24-hour timeout refund path handles the case where
settlement fails entirely.

### Transaction Flow

#### Creation (User-Submitted, Server Pre-Signed)

```
User → API: "create 0.1 SOL coinflip, HEADS"

API generates:
  - secret = random 32 bytes
  - commitment = sha256(secret)
  - Builds tx: CreateMatch { commitment, side, amount_lamports }
  - Server partially signs (proves it authored the commitment)
  - Returns serialized tx to user

User → Wallet: co-signs (fee payer + depositor)
User → Chain: submits

On-chain stores: commitment, algorithm_ver, game params
Server stores: secret (in DB, keyed by round PDA)
```

**Server keypair** is a required `Signer` on the create instruction, but the **user** is
the fee payer. One transaction, one user approval, zero server SOL spent.

#### Entropy Capture (User-Submitted)

A player-driven instruction that locks the round and records `target_slot`:

```
Player → Chain: JoinMatch / StartSpin / CloseBetting / TriggerSpin

On-chain:
  - Transitions phase to LOCKED
  - Records target_slot = Clock::slot() + K
  - Records resolve_deadline = Clock::unix_timestamp() + TIMEOUT
```

No server involvement. Pure user action.

#### Settlement (Server-Submitted)

Server must submit — users can't withhold settlement:

```
Server watches for: target_slot reached (entropy available)

Server → Chain: Settle {
    secret,           // the reveal
    // remaining accounts: round PDA, slot_hashes sysvar, payer accounts, etc.
}

On-chain:
  1. Verify: sha256(secret) == round.commitment        → else reject
  2. Read: slot_hash for round.target_slot from SlotHashes sysvar
  3. Derive: result = sha256(secret || slot_hash || round_pda || algorithm_ver)
  4. Determine winner from result (game-specific derivation)
  5. Transfer payout to winner (pool × 0.97)
  6. Transfer fee to treasury (pool × 0.03)
  7. Update player profiles via platform CPI
  8. Emit settlement event with all verification data
  9. Close round PDA (return rent to creator)
```

Server pays ~0.000005 SOL tx fee. At 10,000 games/day = 0.05 SOL/day.

#### Timeout Refund (Permissionless)

If server fails to settle:

```
Anyone → Chain: TimeoutRefund { round_pda }

On-chain:
  1. Check: Clock::unix_timestamp() >= round.resolve_deadline
  2. Check: round.phase != SETTLED and round.phase != REFUNDED
  3. Refund full principal to all depositors (no fee taken)
  4. Mark round REFUNDED (irreversible — server cannot settle after refund)
  5. Close round PDA
```

---

## Timeout Rules

Timeout is the **sole user protection** against a dishonest or offline server.

| Rule | Value | Rationale |
|------|-------|-----------|
| Base timeout | 120 seconds from entropy capture | Enough for server to read slot hash + submit settle tx |
| Crash timeout | 180 seconds from betting close | Accounts for engine runtime (variable crash point) + cashout ordering |
| Trigger | `now >= resolve_deadline && phase != SETTLED && phase != REFUNDED` | Permissionless |
| Payout | Full principal to ALL depositors | No fee on timeout — platform earns nothing if it fails to settle |
| Irreversibility | Round marked `REFUNDED`, cannot transition to `SETTLED` | Prevents race between late settle and refund |
| Monitoring | Frequent timeouts = operational alert (off-chain) | Not enforced on-chain, but critical for operator health |

---

## Functional Requirements

### FR-1: On-Chain Commitment Storage

The program must store a server commitment on the round/match PDA at creation time,
before any player has committed funds or the outcome is knowable.

**Acceptance Criteria:**
- [ ] Round PDA stores `commitment: [u8; 32]` (the hash of the server secret)
- [ ] Round PDA stores `algorithm_ver: u8` (starting at 1)
- [ ] Commitment is written during the create instruction, before any deposits
- [ ] Server keypair is a required `Signer` on the create instruction
- [ ] Commitment cannot be modified after creation

### FR-2: Slot Hash Entropy Capture

A player-driven instruction must record the target slot for public entropy,
at a moment neither the server nor any player can predict in advance.

**Acceptance Criteria:**
- [ ] `target_slot = Clock::slot() + K` where K is a program constant (default 12)
- [ ] `target_slot` stored on round PDA at the phase-locking instruction
- [ ] `resolve_deadline` set at the same instruction
- [ ] Phase transitions to LOCKED (no further joins/bets after this point)
- [ ] K is defined as a program constant, adjustable per-deploy (not hardcoded in logic)

### FR-3: Settlement with Reveal Verification

The server must reveal the secret and the program must verify it matches the
stored commitment, derive the outcome, and distribute payouts — all atomically.

**Acceptance Criteria:**
- [ ] Settlement instruction accepts `secret: [u8; 32]` from server
- [ ] Program verifies `sha256(secret) == stored_commitment` — rejects if mismatch
- [ ] Program reads `SlotHashes` sysvar to get hash for `target_slot` (or first available `>= target_slot`)
- [ ] Program computes `result = sha256(secret || slot_hash || round_pda || algorithm_ver)`
- [ ] Game-specific winner derivation from `result` bytes (see Per-Game Derivations)
- [ ] Payout transferred to winner(s) atomically in the same instruction
- [ ] Fee transferred to treasury atomically
- [ ] Player profiles updated via platform CPI
- [ ] Settlement event emitted with: `commitment`, `secret`, `target_slot`, `actual_entropy_slot`, `slot_hash`, `result`, `winner`, `algorithm_ver`
- [ ] Round PDA closed after settlement

### FR-4: Permissionless Timeout Refund

If the server fails to settle within the deadline, anyone can trigger a full refund.

**Acceptance Criteria:**
- [ ] Refund callable by any signer when `now >= resolve_deadline`
- [ ] Refund returns full principal to all depositors (zero fee)
- [ ] Refund marks round as `REFUNDED` — settlement is permanently blocked
- [ ] Refund works regardless of whether entropy slot has passed
- [ ] Refund closes the round PDA

### FR-5: Pre-Signed Transaction API

The server provides pre-signed partial transactions so users submit creation txs
without the server needing to interact with the chain.

**Acceptance Criteria:**
- [ ] API endpoint accepts game parameters, returns serialized partial transaction
- [ ] Transaction includes server's signature over the commitment
- [ ] User can co-sign and submit as fee payer
- [ ] Server's on-chain cost for creation is zero
- [ ] Transaction is time-bounded (recent blockhash expiry prevents stale reuse)

### FR-6: Public Verification

Anyone must be able to independently verify any settled round from public on-chain data.

**Acceptance Criteria:**
- [ ] Settlement event contains all inputs to the result formula
- [ ] A verifier can recompute `sha256(secret) == commitment` from event data
- [ ] A verifier can recompute `sha256(secret || slot_hash || round_pda || algorithm_ver) == result` from event data
- [ ] A verifier can confirm the slot hash by reading `SlotHashes` or historical block data
- [ ] Frontend displays verification payload post-settlement (commitment, secret, slot, result)

### FR-7: VRF Upgrade Path (Deferred)

The system must support a future upgrade to VRF without changing game logic.

**Acceptance Criteria:**
- [ ] `vrf_orao.rs` remains in shared crate behind `orao-vrf` feature flag (off by default)
- [ ] Round PDA has space for `randomness_mode: enum { CommitReveal, Vrf }` (future use)
- [ ] Settlement instruction can branch on randomness mode (future implementation)
- [ ] No VRF code compiled into default builds

---

## Per-Game Integration

### Coinflip

| Step | Instruction | Who Submits | Entropy |
|------|-------------|-------------|---------|
| Create | `create_match(commitment, side, amount_lamports)` | User (server pre-signs) | — |
| Join | `join_match()` | Opponent | Captures `target_slot` |
| Settle | `settle_match(secret)` | Server | Reads slot hash, derives `result[0] % 2` → HEADS/TAILS |
| Timeout | `timeout_refund()` | Anyone | Full refund after 120s |

**Derivation**: `result[0] % 2` — 0 = HEADS, 1 = TAILS. Same as current VRF derivation.

### Lord of the RNGs

| Step | Instruction | Who Submits | Entropy |
|------|-------------|-------------|---------|
| Create | `create_round(commitment, amount_lamports, round_id)` | User (server pre-signs) | — |
| Add entry | `join_round(amount_lamports)` / `buy_more_entries(amount_lamports)` | Players | — |
| Countdown start | Occurs on 2nd distinct wallet join | Program | Stores `countdown_ends_at` and precomputed `target_entropy_slot` |
| Settle | `settle_round(secret)` | Server | Reads slot hash, derives `u64 % total_amount_lamports` → winning offset |
| Timeout | `timeout_refund()` | Anyone | Full refund after 120s |

**Derivation**: `u64::from_le_bytes(result[0..8]) % total_amount_lamports` → winning offset.
Map to winner via cumulative entry amount ranges in ordered entry list.

### Crash

Crash is unique: the server needs the crash point **before** the running phase to drive
the real-time engine.

| Step | Instruction | Who Submits | Entropy |
|------|-------------|-------------|---------|
| Create | `create_round(commitment, amount_lamports)` | Server or automated | — |
| Bet | `place_bet(amount)` | Players (20s window) | — |
| Close betting | `close_betting()` | Anyone (after timer) | Captures `target_slot` |
| *Server compute* | — | Off-chain | Server reads slot hash, computes crash point |
| Running phase | — | Off-chain engine | Server drives multiplier to crash point |
| Settle | `settle_round(secret)` | Server | On-chain verify + pay highest valid cashout |
| Timeout | `timeout_refund()` | Anyone | Full refund after 180s |

**Crash-specific flow**:

```
1. close_betting captures target_slot on-chain
2. Server waits ~5s for target_slot to be produced
3. Server reads slot_hash from chain
4. Server computes: crash_point = derive_crash_point(secret, slot_hash, round_pda)
5. Server starts engine with known crash_point
6. Players cash out during running phase (server records cashouts)
7. Multiplier hits crash_point → engine stops
8. Server submits settle tx with secret → program re-derives crash_point,
   verifies it matches server's execution, pays winner
```

**Derivation**:
```
raw = u64::from_le_bytes(result[0..8])
// Map to crash point: floor of 1.00x–100.00x range
// e.g., crash_point = max(1.00, (raw % 10000) as f64 / 100.0)
// Exact formula TBD in crash spec — but must be deterministic from result bytes.

// Boost check (20% of rounds):
boost_roll = result[8] % 5  // 0 = boosted (20%)
if boost_roll == 0:
    boost_factor = 1.5 + (result[9] as f64 / 255.0) * 1.5  // 1.5x–3.0x
    crash_point *= boost_factor
```

**Latency budget**: ~5s for slot hash to be available (K=12) + engine runtime. The 180s
timeout accommodates worst-case crash point (100x at 1.12^t ≈ 41 seconds) plus settlement.

### Slots Utopia

| Step | Instruction | Who Submits | Entropy |
|------|-------------|-------------|---------|
| Create | `create_round(commitment, amount_lamports)` | Server or first player (pre-signed) | — |
| Join | `join_round()` | Players (until 9 seated) | — |
| Spin | `trigger_spin()` | Any player (when full) | Captures `target_slot` |
| Settle | `settle_round(secret)` | Server | Reads slot hash, derives position assignment |
| Timeout | `timeout_refund()` | Anyone | Full refund after 120s |

**Derivation**: Deterministic Fisher-Yates shuffle seeded by `result`:
```
positions = [0, 1, 2, 3, 4, 5, 6, 7, 8]
seed = result  // 32 bytes
for i in (8..=1).rev():
    j = u32::from_le_bytes(seed[i*3..i*3+4]) % (i + 1)  // or similar byte slicing
    positions.swap(i, j)
// positions[player_index] = grid position
// Grid payouts: center(pos 4)=50%, edges(1,3,5,7)=8.5% each, corners(0,2,6,8)=4% each
```

### Chart the Course

Simple commit-reveal only — no slot hash entropy needed (skill game, not RNG).

| Step | Instruction | Who Submits |
|------|-------------|-------------|
| Create session | `create_session(commitment)` | Server |
| Play rounds | Drawing submissions | Players |
| Reveal | `reveal_asset(secret)` | Server |
| Score + settle | Deterministic from revealed asset | Server |

**Commitment**: `sha256(asset_id || chart_params)`. Proves asset wasn't swapped mid-session.
No slot hash needed — the randomness (asset choice) doesn't determine the winner (drawing accuracy does).

### Tug of Earn

Two sub-designs depending on ghost line source:

**Option A — Market-derived ghost line (recommended)**:
No commit-reveal needed. Ghost line = real BTC/USD price movement from Pyth oracle.
Same infrastructure as Close Call. Zero randomness cost.

**Option B — Random ghost line**:

| Step | Instruction | Who Submits | Entropy |
|------|-------------|-------------|---------|
| Create | `create_round(commitment, amount_lamports)` | Server or first player (pre-signed) | — |
| Join | `join_round(team_pref?)` | Players | — |
| Start | `start_tapping()` | Any player (when teams filled) | Captures `target_slot` |
| Tapping | Off-chain tap aggregation | Server | 60s real-time phase |
| Settle | `settle_round(secret)` | Server | Reveals ghost line seed, compares to tap chart |
| Timeout | `timeout_refund()` | Anyone | Full refund after 180s |

**Ghost line derivation**: `result` bytes → series of waypoints the ghost line passes
through over the 60s window. Exact curve interpolation TBD in Tug of Earn spec.

**Team assignment**: Deterministic from `result` — e.g., sort players by
`sha256(result || player_pubkey)`, first half = Surfers, second half = Anchors.

---

## Game Applicability Matrix

| Game | Randomness Source | Commitment | Slot Hash Entropy | Server Settles | Timeout |
|------|-------------------|------------|-------------------|----------------|---------|
| **Coinflip** | Commit-reveal + slot hash | Yes | Yes (at join) | Yes | 120s |
| **Lord of RNGs** | Commit-reveal + slot hash | Yes | Yes (at spin) | Yes | 120s |
| **Crash** | Commit-reveal + slot hash | Yes | Yes (at betting close) | Yes | 180s |
| **Slots Utopia** | Commit-reveal + slot hash | Yes | Yes (at spin) | Yes | 120s |
| **Tug of Earn** | Pyth (option A) or commit-reveal (option B) | Maybe | Maybe | Yes | 120–180s |
| **Chart the Course** | Simple commit-reveal | Yes | No | Yes | Session-level |
| **Close Call** | Pyth oracle | No | No | Oracle-settled | N/A |
| **Game of Trades** | Pyth oracle | No | No | Oracle-settled | N/A |

---

## Shared Crate Changes

### New / Modified Modules

| Module | Action | Contents |
|--------|--------|----------|
| `fairness.rs` (new) | Create | `FairnessFields` struct, `verify_commitment()`, `derive_result()`, `read_slot_hash_entropy()` |
| `commit_reveal.rs` | Extend | Add entropy mixing, result derivation, `CommitRevealFields` on-chain struct |
| `vrf_orao.rs` | Feature-gate | Wrap behind `#[cfg(feature = "orao-vrf")]`, off by default |
| `timeout.rs` | Keep | Reuse as-is — same 120s/180s deadline logic |
| `constants.rs` | Add | `ENTROPY_SLOT_OFFSET: u64 = 12`, `ALGORITHM_VERSION: u8 = 1` |

### On-Chain Structures

```rust
/// Stored on every round/match PDA that uses commit-reveal fairness.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct FairnessFields {
    /// sha256(server_secret) — set at creation, immutable.
    pub commitment: [u8; 32],
    /// Algorithm version for result derivation (starts at 1).
    pub algorithm_ver: u8,
    /// Slot from which to read entropy (set at lock/join, 0 until then).
    pub target_slot: u64,
    /// Actual slot used for entropy (may differ from target if skipped).
    pub actual_entropy_slot: u64,
    /// Captured slot hash (filled at settlement).
    pub entropy: [u8; 32],
}
// Size: 32 + 1 + 8 + 8 + 32 = 81 bytes
```

Replaces `VrfAuditFields` (40 bytes) — net increase of 41 bytes per round PDA.

---

## Success Criteria

- All RNG games settle via commit-reveal + slot hash entropy (zero VRF dependency in default build)
- Server has zero on-chain transaction cost for round creation
- Server settlement tx cost is ~0.000005 SOL per game
- Timeout refund is permissionless and returns full principal
- Any third party can independently verify any settled round from on-chain event data
- VRF remains available behind feature flag for future opt-in

---

## Dependencies

- Solana `SlotHashes` sysvar access from Anchor programs
- Server-side API for pre-signed transaction generation
- Server-side secret storage (DB, keyed by round PDA)
- Server-side settlement watcher (monitors for entropy availability, submits settle txs)

## Assumptions

- Solana leader schedule assigns 4 consecutive slots per validator (current protocol)
- `SlotHashes` sysvar retains ~150 recent slot hashes (~60 seconds)
- Server-validator collusion is impractical when K >= 12 (3+ leader rotations)
- Server liveness is assumed for settlement; timeout refund is the fallback, not the primary path
- Exact VRF mainnet cost is ~0.01 SOL per request (validates the cost motivation)

---

## Risks / Trade-Offs

### 1. Server Withholding

Server can refuse to reveal/settle. Mitigation:
- Timeout refund protects user principal
- No fee collected on timeout (server has no financial incentive to withhold)
- Monitoring/alerting for timeout frequency (operational)
- Future: bonded operator model or delegated settlement

### 2. Server-Validator Collusion

Server shares secret with target_slot validator to steer outcomes. Mitigation:
- K=12 spans 3+ leader rotations — colluding validator identity unknown at commit time
- Economic incentive: validators risk slashing reputation for small-game manipulation
- Future: increase K or add VRF for high-value amounts

### 3. Not Full Trustless Randomness

This is a hybrid model. It is:
- **Stronger than**: UI-only provably fair, pure server-seed, pure slot hash
- **Weaker than**: Per-game VRF
- **Appropriate for**: Cost-sensitive, UX-sensitive, backend-orchestrated round-based games
- **Not appropriate for**: Games demanding strongest trustless randomness (add VRF flag)

### 4. Slot Hash Expiry

If settlement is delayed beyond ~60 seconds, the target slot hash may fall out of
`SlotHashes`. Mitigation: timeout forces refund well before this matters (120s timeout
> 60s sysvar window is intentional — if the slot hash is gone, something is very wrong
and refund is correct).

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Commitment stored immutably at creation | Bankrun: create match, read PDA, verify commitment field | Test output |
| 2 | Entropy captured at correct slot offset | Bankrun: lock match, verify `target_slot = current + K` | Test output |
| 3 | Settlement verifies commitment | Bankrun: settle with wrong secret → expect error | Test output |
| 4 | Settlement derives correct result | Bankrun: settle, recompute sha256 off-chain, compare | Test output |
| 5 | Timeout refund works | Bankrun: warp past deadline, call refund, verify balances | Test output |
| 6 | Timeout blocks late settlement | Bankrun: refund first, then try settle → expect error | Test output |
| 7 | Skipped slot handling | Bankrun: simulate skipped target_slot, verify next-available hash used | Test output |
| 8 | Pre-signed tx flow | Integration test: server partial sign → user co-sign → submit | E2E test |
| 9 | Public verification | Script: read settlement event, recompute all values, assert match | Verification script |

---

## Completion Signal

### Implementation Checklist
- [ ] `FairnessFields` struct in shared crate
- [ ] `verify_commitment()` function
- [ ] `derive_result()` function
- [ ] `read_slot_hash_entropy()` function (with skipped-slot handling)
- [ ] Feature-gate `vrf_orao.rs` behind `orao-vrf` flag
- [ ] Update Coinflip program: replace VRF with commit-reveal
- [ ] Update Lord of RNGs program: replace VRF with commit-reveal
- [ ] Update Crash spec: document commit-reveal + engine timing
- [ ] Bankrun tests for all settlement and timeout paths
- [ ] Settlement event with full verification payload
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**`
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`
- [ ] [test] Devnet integration test with real slot hashes

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled (skipped slots, wrong secret, expired slot hash, double-settle, settle-after-refund)
- [ ] Error states handled

#### Visual Regression
- [ ] `pnpm test:visual` passes (all baselines match)
- [ ] Local deterministic E2E passes (`pnpm test:e2e`) for user-facing flows, or N/A documented
- [ ] Devnet real-provider E2E passes with real slot hashes

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
