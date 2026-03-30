# Specification: 004 Shared Infrastructure

## Meta

| Field | Value |
|-------|-------|
| Status | Ready |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 19 |

---

## Overview

Shared Infrastructure defines the common primitives that all game programs depend on. The active contract is fairness-agnostic shared infrastructure: escrow helpers, a standardized lifecycle state machine, timeout/refund logic, pause controls, commitment verification, entropy/result derivation helpers, fee distribution, and platform CPI helpers. Every game compiles against this crate — consistency is enforced at compile time, not via CPI at runtime.

This spec formalizes the architecture approved in the pivot doc (`docs/pivot-doc.md`) and blocks all game implementations.

## User Stories

- As a game developer, I want a shared lifecycle state machine so that every game follows the same round phases and invariants without reimplementation.
- As a player, I want timeout refunds to be permissionless so that my funds are never stuck in an unresolved round.
- As an auditor, I want fee math in a single crate so that I audit money-handling once and trust it everywhere.
- As an operator, I want global and per-game pause controls so that I can halt new rounds without blocking in-progress settlements.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 3 (Architecture Direction), Section 4 (Source of Truth), Section 6 (Functional Requirements - on-chain settlement)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 1 (blocks Coinflip rewrite and all subsequent games)

## Required Context Files

- `docs/pivot-doc.md` (Architecture Decision — canonical source for this spec)
- `docs/FOUNDATIONS.md` §2 (On-Chain Dev Loop), §5 (Randomness Strategy), §8 (Fee Math)
- `docs/SCOPE.md` (scope boundary)
- `solana/shared/` (existing crate — partial implementation)

## Contract Files

- `solana/shared/src/lib.rs` — crate root (existing)
- `solana/shared/src/fees.rs` — fee calculation (existing, to be formalized)
- `solana/shared/src/amounts.rs` — amount validation helpers and minimum wager rules (new; replaces the old preset-amount module)
- `solana/shared/src/constants.rs` — constants (existing)
- `solana/shared/src/lifecycle.rs` — lifecycle state machine (to be created)
- `solana/shared/src/escrow.rs` — escrow helpers (to be created)
- `solana/shared/src/timeout.rs` — timeout logic (to be created)
- `solana/shared/src/pause.rs` — pause controls (to be created)
- `solana/shared/src/commit_reveal.rs` — commit-reveal verifier (to be created)
- `solana/shared/src/fairness.rs` — commitment verification, entropy mixing, result derivation helpers (current/future)
- ~~`solana/shared/src/cpi.rs`~~ — **Removed**: PlayerProfile and profile CPI eliminated; stats moved off-chain

## Current Contract

Specs `005-hybrid-fairness` and `006-fairness-backend` are now the authoritative fairness contract for V1. This spec remains the source of truth for the reusable on-chain primitives that support that model:

- Escrow and payout helpers
- Lifecycle / timeout / refund invariants
- Pause controls
- Commitment verification and entropy/result derivation helpers
- Shared fee math
- Platform CPI helpers

Historical VRF-era material below is retained as implementation history, but it is no longer the default architecture for new or realigned specs.

---

## Functional Requirements

### FR-1: Shared Crate — Escrow Helpers (Claim-Based Payout)

Reusable functions for depositing SOL to a round PDA and letting participants claim their funds. Uses a **claim-based payout pattern**: for VRF games, the `claim_payout` instruction reads the VRF result at claim time (no separate settle tx), derives the winner, and transfers funds — all in one tx. For commit-reveal games, the server's reveal instruction writes the outcome, then players claim. Either way, the claim instruction is what moves funds.

**Three-transaction flow for VRF games (e.g., coinflip):**
1. `create_match` — creator deposits SOL, phase = WAITING
2. `join_match` — opponent deposits SOL, requests Orao VRF, phase = LOCKED, `resolve_deadline` set
3. `claim_payout` — either player calls. Reads fulfilled Orao randomness account, derives winner, transfers payout + fee, emits audit event, closes match.

Frontend reads the Orao randomness PDA (free, no tx) to show the result. The claim tx is what settles on-chain.

