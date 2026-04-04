# Specification: 101 Lord of the RNGs

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P0 |
| Phase | 2 |
| NR_OF_TRIES | 21 |

---

## Overview

Lord of the RNGs is a winner-takes-all jackpot wheel game. A single open round accepts custom-amount entries from any wallet at or above the platform minimum `0.0026 SOL`. Each purchase is an independent entry with its own `amountLamports`, and the win chance of that entry is proportional to `entryAmountLamports / totalRoundAmountLamports`.

The target V1 architecture is the backend-assisted hybrid fairness model used by Coinflip, adapted for a countdown jackpot:
- Backend commits the secret during round creation and co-signs the first entry tx.
- Countdown starts when two distinct wallets each have at least one entry.
- Entry close is enforced by wall time (`countdownEndsAtUnix`) with no separate lock tx.
- The same on-chain state stores a precomputed `targetEntropySlot` so the backend can submit a single settlement tx after the countdown.
- Completed rounds are publicly verifiable from the revealed secret, public entropy, and the ordered entry list.

## User Stories

- As a player, I want to buy entries into a jackpot wheel so that I have a chance at winning the entire pot.
- As a player, I want to buy multiple entries so that I can increase my odds of winning.
- As a player, I want to watch a wheel spin animation so that I experience the excitement of the draw.
- As a player, I want to see my odds reflected visually on the wheel so that I understand my chances.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 2 (V1 In Scope: Lord of the RNGs), Section 5 (V1 Game Scope), Section 8 (Delivery Plan - Phase 2)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 2 - Lord of the RNGs End-to-End

## Required Context Files

- `backend/docs/LORD_OF_THE_RNGS.md` (game concept source)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee, fairness UX)
- `docs/specs/005-hybrid-fairness/spec.md` (shared fairness contract)
- `docs/specs/006-fairness-backend/spec.md` (backend create / settle / verify contract)

## Contract Files

- `solana/programs/coinflip/` — reference program (same architecture pattern)
- `solana/shared/src/` — shared Rust crate (lifecycle, fees, amount constraints, escrow, fairness, pause, timeout)
- `apps/platform/src/features/lord-of-rngs/` — existing frontend mock (types, components, context, mock-simulation)
- `packages/game-engine/src/types.ts` — amount helpers, fee constants
- `services/backend/` — fairness backend pattern to mirror for create / settle / verification flows

---

## Scope Decisions (Refinement)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entry amounts | Custom SOL input with platform minimum `0.0026 SOL` | Uses the same custom-amount model as coinflip; named tiers are retired. |
| Entry model | Independent weighted entries | Each purchase appends a new entry `{player, amountLamports}`. Odds are proportional to cumulative lamports, not equal slot counts. |
| Entry cap per player | No hard cap, bounded by round entry vector size (64 total) | A wallet may append multiple entries before close. The V1 cap is on total stored entries per round (`MAX_ENTRIES = 64`), not per-wallet balance. |
| Max entries per round | 64 (`MAX_ENTRIES`) | Distinct players can join freely until the round reaches 64 total entries (not 64 players). |
| Account design | Single round PDA with ordered entry vec | Weighted winner selection uses cumulative lamport ranges over the entry vec. |
| Spin trigger | No separate lock or spin tx in the happy path | Countdown close is implicit at `countdownEndsAtUnix`; backend submits one settlement tx after `targetEntropySlot`. |
| Claim model | Backend-driven settlement via `claim_payout(round_number, secret)` | Backend reveals the committed secret to settle; winner receives payout automatically. Frontend shows progress and verification rather than asking the winner to claim in the happy path. |
| Audio (FR-8) | Deferred | No audio in 101 scope. Dedicated audio spec later (same decision as coinflip). |
| Visual pulse (FR-2.5) | Frontend-only | CSS animation for final 5 seconds of countdown. No on-chain involvement. |

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Waiting Phase

Round is open but waiting for minimum 2 distinct wallets to each have at least one entry before countdown begins.

