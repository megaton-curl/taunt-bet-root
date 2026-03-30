# Implementation History — 001-coinflip

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 0 — 2026-02-17T14:42:30Z — BLOCKED
- **Blocker**: Spec is still Draft. Run '/refine 001-coinflip' to break down the checklist.

## Iteration 1 — 2026-02-17 — DONE
- **Item**: Align shared crate tiers with spec (6 tiers Iron→Diamond)
- **Changes**:
  - `solana/shared/src/tiers.rs` — Updated TIER_AMOUNTS to `[5_000_000, 10_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000]`, renamed tier comments from Iron/Bronze/Silver/Gold/Diamond/Obsidian to Iron/Bronze/Silver/Gold/Platinum/Diamond
  - `solana/tests/coinflip.ts` — Updated `TIER_IRON_AMOUNT` from `10_000_000` to `5_000_000`
- **Verification**: `anchor build -p coinflip` succeeded. 5 passing tests (initialize_config + create_match suite) still pass. 17 pre-existing TDD stub failures unchanged.

## Iteration 1 — 2026-02-17T19:26:07Z — OK
- **Log**: iteration-001.log

## Iteration 2 — 2026-02-17 — DONE
- **Item**: Implement join_match instruction
- **Changes**:
  - `solana/programs/coinflip/src/instructions/join_match.rs` — Implemented handler: phase==WAITING check, opponent!=creator check, system_program CPI transfer of entry_amount to match PDA escrow, set opponent + phase=LOCKED
  - `solana/tests/coinflip.ts` — Fixed "rejects if not in WAITING phase" test: funded secondOpponent via `context.setAccount()` so transaction fee doesn't fail before program executes
- **Verification**: `anchor build -p coinflip` succeeded. 9 passing tests (3 join_match tests all pass). 14 pre-existing TDD stub failures unchanged (resolve_match, claim_payout, cancel_match, full lifecycle).

## Iteration 2 — 2026-02-17T19:57:46Z — OK
- **Log**: iteration-002.log

## Iteration 3 — 2026-02-17 — DONE
- **Item**: Implement resolve_match instruction
- **Changes**:
  - `solana/programs/coinflip/src/instructions/resolve_match.rs` — Replaced stub with full handler: phase==LOCKED check (InvalidPhase), oracle==config.oracle_authority check (UnauthorizedOracle), derive result via `from_randomness(randomness[0])`, determine winner based on creator_side match, set result + winner + phase=SETTLED
- **Verification**: `anchor build -p coinflip` succeeded. 14 passing tests (5 new resolve_match tests all pass). 9 pre-existing TDD stub failures unchanged (claim_payout, cancel_match, full lifecycle).

## Iteration 3 — 2026-02-17T20:10:23Z — OK
- **Log**: iteration-003.log

## Iteration 4 — 2026-02-17 — DONE
- **Item**: Implement claim_payout instruction
- **Changes**:
  - `solana/programs/coinflip/src/instructions/claim_payout.rs` — Replaced stub with full handler: phase==SETTLED check (InvalidPhase), signer==winner check (NotWinner), !claimed check (AlreadyClaimed), treasury and creator validation, compute fee via `shared::fees::calculate_fee(pool)` where `pool = entry_amount * 2`, direct lamport transfers: `(pool - fee)` to winner + `fee` to treasury, set `claimed=true`, close match account (remaining lamports → creator)
- **Verification**: `anchor build -p coinflip` succeeded. 19 passing tests (5 new claim_payout tests all pass). 4 pre-existing TDD stub failures unchanged (3 cancel_match + 1 escrow assertion).

## Iteration 4 — 2026-02-17T20:14:34Z — OK
- **Log**: iteration-004.log

## Iteration 5 — 2026-02-17 — DONE
- **Item**: Implement cancel_match instruction
- **Changes**:
  - `solana/programs/coinflip/src/instructions/cancel_match.rs` — Replaced stub with full handler: phase==WAITING check (CannotCancel), transfer all lamports (escrow + rent) from match PDA to creator (closes account)
  - `solana/tests/coinflip.ts` — Fixed pre-existing "escrows correct lamport amount" test: account for 5000 lamport tx fee in balance assertion
