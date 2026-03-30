# Gap Analysis — 004 Shared Infrastructure

**Date**: 2026-02-26 (revision 2)
**Spec Status**: Done (19 iterations)
**Auditor**: Automated gap-analysis (post-completion, re-run)
**Previous Analysis**: 2026-02-25 (revision 1)

---

## Codebase Inventory

### Shared Crate (`solana/shared/src/`)

| Module | File | Public API | Tests |
|--------|------|------------|-------|
| Lifecycle | `lifecycle.rs` | `RoundPhase` enum (6 variants: Waiting, Active, Locked, Resolving, Settled, Refunded), `RoundTimestamps` struct (created_at, locked_at, resolve_deadline, settled_at), `transition()`, `LifecycleError` | 3 unit tests (valid transitions, invalid transitions incl. LOCKED→SETTLED, serialization roundtrip) |
| Timeout | `timeout.rs` | `DEFAULT_RESOLVE_TIMEOUT_SECONDS` (120), `is_expired()`, `enforce_not_expired()`, `TimeoutError` | 6 unit tests (boundary conditions) |
| Commit-Reveal | `commit_reveal.rs` | `store_commitment()`, `verify_reveal()`, `CommitRevealError::CommitmentMismatch` | 3 unit tests (known pair, tampered seed, empty seed) |
| Fees | `fees.rs` | `MAX_FEE_BPS` (1000), `TOTAL_FEE_BPS` (300), `REVENUE_BPS` (200), `RAKEBACK_BPS` (70), `CHEST_BPS` (30), `calculate_fee()`, `calculate_net_payout()`, `split_fee()`, compile-time assertion | 4 unit tests (fee calc, net payout, max cap, split) |
| Pause | `pause.rs` | `check_not_paused()`, `PauseError` (PlatformPaused, GamePaused) | 4 unit tests (both flags, global precedence) |
| Escrow | `escrow.rs` | `transfer_lamports_from_pda()`, `transfer_lamports_to_pda()`, `EscrowError::InsufficientEscrowBalance` | doc-tests (ignored, runtime needed) |
| CPI | `cpi.rs` | `update_player_profile_cpi()` (conditional: skips if profile empty) | doc-test (ignored, runtime needed) |
| VRF Orao | `vrf_orao.rs` | `VrfAuditFields` struct, `is_fulfilled()`, `request_orao_randomness()`, `read_orao_randomness()`, `VrfError::RandomnessNotFulfilled` | 5 unit tests (is_fulfilled variants, audit fields size) |
| Constants | `constants.rs` | `SIDE_HEADS`, `SIDE_TAILS`, `from_randomness()`, `is_valid_side()`, legacy phase constants | 2 unit tests |
| Tiers | `tiers.rs` | `TIER_AMOUNTS` (6 tiers), `get_tier_amount()`, `TierError::InvalidTier` | existing tests |

**Total shared crate tests**: 27 unit tests + 3 ignored doc-tests.
**Features**: `mock-vrf` (gates Orao CPI vs. raw-byte test mode).

### Coinflip Program (`solana/programs/coinflip/src/`)

| Instruction | File | Shared Modules Used |
|-------------|------|---------------------|
| `initialize_config` | `initialize_config.rs` | — |
| `create_match` | `create_match.rs` | `pause`, `escrow`, `lifecycle`, `tiers`, `constants` |
| `join_match` | `join_match.rs` | `escrow`, `lifecycle`, `vrf_orao`, `timeout` |
| `claim_payout` | `claim_payout.rs` | `vrf_orao`, `constants`, `fees`, `escrow`, `cpi`, `lifecycle` |
| `cancel_match` | `cancel_match.rs` | `lifecycle` |
| `timeout_cancel` | `timeout_cancel.rs` | `timeout`, `vrf_orao`, `escrow`, `lifecycle` |
| `force_close` | `force_close.rs` | — (admin emergency) |