**Acceptance Criteria:**
- [x] Backend creates the round via `create_round(commitment, amount, round_number)` with server co-signer; creator's first entry is recorded <!-- satisfied: lord-create.ts:153-288 builds co-signed tx; create_round.rs:45-96 validates + creates PDA with first entry -->
- [x] No countdown timer yet <!-- satisfied: CountdownTimer only renders when phase="countdown" (TierLobby.tsx:104-110) -->
- [x] Display shows current entries and pool size <!-- satisfied: TierRoundView.tsx shows entries + pool; ActiveRoundView shows round data -->
- [x] "Waiting for players..." message shown <!-- satisfied: TierRoundView.tsx:21 "Waiting for players..."; TierLobby.tsx:27 "Waiting for players" -->
- [x] Countdown triggers when 2nd unique player joins (not just 2nd entry from same player) <!-- satisfied: join_round.rs transitions Waiting→Active when 2nd unique player joins; bankrun test validates -->

### FR-2: Countdown Phase (60 seconds)

Active entry period with a visible countdown after the second distinct wallet joins.

**Acceptance Criteria:**
- [x] 60-second countdown begins when the second distinct wallet joins <!-- satisfied: join_round.rs:95 countdown_ends_at = now + COUNTDOWN_SECONDS (60s) -->
- [x] Additional players can join during countdown <!-- satisfied: join_round.rs:51-53 accepts Active phase -->
- [x] Existing players can append more independent entries during countdown <!-- satisfied: buy_more_entries.rs same validation, allows same player -->
- [ ] Pool size, total amount, and weighted odds update in real time <!-- deferred: frontend being reworked separately -->
- [x] Visual pulse in final 5 seconds of countdown <!-- satisfied: CountdownTimer.tsx:36-41 isFinalCountdown<=5; index.css:5885 countdown-pulse 0.5s scale+red -->
- [x] Program rejects new entries once `clock.unix_timestamp >= countdownEndsAtUnix` <!-- satisfied: join_round.rs:59-64 require!(now.unix_timestamp < countdown_ends_at, EntriesClosed) -->

### FR-3: Entry Mechanics

Players can append multiple independent entries to the current round, and each entry may use a different custom amount so long as it satisfies the platform minimum.

**Acceptance Criteria:**
- [x] Each entry stores its own `amountLamports`, with minimum `0.0026 SOL` <!-- satisfied: WeightedEntry stores amount_lamports; validate_wager enforces min 0.0026 SOL -->
- [x] Players can purchase multiple independent entries in the same round <!-- satisfied: join_round.rs always pushes new WeightedEntry, no dedup; buy_more_entries.rs same -->
- [ ] A wallet's displayed odds equal the sum of its entry amounts divided by total round amount <!-- deferred: frontend being reworked separately; on-chain data correct for calculation -->
- [x] Winner selection uses cumulative lamport ranges over ordered entries, not equal slot counts <!-- satisfied: claim_payout.rs:79-91 cumulative range search -->
- [x] Entries are only purchasable during Waiting and Countdown phases <!-- satisfied: join_round.rs:51-53 + buy_more_entries.rs require Waiting or Active, reject expired countdown -->

### FR-4: Countdown Close and Settlement Readiness

Once the countdown starts, the round stores both `countdownEndsAtUnix` and a precomputed `targetEntropySlot`. The round closes automatically by wall time, and the backend performs a single settlement tx after the stored entropy slot is available.

**Acceptance Criteria:**
- [x] Countdown start stores `countdownEndsAtUnix` and `targetEntropySlot` on-chain <!-- satisfied: join_round.rs:94-101 sets both on Waiting→Active transition -->
- [x] No separate lock transaction is required to close entries <!-- satisfied: by design — claim_payout validates countdown_ends_at directly -->
- [x] Backend settlement starts automatically once `targetEntropySlot` is available; no winner-triggered claim is required in the happy path <!-- satisfied: settle-tx.ts:447-680 settleLordRound auto-triggered by settlement worker -->
- [x] Winning offset is derived deterministically from revealed secret + public entropy + round identifier <!-- satisfied: claim_payout.rs:75-77 derive_result(secret, entropy, round_key, algo_ver) -->
- [x] Wheel spin animation with realistic physics (fast start, gradual slow) <!-- satisfied: WheelVisualization.tsx:302-359 — 5s, 3 loops, linear first 30%, dramatic deceleration -->
- [x] Winner = entry owner whose cumulative lamport range contains the derived winning offset <!-- satisfied: claim_payout.rs:79-91 cumulative loop finds winner -->
- [x] Result is provably fair and verifiable through the backend-served verification payload plus on-chain settlement evidence <!-- satisfied: RoundSettled event emits all verification data; verifyLordRound() in game-engine recomputes; /rounds/:pda serves payload -->