- **Verification**: `anchor build -p coinflip` succeeded. All 23 tests passing (3 cancel_match + 2 full lifecycle + 18 prior tests). Zero failures.

## Iteration 5 — 2026-02-17T20:25:36Z — OK
- **Log**: iteration-005.log

## Iteration 6 — 2026-02-17 — DONE
- **Item**: Create platform program scaffold (PlatformConfig + PlayerProfile + initialize_platform + create_player_profile)
- **Changes**:
  - `solana/programs/platform/src/state.rs` — Renamed `GameConfig` → `PlatformConfig`, added `treasury: Pubkey` field, removed `paused: bool`, changed seeds to `[b"platform_config"]`. Added `PlayerProfile` account with seeds `[b"player_profile", wallet]`, fields: authority, total_games, wins, total_wagered, total_won, bump.
  - `solana/programs/platform/src/error.rs` — Simplified error codes to use `= 100` offset (6100 final) matching coinflip pattern. Removed unused `Paused` variant.
  - `solana/programs/platform/src/instructions/initialize_platform.rs` — Renamed from `initialize_config.rs`. Updated to use `PlatformConfig` with `treasury` arg, seeds `[b"platform_config"]`.
  - `solana/programs/platform/src/instructions/create_player_profile.rs` — New instruction: creates PlayerProfile PDA with zeroed stats.
  - `solana/programs/platform/src/instructions/mod.rs` — Updated to export both instruction modules.
  - `solana/programs/platform/src/lib.rs` — Renamed instruction to `initialize_platform(treasury)`, added `create_player_profile`.
  - `solana/tests/platform.ts` — New bankrun test file: 5 tests (config init + double init rejection + profile creation + different wallets + double profile rejection).
- **Verification**: `anchor build` succeeds for both programs. All 28 tests passing (23 coinflip + 5 platform).

## Iteration 6 — 2026-02-17T20:32:50Z — OK
- **Log**: iteration-006.log

## Iteration 7 — 2026-02-17 — DONE
- **Item**: Add CPI from coinflip claim_payout → platform update_player_profile
- **Changes**: All code was already implemented in iteration 6 (claim_payout.rs CPI calls, update_player_profile.rs instruction, platform CPI dependency in coinflip/Cargo.toml, test helpers + 2 CPI assertion tests). This iteration verified the implementation and checked the box.
- **Verification**: `anchor build -p coinflip` succeeded. `anchor test --skip-local-validator --skip-deploy` — all 30 tests passing (25 coinflip + 5 platform), including "updates player profiles via CPI — creator wins" and "updates player profiles via CPI — opponent wins".

## Iteration 1 — 2026-02-17T20:41:34Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-001.log

## Iteration 1 (engine phase) — 2026-02-18 — DONE
- **Item**: Create anchor-client package with typed IDL exports + sync-idl script
- **Changes**:
  - `sources/rng-utopia/packages/anchor-client/package.json` — New package `@rng-utopia/anchor-client` with `@coral-xyz/anchor` + `@solana/web3.js` deps
  - `sources/rng-utopia/packages/anchor-client/tsconfig.json` — Extends base tsconfig
  - `sources/rng-utopia/packages/anchor-client/eslint.config.js` — Uses base eslint config
  - `sources/rng-utopia/packages/anchor-client/src/index.ts` — Re-exports Coinflip/Platform IDL JSON + types
  - `sources/rng-utopia/packages/anchor-client/src/coinflip.json` — Coinflip IDL (copied by sync-idl)
  - `sources/rng-utopia/packages/anchor-client/src/platform.json` — Platform IDL (copied by sync-idl)
  - `sources/rng-utopia/packages/anchor-client/src/coinflip.ts` — Coinflip type definitions (copied by sync-idl)
  - `sources/rng-utopia/packages/anchor-client/src/platform.ts` — Platform type definitions (copied by sync-idl)
  - `sources/rng-utopia/scripts/sync-idl` — Shell script to copy IDL + types from `solana/target/` into anchor-client package
