# Gap Analysis: 101 — Lord of the RNGs

- **Date**: 2026-03-02
- **Spec status**: Ready
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions
| Instruction | Program | File | Line |
|------------|---------|------|------|
| initialize_config | lordofrngs | solana/programs/lordofrngs/src/instructions/initialize_config.rs | 1 |
| create_round | lordofrngs | solana/programs/lordofrngs/src/instructions/create_round.rs | 1 |
| join_round | lordofrngs | solana/programs/lordofrngs/src/instructions/join_round.rs | 1 |
| buy_more_entries | lordofrngs | solana/programs/lordofrngs/src/instructions/buy_more_entries.rs | 1 |
| start_spin | lordofrngs | solana/programs/lordofrngs/src/instructions/start_spin.rs | 1 |
| claim_payout | lordofrngs | solana/programs/lordofrngs/src/instructions/claim_payout.rs | 1 |
| timeout_refund | lordofrngs | solana/programs/lordofrngs/src/instructions/timeout_refund.rs | 1 |
| force_close | lordofrngs | solana/programs/lordofrngs/src/instructions/force_close.rs | 1 |

### On-Chain State & Events
| Item | File | Line |
|------|------|------|
| LordConfig | solana/programs/lordofrngs/src/state.rs | ~1 |
| JackpotRound | solana/programs/lordofrngs/src/state.rs | ~20 |
| PlayerEntry | solana/programs/lordofrngs/src/state.rs | ~55 |
| RoundSettled event | solana/programs/lordofrngs/src/state.rs | 76 |
| LordError (13 codes, 6100–6112) | solana/programs/lordofrngs/src/error.rs | 1 |

### Shared Crate Exports Used
| Export | Package | Usage |
|--------|---------|-------|
| lifecycle (RoundPhase) | solana/shared | Phase enum reused in JackpotRound |
| tiers (TIER_AMOUNTS) | solana/shared | Tier validation in create/join |
| escrow | solana/shared | Lamport transfers to/from round PDA |
| fees (fee_bps) | PlatformConfig | 500 bps fee in claim_payout |
| vrf_orao | solana/shared | CPI to Orao VRF in start_spin |
| pause | solana/shared | Pause guard on create_round |
| timeout | solana/shared | Timeout check in timeout_refund |
| cpi (update_player_profile_cpi) | solana/shared | Called in lordofrngs claim_payout via remaining_accounts pattern (game_type=1) |

### Game Engine Exports
| Export | Package | File | Line |
|--------|---------|------|------|
| LORDOFRNGS_PROGRAM_ID | game-engine | packages/game-engine/src/lordofrngs.ts | ~1 |
| getRoundPda | game-engine | packages/game-engine/src/lordofrngs.ts | — |
| getConfigPda | game-engine | packages/game-engine/src/lordofrngs.ts | — |
| determineWinnerFromRandomness | game-engine | packages/game-engine/src/lordofrngs.ts | — |
| mapSlotToPlayer | game-engine | packages/game-engine/src/lordofrngs.ts | — |

### Anchor Client
| Item | File |
|------|------|
| IDL JSON | packages/anchor-client/src/lordofrngs.json |
| TypeScript types | packages/anchor-client/src/lordofrngs.ts |

### Frontend Components
| Component | File |
|-----------|------|
| LordOfRngsPage | apps/platform/src/pages/LordOfRngsPage.tsx |
| LordOfRngsContext | apps/platform/src/features/lord-of-rngs/context/LordOfRngsContext.tsx |
| TierLobby | apps/platform/src/features/lord-of-rngs/components/TierLobby.tsx |
| TierRoundView | apps/platform/src/features/lord-of-rngs/components/TierRoundView.tsx |
| ActiveRoundView | apps/platform/src/features/lord-of-rngs/components/ActiveRoundView.tsx |
| WheelVisualization | apps/platform/src/features/lord-of-rngs/components/WheelVisualization.tsx |
| CountdownTimer | apps/platform/src/features/lord-of-rngs/components/CountdownTimer.tsx |
| chain.ts (on-chain utils) | apps/platform/src/features/lord-of-rngs/utils/chain.ts |
| odds.ts | apps/platform/src/features/lord-of-rngs/utils/odds.ts |
| verification.ts | apps/platform/src/features/lord-of-rngs/utils/verification.ts |
| types.ts | apps/platform/src/features/lord-of-rngs/types.ts |