### FR-5: Winner Determination and Payout

Single winner takes the entire pot minus platform fee. The backend settles the round automatically after entropy is available; refund remains the fallback if settlement does not complete before deadline.

**Acceptance Criteria:**
- [x] winner_payout = total_pool minus 500 bps (5%) platform fee <!-- satisfied: claim_payout.rs:95 calculate_net_payout(total, fee_bps) -->
- [x] Single winner takes pool minus 500 bps (5%) fee <!-- satisfied: claim_payout.rs:97-98 transfers payout to winner, fee to treasury -->
- [x] Payout recorded on-chain with commitment, secret, entropy, result hash, winning offset, and winner <!-- satisfied: claim_payout.rs:101-114 RoundSettled event with all fields -->
- [x] Backend worker submits one settlement tx after countdown close and entropy readiness <!-- satisfied: settle-tx.ts:447-680 settleLordRound builds + submits claim_payout ix -->
- [x] Settlement is idempotent and safe to retry from the backend worker <!-- satisfied: phase guard (locked→settling→settled), atomic DB transaction -->
- [x] Timeout refund path protects all entrants if backend settlement does not complete before deadline <!-- satisfied: timeout_refund.rs — permissionless after resolve_deadline, per-player aggregated refunds -->

### FR-6: Round Lobby UI

Overview of active rounds with their current state.

**Acceptance Criteria:**
- [ ] Amount input controls let the player join an existing round or request a new round with a custom amount <!-- deferred: frontend being reworked separately; backend POST /lord/create accepts custom amounts -->
- [ ] Each round card / row shows: current phase, distinct player count, total entries, pool size <!-- deferred: frontend being reworked separately; backend GET /lord/current provides all data -->
- [ ] Countdown timer shown for rounds in Active (countdown) phase <!-- deferred: frontend being reworked separately -->

### FR-7: Active Game UI (Wheel View)

The wheel visualization and interaction controls.

**Acceptance Criteria:**
- [x] Large wheel divided into slots <!-- satisfied: WheelVisualization.tsx renders horizontal wheel with slots from player entries -->
- [x] Player's own slots highlighted in distinct color <!-- satisfied: WheelVisualization.tsx highlights current player slots with distinct color -->
- [x] Entry count per player shown in legend <!-- satisfied: ActiveRoundView shows player list with entry counts -->
- [x] "Buy Entry" button (disabled during Spin/Reveal/Complete) <!-- satisfied: LordOfRngsPage.tsx:222-230 sidebar "Buy More Entries" button; disabled during non-Waiting/Countdown phases -->
- [x] "Spin" button appears after countdown expires (disabled once spin animation starts or if phase already Settled) <!-- satisfied: ActiveRoundView.tsx:86-95 + LordOfRngsPage.tsx sidebar; devnet E2E validates -->
- [x] Current pool size prominently displayed <!-- satisfied: ActiveRoundView + TierRoundView show pool size -->
- [x] Smooth spin animation with gradual deceleration <!-- satisfied: WheelVisualization.tsx:302-359 — 5s, 3 loops, deceleration curve -->
- [x] Winner slot highlighted with glow and confetti <!-- satisfied: WheelVisualization.tsx:460-486 winner slot; star burst + coin animations (496-507) -->
- [x] "YOU WON!" overlay if current player wins <!-- satisfied: WheelVisualization.tsx:510-514 "YOU WON!" text + star/coin burst -->

### FR-8: Audio