- **Verification**: `pnpm lint` (17 packages) + `pnpm typecheck` (17 packages) — all pass. No regressions.

## Iteration 1 — 2026-02-18T06:40:45Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-001.log

## Iteration 7 — 2026-02-18 — DONE
- **Item**: Align game-engine with on-chain (types.ts + coinflip.ts)
- **Changes**:
  - `packages/game-engine/src/types.ts` — Updated `COIN_SIDE_VALUES` from `{heads: 1, tails: 2}` to `{heads: 0, tails: 1}` matching on-chain `SIDE_HEADS=0, SIDE_TAILS=1`
  - `packages/game-engine/src/coinflip.ts` — Complete rewrite: removed all BOLT ECS PDAs and instruction builders, removed match status helpers. Added `COINFLIP_PROGRAM_ID` (real program ID from IDL), `getMatchPda(creator)` with seeds `["match", creator]`, `getConfigPda()` with seeds `["coinflip_config"]`. Kept helpers: `getEntryAmount`, `calculatePotentialPayout`, `getOppositeSide`, `determineWinnerFromRandomness`.
  - `packages/game-engine/src/index.ts` — Updated exports to match new coinflip.ts: removed deleted function/type exports, added `COINFLIP_PROGRAM_ID`, `getMatchPda`, `getConfigPda`.
- **Verification**: `pnpm lint` (17 packages, 0 errors) + `pnpm typecheck` (17 packages, all pass). No regressions.

## Iteration 7 — 2026-02-18T07:57:13Z — OK
- **Log**: iteration-007.log

## Iteration 8 — 2026-02-18 — DONE
- **Item**: Wire CoinflipContext to anchor-client (replace mock state with on-chain)
- **Changes**:
  - `apps/platform/package.json` — Added `@coral-xyz/anchor`, `@rng-utopia/anchor-client`, `@solana/web3.js` deps
  - `apps/platform/src/features/coinflip/utils/chain.ts` — New: on-chain instruction builders (buildCreateMatchTx, buildJoinMatchTx, buildCancelMatchTx, buildClaimPayoutTx), account queries (fetchAllOpenMatches, fetchMatchByCreator, fetchMatch), PDA derivation, on-chain → UIMatch converter
  - `apps/platform/src/features/coinflip/utils/helpers.ts` — New: extracted `truncateAddress` + `getOppositeSide` pure utils (previously in mock-simulation)
  - `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — Complete rewrite: removed all mock imports, wired createMatch/joinMatch/cancelMatch/claimPayout to real on-chain instruction builders via wallet-adapter sendTransaction, poll-based active match refresh via on-chain fetch, added cancelMatch action
  - `apps/platform/src/features/coinflip/components/ActiveMatchView.tsx` — Updated import: `getOppositeSide` from `helpers` instead of `mock-simulation`
  - `apps/platform/src/features/coinflip/index.ts` — Updated re-export: `truncateAddress` from `helpers` instead of `mock-simulation`
  - `apps/platform/src/features/coinflip/utils/mock-simulation.ts` — Deleted
- **Verification**: `pnpm lint` (17 packages, 0 errors) + `pnpm typecheck` (17 packages, all pass). No regressions.

## Iteration 8 — 2026-02-18T08:05:23Z — OK
- **Log**: iteration-008.log

## Iteration 9 — 2026-02-18 — DONE
- **Item**: Wire lobby browser (sort, error handling)
- **Changes**:
  - `apps/platform/src/features/coinflip/components/OpenMatchesList.tsx` — Added sort functionality (newest/oldest/amount) via local state + `sortMatches()` helper. Sort dropdown in header.
  - `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — Added `error: string | null` + `clearError()` to context. Added `parseTransactionError()` helper that maps Solana/wallet errors (insufficient lamports, user rejected, network error, wallet not connected, program errors) to user-friendly messages. All action handlers now catch errors internally and set error state instead of throwing.
  - `apps/platform/src/pages/CoinflipPage.tsx` — Added Toast import from `@rng-utopia/ui`, destructured `error`/`clearError` from context, added error Toast display. Simplified handlers (removed try/catch wrappers since context handles errors internally).