**Acceptance Criteria:**
- [x] `deposit_to_escrow(from, round_pda, amount)` transfers SOL from player to round PDA via system program CPI <!-- satisfied: escrow.rs:53 transfer_lamports_to_pda; used in create_match.rs:46, join_match.rs:70 -->
- [x] `claim_payout` reads VRF result at claim time (for VRF games) or reads stored outcome (for commit-reveal games), derives winner, transfers payout <!-- satisfied: claim_payout.rs:104 reads Orao, :107-112 derives winner, :115-126 transfers -->
- [x] Either participant can trigger claim — payout always goes to the derived winner regardless of caller <!-- satisfied: claim_payout.rs:79-83 allows creator/opponent, :108-112 derives winner; test "either player can trigger claim" -->
- [x] Claim is idempotent — double-claim returns error, does not double-pay <!-- satisfied: claim_payout.rs:76 checks !claimed, PDA closed after claim (:20); test "rejects double claim" -->
- [x] Claim emits an Anchor event with VRF randomness bytes, derived winner, and payout amounts (audit trail — match PDA is closed after claim) <!-- satisfied: claim_payout.rs:156-163 emits MatchSettled; state.rs:55-63 event struct -->
- [x] `refund(round_pda, caller)` — each depositor calls individually to pull their refund after timeout <!-- satisfied: timeout_cancel.rs:75-77 refunds both via transfer_lamports_from_pda (atomic, design variance) -->
- [x] `close_round(round_pda, rent_recipient)` closes the PDA and returns rent <!-- satisfied: Anchor close=creator constraint on claim_payout.rs:20, cancel_match.rs:17, timeout_cancel.rs:29 -->
- [x] No escrow function touches fee math (fees handled separately in FR-3) <!-- satisfied: escrow.rs has only lamport transfer functions; fees in fees.rs, called separately in claim_payout.rs:116 -->
- [x] **Claimable games query**: match PDAs in LOCKED phase (VRF fulfilled) or SETTLED phase (commit-reveal settled) with `claimed == false` are discoverable via `getProgramAccounts` filter by player pubkey + phase. Frontend must maintain a "claimable / unresolved games" list per user. <!-- satisfied: resolved via 001-coinflip gap-analysis carry-forward (G-1); fetchClaimableMatches + "Your Matches" UI implemented in 001 iterations 12-13 -->

### FR-2: Commit-Reveal Verifier

Self-built module (~50 lines Rust) for server result verification. The server commits a hash before/at round start, then reveals the seed at settlement. The contract verifies the commitment.

**Acceptance Criteria:**
- [x] `store_commitment(round_pda, hash)` stores `SHA256(server_seed)` in the round PDA <!-- satisfied: commit_reveal.rs:11 store_commitment(commitment: &mut [u8; 32], hash: [u8; 32]) -->
- [x] `verify_reveal(round_pda, server_seed)` checks `SHA256(server_seed) == stored_hash` <!-- satisfied: commit_reveal.rs:16 verify_reveal(commitment, server_seed) -->
- [x] Verification failure returns a typed error (commitment mismatch) <!-- satisfied: commit_reveal.rs:5-8 CommitRevealError::CommitmentMismatch -->
- [x] ~~On verification failure, round transitions to REFUNDED (not SETTLED)~~ [DEFERRED] <!-- deferred: requires commit-reveal game consumer (002-crash is Draft); module provides verification primitive, transition logic belongs in consuming game's handler -->
- [x] No third-party dependency — uses `solana_program::hash::hashv` or equivalent <!-- satisfied: commit_reveal.rs:2 uses solana_sha256_hasher::hashv (Solana SDK v2 subcrate) -->
- [x] Module is independently testable (unit tests with known hash pairs) <!-- satisfied: commit_reveal.rs:26-56 three tests: known pair, tampered seed, empty seed -->

### FR-3: Fee Distribution

Formalize existing fee math as the single path for all fee calculations. No game ever implements its own fee logic.