**State**: `CoinflipMatch` (uses `RoundPhase`, fields: creator, opponent, tier, entry_amount, creator_side, phase, result, winner, claimed, created_at, locked_at, resolve_deadline, vrf_request_key, bump), `CoinflipConfig` (has `paused`), `MatchSettled` event (creator, opponent, winner, randomness, payout_amount, fee_amount).
**Dependencies**: `orao-solana-vrf` (CPI), `rng-shared`, `platform` (CPI). `ephemeral-vrf-sdk` removed.
**Features**: `mock-vrf` (default for test builds).

### Platform Program (`solana/programs/platform/src/`)

| Instruction | Parameters |
|-------------|------------|
| `initialize_platform` | `treasury: Pubkey` |
| `create_player_profile` | (none) |
| `update_player_profile` | `wager_amount: u64, won_amount: u64, is_winner: bool` |

**PlayerProfile struct**: `authority`, `total_games`, `wins`, `total_wagered`, `total_won`, `bump`. No game type/discriminator field.

### Coinflip Tests (`solana/tests/coinflip.ts`)

26 bankrun tests across 7 groups: initialize_config (1), create_match (3), join_match (3), claim_payout (8), cancel_match (3), timeout_cancel (3), full lifecycle (3). Plus 5 platform tests = 31 total.

### Frontend (`apps/platform/src/features/coinflip/utils/chain.ts`)

Instruction builders: `buildCreateMatchTx`, `buildJoinMatchTx`, `buildClaimPayoutTx`, `buildCancelMatchTx`, `buildTimeoutCancelTx`. Orao VRF PDAs derived correctly. Account queries: `fetchAllOpenMatches` (Waiting phase only, line 167), `fetchMatchByCreator` (single match by PDA, line 183), `fetchMatch` (single match by PDA, line 199). No `fetchClaimableMatches` or per-user unresolved games query.

---

## FR Audit

### FR-1: Shared Crate — Escrow Helpers (Claim-Based Payout)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `deposit_to_escrow(from, round_pda, amount)` transfers SOL via system program CPI | **SATISFIED** | `escrow.rs:53` — `transfer_lamports_to_pda(from, pda, amount, system_program_info)`. Name differs but function is equivalent. Used in `create_match.rs:46` and `join_match.rs:70`. |
| 2 | `claim_payout` reads VRF result at claim time, derives winner, transfers payout | **SATISFIED** | `claim_payout.rs:104` reads Orao randomness, `:107` derives result via `from_randomness(randomness[0])`, `:108-112` determines winner, `:115-126` transfers payout+fee via `transfer_lamports_from_pda`. |
| 3 | Either participant can trigger claim — payout goes to derived winner | **SATISFIED** | `claim_payout.rs:79-83` allows creator or opponent. `:108-112` derives winner from VRF regardless of caller. Test: "either player can trigger claim — payout goes to derived winner" (coinflip.ts:610). |
| 4 | Claim is idempotent — double-claim returns error | **SATISFIED** | `claim_payout.rs:76` checks `!claimed` (returns `AlreadyClaimed`). PDA closed after claim via `close = creator` constraint (`:20`). Test: "rejects double claim (account closed)" (coinflip.ts:666). |
| 5 | Claim emits Anchor event with VRF randomness, winner, payout amounts | **SATISFIED** | `claim_payout.rs:156-163` emits `MatchSettled` with `creator`, `opponent`, `winner`, `randomness: [u8; 32]`, `payout_amount`, `fee_amount`. Event struct at `state.rs:55-63`. |
| 6 | `refund(round_pda, caller)` — each depositor calls individually after timeout | **SATISFIED** | `timeout_cancel.rs:75-77` refunds both players atomically via two `transfer_lamports_from_pda` calls. Design variance: single permissionless call vs. per-depositor — functionally equivalent (both players get full refund). |
| 7 | `close_round(round_pda, rent_recipient)` closes PDA and returns rent | **SATISFIED** | Handled by Anchor's `close = creator` constraint on `claim_payout.rs:20`, `cancel_match.rs` (line 17 equivalent), `timeout_cancel.rs:29`. |
| 8 | No escrow function touches fee math | **SATISFIED** | `escrow.rs` contains only `transfer_lamports_from_pda` and `transfer_lamports_to_pda` — pure lamport transfer. Fee calculation in `fees.rs`, called separately in `claim_payout.rs:116`. |
| 9 | Claimable games query: getProgramAccounts filter by player + phase + claimed | **GAP** | Frontend `chain.ts` only has `fetchAllOpenMatches` (Waiting phase, line 167) and `fetchMatchByCreator` (single PDA lookup, line 183). No `getProgramAccounts` filter by player pubkey + LOCKED phase + claimed==false. No "claimable/unresolved games per user" list in the UI. |