- **Verification**: `pnpm lint` (0 errors), `pnpm typecheck` (all pass), `pnpm build` (success, 281 modules).

## Iteration 9 — 2026-02-18T08:10:33Z — OK
- **Log**: iteration-009.log

## Iteration 10 — 2026-02-18 — COMPLETE
- **Item**: All checklist items already completed in prior iterations. Ran full `./scripts/verify`.
- **Details**: All 13 implementation checklist items were `[x]`. Full verification: lint (0 errors, 8 pre-existing warnings), typecheck (all pass), build (281 modules), TS tests (pass), anchor build (2 programs), anchor test (30 passing). Note: `CI=true` required for `./scripts/verify` since vitest hangs in watch mode without it.
- **Verification**: `CI=true ./scripts/verify` — exit code 0. `=== VERIFICATION PASSED (full) ===`
- **Status update**: Spec Meta Status changed from `Ready` to `Done`.

## Iteration 10 — 2026-02-18T09:20:38Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-010.log

## Iteration 10 (Phase 2) — 2026-02-26 — DONE
- **Item**: [engine] Fix tier naming and amounts — emerald→platinum rename + TIER_AMOUNTS update
- **Finding**: Already complete from prior work. `packages/game-engine/src/types.ts` already has `Tier = "iron" | "bronze" | "silver" | "gold" | "platinum" | "diamond"` with correct SOL amounts `{0.005, 0.01, 0.1, 0.25, 0.5, 1.0}`. `packages/ui/src/layouts/TierSelector.tsx` also uses "platinum" with matching amounts. No TypeScript file contains `"emerald"` as a string literal tier value. No CSS files contain "emerald" class names. Remaining "emerald" occurrences in code are descriptive text only (boss-raid dragon description, color comments in CrashChart, game description strings in App.tsx — not tier type references).
- **Verification**: `pnpm lint` (17/17 packages, 0 errors) + `pnpm typecheck` (17/17 packages, all pass). No regressions.

## Iteration 10 — 2026-02-26T08:15:21Z — OK
- **Log**: iteration-010.log

## Iteration 11 — 2026-02-26 — DONE
- **Item**: [frontend] Verify tier display correctness after amounts fix
- **Finding**: All tier display values are correct and flow from `TIER_AMOUNTS`. Verified:
  - `TierSelector` (packages/ui): defines `TIER_AMOUNTS` with correct values `{iron: 0.005, bronze: 0.01, silver: 0.1, gold: 0.25, platinum: 0.5, diamond: 1.0}`, renders via `TIER_AMOUNTS[tier]` at line 80
  - `CoinflipPage`: imports `TIER_AMOUNTS` from `@rng-utopia/game-engine/browser`, uses `TIER_AMOUNTS[selectedTier]` for entry display (line 144) and payout calc (line 91)
  - `MatchCard`: displays `match.entryAmount` (line 48) which flows from `chain.ts` → `TIER_AMOUNTS`
  - `chain.ts`: `entryAmountSol = TIER_AMOUNTS[tier]` (line 136), imported from game-engine
  - No hardcoded tier amounts found in coinflip feature files — all flow from `TIER_AMOUNTS`
  - All tier names use "platinum" (not "emerald") — rename from iteration 10 is fully propagated
- **Changes**: None needed — verification-only item, all values already correct
- **Verification**: `pnpm build` succeeded (419 modules, 8.33s)