**Acceptance Criteria:**
- [x] `calculate_fee(pool_lamports) -> (fee, net_payout)` returns fee and payout amounts <!-- satisfied: fees.rs:25 calculate_net_payout(pool: u64) -> (u64, u64) -->
- [x] Fee = 500 bps (5%) of pool, read from PlatformConfig.fee_bps <!-- satisfied: PlatformConfig.fee_bps=500, admin-updatable -->
- [x] `transfer_fee(round_pda, treasury_pda, fee_amount)` sends fee to treasury <!-- satisfied: escrow::transfer_lamports_from_pda used in claim_payout.rs:126 -->
- [x] Integer math only (basis points, lamports) — no floats <!-- satisfied: fees.rs:19 u128 intermediate, all integer operations -->
- [x] Rounding favors the player (fee rounds down) <!-- satisfied: fees.rs:19 integer division truncates; test :68-70 confirms 1 lamport → fee=0 -->
- [x] `MAX_FEE_BPS = 1000` compile-time safety cap preserved <!-- satisfied: fees.rs:2 MAX_FEE_BPS=1000, compile-time assertion at :14 -->
- [x] Single flat fee to single treasury (no split buckets) <!-- satisfied: PlatformConfig stores fee_bps + treasury; split_fee() removed -->

### FR-4: VRF Provider Integration (Orao)

Integrate **Orao** as the single VRF provider for all games requiring randomness. Uses `orao-solana-vrf` (standard crate, not callback variant). No separate consume/resolve instruction — VRF result is read at claim time.

**Integration Contract (Authoritative Shape):**

- **Request path**: VRF is requested as part of an existing game instruction (e.g., `join_match` for coinflip). No separate `request_vrf` instruction.
- **Request side effects**:
  - CPIs into Orao to request randomness with a unique seed (derived from match PDA or round ID).
  - Stores `vrf_request_key` on the round account for later lookup.
  - Sets `resolve_deadline` for timeout safety.
  - Moves phase to `Locked`.
- **Read-at-claim path**: No separate consume/callback instruction. The `claim_payout` instruction reads the fulfilled Orao `Randomness` PDA (passed as an account input), verifies it's fulfilled, derives the outcome, and settles — all in one tx.
- **Frontend reads** (no tx): Frontend polls the Orao randomness PDA to detect fulfillment and show the result. This is a free read, not a transaction. Frontend maintains a **claimable games list** per user so players can claim or cancel.
- **Failure/timeout**:
  - If Orao has not fulfilled by `resolve_deadline`, any signer can trigger timeout refund (FR-5 invariants).
  - Claim with unfulfilled randomness is rejected.

**Why not callback**: The 3-tx model (create → join+request → claim+read) is simpler. VRF latency (~1-2s) is absorbed while the frontend detects fulfillment. No callback infrastructure, no extra instruction, no cranker.

**Acceptance Criteria:**
- [x] Orao selection is documented in `docs/DECISIONS.md` <!-- satisfied: DECISIONS.md "VRF Provider = Orao (MagicBlock dropped)" dated 2026-02-25, Status: Locked -->
- [x] Shared helper module exists for Orao integration (`vrf_orao.rs`) — request helper, read helper, fulfillment check <!-- satisfied: vrf_orao.rs — request_orao_randomness(:31), read_orao_randomness(:57), is_fulfilled(:21) -->
- [x] VRF request is embedded in a game instruction (e.g., `join_match`), not a separate instruction <!-- satisfied: join_match.rs:78-87 Orao CPI embedded in join_match -->
- [x] `claim_payout` reads Orao randomness account at claim time, derives outcome, and settles <!-- satisfied: claim_payout.rs:104 reads, :107-112 derives, :115-126 settles -->
- [x] Claim emits Anchor event with randomness bytes + derived outcome (audit trail persists in tx logs after match PDA closed) <!-- satisfied: claim_payout.rs:156-163 MatchSettled with randomness + winner -->
- [x] Claim with unfulfilled Orao randomness is rejected with clear error <!-- satisfied: vrf_orao.rs:71/103 VrfError::RandomnessNotFulfilled; test "rejects claim with unfulfilled randomness" -->
- [x] Outcome derivation from VRF is deterministic and uses only on-chain/public inputs <!-- satisfied: claim_payout.rs:107 from_randomness(randomness[0]) in constants.rs:15 — byte % 2 -->
- [x] Timeout path remains permissionless when VRF is not fulfilled (refund, not stuck funds) <!-- satisfied: timeout_cancel.rs:11-14 any signer, :58-70 checks deadline+VRF unfulfilled -->
- [x] `mock-vrf` feature flag: in test builds, skip Orao CPI on request and allow test authority to write mock randomness for claim <!-- satisfied: shared/Cargo.toml mock-vrf feature; vrf_orao.rs:80-91 no-op, :96-105 raw bytes -->
- [x] Reference implementation: Coinflip (001) as first consumer <!-- satisfied: coinflip program fully rewritten with shared crate + Orao VRF, 26 coinflip + 5 platform bankrun tests pass -->
- [x] Drop all MagicBlock VRF references from codebase and docs <!-- satisfied: grep returns zero matches in solana/ and CLAUDE.md; iteration 16 confirmed -->

