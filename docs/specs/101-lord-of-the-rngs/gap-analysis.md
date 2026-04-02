# Gap Analysis: 101 — Lord of the RNGs

- **Date**: 2026-04-02
- **Spec status**: Ready
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions

| Instruction | Program | File | Notes |
|------------|---------|------|-------|
| `initialize_config` | lordofrngs | `programs/lordofrngs/src/instructions/initialize_config.rs` | Creates LordConfig PDA |
| `create_round` | lordofrngs | `programs/lordofrngs/src/instructions/create_round.rs` | Server co-signs, creator first entry |
| `join_round` | lordofrngs | `programs/lordofrngs/src/instructions/join_round.rs` | Triggers countdown on 2nd distinct wallet |
| `buy_more_entries` | lordofrngs | `programs/lordofrngs/src/instructions/buy_more_entries.rs` | Additional entries, same validation |
| `cancel_round` | lordofrngs | `programs/lordofrngs/src/instructions/cancel_round.rs` | Creator cancels before 2nd player |
| `start_spin` | lordofrngs | `programs/lordofrngs/src/instructions/start_spin.rs` | Deprecated compatibility shim (no-op) |
| `claim_payout` | lordofrngs | `programs/lordofrngs/src/instructions/claim_payout.rs` | Settlement: derive winner, transfer payout+fee |
| `timeout_refund` | lordofrngs | `programs/lordofrngs/src/instructions/timeout_refund.rs` | Permissionless after resolve_deadline |
| `force_close` | lordofrngs | `programs/lordofrngs/src/instructions/force_close.rs` | Admin-only force close |
| `set_paused` | lordofrngs | `programs/lordofrngs/src/instructions/set_paused.rs` | Admin pause/unpause |

### Shared Crate Exports

| Export | File | Used By Lord |
|--------|------|-------------|
| `RoundPhase` | `shared/src/lifecycle.rs` | Waiting, Active, Settled, Refunded |
| `calculate_net_payout` | `shared/src/fees.rs` | Payout after 500 bps fee |
| `derive_result` | `shared/src/fairness.rs` | SHA256(secret\|\|entropy\|\|pda\|\|algo_ver) |
| `verify_commitment` | `shared/src/fairness.rs` | SHA256(secret) == commitment |
| `read_slot_hash_entropy` | `shared/src/fairness.rs` | SlotHashes sysvar read |
| `validate_wager` | `shared/src/wager.rs` | Min 0.0026 SOL |
| `transfer_lamports_to/from_pda` | `shared/src/escrow.rs` | Escrow transfers |

### Game Engine Exports

| Export | File | Purpose |
|--------|------|---------|
| `LORDOFRNGS_PROGRAM_ID` | `packages/game-engine/src/lordofrngs.ts:7` | Program ID constant |
| `getRoundPda(matchId)` | `packages/game-engine/src/lordofrngs.ts:17` | PDA derivation (uses matchId Buffer, not roundNumber) |
| `getConfigPda()` | `packages/game-engine/src/lordofrngs.ts:30` | Config PDA |
| `determineWinnerFromRandomness()` | `packages/game-engine/src/lordofrngs.ts:74` | Winner from result hash |
| `mapOffsetToPlayer()` | `packages/game-engine/src/lordofrngs.ts:100` | Offset → entry mapping |
| `verifyLordRound()` | `packages/game-engine/src/lordofrngs.ts:128` | Full round verification |
| `calculateJackpotPayout()` | `packages/game-engine/src/lordofrngs.ts:186` | Payout calculation |

### Backend Routes

| Endpoint | File | Purpose |
|----------|------|---------|
| `GET /lord/current` | `routes/lord-create.ts:92` | Active lord round (DB + on-chain enriched) |
| `POST /lord/create` | `routes/lord-create.ts:153` | Create round (secret, commitment, co-signed tx, game_entry) |
| `GET /rounds/history?game=lord` | `routes/rounds.ts:153` | Settled lord round history |
| `GET /rounds/by-id/:matchId` | `routes/rounds.ts:170` | Round by matchId (hex) |
| `GET /rounds/:pda` | `routes/rounds.ts:207` | Round by PDA |

### Backend Settlement