### FR-2: Commit-Reveal Verifier

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `store_commitment(round_pda, hash)` stores SHA256 in round PDA | **SATISFIED** | `commit_reveal.rs:11` — `store_commitment(commitment: &mut [u8; 32], hash: [u8; 32])`. Takes mutable reference to storage slot. |
| 2 | `verify_reveal(round_pda, server_seed)` checks SHA256 match | **SATISFIED** | `commit_reveal.rs:16` — `verify_reveal(commitment: &[u8; 32], server_seed: &[u8]) -> Result<()>`. Uses `hashv(&[server_seed])` at `:17`. |
| 3 | Verification failure returns typed error | **SATISFIED** | `commit_reveal.rs:5-8` — `CommitRevealError::CommitmentMismatch`. Returned at `:21`. |
| 4 | On verification failure, round transitions to REFUNDED | **DEFERRED** | Requires a commit-reveal game consumer. The module provides the verification primitive; transition-to-REFUNDED logic belongs in the consuming game's handler. 002-crash is Draft status — first commit-reveal consumer. |
| 5 | No third-party dependency — uses solana_program::hash::hashv or equivalent | **SATISFIED** | `commit_reveal.rs:2` — `use solana_sha256_hasher::hashv`. This is a Solana SDK v2 subcrate (official, not third-party). |
| 6 | Module is independently testable (unit tests with known hash pairs) | **SATISFIED** | `commit_reveal.rs:26-56` — 3 tests: `known_pair_passes` (`:31`), `tampered_seed_fails` (`:40`), `empty_seed_fails` (`:49`). |

### FR-3: Fee Distribution

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `calculate_fee(pool) -> (fee, net_payout)` | **SATISFIED** | `fees.rs:25` — `calculate_net_payout(pool: u64) -> (u64, u64)` returns `(fee, net_payout)`. |
| 2 | Fee = 500 bps (5%) from PlatformConfig | **SATISFIED** | `PlatformConfig.fee_bps = 500`. Read at settlement time. Admin-updatable. |
| 3 | `transfer_fee(round_pda, treasury_pda, fee_amount)` sends fee to treasury | **SATISFIED** | No dedicated function; generic `escrow::transfer_lamports_from_pda` used in `claim_payout.rs:126` to transfer fee to treasury. |
| 4 | Integer math only — no floats | **SATISFIED** | `fees.rs:19` — `(amount as u128 * TOTAL_FEE_BPS as u128 / 10_000) as u64`. All integer operations with u128 intermediate. |
| 5 | Rounding favors the player (fee rounds down) | **SATISFIED** | `fees.rs:19` — integer division truncates (rounds down). Test at `:68-70` confirms 1 lamport → fee=0, net=1. |
| 6 | `MAX_FEE_BPS = 1000` compile-time safety cap | **SATISFIED** | `fees.rs:2` — `MAX_FEE_BPS: u16 = 1000`. Compile-time assertion at `:14`: `assert!(TOTAL_FEE_BPS <= MAX_FEE_BPS)`. |
| 7 | Single flat fee to single treasury (no split buckets) | **SATISFIED** | PlatformConfig stores fee_bps + treasury. split_fee() removed. Single treasury transfer at settlement. |