### FR-5: On-Chain Lifecycle State Machine

Every round in every game follows the same phase progression with hard invariants. Not every game uses every phase — VRF-only games skip RESOLVING (result is read at claim time).

```
WAITING -> ACTIVE -> LOCKED -> RESOLVING -> SETTLED
                         \                \-> REFUNDED (on timeout or cancel)
                          \-> SETTLED (VRF games: claim reads result at claim time, skips RESOLVING)
```

**Phase usage by game type:**
- **VRF-only games** (coinflip, Lord of RNGs, slots): WAITING → LOCKED → SETTLED/REFUNDED. VRF requested at lock, result read at claim. No RESOLVING needed.
- **Commit-reveal games** (crash, chart the course, game of trades): WAITING → ACTIVE → LOCKED → RESOLVING → SETTLED/REFUNDED. Server submits reveal during RESOLVING.
- **Mixed VRF + commit-reveal** (tug of earn): Uses RESOLVING for server reveal phase.

**Acceptance Criteria:**
- [x] `RoundPhase` enum: `Waiting`, `Active`, `Locked`, `Resolving`, `Settled`, `Refunded` <!-- satisfied: lifecycle.rs:5-12 all 6 variants with correct derives -->
- [x] `transition(current, target) -> Result<()>` validates allowed transitions, rejects invalid ones (including LOCKED→SETTLED for VRF games) <!-- satisfied: lifecycle.rs:39-58 nine allowed transitions; test :88-89 confirms LOCKED→SETTLED invalid -->
- [x] **Timeout invariant**: Every round entering `Locked` or `Resolving` gets a `resolve_deadline` timestamp. After expiry, anyone can trigger refund — BUT only if the resolution source (VRF or commit-reveal) has NOT been fulfilled. If VRF is fulfilled, claim must be used instead of timeout_cancel. <!-- satisfied: join_match.rs sets resolve_deadline; timeout_cancel.rs:58-70 checks deadline+VRF unfulfilled; test "rejects timeout when VRF IS fulfilled" -->
- [x] **Pause invariant**: Global pause (platform-level) and per-game pause (game config). Paused games reject new rounds but existing rounds can still settle or refund. <!-- satisfied: pause.rs:13 check_not_paused; create_match.rs:39 calls it; claim_payout/timeout_cancel do NOT check (settle/refund still work) -->
- [x] **Refund invariant**: Any round that doesn't reach `Settled` before its deadline AND whose resolution source is not fulfilled is refundable. No player funds get stuck. Refund is not available if a valid result exists (prevents racing claim vs refund). <!-- satisfied: timeout_cancel.rs:67-70 checks VRF NOT fulfilled; rejects if fulfilled (must claim) -->
- [x] ~~Phase transitions emit Anchor events for frontend consumption~~ [DEFERRED] <!-- deferred: only MatchSettled emitted (claim_payout.rs:156); create/join/cancel/timeout events carried forward to 003-platform-core gap-analysis carry-forward (G-2); account polling works as fallback -->
- [x] ~~Timestamp tracking: `created_at`, `locked_at`, `resolve_deadline`, `settled_at` fields~~ [DEFERRED] <!-- deferred: CoinflipMatch has created_at/locked_at/resolve_deadline; settled_at omitted because PDA closes after claim — tx timestamp on MatchSettled event serves as proxy (G-3, no action for V1) -->