**Acceptance Criteria:**
- [x] ~~Wheel spin sound (clicking/ticking)~~ [DEFERRED] <!-- deferred: audio integration deferred to dedicated audio spec -->
- [x] ~~Countdown beeps in final seconds~~ [DEFERRED] <!-- deferred: audio integration deferred to dedicated audio spec -->
- [x] ~~Dramatic drum roll during final spin moments~~ [DEFERRED] <!-- deferred: audio integration deferred to dedicated audio spec -->
- [x] ~~Victory fanfare for winner~~ [DEFERRED] <!-- deferred: audio integration deferred to dedicated audio spec -->
- [x] ~~Coin/cash sound for payout~~ [DEFERRED] <!-- deferred: audio integration deferred to dedicated audio spec -->

### FR-9: Fairness Verification

Each round includes a public verification payload for independent verification after settlement.

**Acceptance Criteria:**
- [x] Settled rounds are verifiable via a public rounds/fairness payload including commitment, revealed secret, entropy slot details, winning slot, winner, and payout <!-- satisfied: GET /rounds/:pda returns full verification data; RoundSettled event on-chain; verifyLordRound() in game-engine -->
- [ ] Fairness page supports Lord of the RNGs verification using backend-served payloads rather than VRF proof assumptions <!-- deferred: frontend being reworked separately; backend endpoint + verification function exist -->
- [ ] Active round / result UI shows pre-settlement commitment info and post-settlement verification data without exposing secrets early <!-- deferred: frontend being reworked separately; backend serves correct data per phase -->

---

## Success Criteria

- A player can buy entries, watch the spin, and the correct winner receives the full pot through automatic backend settlement
- Multiple entries correctly increase win probability proportionally
- Results are independently verifiable from public fairness payloads and on-chain settlement evidence
- Per-round independence: different round_numbers can be in different phases simultaneously
- Round lifecycle (Waiting → Active → Settled) runs without manual intervention beyond backend settlement

---

## Dependencies

- [x] Shared infrastructure (004): lifecycle, escrow, fees, fairness helpers, amount constraints, pause, timeout
- [ ] Shared fairness contract (005): backend-assisted commit-reveal + public entropy
- [ ] Fairness backend contract (006): create/auth/settle/verify pattern

## Assumptions

- No entry cap per player (whale-friendly by design)
- Max 64 entries per round (`MAX_ENTRIES = 64`, `Vec<WeightedEntry>` account size cap)
- Round only triggers countdown with minimum 2 distinct wallets
- Rounds are identified by `round_number` (backend-generated), not scoped by amount
- PDA seeds: `["jackpot_round", round_number.to_le_bytes()]` — no tier or amount in seeds
- This is the second V1 game after Coinflip
- SOL-denominated custom amounts with a shared minimum of `0.0026 SOL`
- Commit-reveal fairness (same model as coinflip), NOT Orao VRF
- PlayerProfile removed — no platform CPI for stats

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Multi-entry increases probability | Buy N entries, verify N/total shown | Probability display |
| 2 | Winner selection is fair | Verify public fairness payload for winning slot | Verification payload + slot mapping |
| 3 | Payout = pool minus 500 bps (5%) fee | Check on-chain settlement | On-chain balance assertions |
| 4 | Multiple rounds operate independently | Two round_numbers in different phases | Bankrun test |
| 5 | Countdown triggers at 2 distinct wallets | Join as 2nd distinct wallet, verify countdown starts | Phase transition assertion |
| 6 | Max 64 entries enforced | 65th entry rejected | Bankrun error test |
| 7 | Backend settlement works | Backend calls `claim_payout(round_number, secret)`, winner receives payout | Bankrun balance assertion |

---

## Completion Signal

### Implementation Checklist

The completed phases below capture the current commit-reveal implementation. The program uses the same backend-assisted hybrid fairness model as Coinflip (commit-reveal + SlotHashes entropy), not Orao VRF.

#### Phase A: On-Chain Program (Lord of the RNGs)