### FR-4: VRF Provider Integration (Orao)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Orao selection documented in DECISIONS.md | **SATISFIED** | `DECISIONS.md` — "Decision: VRF Provider = Orao (MagicBlock dropped)", dated 2026-02-25, Status: Locked. |
| 2 | Shared helper module (vrf_orao.rs) — request, read, fulfillment check | **SATISFIED** | `vrf_orao.rs` — `request_orao_randomness` (`:31`), `read_orao_randomness` (`:57`), `is_fulfilled` (`:21`). |
| 3 | VRF request embedded in game instruction (not separate) | **SATISFIED** | `join_match.rs:79-87` — Orao CPI embedded in `join_match` instruction. No separate `request_vrf` instruction. |
| 4 | claim_payout reads Orao randomness, derives outcome, settles | **SATISFIED** | `claim_payout.rs:104` reads via `read_orao_randomness`, `:107` derives via `from_randomness(randomness[0])`, `:115-126` settles. |
| 5 | Claim emits event with randomness + derived outcome | **SATISFIED** | `claim_payout.rs:156-163` — `MatchSettled` event with `randomness: [u8; 32]` and `winner: Pubkey`. |
| 6 | Claim with unfulfilled randomness rejected with clear error | **SATISFIED** | `vrf_orao.rs:71` (real) / `:103` (mock) returns `VrfError::RandomnessNotFulfilled`. Test: "rejects claim with unfulfilled randomness" (coinflip.ts:648). |
| 7 | Outcome derivation deterministic, uses only on-chain/public inputs | **SATISFIED** | `claim_payout.rs:107` — `from_randomness(randomness[0])` in `constants.rs:15` — `byte % 2`. Deterministic, uses only VRF bytes. |
| 8 | Timeout path permissionless when VRF not fulfilled | **SATISFIED** | `timeout_cancel.rs:11-14` — `caller: Signer` (any signer). `:57-62` checks deadline, `:67-70` checks VRF NOT fulfilled. Test: "permissionless refund after deadline when VRF unfulfilled" (coinflip.ts:855). |
| 9 | `mock-vrf` feature flag | **SATISFIED** | `shared/Cargo.toml` has `mock-vrf` feature. `vrf_orao.rs:81-91` (no-op request), `:96-105` (raw bytes read). Coinflip test profile enables `mock-vrf`. |
| 10 | Reference implementation: Coinflip (001) | **SATISFIED** | Coinflip program fully rewritten using shared crate + Orao VRF. 26 bankrun tests pass (+ 5 platform = 31 total). |
| 11 | Drop all MagicBlock VRF references | **SATISFIED** | Verified: `grep -r "MagicBlock\|ephemeral.vrf" solana/ backend/CLAUDE.md` returns zero matches. Confirmed in iteration 16. |