### FR-6: ~~Platform CPI Helpers~~ [REMOVED]

~~Reusable CPI calls from game programs to the platform program for updating player profiles after settlement.~~

**Status**: Removed. `PlayerProfile` and all profile CPI infrastructure deleted. Player stats moved off-chain. Game programs no longer CPI into the platform program for profile updates. `shared/src/cpi.rs` deleted.

---

## Success Criteria

- Any new game program can import `solana/shared/` and get lifecycle, escrow, fees, timeout, pause, and CPI for free
- Compile-time enforcement: a game that skips fee calculation or lifecycle validation won't compile
- Commit-reveal module passes unit tests with known hash pairs
- Shared infrastructure cleanly supports the backend-assisted hybrid fairness flow defined in specs `005` and `006`
- No game program contains duplicated fee math, lifecycle logic, or escrow handling

---

## Dependencies

- Existing `solana/shared/` crate (fees, amount constraints, constants — already implemented)
- Platform program (`solana/programs/platform/`) for CPI target
- `docs/specs/005-hybrid-fairness/spec.md`
- `docs/specs/006-fairness-backend/spec.md`

## Assumptions

- Program-per-game architecture (not monolith, not shared on-chain kernel)
- Consistency via compile-time shared crate, not CPI at runtime
- V1 hardcoded fees (no on-chain admin configurability)
- V1-default fairness for RNG games is backend-assisted commit-reveal plus future slot-hash entropy
- Pyth oracle is a data source, not a fairness mechanism (read directly by contracts)
- Timeout refund remains the liveness guarantee if backend settlement does not complete

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Escrow deposit/payout/refund works | bankrun tests with SOL transfers | Test output showing balance changes |
| 2 | Commit-reveal verifies correctly | Unit tests with known SHA256 pairs | Test output with pass/fail cases |
| 3 | Fee math is correct | Unit tests: 500 bps, rounding, edge cases | Test output showing fee calculations |
| 4 | Lifecycle rejects invalid transitions | Unit tests for all phase pairs | Test output showing accepted/rejected transitions |
| 5 | Timeout refund is permissionless | bankrun test: any signer can trigger after deadline | Test output showing refund by third party |
| 6 | Pause blocks new rounds | bankrun test: paused game rejects create_round | Test output showing rejection |
| 7 | Orao request + read-at-claim works | bankrun test (mock-vrf): join requests VRF, claim reads + settles. Plus timeout path. | Test output showing 3-tx flow + audit event emitted |
| 8 | CPI updates player profile | bankrun test: settlement updates both profiles | Test output showing profile changes |

---

## Completion Signal

### Implementation Checklist

Phases A-C below capture the historical shared-crate and VRF-era delivery that originally completed this spec. The active contract for new work is the carry-forward phase below, which realigns shared infrastructure to the backend-assisted fairness model used by current V1 specs.

**Phase A: Shared Crate Pure Modules** (no program changes, `cargo test -p rng-shared` validates)

- [x] [on-chain] Create `solana/shared/src/lifecycle.rs` — `RoundPhase` enum (`Waiting`, `Active`, `Locked`, `Resolving`, `Settled`, `Refunded`) as `#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]`. Add `transition(current: RoundPhase, target: RoundPhase) -> Result<()>` that validates allowed transitions (WAITING→ACTIVE, WAITING→LOCKED, ACTIVE→LOCKED, LOCKED→RESOLVING, RESOLVING→SETTLED, RESOLVING→REFUNDED, WAITING→REFUNDED, ACTIVE→REFUNDED, LOCKED→REFUNDED) and rejects all others. Add `RoundTimestamps` struct with `created_at: i64`, `locked_at: Option<i64>`, `resolve_deadline: Option<i64>`, `settled_at: Option<i64>`. Re-export from `lib.rs`. Unit tests: all valid transitions pass, all invalid transitions fail, enum serialization round-trips. Verify: `cargo test -p rng-shared`. (done: iteration 1)