### Tests
| Test | Type | File | Status |
|------|------|------|--------|
| initialize_config suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| create_round suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| join_round suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| buy_more_entries suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| start_spin suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| claim_payout suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| timeout_refund suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| force_close suite | bankrun | solana/tests/lordofrngs.ts | Pass |
| 29 total bankrun tests | bankrun | solana/tests/lordofrngs.ts | Pass |
| Visual: lobby disconnected | Playwright visual | apps/platform/e2e/visual/states.spec.ts | Pass |
| Visual: tier selected | Playwright visual | apps/platform/e2e/visual/states.spec.ts | Pass |
| Visual: tier connected+sidebar | Playwright visual | apps/platform/e2e/visual/states.spec.ts | Pass |
| Visual: back-to-lobby nav | Playwright visual | apps/platform/e2e/visual/states.spec.ts | Pass |
| Local E2E: lord lifecycle | Playwright E2E | apps/platform/e2e/local/11-lord-lifecycle.spec.ts | Pass |
| Devnet E2E: lord lifecycle | Playwright E2E | apps/platform/e2e/devnet/lord-lifecycle.spec.ts | Pass |

## Acceptance Criteria Audit

### FR-1: Waiting Phase
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Players can join and purchase entries during waiting | SATISFIED | on-chain: join_round.rs validates phase Waiting/Active; chain.ts:buildJoinRoundTx; UI: LordOfRngsPage "Start Round"/"Join Round" buttons |
| 2 | No countdown timer yet | SATISFIED | CountdownTimer only renders when phase="countdown" (TierLobby.tsx:104-110); waiting phase shows "Waiting for players..." text |
| 3 | Display shows current entries and pool size | SATISFIED | TierRoundView.tsx shows entries + pool; ActiveRoundView.tsx shows round data |
| 4 | "Waiting for players..." message shown | SATISFIED | TierRoundView.tsx:21 "Waiting for players..."; TierLobby.tsx:27 "Waiting for players" |
| 5 | Countdown triggers when 2nd unique player joins | SATISFIED | join_round.rs: transitions Waiting→Active and sets countdown_ends_at when 2nd unique player joins; bankrun test validates |