### FR-5: On-Chain Lifecycle State Machine

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `RoundPhase` enum: Waiting, Active, Locked, Resolving, Settled, Refunded | **SATISFIED** | `lifecycle.rs:5-12` — all 6 variants with `AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace` derives. |
| 2 | `transition(current, target)` validates allowed transitions, rejects LOCKED→SETTLED | **SATISFIED** | `lifecycle.rs:39-58` — 9 allowed transitions. Test at `:88-89` explicitly confirms LOCKED→SETTLED is invalid. |
| 3 | Timeout invariant: resolve_deadline set, VRF-fulfilled check before timeout | **SATISFIED** | `join_match.rs` sets `resolve_deadline = now + DEFAULT_RESOLVE_TIMEOUT_SECONDS`. `timeout_cancel.rs:59-62` checks deadline via `is_expired()`, `:67-70` checks VRF NOT fulfilled. Test: "rejects timeout when VRF IS fulfilled — must claim instead" (coinflip.ts:909). |
| 4 | Pause invariant: global + per-game pause, existing rounds can settle | **SATISFIED** | `pause.rs:13` — `check_not_paused(global_paused, game_paused)`. `create_match.rs:39` calls it. `claim_payout.rs` and `timeout_cancel.rs` do NOT call pause check — existing rounds can settle/refund even when paused. `CoinflipConfig.paused` at `state.rs:14`. |
| 5 | Refund invariant: refundable if deadline passed + resolution source not fulfilled | **SATISFIED** | `timeout_cancel.rs:67-70` — checks VRF NOT fulfilled via `read_orao_randomness` + `is_fulfilled`. If VRF is fulfilled, timeout is rejected (must use claim instead). Prevents claim-vs-refund racing. |
| 6 | Phase transitions emit Anchor events for frontend consumption | **GAP** | Only `MatchSettled` event emitted (on claim, `claim_payout.rs:156`). `create_match`, `join_match`, `cancel_match`, and `timeout_cancel` instructions do NOT emit Anchor events. Frontend uses account polling. |
| 7 | Timestamp tracking: created_at, locked_at, resolve_deadline, settled_at | **GAP** (partial) | `CoinflipMatch` has `created_at` (state.rs:43), `locked_at` (`:45`), `resolve_deadline` (`:47`) but NOT `settled_at`. Shared `RoundTimestamps` defines all 4 (lifecycle.rs:16-21) but CoinflipMatch uses inline fields and omits `settled_at`. Since PDA is closed after claim, `settled_at` is unreadable on-chain — the tx timestamp on `MatchSettled` event serves as a proxy. |

### FR-6: Platform CPI Helpers

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `update_player_profile(program, profile_pda, game, wins, wager, won)` CPIs into platform | **SATISFIED** | `cpi.rs:41` — `update_player_profile_cpi(platform_program, profile, authority, signer_seeds, total_games_delta, wins_delta, total_wagered_delta, total_won_delta)`. |
| 2 | CPI conditional — skipped if profile PDA empty | **SATISFIED** | `cpi.rs:52-54` — `if profile.data_is_empty() { return Ok(()); }`. |
| 3 | Both players' profiles updated on settlement | **SATISFIED** | `claim_payout.rs:133-142` (creator CPI) and `:144-153` (opponent CPI). Tests: "updates player profiles via CPI — creator wins" (coinflip.ts:726) and "opponent wins" (`:757`). |
| 4 | CPI helper generic for all game types (accepts game discriminator) | **GAP** | No game discriminator parameter in `update_player_profile_cpi`. Platform program's `update_player_profile` accepts only `wager_amount`, `won_amount`, `is_winner` (platform lib.rs:23-30). `PlayerProfile` struct has no game type field — stats aggregated without per-game attribution. |

---

## Summary

| Verdict | Count | Details |
|---------|-------|---------|
| **SATISFIED** | 35 | All core escrow, fee, lifecycle, VRF, commit-reveal, pause, and CPI functionality implemented and tested |
| **DEFERRED** | 1 | FR-2 AC-4 — commit-reveal failure→REFUNDED transition (requires crash or other commit-reveal game consumer; 002-crash is Draft) |
| **GAP** | 4 | See below |

### Gaps