## Iteration 11 — 2026-02-26T08:18:12Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-02-26 — DONE
- **Item**: [frontend] Add `fetchClaimableMatches(connection, playerPubkey)` to chain.ts
- **Changes**:
  - `apps/platform/src/features/coinflip/utils/chain.ts` — Added `fetchClaimableMatches()` function using `getProgramAccounts` with memcmp filters. Two parallel queries: one for creator (offset 8) and one for opponent (offset 40), both filtered by `claimed == false` (offset 116, base58 "1"). Results merged with dedup by PDA key, refunded phase excluded in post-filter. Returns `UIMatch[]`.
- **Verification**: `pnpm typecheck` — 17/17 packages pass (platform cache miss → pass).

## Iteration 12 — 2026-02-26T08:21:38Z — OK
- **Log**: iteration-012.log

## Iteration 13 — 2026-02-26 — DONE
- **Item**: [frontend] Surface claimable matches in CoinflipContext + CoinflipPage
- **Changes**:
  - `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — Added `claimableMatches: UIMatch[]` to context state and interface. Imported `fetchClaimableMatches` from chain.ts. Modified `refreshMatches` to also poll claimable matches when `publicKey` is available. Added `selectMatch(match: UIMatch)` action to open a claimable match in ActiveMatchView.
  - `apps/platform/src/pages/CoinflipPage.tsx` — Added "Your Matches" section above the open lobby list. Shows when connected and claimableMatches is non-empty. Each match card displays tier (colored), entry amount, phase badge (Waiting/Locked/Settled), and action button (Claim/Settle/Cancel/View). Clicking a card or button calls `selectMatch` to open it in ActiveMatchView where existing claim/cancel actions work.
- **Verification**: `pnpm build` succeeded (419 modules, 7.99s)

## Iteration 13 — 2026-02-26T08:26:07Z — OK
- **Log**: iteration-013.log

## Iteration 14 — 2026-02-26 — DONE
- **Item**: [on-chain] Add `vrf_request_key: Pubkey` field to `MatchSettled` event
- **Changes**:
  - `solana/programs/coinflip/src/state.rs` — Added `pub vrf_request_key: Pubkey` field to `MatchSettled` event struct (line 63)
  - `solana/programs/coinflip/src/instructions/claim_payout.rs` — Added `vrf_request_key: coinflip_match.vrf_request_key` to `emit!(MatchSettled { ... })` (line 163)
- **Verification**: `anchor build -p coinflip` succeeded. `anchor test --skip-local-validator --skip-deploy` — all 31 tests passing. Zero failures.

## Iteration 14 — 2026-02-26T08:28:20Z — OK
- **Log**: iteration-014.log

## Iteration 15 — 2026-02-26 — DONE
- **Item**: [engine] Re-sync IDL after MatchSettled event change
- **Changes**:
  - Ran `./scripts/sync-idl` — copied updated `coinflip.json`, `coinflip.ts`, `platform.json`, `platform.ts` into `packages/anchor-client/src/`
  - Verified `vrf_request_key` field present in MatchSettled event in IDL JSON (line 894) and as `vrfRequestKey` in TypeScript types (line 900)
- **Verification**: `pnpm typecheck` — 17/17 packages pass (anchor-client cache miss → recompiled + passed, platform cache miss → passed). No regressions.

## Iteration 15 — 2026-02-26T08:29:47Z — OK
- **Log**: iteration-015.log

## Iteration 16 — 2026-02-26 — DONE
- **Item**: [frontend] Build fairness verification utility
- **Changes**:
  - `apps/platform/src/features/coinflip/utils/verification.ts` — New file: exports `VerificationResult` interface and `verifyMatch(connection, claimTxSignature)` async function. Implementation: (1) fetches parsed transaction by signature, (2) uses Anchor `EventParser` + `BorshCoder` to extract `MatchSettled` event from program logs, (3) reads 32-byte randomness from event and converts to hex, (4) re-derives coin flip result via `randomness[0] % 2` (matching on-chain `from_randomness`), (5) validates winner is one of creator/opponent, (6) fetches Orao VRF randomness account by `vrfRequestKey` and checks for non-zero randomness bytes to confirm fulfillment. Returns `{verified, creator, opponent, winner, randomnessHex, derivedResult, vrfFulfilled}`.
- **Verification**: `pnpm typecheck` — 17/17 packages pass (platform cache miss → recompiled + passed). No regressions.

## Iteration 16 — 2026-02-26T08:34:09Z — OK
- **Log**: iteration-016.log

## Iteration 17 — 2026-02-26 — DONE
- **Item**: [frontend] Build fairness verification UI
- **Changes**:
  - `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — Added `lastClaimSignature: string | null` state + context field. Modified `claimPayout` to store claim tx signature and keep activeMatch with `claimed: true` locally (instead of nulling) so user can verify fairness before returning to lobby. Updated poller to skip match fetch when `claimed===true` (PDA is closed). Clear signature on `clearActiveMatch`.
  - `apps/platform/src/features/coinflip/components/ActiveMatchView.tsx` — Added verification props: `claimTxSignature`, `verificationResult`, `verifying`, `onVerify`. In complete+claimed phase: shows "Verify Fairness" button + "Back to Lobby" side by side. After verification: shows inline panel with status badge (Verified/Failed), claim TX, randomness hex, derived result, winner address, VRF fulfillment status, and link to /fairness page.
  - `apps/platform/src/pages/CoinflipPage.tsx` — Added `useConnection` hook, `verifyMatch` import, local verification state (`verificationResult`, `verifying`). Wired `handleVerify` callback that calls `verifyMatch(connection, lastClaimSignature)`. Passes all verification props to ActiveMatchView.
  - `apps/platform/src/App.tsx` — Added coinflip VRF verification section to FairnessPage verify tab. Users can paste a claim tx signature and click "Verify Coinflip" to run on-chain VRF verification. Shows result details: derived result (Heads/Tails with color), winner, randomness hex, VRF fulfillment, creator, opponent.
  - `apps/platform/src/index.css` — Added CSS for `.coinflip-active-match__post-claim`, `.coinflip-verification` panel (title, badge, rows, hash, check/cross icons, link), and `.coinflip-vrf-details` / `.coinflip-vrf-row` / `.vrf-hash` / `.vrf-heads` / `.vrf-tails` for FairnessPage.