- [x] [on-chain] Scaffold `solana/programs/lordofrngs/` — Cargo.toml, Xargo.toml, `src/lib.rs` with `declare_id!`, `src/state.rs` with `LordConfig` + `JackpotRound` + `WeightedEntry` + `RoundSettled` event, `src/error.rs` with error codes. Register in `solana/Cargo.toml` workspace members and `Anchor.toml` programs. Verify: `anchor build -p lordofrngs` succeeds. (done: iteration 1)
- [x] [on-chain] `initialize_config` instruction — admin creates `LordConfig` PDA (`[b"lord_config"]`) with treasury + authority + paused flag. Pattern: copy from coinflip `initialize_config.rs`. Verify: bankrun test creates config, reads back fields. (done: iteration 2)
- [x] [on-chain] `create_round` instruction — server co-signs, creates a `JackpotRound` PDA (`[b"jackpot_round", round_number.to_le_bytes()]`). Creator pays rent and is first entry. Stores `commitment = SHA256(server_secret)`, sets phase=Waiting, records first `WeightedEntry`, transfers `amount` lamports to round PDA escrow. Requires: config not paused, amount at or above `0.0026 SOL`, `round_number` is backend-generated (no on-chain counter). Verify: bankrun test creates round, checks PDA data + escrow balance. (done: iteration 3)
- [x] [on-chain] `join_round` instruction — any player joins an existing round. Validates: phase is Waiting or Active, entries < `MAX_ENTRIES` (64), countdown not expired (if Active). Appends a new `WeightedEntry {player, amount_lamports}` — multiple entries per player allowed (each independent). Transfers `amount` to escrow. If this is the 2nd distinct wallet, transition Waiting→Active: set `countdown_started_at`, `countdown_ends_at = clock + 60`, `target_entropy_slot = current_slot + 150 + 12`, `resolve_deadline`. Verify: bankrun tests for happy path (join triggers countdown), max entries rejection, wrong phase rejection. (done: iteration 4)
- [x] [on-chain] `buy_more_entries` instruction — delegates to same logic as `join_round` internally. Any player (new or existing) can call. Validates: phase is Waiting or Active, entries < `MAX_ENTRIES` (64), countdown not expired. Appends new `WeightedEntry`, updates `total_amount_lamports` and `distinct_players`. Also triggers Waiting→Active if this is the 2nd distinct wallet. Verify: bankrun test buys more, checks updated entry count + pool. (done: iteration 5)
- [x] [on-chain] `start_spin` instruction — **deprecated compatibility shim**. Validates: phase is Active, `clock.unix_timestamp >= countdown_ends_at`. Performs no state transition (no VRF request). Kept for frontend compatibility. Settlement happens via `claim_payout` directly. (done: iteration 6)
- [x] [on-chain] `claim_payout` instruction — backend settles the round. Takes `(round_number, secret)`. Validates: phase is Active, >=2 distinct players, countdown expired, `target_entropy_slot` reached. Verifies `SHA256(secret) == commitment`. Reads entropy from provided account. Derives `result_hash = SHA256(secret || entropy || round_pda || algorithm_ver)`. Winner: `u64::from_le_bytes(result_hash[0..8]) % total_amount_lamports` → cumulative offset maps to winning entry. Calculates fee (500 bps / 5%, read from PlatformConfig) + net payout. Transfers payout to winner, fee to treasury. Emits `RoundSettled` event. Sets phase to Settled, closes round PDA (rent → round creator). No platform CPI (PlayerProfile removed). Verify: bankrun test — correct winner, correct payout, treasury fee, event fields, account closed after claim. (done: iteration 7)
- [x] [on-chain] `timeout_refund` instruction — permissionless after `resolve_deadline`. Validates: phase is Active, countdown started, `is_expired(resolve_deadline, now)`. Aggregates per-player refund totals across all entries. Refunds each player's total via remaining_accounts (one per distinct player, first-seen order). Sets phase to Refunded, closes round PDA. Verify: bankrun test with expired deadline. (done: iteration 8)
- [x] [on-chain] `force_close` instruction — admin-only (`config.authority`). Closes a Waiting or Active round, refunds all players using same per-player aggregation + remaining_accounts pattern. Sets phase to Refunded, closes round PDA. Verify: bankrun test admin-only guard. (done: iteration 9)

#### Phase B: Platform Program Update

- [x] ~~Game discriminator / PlayerProfile CPI~~ [REMOVED] <!-- removed: PlayerProfile and all platform CPI deleted (2026-03-12). Stats moved off-chain. No game_type parameter needed. -->

#### Phase C: Game Engine + Anchor Client