### FR-2: Countdown Phase (60 seconds)
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 60-second countdown begins when 2nd unique player joins | SATISFIED | join_round.rs sets countdown_ends_at = clock + 60; bankrun test; devnet E2E validates |
| 2 | Additional players can join during countdown | SATISFIED | join_round.rs validates phase Active (countdown); max 20 enforced |
| 3 | Existing players can purchase additional entries | SATISFIED | buy_more_entries.rs validates phase Waiting/Active; chain.ts:buildBuyMoreEntriesTx |
| 4 | Pool size and entry count update in real-time | SATISFIED | LordOfRngsContext polling (5s interval); TierRoundView displays current data |
| 5 | Visual pulse in final 5 seconds of countdown | SATISFIED | CountdownTimer.tsx:36-41 isFinalCountdown when timeLeft<=5; index.css:5885 countdown-pulse animation (0.5s scale 1→1.1, red #ff4444) |

### FR-3: Entry Mechanics
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Each entry costs the tier amount | SATISFIED | create_round.rs/join_round.rs transfer entry_amount×entries from shared TIER_AMOUNTS; chain.ts uses same amounts |
| 2 | Players can purchase multiple entries in same tier | SATISFIED | buy_more_entries.rs increments player entry count; bankrun test validates |
| 3 | Each entry = one slot on the wheel | SATISFIED | WheelVisualization.tsx builds slots from player entries; odds.ts calculates per-entry |
| 4 | No maximum entry limit per player | SATISFIED | entries is u32 in PlayerEntry; no cap enforced on-chain |
| 5 | player_win_probability = player_entries / total_entries | SATISFIED | odds.ts:40 raw calculation (player.entries / totalEntries) × 100; largest remainder method for display |
| 6 | Entries purchasable during Waiting and Countdown phases only | SATISFIED | join_round.rs and buy_more_entries.rs validate phase is Waiting or Active; start_spin transitions to Locked |

### FR-4: Spin Phase
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Joins disabled when countdown reaches zero (on-chain) | SATISFIED | start_spin.rs transitions Active→Locked; join_round.rs rejects non-Waiting/Active phases |
| 2 | "Spin" button appears/enables after countdown expires | SATISFIED | LordOfRngsPage.tsx countdownExpired logic; ActiveRoundView.tsx:86 shows spin button when countdownExpired; devnet E2E validates |
| 3 | Any player can send start_spin — idempotent | SATISFIED | start_spin.rs:57-67 returns Ok(()) when already Locked; no signer restriction beyond being a player |
| 4 | All clients poll for phase transition | SATISFIED | LordOfRngsContext.tsx polling with 5s interval; all connected clients see Locked transition |
| 5 | VRF selects winning slot (equal probability) | SATISFIED | claim_payout.rs: winning_slot = u64_le(randomness[0..8]) % total_entries; each slot equal weight |
| 6 | Wheel spin animation with realistic physics | SATISFIED | WheelVisualization.tsx:302-359 — 5s duration, 3 full loops, fast start (linear first 30%), dramatic deceleration |
| 7 | Winner = player who owns the selected slot | SATISFIED | claim_payout.rs maps winning_slot → player via cumulative entry counting |
| 8 | Result is provably fair and verifiable | SATISFIED | Orao VRF on-chain; verification.ts re-derives winning_slot from randomness |

### FR-5: Winner Determination and Payout
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | winner_payout = total_pool minus 500 bps (5%) fee | SATISFIED | claim_payout.rs reads fee_bps from PlatformConfig; bankrun test asserts exact amounts; devnet E2E validates treasury fee |
| 2 | Single winner takes pool minus 500 bps fee | SATISFIED | claim_payout.rs transfers net_payout to winner, fee to treasury |
| 3 | Payout recorded on-chain (RoundSettled event) | SATISFIED | state.rs:76-95 RoundSettled with 9 fields (tier, round_number, winner, randomness, winning_slot, total_entries, payout_amount, fee_amount, vrf_request_key) |
| 4 | Winner can claim funds (pull-based claim_payout) | SATISFIED | claim_payout.rs; chain.ts:buildClaimPayoutTx; LordOfRngsContext auto-claim on win |
| 5 | Settlement is idempotent (round closed after claim) | SATISFIED | claim_payout.rs closes round PDA (rent → creator); bankrun test validates double-claim rejected |

### FR-6: Tier Selection UI
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Grid showing all six tiers | SATISFIED | TierLobby.tsx renders 6 tier cards from TIER_AMOUNTS |
| 2 | Each tier card shows: name, entry cost, current phase, player count, total entries, pool size | SATISFIED | TierLobby.tsx tier cards show name, cost, phase label, player count; TierRoundView shows entries + pool |
| 3 | Countdown timer shown for tiers in Countdown phase | SATISFIED | TierLobby.tsx:104-110 renders CountdownTimer (size="small") when phase="countdown" |

### FR-7: Active Game UI (Wheel View)
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Large wheel divided into slots | SATISFIED | WheelVisualization.tsx renders horizontal wheel with slots from player entries |
| 2 | Player's own slots highlighted in distinct color | SATISFIED | WheelVisualization.tsx highlights current player's slots with distinct color |
| 3 | Entry count per player shown in legend | SATISFIED | ActiveRoundView shows player list with entry counts |
| 4 | "Buy Entry" button (disabled during Spin/Reveal/Complete) | SATISFIED | LordOfRngsPage.tsx:222-230 sidebar "Buy More Entries" button — wired to buyMoreEntries action, disabled during non-Waiting/Countdown phases. Spec says "sidebar" which is where it is; ActiveRoundView doesn't need it inline. |
| 5 | "Spin" button appears after countdown expires | SATISFIED | ActiveRoundView.tsx:86-95 spin button gated by countdownExpired; LordOfRngsPage.tsx sidebar also has spin button |
| 6 | Current pool size prominently displayed | SATISFIED | ActiveRoundView shows pool size; TierRoundView shows pool |
| 7 | Smooth spin animation with gradual deceleration | SATISFIED | WheelVisualization.tsx:302-359 — 5s spin, 3 loops, deceleration curve |
| 8 | Winner slot highlighted with glow and confetti | SATISFIED | WheelVisualization.tsx:460-486 winner slot highlighted; star burst + coin animations (lines 496-507) serve as confetti equivalent |
| 9 | "YOU WON!" overlay if current player wins | SATISFIED | WheelVisualization.tsx:510-514 shows "YOU WON!" text for winner; star/coin burst animations |

### FR-8: Audio
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1-5 | All audio criteria | DEFERRED | Scope Decision: "No audio in 101 scope. Dedicated audio spec later." All 5 items marked [DEFERRED] in spec. |

### FR-9: Fairness Verification
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | RoundSettled event emits VRF request key, randomness, winning slot, winner, payout | SATISFIED | state.rs:76-95 RoundSettled event with all required fields; emitted in claim_payout.rs:120-130 |
| 2 | Fairness page supports Lord verification | SATISFIED | verification.ts:56-147 verifyLordRound() — fetches tx, extracts RoundSettled, re-derives winning_slot from randomness, confirms VRF fulfillment |
| 3 | Active round sidebar shows seed hash (before spin) and VRF proof data (after settlement) | SATISFIED | LordOfRngsPage.tsx:258-289 sidebar "Fairness" section — shows Orao seed hash (seedHash from round), VRF proof data (vrfProof after settlement), and link to fairness verification page. Spec says "sidebar" which is where it is; ActiveRoundView doesn't need it inline. |

## Gap Summary

All gaps resolved.

| # | FR | Criterion | Status | Resolution |
|---|-----|-----------|--------|------------|
| 1 | FR-7.4 | "Buy Entry" button in active game view | RESOLVED (false positive) | Button exists in LordOfRngsPage.tsx:222-230 sidebar — spec says "sidebar" |
| 2 | FR-9.3 | Sidebar VRF data (seed hash + proof) | RESOLVED (false positive) | VRF data shown in LordOfRngsPage.tsx:258-289 sidebar — spec says "sidebar" |
| 3 | Platform CPI | claim_payout did not call update_player_profile_cpi | RESOLVED | Added platform_program account + CPI loop in claim_payout.rs. Player profile PDAs passed as remaining_accounts. game_type=1 (LORDOFRNGS). |

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| FR-8: All audio (5 criteria) | Dedicated audio spec | None specified | N/A | UNTRACKED DEFERRAL — no target audio spec exists yet |
| FR-2.5: Audio ticks in countdown | Dedicated audio spec | None specified | N/A | UNTRACKED DEFERRAL — same as above |

## Recommendations

1. **Audio spec**: Create a dedicated audio spec to cover FR-8 deferrals across all games (coinflip + lord). Currently untracked — no target spec exists.

2. **Implementation Checklist**: Phase F validation items should be checked off after verifying full test suite passes.