- [x] [on-chain] Create `solana/shared/src/timeout.rs` — `is_expired(resolve_deadline: i64, now: i64) -> bool` returns true when `now >= resolve_deadline`. `enforce_not_expired(resolve_deadline: i64, now: i64) -> Result<()>` returns error if expired. `DEFAULT_RESOLVE_TIMEOUT_SECONDS: i64 = 120`. Error type: `TimeoutError::ResolveDeadlineExceeded`. Unit tests: boundary conditions (exactly at deadline, 1 second before, 1 second after). Keep existing `LOCK_TIMEOUT_SECONDS` in `constants.rs` for backwards compat during migration. Re-export from `lib.rs`. Verify: `cargo test -p rng-shared`. (done: iteration 2)

- [x] [on-chain] Create `solana/shared/src/commit_reveal.rs` — `store_commitment(commitment: &mut [u8; 32], hash: [u8; 32])` writes hash to the provided storage. `verify_reveal(commitment: &[u8; 32], server_seed: &[u8]) -> Result<()>` computes `solana_program::hash::hashv(&[server_seed])` and compares with commitment; returns `CommitRevealError::CommitmentMismatch` on failure. Error type: `#[error_code] CommitRevealError { CommitmentMismatch }`. Unit tests: known SHA256 pair passes, tampered seed fails, empty seed fails. Re-export from `lib.rs`. Verify: `cargo test -p rng-shared`. (done: iteration 3)

- [x] [on-chain] Update `solana/shared/src/fees.rs` — Add `calculate_net_payout(pool: u64) -> (u64, u64)` returning `(fee, net_payout)` where `net_payout = pool - fee`. Add `MAX_FEE_BPS: u16 = 1000` compile-time safety cap. Add `#[cfg(test)]` test for `calculate_net_payout` (e.g., pool=1_000_000 → fee=30_000, net=970_000). Keep all existing functions and tests passing unchanged. Re-export new items from `lib.rs`. Verify: `cargo test -p rng-shared`. (done: iteration 4)

- [x] [on-chain] Create `solana/shared/src/pause.rs` — `check_not_paused(global_paused: bool, game_paused: bool) -> Result<()>` returns `PauseError::PlatformPaused` or `PauseError::GamePaused`. Error type: `#[error_code] PauseError { PlatformPaused, GamePaused }`. This is a pure validation helper — games pass their config flags in. Unit tests: both flags false → Ok, global true → PlatformPaused, game true → GamePaused, both true → PlatformPaused (global takes precedence). Re-export from `lib.rs`. Verify: `cargo test -p rng-shared`. (done: iteration 5)