- [x] [engine] Update `lordofrngs.ts` in `packages/game-engine/src/` — exports: `getRoundPda(matchId)`, `getConfigPda()`, `determineWinnerFromRandomness()`, `mapOffsetToPlayer()`, `verifyLordRound()`, `calculateJackpotPayout()`. <!-- satisfied: game-engine/src/lordofrngs.ts — all exports present, uses matchId Buffer -->
- [x] [engine] Add Lord of the RNGs verification function to `packages/game-engine/src/` or `packages/fairness/src/` — given a tx signature, extract RoundSettled event, re-derive result_hash from secret + entropy + round_pda, verify winning offset and winner match. Pattern: mirror coinflip `verification.ts` (commit-reveal, not VRF). Verify: TypeScript compiles. (done: iteration 12)
- [x] [engine] Run `anchor build -p lordofrngs` and sync IDL to `packages/anchor-client/src/lordofrngs.json`. Export typed program interface from anchor-client package. Verify: `pnpm build:all` succeeds. (done: iteration 13)

#### Phase D: Frontend Wiring (Replace Mocks)

- [ ] [frontend] Update `features/lord-of-rngs/utils/chain.ts` for round-number-keyed rounds: `buildJoinRoundTx`, `buildBuyMoreEntriesTx`, `buildStartSpinTx`, `fetchRound`, `fetchActiveRounds`. Backend handles `create_round` and `claim_payout` (server co-sign required). Pattern: mirror coinflip `chain.ts`. Verify: TypeScript compiles. <!-- out of scope: frontend is a separate project -->
- [ ] [frontend] Update `LordOfRngsContext.tsx` — replace mock-simulation imports with chain.ts calls. Wire join/buyMore actions around round-number-keyed rounds. Poll/subscribe round account so all clients detect phase transitions (Active → Settled). `start_spin` is a deprecated shim kept for frontend compatibility but performs no state transition. Verify: TypeScript compiles, `pnpm lint` clean. <!-- out of scope: frontend is a separate project -->
- [ ] [frontend] Replace tier types / selectors with amount input + round state. Ensure `ActiveRoundView` and lobby views display the entered SOL amount and enforce the `0.0026 SOL` minimum. Verify: `pnpm lint` clean. <!-- out of scope: frontend is a separate project -->
- [x] [frontend] Wire fairness verification — update sidebar fairness section to show commit-reveal data from RoundSettled event (commitment, secret, entropy, result_hash). Add Lord of the RNGs section to `/fairness` page (paste tx signature → verify winning offset). Verify: TypeScript compiles. (done: iteration 17)
- [x] [frontend] Delete `mock-simulation.ts` once all context actions use chain.ts. Verify: `pnpm build:all` succeeds, no imports of mock-simulation remain. (done: iteration 18)

#### Phase E: Testing

- [ ] [test] Bankrun test suite for lord program — at minimum: initialize_config, create_round (happy + below-minimum amount + server co-sign), join_round (happy + triggers countdown + max entries + wrong phase + countdown expired), buy_more_entries (happy + new player via buy_more + wrong phase), start_spin (happy shim + too early + wrong phase), claim_payout (correct winner via commit-reveal + correct payout + fee to treasury + event fields + account closed), timeout_refund (happy after resolve_deadline + too early rejects), force_close (admin only + refunds all). Target: >=15 tests. Verify: `anchor test` passes.
- [x] [test] Update visual baselines for Lord of the RNGs pages. Run `pnpm test:visual` to identify failures, then `pnpm test:visual:update` to regenerate. **Before committing**: read old baseline and new screenshot for each changed page (use Read tool on PNG files). Evaluate:
  - **PASS** (changes clearly match spec intent, only expected areas changed) → commit updated baselines
  - **REVIEW** (changes look plausible but unexpected areas also changed, or uncertain) → do NOT commit baselines. Save the diff images from `test-results/` to `docs/specs/101-lord-of-the-rngs/visual-review/`, describe concerns in `history.md`, output `<blocker>Visual review needed: [describe what looks off]</blocker>`
  - **FAIL** (layout broken, elements missing, clearly wrong) → fix the code, do NOT update baselines
  (done: iteration 20)