- **Verification**: `pnpm build` succeeded (420 modules). `pnpm typecheck` — 17/17 packages pass (platform cache miss → recompiled + passed).

## Iteration 17 — 2026-02-26T08:42:45Z — OK
- **Log**: iteration-017.log

## Iteration 18 — 2026-02-26 — DONE
- **Item**: [frontend] Add rematch button to ActiveMatchView ("Play Again")
- **Changes**:
  - `apps/platform/src/features/coinflip/components/ActiveMatchView.tsx` — Added `onRematch?: () => void` and `rematching?: boolean` props. Added "Play Again" button in the post-claim section (between "Verify Fairness" and "Back to Lobby"), disabled while creating.
  - `apps/platform/src/pages/CoinflipPage.tsx` — Added `rematchPending` state + useEffect pattern to trigger `createMatch` after tier/side state settles from rematch. Added `handleRematch` callback that sets `selectedTier` to match tier, `selectedSide` to player's original side, clears active match, then triggers createMatch via the effect. Passed `onRematch={handleRematch}` and `rematching={creating}` to ActiveMatchView.
- **Verification**: `pnpm build` succeeded (420 modules, 7.62s)

## Iteration 18 — 2026-02-26T08:45:46Z — OK
- **Log**: iteration-018.log

## Iteration 19 — 2026-02-26 — DONE
- **Item**: [test] Validate carry-forward invariants against post-004 code
- **Findings**:
  - **(a) vrf_request_key stored + emitted**: ✓ `state.rs:49` CoinflipMatch has `vrf_request_key: Pubkey`, `state.rs:63` MatchSettled event has `vrf_request_key: Pubkey`, `claim_payout.rs:163` emits `vrf_request_key: coinflip_match.vrf_request_key`
  - **(b) from_randomness is pure deterministic**: ✓ `shared/src/constants.rs:14-17` — `pub fn from_randomness(byte: u8) -> u8 { byte % 2 }`. No RNG, no state, no side effects. Tests at `:29-34` confirm 0→heads, 1→tails, 2→heads, 255→tails.
  - **(c) timeout_cancel guards**: ✓ `timeout_cancel.rs:4-5` imports `is_expired` + `is_fulfilled`/`read_orao_randomness`. Line 60: `require!(is_expired(coinflip_match.resolve_deadline, now), LockTimeoutNotElapsed)`. Lines 64-70: reads Orao randomness, requires `!vrf_is_fulfilled` (InvalidPhase if VRF already fulfilled). `shared/src/timeout.rs:12-15` `is_expired(deadline, now) → now >= deadline`. `shared/src/vrf_orao.rs:20-23` `is_fulfilled(r) → r.iter().any(|&b| b != 0)`.
  - **(d) phase + idempotency checks**: ✓ `join_match.rs:57-58` calls `lifecycle::transition(coinflip_match.phase, RoundPhase::Locked)?` (rejects non-WAITING). `claim_payout.rs:71-76` `require!(phase == Locked, InvalidPhase)` + `require!(!coinflip_match.claimed, AlreadyClaimed)`.
  - **(e) pause check + VRF unfulfilled → claim rejects**: ✓ `create_match.rs:5` imports `check_not_paused`, line 39: `check_not_paused(false, ctx.accounts.config.paused)?`. `claim_payout.rs:104` `let randomness = read_orao_randomness(&ctx.accounts.randomness_account)?` — propagates error if VRF unfulfilled. `shared/src/pause.rs:13-21` returns `PlatformPaused`/`GamePaused` errors.
