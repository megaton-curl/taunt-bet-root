# Implementation History — 004-shared-infrastructure

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — lifecycle.rs

Created `solana/shared/src/lifecycle.rs` with:
- `RoundPhase` enum (6 variants) with Anchor serialization derives
- `transition(current, target) -> Result<()>` validating 9 allowed transitions, rejecting all others
- `RoundTimestamps` struct with `created_at`, `locked_at`, `resolve_deadline`, `settled_at`
- `LifecycleError::InvalidTransition` error code
- 3 unit tests: valid transitions, invalid transitions (including LOCKED→SETTLED), enum serialization roundtrip

Updated `lib.rs` to re-export `lifecycle` module.

**Verification**: `cargo test -p rng-shared` — 7 tests passed (4 existing + 3 new).

## Iteration 1 — 2026-02-25T21:35:21Z — OK
- **Log**: iteration-001.log

## Iteration 2 — timeout.rs

Created `solana/shared/src/timeout.rs` with:
- `DEFAULT_RESOLVE_TIMEOUT_SECONDS: i64 = 120` constant
- `TimeoutError::ResolveDeadlineExceeded` error code
- `is_expired(resolve_deadline, now) -> bool` — returns true when `now >= resolve_deadline`
- `enforce_not_expired(resolve_deadline, now) -> Result<()>` — returns error if expired
- 6 unit tests: boundary conditions (exactly at deadline, 1 second before, 1 second after) for both functions

Updated `lib.rs` to re-export `timeout` module. Existing `LOCK_TIMEOUT_SECONDS` in `constants.rs` preserved.

**Verification**: `cargo test -p rng-shared` — 13 tests passed (7 existing + 6 new).

## Iteration 2 — 2026-02-25T21:37:45Z — OK
- **Log**: iteration-002.log

## Iteration 3 — commit_reveal.rs

Created `solana/shared/src/commit_reveal.rs` with:
- `CommitRevealError::CommitmentMismatch` error code
- `store_commitment(commitment: &mut [u8; 32], hash: [u8; 32])` — writes hash to storage
- `verify_reveal(commitment: &[u8; 32], server_seed: &[u8]) -> Result<()>` — computes SHA256 via `solana_sha256_hasher::hashv` and compares with stored commitment
- 3 unit tests: known SHA256 pair passes, tampered seed fails, empty seed fails

Added `solana-sha256-hasher = "2.3"` to workspace deps and shared crate Cargo.toml (Solana SDK v2.x splits `solana_program` into subcrates — `hash` module now in `solana-sha256-hasher`).

Updated `lib.rs` to re-export `commit_reveal` module.

**Verification**: `cargo test -p rng-shared` — 16 tests passed (13 existing + 3 new).

## Iteration 3 — 2026-02-25 — OK

## Iteration 3 — 2026-02-25T21:45:53Z — OK
- **Log**: iteration-003.log

## Iteration 4 — fees.rs update

Updated `solana/shared/src/fees.rs` with:
- `MAX_FEE_BPS: u16 = 1000` compile-time safety cap
- Compile-time assertion: `const _: () = assert!(TOTAL_FEE_BPS <= MAX_FEE_BPS)`
- `calculate_net_payout(pool: u64) -> (u64, u64)` returning `(fee, net_payout)` where `net_payout = pool - fee`
- 2 new tests: `test_calculate_net_payout` (standard amount, zero, small rounding, 1 lamport edge case), `test_max_fee_bps_cap`

All existing functions and tests unchanged. `fees` module already re-exported from `lib.rs`.

**Verification**: `cargo test -p rng-shared` — 18 tests passed (16 existing + 2 new).

## Iteration 4 — 2026-02-25T21:47:24Z — OK
- **Log**: iteration-004.log

## Iteration 5 — pause.rs

Created `solana/shared/src/pause.rs` with:
- `PauseError::PlatformPaused` and `PauseError::GamePaused` error codes
- `check_not_paused(global_paused: bool, game_paused: bool) -> Result<()>` — global pause takes precedence
- 4 unit tests: both unpaused → Ok, global paused → PlatformPaused, game paused → GamePaused, both paused → PlatformPaused (precedence)

Updated `lib.rs` to re-export `pause` module.

**Verification**: `cargo test -p rng-shared` — 22 tests passed (18 existing + 4 new).

## Iteration 5 — 2026-02-25T21:49:13Z — OK
- **Log**: iteration-005.log

## Iteration 6 — escrow.rs