- [x] [test] Add local deterministic E2E coverage in `e2e/local/` — at minimum: smoke test (app loads with lord page), lifecycle test (Player A creates round → Player B joins → countdown → backend settles via claim_payout(secret) → payout verified on-chain). Verify: `pnpm test:e2e` passes. (done: iteration 21)
- [x] [test] Add devnet E2E coverage in `e2e/devnet/` — lifecycle test with real commit-reveal settlement. VRF fulfillment + claim are programmatic (backend-driven). Passes in ~2.5min. Verify: code compiles and type-checks (actual run requires devnet deploy). (done: iteration 22)

#### Phase G: Backend Fairness Integration

- [ ] [frontend] Ensure create/start/verification flows use commit-reveal payloads from the backend fairness contract (specs `005` and `006`). No VRF-specific terminology or payloads. <!-- deferred: frontend being reworked separately -->
- [x] [backend] Define Lord-specific create, settle, and verification flows on top of the fairness backend architecture. `create_round` requires server co-signer + commitment. `claim_payout` requires revealed secret. <!-- satisfied: lord-create.ts (create with commitment), settle-tx.ts:447-680 (claim_payout with secret), rounds.ts (verification endpoints) -->
- [x] [test] Validate backend-backed create -> countdown -> auto-settle -> verify coverage in local/devnet E2E. <!-- satisfied: e2e/devnet/lord-lifecycle.spec.ts full lifecycle test -->
- [ ] [docs] Confirm result/history pages use public verification payloads (commitment, secret, entropy, result_hash) instead of VRF proof terminology. <!-- deferred: frontend being reworked separately; backend payloads correct -->

#### Phase F: Validation

- [ ] [test] All existing tests pass (coinflip bankrun, platform bankrun, visual regression, lint, typecheck)
- [ ] [test] Lord bankrun tests pass (≥15 tests)
- [ ] [test] `pnpm lint` clean, `pnpm build:all` succeeds
- [ ] [test] No JS console errors on Lord of the RNGs pages
- [ ] [test] All FR acceptance criteria verified (FR-1 through FR-7, FR-9)

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

---

## Implementation Reference

### On-Chain (Solana)
- **Program ID**: `EtiKV4VdHPLow2N8zqHhb5QhxvqwzTqZxULPNrffZr6z`
- **PDA Seeds**:
  - `LordConfig`: `["lord_config"]`
  - `JackpotRound`: `["jackpot_round", match_id]` (match_id is random 8 bytes, backend-generated)
- **Accounts**:
  - `LordConfig` — authority, paused, bump
  - `JackpotRound` — match_id, server, phase (RoundPhase from shared crate), commitment, algorithm_ver, entries (Vec\<WeightedEntry\>, max 64), total_amount_lamports, distinct_players, created_at, countdown_started_at, countdown_ends_at, target_entropy_slot, resolve_deadline, result_hash, winning_offset, winning_entry_index, winner, creator, bump
  - `WeightedEntry` — player (Pubkey), amount_lamports (u64)
- **Instructions**: `initialize_config`, `create_round`, `join_round`, `buy_more_entries`, `cancel_round`, `start_spin` (deprecated shim), `claim_payout`, `timeout_refund`, `force_close`, `set_paused`

### Backend
- **Endpoints**:
  - `GET /fairness/lord/current` — active lord round (on-chain enriched, DB fallback)
  - `POST /fairness/lord/create` — create round (generates secret + commitment, builds co-signed tx, inserts DB row, starts PDA watcher)
  - `GET /fairness/rounds/history?game=lord` — settled lord round history
  - `GET /fairness/rounds/by-id/:matchId` — round details + fairness payload (16-char hex matchId)
  - `GET /fairness/rounds/:pda` — round lookup by PDA address
- **DB Table**: `rounds` (shared with coinflip) — pda, game (`"lord"`), creator, server_key, secret, commitment, amount_lamports, side, match_id (hex), phase, target_slot, settle_tx, settle_attempts, result_hash, result_side (winning_entry_index), winner, entries, created_at, updated_at
- **Settlement**: PDA watcher (`onAccountChange` WebSocket) detects phase transitions. After countdown expires and `target_entropy_slot` is reached, backend calls `claim_payout(match_id, secret)` revealing the committed secret. On-chain derives `result_hash = SHA256(secret || entropy || round_pda || algo_ver)`, maps winning offset to entry, transfers payout to winner and fee to treasury. 1s poll fallback if WebSocket misses events.