- **Verification**: `anchor build -p coinflip` succeeded. `anchor test --skip-local-validator --skip-deploy` — all 31 tests passing. Zero failures.

## Iteration 19 — 2026-02-26T08:48:24Z — OK
- **Log**: iteration-019.log

## Iteration 20 — 2026-02-26 — DONE
- **Item**: [frontend] Remove dead code
- **Changes**:
  - `apps/platform/src/features/coinflip/utils/chain.ts` — Deleted `buildCreateMatchInstruction` function (lines 265-290) and removed unused `type TransactionInstruction` import. Only `buildCreateMatchTx` was ever used.
  - `apps/platform/src/features/coinflip/types.ts` — Removed stale "Simplified match type for UI/mock mode" JSDoc comment from `UIMatch` interface (leftover from mock era).
- **Verification**: `pnpm lint` (0 errors, 10 pre-existing warnings) + `pnpm typecheck` (17/17 pass). No regressions.

## Iteration 20 — 2026-02-26T08:50:08Z — OK
- **Log**: iteration-020.log

## Iteration 21 — 2026-02-26 — DONE
- **Item**: [docs] Update spec artifacts
- **Changes**:
  - `docs/specs/001-coinflip/gap-analysis.md` — Full refresh: removed all MagicBlock VRF / resolve_match references, updated to Orao VRF / 3-tx-flow architecture. Updated instruction inventory (removed resolve_match, added force_close, added shared crate modules: lifecycle, escrow, timeout, pause, vrf_orao, commit_reveal, cpi). Updated test counts to 31 (26 coinflip + 5 platform). FR-3 all SATISFIED (was RESOLVED/PARTIAL). FR-5 all SATISFIED (was DEFERRED). FR-7.6 SATISFIED (was GAP). Deferred items reduced from 10 to 5. Added verification.ts + claimable matches to frontend inventory. Resolved Items table expanded with dates.
  - `docs/specs/001-coinflip/checklist.md` — Marked all 5 Refinement Carry-Forward items as resolved with evidence (iterations 14-19). Marked all 3 Gap Analysis Carry-Forward items as resolved (iterations 12-13). Updated VRF approach from "Mock oracle for V1" to "Orao VRF (post-004 rewrite)". Updated Open Item #8 from Deferred to Resolved. Updated Notes with final counts.
  - `docs/specs/001-coinflip/history.md` — Added this Phase 2 refinement entry.