Created `solana/shared/src/escrow.rs` with:
- `EscrowError::InsufficientEscrowBalance` error code
- `transfer_lamports_from_pda(pda, recipient, amount) -> Result<()>` — direct lamport manipulation via `try_borrow_mut_lamports` with balance check
- `transfer_lamports_to_pda(from, pda, amount, system_program_info) -> Result<()>` — system program CPI transfer with explicit lifetime parameter `'a` on all `AccountInfo<'a>` refs
- Doc-test examples (marked `ignore` — need runtime context, deferred to bankrun in Phase C)

Updated `lib.rs` to re-export `escrow` module.

**Verification**: `anchor build` succeeded (release + test profiles). `cargo test -p rng-shared` — 22 unit tests passed, 2 doc-tests correctly ignored.

## Iteration 6 — 2026-02-25T21:53:37Z — OK
- **Log**: iteration-006.log

## Iteration 7 — cpi.rs

Created `solana/shared/src/cpi.rs` with:
- `update_player_profile_cpi(platform_program, profile, authority, signer_seeds, total_games_delta, wins_delta, total_wagered_delta, total_won_delta) -> Result<()>` — CPI helper for platform program's `update_player_profile` instruction
- Guard: if `profile.data_is_empty()`, silently returns `Ok(())` (player hasn't created a profile)
- Constructs CPI instruction manually (discriminator + borsh args + `invoke_signed`) to avoid circular dependency between `rng-shared` and `platform` crate
- Maps parameters: `wins_delta > 0` → `is_winner`, `total_wagered_delta` → `wager_amount`, `total_won_delta` → `won_amount`
- Doc-test example (marked `ignore` — needs runtime context)

Updated `lib.rs` to re-export `cpi` module.

**Verification**: `anchor build` succeeded (release + test profiles). `cargo test -p rng-shared` — 22 unit tests passed, 3 doc-tests correctly ignored.

## Iteration 7 — 2026-02-25T21:58:39Z — OK
- **Log**: iteration-007.log

## Iteration 8 — vrf_orao.rs (Orao VRF integration)

Created `solana/shared/src/vrf_orao.rs` with:
- `VrfAuditFields` struct (`vrf_request_key: Pubkey`, `vrf_requested_at: i64`) with `InitSpace` derive (40 bytes)
- `VrfError::RandomnessNotFulfilled` error code
- `is_fulfilled(randomness: &[u8; 32]) -> bool` — checks non-zero bytes
- `request_orao_randomness(orao_program, network_state, treasury, random, payer, system_program, seed) -> Result<()>` — CPIs into Orao's `request_v2` instruction (real mode) / no-op (mock-vrf mode)
- `read_orao_randomness(randomness_account: &AccountInfo) -> Result<[u8; 32]>` — deserializes Orao `RandomnessAccountData` and returns first 32 bytes of 64-byte randomness (real mode) / reads raw 32 bytes from account data (mock-vrf mode)
- 5 unit tests: `is_fulfilled` boundary cases + `VrfAuditFields` size check

Added `orao-solana-vrf = { version = "0.7.0", default-features = false, features = ["cpi"] }` to workspace `Cargo.toml`.
Added `mock-vrf` feature flag to `shared/Cargo.toml`.
Updated `lib.rs` to re-export `vrf_orao` module.

Note: `default-features = false` is required — the Orao crate's default `sdk` feature pulls in `anchor-client`, `solana-rpc-client`, and `getrandom` v0.3.4 which doesn't compile on the Solana SBF target.

**Verification**: `anchor build` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed (22 existing + 5 new), 3 doc-tests correctly ignored.

## Iteration 8 — 2026-02-25T22:16:28Z — OK
- **Log**: iteration-008.log

## Iteration 9 — Coinflip state.rs rewrite (Phase C begins)

Rewrote `solana/programs/coinflip/src/state.rs`:
- `CoinflipConfig`: removed `oracle_authority: Pubkey`, added `paused: bool`
- `CoinflipMatch`: replaced `phase: u8` with `phase: RoundPhase` (from shared lifecycle), added `resolve_deadline: i64` and `vrf_request_key: Pubkey`
- Added `MatchSettled` Anchor event struct with `creator`, `opponent`, `winner`, `randomness`, `payout_amount`, `fee_amount`
- Added `InitSpace` derive to `RoundPhase` enum in shared crate (required for `CoinflipMatch::INIT_SPACE`)

Updated `Cargo.toml`:
- Removed `ephemeral-vrf-sdk` dependency
- Added `orao-solana-vrf = { workspace = true }`
- Replaced `mock-oracle` feature with `mock-vrf = ["rng-shared/mock-vrf"]`

Updated instruction files for compilation (minimal changes — full rewrites in later iterations):
- `initialize_config.rs`: removed `oracle_authority` param, added `paused = false`
- `lib.rs`: updated `initialize_config` signature (removed `oracle_authority`)
- `create_match.rs`: `PHASE_WAITING` → `RoundPhase::Waiting`, initialize new fields
- `join_match.rs`: removed all `ephemeral_vrf_sdk` imports + `#[vrf]` macro, replaced with plain `#[derive(Accounts)]`, used `RoundPhase::Waiting/Locked` (Orao VRF integration deferred to iteration 11)
- `resolve_match.rs`: used `RoundPhase::Locked/Settled`, removed oracle_authority check (legacy instruction, to be deleted)
- `claim_payout.rs`: `PHASE_SETTLED` → `RoundPhase::Settled`
- `cancel_match.rs`: `PHASE_WAITING` → `RoundPhase::Waiting`
- `timeout_cancel.rs`: `PHASE_LOCKED` → `RoundPhase::Locked`

**Verification**: `anchor build` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed, 3 doc-tests correctly ignored.

## Iteration 9 — 2026-02-25T22:24:33Z — OK
- **Log**: iteration-009.log

## Iteration 10 — Rewrite create_match.rs + cancel_match.rs

Rewrote `solana/programs/coinflip/src/instructions/create_match.rs`:
- Added `CoinflipConfig` account to Accounts struct (read-only, for pause check)
- Added `shared::pause::check_not_paused(false, config.paused)` at handler top
- Replaced raw `system_program::transfer` with `shared::escrow::transfer_lamports_to_pda`
- Added `created_at = Clock::get()?.unix_timestamp` — required adding `created_at: i64` field to `CoinflipMatch` in `state.rs`
- Explicitly initializes all fields including `locked_at = 0`

Rewrote `solana/programs/coinflip/src/instructions/cancel_match.rs`:
- Replaced `require!(phase == Waiting, CannotCancel)` with `shared::lifecycle::transition(phase, Refunded)` — validates the Waiting→Refunded transition via shared helper
- Kept `close = creator` Anchor constraint for lamport transfer (escrow + rent refunded atomically)
- Removed unused `CoinflipError` import

Updated `solana/programs/coinflip/src/state.rs`:
- Added `pub created_at: i64` field to `CoinflipMatch` (auto-updates `INIT_SPACE` via derive)

**Verification**: `anchor build -p coinflip` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed, 3 doc-tests ignored.

## Iteration 10 — 2026-02-25T22:28:33Z — OK
- **Log**: iteration-010.log

## Iteration 11 — Rewrite join_match.rs (Orao VRF integration)

Rewrote `solana/programs/coinflip/src/instructions/join_match.rs`:
- Replaced raw `system_program::transfer` with `shared::escrow::transfer_lamports_to_pda` for opponent deposit
- Replaced manual `require!(phase == Waiting)` with `shared::lifecycle::transition(phase, Locked)` for Waiting→Locked validation
- Added Orao VRF accounts to `JoinMatch` struct: `orao_program`, `orao_network_state`, `orao_treasury`, `orao_random` (all `UncheckedAccount` — validated by Orao CPI internally)
- Calls `shared::vrf_orao::request_orao_randomness` with match PDA key as unique seed (no-op under `mock-vrf` feature)
- Sets `resolve_deadline = now + DEFAULT_RESOLVE_TIMEOUT_SECONDS` (120s)
- Stores `vrf_request_key = orao_random.key()` on match for claim-time VRF lookup

**Verification**: `anchor build -p coinflip` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed, 3 doc-tests correctly ignored.

## Iteration 11 — 2026-02-25T22:31:45Z — OK
- **Log**: iteration-011.log

## Iteration 12 — Rewrite claim_payout.rs (read-at-claim VRF flow)

Rewrote `solana/programs/coinflip/src/instructions/claim_payout.rs`:
- Now checks `phase == Locked` (not Settled) — VRF result is read at claim time, not via separate resolve
- Added `opponent` and `randomness_account` to Accounts struct (removed old `winner` account)
- Reads Orao randomness via `shared::vrf_orao::read_orao_randomness` — rejects if not fulfilled
- Derives winner from `shared::constants::from_randomness(randomness[0])` + `creator_side`
- Computes fee/payout via `shared::fees::calculate_net_payout`
- Transfers payout to derived winner + fee to treasury via `shared::escrow::transfer_lamports_from_pda`
- CPI updates both player profiles via `shared::cpi::update_player_profile_cpi` (shared helper, not direct platform::cpi)
- Emits `MatchSettled` event with randomness bytes, derived winner, payout/fee amounts
- Sets `phase = Settled`, `claimed = true`, `result`, `winner` directly (LOCKED→SETTLED bypasses transition() by design)
- `close = creator` Anchor constraint closes PDA after handler (rent → creator)
- Either participant can call — payout always goes to derived winner
- Under `mock-vrf`: `read_orao_randomness` reads raw 32 bytes from mock account

Deleted `solana/programs/coinflip/src/instructions/resolve_match.rs` (legacy instruction).
Updated `instructions/mod.rs` and `lib.rs` to remove `resolve_match` references.

**Verification**: `anchor build -p coinflip` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed, 3 doc-tests correctly ignored.

## Iteration 12 — 2026-02-25 — OK
- **Log**: iteration-012.log

## Iteration 12 — 2026-02-25T22:36:49Z — OK
- **Log**: iteration-012.log

## Iteration 13 — Rewrite timeout_cancel.rs

Rewrote `solana/programs/coinflip/src/instructions/timeout_cancel.rs`:
- Made **permissionless** — any signer can trigger after deadline (removed creator/opponent caller restriction)
- Uses `shared::timeout::is_expired(resolve_deadline, now)` instead of old `LOCK_TIMEOUT_SECONDS` calculation
- Added `randomness_account` to Accounts struct to check VRF fulfillment status
- Checks Orao VRF is NOT fulfilled — if VRF result exists, rejects timeout (must use `claim_payout` instead)
- Uses `shared::escrow::transfer_lamports_from_pda` for both player refunds (replaces raw lamport manipulation)
- Uses `shared::lifecycle::transition(Locked, Refunded)` for phase validation
- Sets `phase = Refunded` before Anchor's `close = creator` constraint closes PDA
- Validates `creator`, `opponent`, and `randomness_account` keys against stored match state

**Verification**: `anchor build -p coinflip` succeeded (release + test profiles). `cargo test -p rng-shared` — 27 tests passed, 3 doc-tests correctly ignored.

## Iteration 13 — 2026-02-25T22:38:43Z — OK
- **Log**: iteration-013.log

## Iteration 14 — Rewrite coinflip.ts bankrun tests (3-tx flow)

Rewrote `solana/tests/coinflip.ts` with 26 tests covering the full 3-tx program flow:
- **initialize_config** (1 test): creates config PDA with correct treasury/authority/paused
- **create_match** (4 tests): phase=Waiting, escrow correct, pause rejection, duplicate rejection
- **join_match** (3 tests): phase=Locked, escrow doubled, resolve_deadline set, self-join rejected
- **claim_payout** (9 tests): HEADS/TAILS winner derivation, fee math (3% = 300 bps), treasury transfer, profile CPI for both players, MatchSettled event emitted, match PDA closed, unfulfilled randomness rejected, double-claim rejected, unauthorized caller rejected
- **cancel_match** (3 tests): Waiting-only, full refund, rejects cancel after Locked
- **timeout_cancel** (3 tests): permissionless after deadline + unfulfilled VRF, both players refunded, rejects when VRF fulfilled
- **full lifecycle** (3 tests): create→join→claim HEADS, create→join→claim TAILS, create→cancel

Mock VRF pattern: `context.setAccount()` writes raw 32-byte randomness to mock account. HEADS = byte[0]=2 (even, non-zero=fulfilled), TAILS = byte[0]=1 (odd, non-zero), UNFULFILLED = all zeros.

**Bug fix**: `cancel_match.rs` was using `shared::lifecycle::transition(phase, Refunded)` which allowed Locked→Refunded (valid for timeout_cancel, wrong for cancel). Fixed to use explicit `require!(phase == Waiting, CannotCancel)`.

**Test runner change**: Replaced `ts-mocha` with `mocha --require tsx/cjs` in `Anchor.toml` — Node 24's native TS type stripping segfaults with solana-bankrun's native addon. Added `tsx` as devDependency.

**Verification**: `anchor test --skip-local-validator --skip-deploy` — 31 tests passed (26 coinflip + 5 platform).

## Iteration 14 — 2026-02-25 — OK
- **Log**: iteration-014.log

## Iteration 14 — 2026-02-25T23:14:22Z — OK
- **Log**: iteration-014.log

## Iteration 15 — Sync IDL to anchor-client

Ran `anchor build` to regenerate IDL files with the rewritten coinflip program, then ran `./scripts/sync-idl` to copy updated IDL JSON + TypeScript types to `packages/anchor-client/src/`.

Verified the new IDL reflects the rewrite:
- `resolve_match` instruction removed (0 matches in IDL)
- `RoundPhase` enum present (replaces `phase: u8`)
- New fields: `vrfRequestKey`, `resolveDeadline`, `createdAt`
- `MatchSettled` event struct present
- `claim_payout` accounts include `randomnessAccount`

**Verification**: `anchor build` succeeded. `pnpm lint` passed across all 17 packages (0 errors). `pnpm typecheck` passed for anchor-client.

## Iteration 15 — 2026-02-25T23:18:01Z — OK
- **Log**: iteration-015.log

## Iteration 16 — Drop MagicBlock VRF references

Removed all MagicBlock/ephemeral-vrf references from the codebase:

- `backend/CLAUDE.md`: Updated locked decisions table — "MagicBlock Ephemeral VRF" → "Orao VRF (`orao-solana-vrf`)"
- `solana/scripts/test-devnet-lifecycle.ts`: Updated "MagicBlock VRF" → "Orao VRF" in error message
- `solana/scripts/join-devnet-match.ts`: Updated "MagicBlock Ephemeral VRF" comment → "Orao VRF"
- `solana/scripts/init-devnet-config.ts`: Updated "MagicBlock VRF" comment → "Legacy VRF" (oracle_authority removed)
- `apps/platform/src/features/coinflip/utils/chain.ts`: Full rewrite to match new Orao-based IDL:
  - Replaced old VRF constants (VRF_DEFAULT_QUEUE, VRF_PROGRAM_ID, VRF_PROGRAM_IDENTITY) with Orao VRF program ID + PDA derivation helpers
  - Updated `OnChainMatch` interface for `RoundPhase` enum (replaces raw `phase: number`)
  - Added `createdAt`, `resolveDeadline`, `vrfRequestKey` fields
  - Fixed `createMatch` accounts (added `config` PDA)
  - Fixed `joinMatch` accounts (Orao program + network state + treasury + randomness PDA)
  - Fixed `timeoutCancel` accounts (added `randomnessAccount`)
  - Fixed `claimPayout` accounts (removed `winner`, added `opponent` + `randomnessAccount`)
  - Winner now derived on-chain from VRF randomness (no frontend `winner` param needed)
- `apps/platform/src/features/coinflip/context/CoinflipContext.tsx`: Updated `claimPayout` caller to match new API

**Verification**: `grep -r "MagicBlock\|ephemeral.vrf" solana/ backend/CLAUDE.md` returns zero matches. Lint, typecheck, build, unit tests, and Anchor tests all pass. Playwright visual tests fail due to pre-existing missing browser installation (unrelated to changes).

All 16 checklist items complete. Spec status updated to Done.

## Iteration 16 — 2026-02-25 — OK
- **Log**: iteration-016.log

## Iteration 16 — 2026-02-25T23:31:24Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-016.log

## Gap Analysis — 2026-02-25T23:39:15Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

## Iteration 18 — 2026-02-26T05:16:23Z — OK
- **Log**: iteration-018.log

## Iteration 19 — Final Verification

All 16 checklist items were already complete. Ran `./scripts/verify` for final confirmation:
- Installed Playwright Chromium browser + system dependencies (previously missing in devcontainer)
- Full verification passed: lint, typecheck, build, vitest, visual tests (19 Playwright), anchor build, anchor tests (31 bankrun tests)
- Exit code 0

**Result**: All items done, full verification passed. Spec complete.

## Iteration 19 — 2026-02-26T05:28:00Z — COMPLETE
- **Log**: iteration-019.log

## Iteration 19 — 2026-02-26T05:27:27Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-019.log

## Gap Analysis (Revision 2) — 2026-02-26

Re-ran gap analysis after iteration 19 final verification. Verified all FR acceptance criteria
against current codebase with exact file:line references.

- **Report**: gap-analysis.md (revision 2)
- **Findings**: 35 SATISFIED, 1 DEFERRED, 4 GAPs (unchanged from revision 1)
- **Gaps**: G-1 (claimable games query, Medium), G-2 (phase transition events, Low), G-3 (settled_at timestamp, Low), G-4 (game discriminator in CPI, Low)
- **Carry-forwards**: All 4 gaps have carry-forward items in target spec checklists (001-coinflip, 003-platform-core, 101-lord-of-the-rngs)
- **Spec annotations**: FR checkbox HTML comments verified and updated to match current line numbers

## Gap Analysis — 2026-02-26T05:33:40Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