| Function | File | Purpose |
|----------|------|---------|
| `settleLordRound()` | `worker/settle-tx.ts:447` | Full settlement: fetch on-chain, derive winner, build claim_payout tx, atomic DB update |
| `settleRound()` | `worker/settle-tx.ts:682` | Dispatcher (game='lord' → settleLordRound) |
| `buildCreateLordRoundTx()` | `tx-builder.ts` | Partially-signed create transaction |

### Tests

| Test | Type | File | Status |
|------|------|------|--------|
| Bankrun suite (25 tests) | On-chain | `solana/tests/lordofrngs.ts` | Present (>=15 required) |
| Integration lifecycle | Backend | `backend/src/__tests__/integration.test.ts` | Pass |
| Endpoint tests | Backend | `backend/src/__tests__/endpoints.test.ts` | Pass |
| Leaderboard (lord entries) | Backend | `backend/src/__tests__/leaderboard.test.ts` | Pass |
| Player stats (lord breakdown) | Backend | `backend/src/__tests__/player-stats.test.ts` | Pass |
| Devnet E2E lifecycle | E2E | `e2e/devnet/lord-lifecycle.spec.ts` | Present (requires devnet) |

### Frontend

| Component | Status |
|-----------|--------|
| `apps/platform/src/features/lord-of-rngs/` | **Not in this repo** — frontend being reworked separately |

## Acceptance Criteria Audit

### FR-1: Waiting Phase

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Backend creates round via create_round with server co-signer | SATISFIED | `lord-create.ts:153-288` builds co-signed tx via `buildCreateLordRoundTx()`, inserts DB round + game_entry. On-chain: `create_round.rs:45-96` validates commitment, co-signer, creates PDA with first entry. |
| 2 | No countdown timer yet | SATISFIED | On-chain: `create_round.rs` sets `countdown_ends_at = 0`, phase=Waiting. Frontend reference stale (frontend reworked). |
| 3 | Display shows current entries and pool size | DEFERRED | Frontend being reworked separately. Backend `GET /lord/current` provides the data. |
| 4 | "Waiting for players..." message shown | DEFERRED | Frontend being reworked separately. |
| 5 | Countdown triggers when 2nd unique player joins | SATISFIED | `join_round.rs:92-105` — transitions Waiting→Active on `distinct_players >= 2`, sets countdown_ends_at + target_entropy_slot. |

### FR-2: Countdown Phase (60 seconds)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 60-second countdown begins on 2nd distinct wallet | SATISFIED | `join_round.rs:95` — `countdown_ends_at = now.unix_timestamp + COUNTDOWN_SECONDS` (60s). `state.rs:8` COUNTDOWN_SECONDS = 60. |
| 2 | Additional players can join during countdown | SATISFIED | `join_round.rs:51-53` — accepts Waiting OR Active phase. |
| 3 | Existing players can append more entries during countdown | SATISFIED | `buy_more_entries.rs` — same validation, allows same player to add entries during Active phase. |
| 4 | Pool size, total amount, and weighted odds update in real time | DEFERRED | Frontend being reworked separately. On-chain data updates are correct; backend `GET /lord/current` reflects latest. |
| 5 | Visual pulse in final 5 seconds | DEFERRED | Frontend being reworked separately. |
| 6 | Program rejects entries once countdown expired | SATISFIED | `join_round.rs:59-64` — `require!(now.unix_timestamp < round.countdown_ends_at, LordError::EntriesClosed)`. Same check in `buy_more_entries.rs`. |

### FR-3: Entry Mechanics

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Each entry stores amountLamports, min 0.0026 SOL | SATISFIED | `join_round.rs:46` — `validate_wager(amount)` (shared crate, min 0.0026 SOL). Each `WeightedEntry` stores `amount_lamports`. |
| 2 | Multiple independent entries per player | SATISFIED | `join_round.rs:75-78` — always `push(WeightedEntry)`, no dedup. `buy_more_entries.rs` does same. |
| 3 | Displayed odds = sum of entry amounts / total | DEFERRED | Frontend being reworked. On-chain stores correct data for calculation. |
| 4 | Winner selection uses cumulative lamport ranges | SATISFIED | `claim_payout.rs:79-91` — iterates entries, cumulative sum, `winning_offset < cumulative` selects winner. |
| 5 | Entries only during Waiting and Countdown phases | SATISFIED | `join_round.rs:51-53` and `buy_more_entries.rs:52-54` — require Waiting or Active, reject expired countdown. |