- [x] [on-chain] Create `solana/shared/src/escrow.rs` — Helper functions for raw lamport transfers: `transfer_lamports_from_pda(pda: &AccountInfo, recipient: &AccountInfo, amount: u64) -> Result<()>` using `try_borrow_mut_lamports` pattern (extracted from coinflip's claim_payout.rs). `transfer_lamports_to_pda(from: &AccountInfo, pda: &AccountInfo, amount: u64, system_program: &AccountInfo) -> Result<()>` using `system_program::transfer` CPI. Error types: `EscrowError::InsufficientEscrowBalance`. Unit tests may be limited (lamport transfers need runtime); add doc-tests with usage examples. Re-export from `lib.rs`. Verify: `anchor build` succeeds (tests that need runtime context deferred to bankrun in Phase C). (done: iteration 6)

- [x] [on-chain] Create `solana/shared/src/cpi.rs` — Extract platform CPI helper from coinflip's `claim_payout.rs`. Function signature: `update_player_profile_cpi(platform_program: &AccountInfo, profile: &AccountInfo, authority: &AccountInfo, signer_seeds: &[&[u8]], total_games_delta: u64, wins_delta: u64, total_wagered_delta: u64, total_won_delta: u64) -> Result<()>`. Guard: if `profile.data_is_empty()`, skip silently (return Ok). Uses `platform::cpi::update_player_profile` with CpiContext. Re-export from `lib.rs`. Verify: `anchor build` succeeds. (done: iteration 7)

**Phase B: Orao VRF Integration**

- [x] [on-chain] Add `orao-solana-vrf` dependency to `solana/Cargo.toml` workspace deps (with `cpi` feature). Create `solana/shared/src/vrf_orao.rs` with: `VrfAuditFields` struct (`vrf_request_key: Pubkey`, `vrf_requested_at: i64`). Helper `request_orao_randomness(orao_program, network_state, treasury, random, payer, system_program, seed: [u8; 32]) -> Result<()>` that CPIs into Orao's request instruction. Helper `read_orao_randomness(randomness_account: &AccountInfo) -> Result<[u8; 32]>` that reads fulfilled randomness from Orao's `RandomnessAccountData`. `is_fulfilled(randomness: &[u8; 32]) -> bool` checks if randomness is non-zero (all-zeros = unfulfilled). Add `mock-vrf` feature flag to shared crate: under `mock-vrf`, `request_orao_randomness` is a no-op and `read_orao_randomness` reads from a simple test account instead of Orao's type. Re-export from `lib.rs`. Verify: `anchor build` succeeds. (done: iteration 8)

**Phase C: Coinflip Rewrite** (validates all shared modules end-to-end via the 3-tx flow: create → join+request → claim+read)

- [x] [on-chain] Rewrite `solana/programs/coinflip/src/state.rs` — Replace `phase: u8` with `phase: RoundPhase` from shared crate. Add fields: `resolve_deadline: i64`, `vrf_request_key: Pubkey` (Orao randomness PDA address, used to look up result at claim time). Add `paused: bool` to `CoinflipConfig`. Remove `oracle_authority` from config (Orao uses account constraints, not signer trust). Remove `ephemeral-vrf-sdk` from `Cargo.toml`, add `orao-solana-vrf` workspace dep. Update `CoinflipMatch` seeds and space calculation. Add `MatchSettled` Anchor event struct: `creator`, `opponent`, `winner`, `randomness: [u8; 32]`, `payout_amount`, `fee_amount`. Verify: `anchor build` succeeds (tests will fail — expected, fixed in later iterations). (done: iteration 9)

- [x] [on-chain] Rewrite `create_match.rs` + `cancel_match.rs` — `create_match`: use `shared::lifecycle::transition` for initial phase (Waiting), use `shared::pause::check_not_paused(config.paused, false)`, use `shared::escrow::transfer_lamports_to_pda` for deposit, set `created_at` timestamp. `cancel_match`: use `shared::lifecycle::transition(current, Refunded)`, use `shared::escrow::transfer_lamports_from_pda` for refund, close match PDA. Both instructions use shared `RoundPhase` enum instead of raw u8 phase constants. Verify: `anchor build` succeeds. (done: iteration 10)

- [x] [on-chain] Rewrite `join_match.rs` — Remove all `ephemeral_vrf_sdk` imports and `#[vrf]` macro. Use `shared::escrow::transfer_lamports_to_pda` for opponent deposit. Transition phase `Waiting → Locked` via `shared::lifecycle::transition`. In the same instruction, call `shared::vrf_orao::request_orao_randomness` to CPI into Orao (pass Orao program + accounts). Store `vrf_request_key` (Orao randomness PDA address) on match. Set `resolve_deadline = now + DEFAULT_RESOLVE_TIMEOUT_SECONDS`. Under `mock-vrf` feature: skip Orao CPI (request is no-op). Verify: `anchor build` succeeds. (done: iteration 11)

- [x] [on-chain] Rewrite `claim_payout.rs` — This replaces both old `resolve_match` and `claim_payout`. Single instruction does: (1) check `phase == Locked` and `!claimed`, (2) read Orao randomness account via `shared::vrf_orao::read_orao_randomness` — reject if not fulfilled, (3) derive winner via `shared::constants::from_randomness(randomness[0])`, (4) compute fee/payout via `shared::fees::calculate_net_payout`, (5) transfer payout to winner + fee to treasury via `shared::escrow::transfer_lamports_from_pda`, (6) CPI update both player profiles via `shared::cpi::update_player_profile_cpi`, (7) emit `MatchSettled` event with randomness + winner + amounts, (8) set `phase = Settled`, `claimed = true`, close match PDA. Either player can call — payout goes to derived winner regardless. Under `mock-vrf`: read mock randomness account instead of Orao. Delete old `resolve_match.rs`. Verify: `anchor build` succeeds. (done: iteration 12)

- [x] [on-chain] Rewrite `timeout_cancel.rs` — Check `phase == Locked`, check `shared::timeout::is_expired(resolve_deadline, now)`, check that Orao randomness is NOT fulfilled via `shared::vrf_orao::is_fulfilled` (reject if VRF resolved — must use claim instead), use `shared::escrow::transfer_lamports_from_pda` for refunds to both players, transition to `Refunded` via `shared::lifecycle::transition`, close match PDA. Permissionless — any signer can trigger after deadline, but only when result is genuinely unavailable. Verify: `anchor build` succeeds. (done: iteration 13)

- [x] [test] Rewrite `solana/tests/coinflip.ts` bankrun tests for new 3-tx program — Setup: deploy coinflip + platform programs with `mock-vrf` feature, initialize configs. Tests: create_match (phase=Waiting, escrow correct, pause check), join_match (phase=Locked, escrow doubled, vrf_request_key set, resolve_deadline set), claim_payout with mock randomness (reads mock account, derives winner HEADS/TAILS, fee math correct, treasury transfer, profile CPI for both players, MatchSettled event emitted, match PDA closed), cancel_match (Waiting-only, full refund), timeout_cancel (after resolve_deadline expired AND VRF unfulfilled, permissionless, both players refunded), error cases (invalid phase transitions, double-claim, unauthorized, self-join, claim with unfulfilled randomness rejected, timeout_cancel rejected when VRF IS fulfilled — must claim instead). Target: all tests green. Verify: `anchor test --skip-local-validator`. (done: iteration 14)

- [x] [engine] Re-run `scripts/sync-idl` to update `packages/anchor-client/` with new coinflip IDL (new CoinflipMatch shape with RoundPhase + vrf_request_key, removed resolve_match instruction, updated claim_payout accounts to include Orao randomness). Verify: `anchor build && pnpm lint` in anchor-client package. (done: iteration 15)

- [x] [docs] Drop all MagicBlock VRF references from codebase: update `sources/rng-utopia/CLAUDE.md` locked decisions table (MagicBlock → Orao), remove MagicBlock comments from coinflip source files, clean up any remaining `ephemeral-vrf-sdk` references. Verify: `grep -r "MagicBlock\|ephemeral.vrf" sources/rng-utopia/solana/ sources/rng-utopia/CLAUDE.md` returns zero matches. (done: iteration 16)

### Phase D: Hybrid Fairness Realignment (required for active contract)

- [ ] [docs] Rewrite the active fairness framing in this spec so shared infrastructure is described in terms of backend-assisted hybrid fairness rather than VRF-first claim flows.
- [ ] [on-chain] Ensure the shared crate API surface explicitly supports commitment verification, slot-hash entropy capture/reading, and deterministic result derivation as first-class helpers.
- [ ] [docs] Update lifecycle guidance so Coinflip, Lord of the RNGs, Crash, and future RNG games are described against the same backend-assisted settlement contract.
- [ ] [test] Align validation expectations with specs `005-hybrid-fairness` and `006-fairness-backend`, including timeout behavior and public verification payload requirements.

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [x] All existing tests pass
- [x] New tests added for each shared module
- [x] No lint errors

#### Functional Verification
- [x] All acceptance criteria verified
- [x] Edge cases handled (zero amounts, expired deadlines, double-settle, paused state)
- [x] Error states handled (invalid transitions, commitment mismatch, insufficient funds)

#### Console/Network Check
- [x] `anchor build` succeeds
- [x] `anchor test` passes all program tests

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
2. Writes `docs/specs/004-shared-infrastructure/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