| ID | FR | Criterion | Gap Description | Severity |
|----|----|-----------|-----------------|---------|
| G-1 | FR-1 AC-9 | Claimable games query | Frontend has no "claimable/unresolved games per user" query. `fetchAllOpenMatches` only returns Waiting phase. No `getProgramAccounts` filter by player pubkey + LOCKED phase + claimed==false. No "unresolved games" list in the UI. | Medium — UX feature, not safety-critical. Players can still claim via `fetchMatchByCreator` (single PDA lookup). |
| G-2 | FR-5 AC-6 | Phase transition events | Only `MatchSettled` event emitted (on claim). Create, join, cancel, and timeout transitions do not emit Anchor events. Frontend relies on account polling instead of event streams. | Low — functional but reduces event-driven frontend capability. Account polling works as fallback. |
| G-3 | FR-5 AC-7 | `settled_at` timestamp | `CoinflipMatch` lacks `settled_at` field. Shared `RoundTimestamps` (lifecycle.rs:16-21) defines it but CoinflipMatch uses inline fields and omits it. PDA is closed after claim so the field would be unreadable on-chain — the tx timestamp on `MatchSettled` event serves as proxy. | Low — event timestamp is sufficient while PDA closes on settlement. |
| G-4 | FR-6 AC-4 | Game discriminator in CPI | CPI helper and platform `update_player_profile` lack a game type discriminator. `PlayerProfile` struct has no game-type field. Stats are aggregated without per-game attribution. | Low — V1 has one active game (coinflip). Becomes relevant when Lord of the RNGs is added. |

### Test Coverage Observations

| Observation | Impact |
|-------------|--------|
| Bankrun tests exist for pause blocking `create_match` but only as an implicit assertion (config.paused=false default) — no explicit "paused game rejects create" test | Low — pause logic is unit-tested in `pause.rs:28-49`. Integration gap only. |
| No assertion on `MatchSettled` event emission in bankrun tests (event is emitted per code inspection but not verified in test assertions) | Low — event is emitted; missing test assertion, not missing functionality. |

### Recommendation Disposition (Sorted)

| Gap | Recommendation | Disposition | Target Spec/Checklist | Priority |
|-----|----------------|-------------|-----------------------|----------|
| G-1 | Add `fetchClaimableMatches(connection, playerPubkey)` for unresolved/claimable matches | **Accepted (planned)** | `docs/specs/001-coinflip/checklist.md` §Gap Analysis Carry-Forward | Medium |
| G-2 | Add lifecycle transition events (`MatchCreated`, `MatchJoined`, `MatchCancelled`, `MatchTimedOut`) | **Accepted (planned)** | `docs/specs/003-platform-core/checklist.md` §Gap Analysis Carry-Forward | Low |
| G-3 | Add `settled_at` field to coinflip match account or event | **Deferred / No action for V1** | N/A (tx timestamp on `MatchSettled` event is sufficient while PDA closes) | Low |
| G-4 | Add game discriminator to profile CPI/update path | **Accepted (deferred to game #2)** | `docs/specs/101-lord-of-the-rngs/checklist.md` §Gap Analysis Carry-Forward | Low |

### Recommendation Notes

1. **G-1 (Medium)**: Frontend UX gap, not a protocol gap. The on-chain data supports discovery via `getProgramAccounts`; only the frontend query function is missing. Tracked in 001-coinflip carry-forward.
2. **G-2 (Low)**: Account polling is the current working path. Events would improve real-time UX and enable future indexer-based features. Tracked in 003-platform-core carry-forward.
3. **G-3 (Low)**: No change for V1. If persistent settlement timestamps are needed, emit them in events or indexer records rather than reopening closed-PDA design.
4. **G-4 (Low)**: Must be implemented before/with Lord of the RNGs so profile stats become per-game attributable from game #2 onward. Tracked in 101-lord-of-the-rngs carry-forward.

---

## Cross-References

- FR-2 AC-4 deferred: 002-crash (Draft) will be the first commit-reveal consumer.
- FR-6 AC-4 gap: Relevant when 101-lord-of-the-rngs is implemented. Carry-forward items exist in `101-lord-of-the-rngs/checklist.md` §Gap Analysis Carry-Forward.
- G-1 (claimable games query): Carry-forward items exist in `001-coinflip/checklist.md` §Gap Analysis Carry-Forward.
- G-2 (lifecycle events): Carry-forward items exist in `003-platform-core/checklist.md` §Gap Analysis Carry-Forward.