- **Verification**: docs-only changes, no verification needed.

## Phase 2 Refinement Summary (2026-02-26)

Phase 2 added 19 checklist items to address gaps identified after the 004 shared-infrastructure rewrite. All 19 items completed across iterations 10-20:

| Category | Items | Iterations |
|----------|-------|------------|
| Data consistency (tier rename + amounts) | 2 | 10-11 |
| Claimable matches (G-1) | 2 | 12-13 |
| Fairness verification (FR-5) | 4 | 14-17 |
| Quick rematch (FR-7.6) | 1 | 18 |
| Validation & cleanup | 4 | 19-21 |

Architecture changes from 004 rewrite:
- **VRF**: MagicBlock Ephemeral VRF → Orao VRF (shared vrf_orao module)
- **Flow**: 4-tx (create→join→resolve→claim) → 3-tx (create→join(+VRF)→claim(+settle))
- **resolve_match**: Deleted. Winner derivation moved to claim_payout (reads Orao randomness at claim time).
- **Shared crate**: Expanded with lifecycle, escrow, timeout, pause, vrf_orao, commit_reveal, cpi modules.
- **Tests**: 30 → 31 bankrun tests (added timeout_cancel + lifecycle tests, removed resolve_match tests).

## Iteration 21 — 2026-02-26T08:54:11Z — OK
- **Log**: iteration-021.log

## Iteration 22 — 2026-02-26 — DONE
- **Item**: [test] Update visual baselines for coinflip pages
- **Finding**: All 17 visual tests (12 route baselines + 5 state variants) pass with zero diff. No baseline updates needed. Tier rename (emerald→platinum) and amount changes were already reflected in existing baselines. New UI elements from Phase 2 (fairness verification panel, rematch button, claimable matches section) only appear in specific match states (post-claim, active match) that aren't exercised by the current visual test routes/states. **Result: PASS** — no code changes or baseline updates required.
- **Verification**: `npx playwright test e2e/visual/` — 17 passed (1.5m)

## Iteration 22 — 2026-02-26T09:01:48Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-022.log

## Gap Analysis — 2026-02-26T09:09:28Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

## Iteration 23 — 2026-03-12 — OK
- **Item**: Phase 3 devnet backend-backed flow realignment
- **Changes**:
  - Restored the backend create happy path so server-built transactions again create the player profile if needed, increment `PlayerProfile.match_nonce`, and then call `create_match` in one atomic transaction.
  - Required strict confirmation metadata for backend-partially-signed transactions by carrying `lastValidBlockHeight` from backend build -> route response -> frontend send/confirm.
  - Upgraded the devnet `coinflip` deployment to the current account layout and aligned the backend settlement worker plus E2E helpers to the `248`-byte match account shape.
  - Hardened deterministic devnet-wallet cleanup to recover from stale occupied PDAs and orphan waiting/locked matches created by older broken test runs.
  - Updated devnet lifecycle assertions to reflect the real backend-assisted happy path: backend creates, players join, backend settles, fairness payload is served, and the match PDA closes on chain.
- **Verification**:
  - `pnpm --filter @rng-utopia/backend test` — pass
  - `bash apps/platform/scripts/run-e2e-devnet.sh apps/platform/e2e/devnet/lifecycle.spec.ts` — pass
  - `bash apps/platform/scripts/run-e2e-devnet.sh apps/platform/e2e/devnet/smoke.spec.ts` — pass
  - `VITE_RPC_URL=... VITE_COINFLIP_PROGRAM_ID=... VITE_PLATFORM_PROGRAM_ID=... VITE_FAIRNESS_BACKEND_URL=http://127.0.0.1:3100 pnpm test:e2e:devnet` — pass via the standard devnet entrypoint (lifecycle green with one retry, Lord test skipped without Lord env)