### FR-4: Countdown Close and Settlement Readiness

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Countdown stores countdownEndsAtUnix and targetEntropySlot | SATISFIED | `join_round.rs:94-101` — sets both on Waiting→Active transition. |
| 2 | No separate lock transaction to close entries | SATISFIED | By design: `claim_payout.rs:63-68` validates countdown_ends_at and target_entropy_slot directly. No lock instruction needed. |
| 3 | Backend settlement starts automatically once entropy available | SATISFIED | `settle-tx.ts` settlement worker polls for locked/settling rounds. PDA watcher detects phase changes. `settleLordRound` called automatically. |
| 4 | Winning offset derived deterministically from secret + entropy + round PDA | SATISFIED | `claim_payout.rs:75-77` — `derive_result(secret, entropy, round_key, algo_ver)`, offset = `u64_le(hash[0..8]) % total`. |
| 5 | Wheel spin animation | DEFERRED | Frontend being reworked separately. |
| 6 | Winner = entry owner containing winning offset | SATISFIED | `claim_payout.rs:79-91` — cumulative range search over entries. |
| 7 | Result is provably fair and verifiable | SATISFIED | `RoundSettled` event (claim_payout.rs:101-114) emits commitment, secret, entropy, result_hash, winning_offset, winner. `verifyLordRound()` in game-engine recomputes and verifies. Backend `/rounds/:pda` serves verification payload. |

### FR-5: Winner Determination and Payout

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | winner_payout = pool minus 500 bps (5%) fee | SATISFIED | `claim_payout.rs:95` — `calculate_net_payout(total, fee_bps)` from shared crate. Fee read from PlatformConfig. |
| 2 | Single winner takes pool minus fee | SATISFIED | `claim_payout.rs:97-98` — full payout to winner, fee to treasury. |
| 3 | Payout recorded on-chain with all verification data | SATISFIED | `claim_payout.rs:101-114` — `RoundSettled` event includes commitment, secret, entropy, result_hash, winning_offset, winner, payout_amount, fee_amount. Round state updated with result fields. |
| 4 | Backend worker submits settlement tx after countdown close | SATISFIED | `settle-tx.ts:447-680` — `settleLordRound()` builds `claim_payout` instruction, submits and confirms. Triggered by settlement worker after target_entropy_slot reached. |
| 5 | Settlement is idempotent and safe to retry | SATISFIED | `settle-tx.ts` uses phase guard (locked→settling→settled). `updateRoundPhase` enforces unidirectional transitions. DB atomic transaction wraps all writes. |
| 6 | Timeout refund path protects entrants | SATISFIED | `timeout_refund.rs` — permissionless after resolve_deadline. Aggregates per-player refund totals across all entries, refunds via remaining_accounts. |

### FR-6: Round Lobby UI

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Amount input controls for join/create | DEFERRED | Frontend being reworked separately. Backend `POST /lord/create` accepts custom amountLamports. |
| 2 | Round card shows phase, players, entries, pool | DEFERRED | Frontend being reworked separately. Backend `GET /lord/current` returns all needed data. |
| 3 | Countdown timer for Active rounds | DEFERRED | Frontend being reworked separately. |

### FR-7: Active Game UI (Wheel View)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Large wheel divided into slots | DEFERRED | Frontend being reworked separately. |
| 2 | Player's own slots highlighted | DEFERRED | Frontend being reworked separately. |
| 3 | Entry count per player in legend | DEFERRED | Frontend being reworked separately. |
| 4 | "Buy Entry" button | DEFERRED | Frontend being reworked separately. |
| 5 | "Spin" button after countdown | DEFERRED | Frontend being reworked separately. |
| 6 | Current pool size displayed | DEFERRED | Frontend being reworked separately. |
| 7 | Smooth spin animation | DEFERRED | Frontend being reworked separately. |
| 8 | Winner slot highlighted with glow and confetti | DEFERRED | Frontend being reworked separately. |
| 9 | "YOU WON!" overlay | DEFERRED | Frontend being reworked separately. |