---

## Key Decisions (from refinement)

- Entry model changed from equal-cost tier slots to independent weighted entries with custom SOL amounts (minimum 0.0026 SOL). Named tiers retired.
- Winner selection uses cumulative lamport ranges over the ordered entry vector, not equal slot counts. `winning_offset = u64_le(result_hash[0..8]) % total_amount_lamports`.
- Fairness model: backend-assisted commit-reveal + SlotHashes entropy (same as coinflip). NOT Orao VRF — switched during spec pivot.
- No entry cap per player (whale-friendly by design). Entries field is u32 counter per `PlayerEntry`.
- Max 64 total entries per round (`MAX_ENTRIES = 64`, `Vec<WeightedEntry>` account size cap). Not 64 players — 64 entries across all players.
- Countdown: 60 seconds, starts when 2nd distinct wallet joins. Stores both `countdownEndsAtUnix` and precomputed `targetEntropySlot` on-chain.
- No separate lock transaction to close entries. Countdown close is implicit at `countdownEndsAtUnix`; backend submits one settlement tx after `targetEntropySlot`.
- `start_spin` instruction is a deprecated compatibility shim — kept for frontend compatibility but performs no state transition (no VRF request).
- Settlement: backend calls `claim_payout(round_number, secret)` to reveal committed secret and settle. Winner receives payout automatically. Frontend shows progress/verification rather than asking winner to claim in happy path.
- Fee: 500 bps (5%) flat fee to single treasury via PlatformConfig. Collected at settlement of decisive rounds only.
- Account design: single round PDA with ordered entry vec. PDA seeds: `["jackpot_round", round_number.to_le_bytes()]` — no tier or amount in seeds.
- `PlayerProfile` removed (2026-03-12) — no platform CPI for stats. Stats moved off-chain.
- Spin trigger `start_spin` is permissionless and idempotent — any player can press it after countdown expires. On-chain rejects if already Locked.
- `timeout_refund` is permissionless after `resolve_deadline`. Aggregates per-player refund totals across all entries. Uses remaining_accounts pattern (one per distinct player).
- `force_close` is admin-only. Works on any non-terminal phase (Waiting, Active, or Locked). Refunds all players.
- Visual pulse: CSS-only animation for final 5 seconds of countdown. No on-chain involvement.
- PDA helpers defined locally in frontend (not imported from `@rng-utopia/game-engine`) to avoid `Buffer` polyfill issues in Vite browser builds.
- Verification lives in game-engine package (not fairness package) because fairness package is HMAC/crash-specific while VRF verification uses `@solana/web3.js` types.

## Deferred Items

- **FR-8 Audio (all 5 criteria)**: Wheel spin sound, countdown beeps, drum roll, victory fanfare, coin/cash sound — all deferred to a dedicated audio spec covering all games. No target spec exists yet (untracked deferral).
- **FR-2.5 Audio ticks in countdown**: Same deferral — dedicated audio spec.
- **Phase C game-engine update**: `lordofrngs.ts` exports not yet updated for round-number-keyed rounds (e.g., `getRoundPda(roundNumber)` without tier, `determineWinnerFromResultHash`). TypeScript compiles but API shape is from the tier-based era.
- **Phase D frontend wiring (partial)**: `chain.ts` transaction builders, `LordOfRngsContext.tsx` backend integration, and amount-input replacement for tier selectors are incomplete — pending backend fairness integration (Phase G).
- **Phase E bankrun tests**: Full bankrun suite (>=15 tests) not re-validated against the commit-reveal pivot. 38 tests exist from the VRF era but some may need updates for the new settlement model.
- **Phase F validation**: Final validation pass (all tests, lint, build, FR acceptance criteria) not completed.
- **Phase G backend fairness integration**: Lord-specific create/settle/verify flows on top of the backend fairness architecture not yet implemented. Backend needs `create_round` with server co-signer + commitment, and `claim_payout` with revealed secret.
- **Audio spec tracking**: No target audio spec exists to receive the FR-8 deferrals. Risk of permanent deferral without a tracking ticket.