### FR-8: Audio

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1-5 | All 5 audio criteria | DEFERRED | Explicitly deferred in spec Scope Decisions to dedicated audio spec. No target spec exists. |

### FR-9: Fairness Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Settled rounds verifiable via public payload | SATISFIED | Backend `GET /rounds/:pda` returns full verification data (commitment, secret, entropy, result_hash, winning_offset, winner, entries). `verifyLordRound()` in game-engine recomputes. |
| 2 | Fairness page supports Lord verification | DEFERRED | Frontend being reworked separately. Backend verification endpoint + game-engine verification function exist. |
| 3 | Active round shows pre-settlement commitment, post-settlement verification | DEFERRED | Frontend being reworked separately. Backend `GET /lord/current` returns commitment pre-settlement; `/rounds/:pda` returns full verification post-settlement. |

## Gap Summary

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| — | — | — | — | — | — | **No backend/on-chain gaps found** |

All on-chain, backend, settlement, game-engine, and test criteria are SATISFIED. All remaining unchecked items are frontend UI criteria that are DEFERRED because the frontend is being reworked in a separate repo.

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| FR-1.3 Display entries/pool | Frontend rework | N/A (separate repo) | N/A | UNTRACKED — no frontend spec |
| FR-1.4 Waiting message | Frontend rework | N/A | N/A | UNTRACKED |
| FR-2.4 Real-time pool updates | Frontend rework | N/A | N/A | UNTRACKED |
| FR-2.5 Visual pulse | Frontend rework | N/A | N/A | UNTRACKED |
| FR-3.3 Displayed odds | Frontend rework | N/A | N/A | UNTRACKED |
| FR-4.5 Wheel spin animation | Frontend rework | N/A | N/A | UNTRACKED |
| FR-6 (all 3) | Frontend rework | N/A | N/A | UNTRACKED |
| FR-7 (all 9) | Frontend rework | N/A | N/A | UNTRACKED |
| FR-8 (all 5) | Dedicated audio spec | None | N/A | UNTRACKED — no target spec exists |
| FR-9.2 Fairness page | Frontend rework | N/A | N/A | UNTRACKED |
| FR-9.3 Active round verification UI | Frontend rework | N/A | N/A | UNTRACKED |

## Spec Staleness Notes

The spec body has several stale references that should be updated:
1. **Route paths**: References `/fairness/lord/*` and `/fairness/rounds/*` — now `/lord/*` and `/rounds/*`
2. **PDA seeds in Assumptions**: Says `round_number.to_le_bytes()` — actual seeds use `match_id` (random 8 bytes)
3. **DB Table reference**: Mentions `entries` JSONB column — removed in data layer consolidation
4. **Game engine tech debt**: Spec's Deferred Items mentions stale `getRoundPda(roundNumber)` — already fixed to `getRoundPda(matchId: Buffer)`
5. **Implementation Checklist Phase C**: Says game-engine update not done — but `lordofrngs.ts` has all required exports
6. **Implementation Checklist Phase G**: Says backend fairness integration not done — but `lord-create.ts` create + `settle-tx.ts` settlement are fully implemented

## Recommendations

1. **Advance backend/on-chain status to Done**: All 25 on-chain/backend/settlement/test criteria are satisfied. The remaining gaps are exclusively frontend UI.
2. **Split spec into backend (Done) and frontend (Ready)**: Since frontend is in a separate repo and rework, the backend portion is complete. Consider marking the spec as "Done (backend)" or splitting into 101a (backend, Done) + 101b (frontend, blocked on rework).
3. **Update stale references**: Route paths, PDA seeds, JSONB entries, game-engine status.
4. **Update Implementation Checklist**: Phase C (game-engine) is done. Phase G (backend fairness) is done. Phase E (bankrun tests) has 25 tests (exceeds 15 minimum). Phase F (validation) needs a pass.
5. **Create audio spec**: FR-8 deferrals have no target spec — risk of permanent deferral.
6. **Tech debt resolved**: `getRoundPda` already uses `matchId: Buffer` — remove from TECH_DEBT.md.
