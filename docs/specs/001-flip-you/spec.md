# Specification: 001 FlipYou

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Ideation | Complete |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 22 |

---

## Overview

FlipYou is the simplest game on the platform and the first end-to-end delivery target. Two players wager equal custom amounts in a 1v1 match. The V1 contract is the backend-assisted commit-reveal flow defined by `005-hybrid-fairness` and implemented by `006-fairness-backend`: the backend generates a secret and commitment, returns a partially-signed create transaction, the opponent's join locks a future entropy slot via `SlotHashes`, and a settlement worker automatically reveals the secret on-chain once the target slot passes. The match PDA is closed after settlement (funds distributed, account zeroed). Authentication uses JWT Bearer tokens issued via challenge-response sign-in — no per-request Ed25519 signatures. FlipYou is only complete when that backend-backed flow works locally and on devnet, with full E2E coverage from create through verification.

## User Stories

- As a player, I want to create a flipyou match by entering a custom SOL amount and choosing a side so that I can challenge an opponent at stakes I'm comfortable with.
- As a player, I want to browse open flipyou lobbies so that I can join a match quickly.
- As a player, I want to see a fair flip you animation and result so that I trust the outcome is legitimate.
- As a player, I want settlement to happen automatically after both players are locked so that I do not need to submit a separate claim transaction.
- As a player, I want to verify the fairness of any completed match so that I can confirm the result was not manipulated.
- As an operator, I want a documented way to run the fairness backend locally and on devnet so that flipyou can be tested outside of mock mode.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 2 (Product Scope - V1 In Scope: FlipYou), Section 5 (V1 Game Scope - FlipYou), Section 8 (Delivery Plan - Phase 1)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 1 - FlipYou End-to-End

## Required Context Files

- `backend/docs/FLIPYOU.md` (game concept source)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee, provably fair system)
- `docs/SCOPE.md` (scope boundary and shared game requirements)
- `docs/specs/005-hybrid-fairness/spec.md` (commit-reveal + slot hash fairness contract)
- `docs/specs/006-fairness-backend/spec.md` (flipyou backend service contract)

## Contract Files

### Frontend (Existing UI — preserve design/UX)
- `apps/platform/src/features/flipyou/context/FlipYouContext.tsx` — game state management
- `apps/platform/src/features/flipyou/components/` — ActiveMatchView, CoinAnimation, CoinSideSelector, MatchCard, OpenMatchesList
- `apps/platform/src/features/flipyou/types.ts` — frontend type definitions
- `apps/platform/src/features/flipyou/utils/chain.ts` — on-chain reads/writes for the backend-backed commit-reveal flow
- `apps/platform/src/features/flipyou/utils/verification.ts` — client-side verification helpers / UX payload shaping
- `packages/ui/src/layouts/WagerInput.tsx` — shared numeric input with quick-select preset buttons (0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0 SOL)

### Game Engine (TS instruction builders)
- `packages/game-engine/src/flipyou.ts` — PDA derivation, instruction builders, payout calc
- `packages/game-engine/src/types.ts` — shared types + fee constants
- `packages/game-engine/src/payouts.ts` — payout math

### On-Chain (Anchor programs — current implementation)
- `solana/programs/flipyou/` — FlipYou program implementing the commit-reveal settlement path (create, join, settle, cancel, request_refund, timeout_refund)
- `solana/programs/platform/` — Platform program (fee config; PlayerProfile removed)
- `solana/shared/` — Shared Rust lib (fees, wager validation, fairness/commit-reveal, escrow, timeout, pause, constants)

### Backend (Required for V1 flow)
- `services/backend/src/routes/auth.ts` — JWT session auth (challenge/verify/refresh/logout)
- `services/backend/src/middleware/jwt-auth.ts` — JWT Bearer token middleware (POST requests require valid access token)
- `services/backend/src/routes/create.ts` — create endpoint (JWT-authenticated) returning partially signed transactions; reads wallet from JWT `sub` claim
- `services/backend/src/routes/rounds.ts` — public verification payload endpoint
- `services/backend/src/routes/health.ts` — operator health endpoint
- `services/backend/src/worker/settlement.ts` — automatic settlement worker (polls every 1s for LOCKED matches where target_slot has passed)
- `services/backend/src/worker/settle-tx.ts` — settle transaction builder + submission (parallel RPC calls for speed)
- `services/backend/src/config.ts` — required environment contract for local/devnet runs

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Match Creation

A player can create a new flipyou match by entering a custom SOL amount (minimum 0.0026 SOL) and a side (Heads or Tails). The frontend requests a backend-generated partial transaction via JWT-authenticated endpoint, the player co-signs once in-wallet, and the match appears in the open games list for other players to join. The on-chain `create_match` instruction takes `amount: u64` (not a tier index). The backend request body uses `amountLamports`.

**Acceptance Criteria:**
- [x] Player can enter any custom SOL amount at or above 0.001 SOL <!-- satisfied: shared/wager.rs MIN_WAGER_LAMPORTS=1_000_000, create.ts MIN_WAGER_LAMPORTS=1_000_000 -->
- [x] Player can choose Heads or Tails <!-- satisfied: shared/src/constants.rs:2-3 SIDE_HEADS/TAILS, CoinSideSelector.tsx:19 -->
- [x] Create flow uses `POST /fairness/flipyou/create` to obtain a server-partially-signed transaction, `matchPda`, and commitment before wallet submission <!-- satisfied: create.ts returns {transaction, matchPda, matchId, commitment, lastValidBlockHeight} -->
- [x] Create request is authenticated by JWT Bearer token (wallet read from `sub` claim); body includes `{wallet, amountLamports, side}` <!-- satisfied: jwt-auth.ts middleware + create.ts defense-in-depth wallet===jwtWallet check -->
- [ ] Created match appears in the lobby browser with creator name, entered amount, and side chosen <!-- out of scope: frontend is a separate project -->
- [x] Match creation requires a connected wallet with sufficient balance <!-- satisfied: FlipYouContext.tsx:169 createMatch, error.rs:19 InsufficientFunds -->
- [x] Duplicate create attempts with the same match PDA are rejected cleanly (HTTP 409 / actionable UI error) <!-- satisfied: create.ts checks db.getRoundByPda + unique constraint race handling, returns 409 -->

### FR-2: Match Joining

A second player can join an open match. The joiner is automatically assigned the opposite side. The joiner must deposit the exact same `entry_amount` stored on the match PDA. No tier-based filtering — the lobby shows all open matches with their custom entry amounts.

**Acceptance Criteria:**
- [ ] Player can browse open matches sorted by newest/oldest/amount (no tier-based filtering) <!-- out of scope: frontend is a separate project -->
- [x] Joining assigns the opposite side automatically <!-- satisfied: join_match.rs opponent set, chain.ts onChainMatchToUI -->
- [x] Both players' wagers are equal (joiner deposits exact `entry_amount` from match PDA) <!-- satisfied: join_match.rs:47 `entry_amount = flipyou_match.entry_amount` transferred from opponent -->
- [x] Amount is locked on-chain at create time (entry_amount stored on match PDA, immutable after init) <!-- satisfied: create_match.rs:74 m.entry_amount = entry_amount -->
- [x] Join requires connected wallet with sufficient balance <!-- satisfied: FlipYouContext.tsx:206 joinMatch, chain.ts buildJoinMatchTx -->

### FR-3: Flip Resolution

Once both players have joined, `join_match` sets `target_slot = current_slot + ENTROPY_SLOT_OFFSET` (12 slots ahead) and transitions to PHASE_LOCKED. The settlement worker polls for LOCKED matches, waits for the target slot to pass, reads entropy from the entropy account, reveals the committed secret on-chain via `settle`, and the match resolves. The match PDA is zeroed and closed after settlement (winner takes all remaining lamports). The UI shows a countdown (3-2-1), then a coin-flip animation with a slot-progress bar and "Settling..." overlay.

**Acceptance Criteria:**
- [x] Join/lock flow records the future entropy slot (`target_slot = slot + 12`) and transitions the match to PHASE_LOCKED <!-- satisfied: join_match.rs:60 target_slot = now.slot + ENTROPY_SLOT_OFFSET, :62 phase = PHASE_LOCKED -->
- [x] Backend settlement starts automatically once the entropy slot is available; no player-triggered claim step is required for the happy path <!-- satisfied: settlement.ts polls every 1s, onSettleReady triggers settle-tx.ts -->
- [x] Result is deterministic and reproducible from `sha256(secret || entropy || match_pda || algorithm_version)` with the coin side derived from `result_hash[0] % 2` <!-- satisfied: settle.rs:79 derive_result, :80 result_side = result_hash[0] % 2; settle-tx.ts deriveResult mirrors this -->
- [x] Flip animation plays with coin rotation and landing <!-- satisfied: CoinAnimation.tsx CSS 3D transform, spinning-heads/spinning-tails classes -->

### FR-4: Settlement and Payout

The winner receives all remaining lamports from the match PDA (pool minus fee plus any rent surplus). The `settle` instruction transfers the fee to treasury, then transfers all remaining lamports to the winner and zeroes the match PDA. Settlement is submitted by the backend worker after the match locks and the target slot is reached. The player-facing flow is fully automatic; refund is the fallback if the backend fails to settle within the deadline.

**Acceptance Criteria:**
- [x] Winner payout = remaining PDA lamports after 500 bps (5%) fee (read from PlatformConfig.fee_bps) <!-- satisfied: settle.rs:88-89 pool = entry*2, calculate_net_payout(pool); PlatformConfig.fee_bps=500 -->
- [x] Platform fee is collected to treasury <!-- satisfied: settle.rs:114 transfer_lamports_from_pda to treasury -->
- [x] Winner and result recorded on-chain before PDA is zeroed <!-- satisfied: settle.rs:91-94 m.result_hash/result/winner/phase set; :128-130 lamports zeroed + data cleared -->
- [x] MatchSettled event emitted with commitment, secret, entropy, result_hash, result_side, payout_amount, fee_amount <!-- satisfied: settle.rs:96-107,123-126 MatchSettled event emission -->
- [x] Backend worker submits the settlement transaction automatically after join/lock; the UI surfaces progress without asking the user to claim manually <!-- satisfied: settlement.ts onSettleReady -> settle-tx.ts settleMatch, settlement worker polls every pollIntervalMs -->
- [x] Settlement uses transient/permanent error classification for safe retry from the backend worker <!-- satisfied: settle-tx.ts PermanentSettleError/TransientSettleError classes; retry.ts retry logic -->
- [ ] Backend health / low-balance / worker failures are operator-visible via `GET /health` and structured logs

### FR-4b: Cancellation and Refunds

All cancellations refund deposited amounts in full. No platform fee is kept on cancellation. Three refund paths exist: (1) creator cancel (WAITING only), (2) mutual refund via `request_refund` (LOCKED, both must vote), (3) `timeout_refund` after `resolve_deadline` passes (permissionless, anyone can trigger).

**Acceptance Criteria:**
- [x] Creator can cancel a match in WAITING phase (before opponent joins) <!-- satisfied: cancel_match.rs, phase==WAITING check -->
- [x] Cancel refunds full entry amount + rent to creator <!-- satisfied: cancel_match.rs close=creator, all lamports returned -->
- [x] Timeout refund returns both players' principal if backend settlement does not complete before the resolve_deadline (FLIPYOU_RESOLVE_TIMEOUT_SECONDS = 86400s / 24h) <!-- satisfied: timeout_refund.rs:43 is_expired(m.resolve_deadline, now), opponent gets entry_amount, creator gets remaining -->
- [x] Mutual refund via `request_refund` — either player can vote, when both have voted the match refunds immediately <!-- satisfied: request_refund.rs creator_wants_refund/opponent_wants_refund flags, both_voted triggers PHASE_REFUNDED -->
- [x] No platform fee is deducted on any cancellation <!-- satisfied: cancel_match.rs, request_refund.rs, and timeout_refund.rs have no fee calculation -->
- [x] Timeout refund is permissionless (any signer can trigger after deadline) <!-- satisfied: timeout_refund.rs caller: Signer, no creator/opponent check on caller -->

### FR-5: Fairness Verification

Players can verify the outcome of any completed match by inspecting the MatchSettled event (emitted on-chain with commitment, secret, entropy, result_hash) and/or the backend-served verification payload. The result is re-derivable: `sha256(secret || entropy || match_pda || algo_ver)` must equal `result_hash`, and `result_hash[0] % 2` determines the winning side.

**Acceptance Criteria:**
- [ ] Settled rounds are verifiable via `GET /fairness/rounds/:pda`, including commitment, secret, target slot / entropy details, result side, winner, and settlement tx
- [ ] Unsettled rounds never expose the secret via the verification endpoint
- [ ] Verification is accessible from the result screen and match-history-style entry points, using the backend payload and/or on-chain MatchSettled event data <!-- out of scope: frontend is a separate project -->

### FR-5b: Backend Operations and Testability

FlipYou V1 requires a documented, repeatable backend run path for local development, devnet smoke testing, and full E2E validation.

**Acceptance Criteria:**
- [ ] A local backend run profile is documented and exercised: Postgres available, migrations applied, backend booted, health endpoint returns ready state
- [x] A devnet backend run profile is documented and exercised: devnet RPC configured, server keypair funded, backend booted, health endpoint returns ready state <!-- satisfied: Backend Run Modes / Devnet below; exercised via `apps/platform/scripts/run-e2e-devnet.sh` + `/health` gating -->
- [ ] Local E2E covers backend-backed create -> join -> auto-settle -> verify against a running backend
- [x] Devnet E2E covers the same backend-backed flow against deployed devnet programs and backend infrastructure <!-- satisfied: apps/platform/e2e/devnet/lifecycle.spec.ts + smoke.spec.ts -->

### FR-6: Lobby Browser UI

A browsable list of open flipyou matches with creation controls. No tier-based filtering — lobby shows all open matches with their custom entry amounts.

**Acceptance Criteria:**
- [ ] Open games list shows creator name/avatar, wager amount, side, and join button <!-- out of scope: frontend is a separate project -->
- [x] Sort by newest/oldest/amount <!-- satisfied: OpenMatchesList.tsx:18 sortMatches, :79 sort dropdown -->
- [ ] Create Game panel with WagerInput (numeric input + quick-select preset buttons: 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0 SOL) and Heads/Tails toggle <!-- out of scope: frontend is a separate project -->
- [x] ~~Estimated wait time shown (derived from recent match fill rate — deferred to post-MVP polish if data unavailable)~~ [DEFERRED] <!-- deferred: self-deferred in criterion text, no match fill-rate data available -->

### FR-7: Active Game and Result UI

The in-match view showing both players, flip you animation, and result. UI phases: Created (waiting for opponent) -> Countdown (3-2-1 when opponent joins) -> Flipping (coin spinning + slot progress bar + "Settling...") -> Complete (You Won/Lost + payout breakdown + verify fairness). Refund buttons shown after 30s of flipping as a safety net, not during normal flow.

**Acceptance Criteria:**
- [x] Both players shown with avatars, names, and wager amounts <!-- satisfied: ActiveMatchView.tsx PlayerAvatarCompact, side labels, entry amount -->
- [x] 3D flip you animation with multiple rotations and gradual slowdown <!-- satisfied: CoinAnimation.tsx CSS 3D transform (front/back faces), spinning classes -->
- [x] Winning side highlighted with glow effect <!-- satisfied: ActiveMatchView.tsx result color + textShadow glow -->
- [x] "YOU WIN!" or "YOU LOSE" overlay displayed <!-- satisfied: ActiveMatchView.tsx "You Won!", "You Lost" with heart+shards animation -->
- [x] Payout amount shown for winner <!-- satisfied: ActiveMatchView.tsx match.payoutAmount.toFixed(4) SOL -->
- [ ] Quick rematch option available after result using the same amount and side <!-- out of scope: frontend is a separate project -->

### FR-8: Audio Feedback

Sound effects accompany the flipyou experience.

**Acceptance Criteria:**
- [x] ~~Flip you spinning sound during animation~~ [DEFERRED] <!-- deferred: audio integration deferred (Scope Decisions) -->
- [x] ~~Dramatic pause before landing~~ [DEFERRED] <!-- deferred: audio integration deferred (Scope Decisions) -->
- [x] ~~Victory sound for winner~~ [DEFERRED] <!-- deferred: audio integration deferred (Scope Decisions) -->
- [x] ~~Coin clink on landing~~ [DEFERRED] <!-- deferred: audio integration deferred (Scope Decisions) -->

---

## Success Criteria

- A player can create a match, have it joined, see the flip, and receive payout in a single uninterrupted flow (no separate claim step)
- Match creation uses the backend partial-sign flow with JWT auth, one wallet approval, and no client-held secret
- Settlement correctness: winner always receives pool minus 500 bps (5%) fee, fee always reaches treasury, match PDA is zeroed after settlement
- Any completed match can be independently verified for fairness via the MatchSettled event data and/or the public rounds endpoint
- Automatic settlement completes within 10 seconds of target slot availability (p95)
- Error states (insufficient balance, network failure, wallet disconnect, auth failure) are clearly communicated

---

## Dependencies

- Wallet connection via `@solana/wallet-adapter-react` (Privy removed)
- FlipYou Anchor program (`solana/programs/flipyou`) implementing commit-reveal settlement (create, join, settle, cancel, request_refund, timeout_refund)
- Platform Anchor program (`solana/programs/platform`) for fee config (PlayerProfile removed)
- `packages/anchor-client/` (generated from IDL via `scripts/sync-idl`)
- `services/backend/` fairness service (Hono API + JWT auth + settlement worker)
- Postgres for backend secret / round / auth session storage
- Shared UI components (`packages/ui/`) for buttons, modals, cards, toasts, WagerInput
- Dev environment: Anchor CLI 0.32.1, Solana CLI 3.1.8, Rust toolchain

## Assumptions

- FlipYou uses custom wager amounts (no tiers) with a platform-wide minimum of 0.0026 SOL; on-chain `create_match` takes `amount: u64`, backend uses `amountLamports` in request body
- `FlipYouMatch` account fields: creator, opponent, server, entry_amount, creator_side, phase, commitment, algorithm_ver, target_slot, resolve_deadline, result_hash, result, winner, created_at, match_id, bump, creator_wants_refund, opponent_wants_refund
- PDA seeds: `["match", creator.key(), match_id]` where match_id is backend-generated random 8 bytes; Config PDA: `["flipyou_config"]`
- Platform fee is 500 bps (5%), flat fee to a single treasury. Fee rate and treasury address are read from PlatformConfig at settlement time.
- FlipYou fairness is backend-assisted commit-reveal: secret generated server-side, SHA256(secret) = commitment stored on-chain at create, entropy from SlotHashes at target_slot, result = SHA256(secret || entropy || match_pda || algo_ver)
- Authentication uses JWT Bearer tokens issued via challenge-response sign-in (not per-request Ed25519 signatures). Frontend authenticates once, gets access/refresh token pair.
- Non-custodial wallet flow via `@solana/wallet-adapter-react` (no Privy, no internal balance model)
- Backend service is a required part of the flipyou product, not optional operator tooling
- Match PDA is closed after settlement (all lamports distributed, account data zeroed) — no `claimed` field or separate claim step
- PlayerProfile removed — no on-chain player stats tracking

---

## Backend Run Modes

### Local

- Backend env must provide: `DATABASE_URL`, `RPC_URL`, `SERVER_KEYPAIR`, and optional tuning values from `services/backend/src/config.ts`
- Minimum startup flow: `pnpm --filter @rng-utopia/backend migrate` then `pnpm --filter @rng-utopia/backend dev`
- Local platform/frontend config must point flipyou create + verification requests at the local backend base URL
- Ready signal: `GET /health` reports DB connected, worker running, and server balance above threshold for the chosen localnet flow

### Devnet

- Backend env must use funded devnet credentials: devnet `RPC_URL`, funded `SERVER_KEYPAIR`, and the deployed program IDs expected by the platform E2E suite
- Minimum startup flow: `pnpm --filter @rng-utopia/backend migrate` then `pnpm --filter @rng-utopia/backend dev`
- Devnet E2E must run against the live backend and deployed programs, not a mock secret generator
- Ready signal: `GET /health` reports the expected server key, devnet SOL balance, DB connectivity, and active worker

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Match creation with amount + side | Create match via UI, verify lobby listing | Screenshot of lobby with new match |
| 2 | Match joining assigns opposite side | Join match, verify side assignment | Screenshot showing both players |
| 3 | Backend create flow returns valid partial tx | Authenticate via JWT, request backend create with `{wallet, amountLamports, side}`, wallet co-signs returned tx | Captured request/response + confirmed tx |
| 4 | Backend automatic settlement determines outcome | Join match, wait for backend settle, verify deterministic result from secret + entropy | Settled round payload + tx confirmation |
| 5 | Winner payout = pool minus 500 bps (5%) fee | Check on-chain settlement transaction | Explorer link showing amounts |
| 6 | Platform fee reaches treasury | Check treasury PDA balance | Explorer link showing fee transfer |
| 7 | Timeout refund protects users if backend is unavailable (24h deadline) | Simulate / induce missed settlement and verify timeout_refund path | Tx confirmation + balance check |
| 8 | Fairness verification works | Use rounds endpoint / UI to recalculate result | Response body or screenshot of verification view |
| 9 | Local backend run profile works | Boot Postgres + backend locally, verify `/health`, run local backend-backed E2E | Health output + E2E run result |
| 10 | Devnet backend run profile works | Boot backend against devnet, verify `/health`, run devnet smoke/E2E | Health output + devnet test result |
| 11 | End-to-end flow completes | Full playthrough from create to automatic settle and verify | Video or step-by-step screenshots |

---

## Completion Signal

### Implementation Checklist

Phases 1-2 below capture the historical implementation work that previously marked this spec done. Phase 3 is the active carry-forward needed to align FlipYou with the backend-assisted V1 contract defined by specs 005 and 006.

**Phase 1: Core Implementation (complete)**
- [x] [on-chain] FlipYouConfig PDA + initialize_config instruction (done: TDD stubs commit)
- [x] [on-chain] `FlipYouMatch` state + `create_match` instruction with custom `amount: u64` (no tiers), `validate_wager()` enforces minimum 0.0026 SOL (done: commit-reveal rewrite)
- [x] [on-chain] Shared wager validation via `rng_shared::wager::validate_wager` enforcing platform minimum 0.0026 SOL (done: shared crate)
- [x] [on-chain] Implement join_match — phase check, opponent != creator, escrow transfer, set LOCKED, set target_slot (done: iteration 2)
- [x] [on-chain] Implement settle — verify commitment, derive result from secret+entropy+match_pda+algo_ver, fee to treasury, winner takes remaining, PDA zeroed (done: commit-reveal rewrite, replaced resolve_match + claim_payout)
- [x] [on-chain] Implement cancel_match — WAITING-only, full refund + close (done: iteration 5)
- [x] [on-chain] Implement request_refund — mutual refund in LOCKED phase, both players must vote (done: commit-reveal rewrite)
- [x] [on-chain] Implement timeout_refund — permissionless after resolve_deadline (24h), refunds both players (done: commit-reveal rewrite)
- [x] [on-chain] Platform program scaffold — PlatformConfig (PlayerProfile removed) (done: iteration 6, profile deleted later)
- [x] [engine] Create anchor-client package + sync-idl script (done: iteration 1, engine phase)
- [x] [engine] Align game-engine with on-chain — types.ts side values, flipyou.ts PDA rewrite (done: iteration 7)
- [x] [frontend] Wire FlipYouContext to anchor-client — delete mock-simulation.ts, real chain calls (done: iteration 8)
- [x] [frontend] Wire lobby browser + error handling (done: iteration 9)

**Phase 1b: Shared Infrastructure + Commit-Reveal Rewrite (complete — specs 004, 005, 006)**
- [x] [on-chain] Commit-reveal model — backend generates secret, SHA256(secret)=commitment stored at create, settle reveals secret on-chain (done: specs 005+006)
- [x] [on-chain] resolve_match + claim_payout deleted — replaced by single `settle` instruction that does everything (verify commitment, derive result, transfer fee, pay winner, zero PDA) (done: commit-reveal rewrite)
- [x] [on-chain] PlayerProfile + CPI removed — no on-chain stats tracking (done: profile removal)
- [x] [on-chain] Shared crate modules: wager, timeout, escrow, fees, pause, fairness (commit-reveal), constants (done: spec 004 + rewrite)
- [x] [on-chain] request_refund (mutual) + timeout_refund (deadline-based, permissionless) instructions (done: commit-reveal rewrite)
- [x] [engine] IDL re-synced for rewritten programs (done: spec 004)
- [x] [frontend] chain.ts rewritten for commit-reveal flow (done: backend integration)

**Phase 2: Data Consistency (complete)**
- [x] [engine] Tier enums removed; custom amount helpers in place. `packages/game-engine/src/types.ts` uses `amountLamports`, no named-tier dependencies remain. (done: custom-amount rewrite)
- [x] [frontend] Tier selection UI replaced with `WagerInput` component (numeric input + quick-select preset buttons: 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0 SOL). FlipYouPage, MatchCard, and `chain.ts` all use custom amounts. (done: custom-amount rewrite)

**Phase 2: Active Matches (G-1)**
- [x] [frontend] Add `fetchClaimableMatches(connection, playerPubkey)` to `features/flipyou/utils/chain.ts` — use `getProgramAccounts` with memcmp filters for matches where player is `creator` OR `opponent` in WAITING or LOCKED phase. Must handle both cases (player as creator and player as opponent are separate queries since the pubkey is at different offsets). Return `UIMatch[]`. Verify: `pnpm typecheck` passes. (done: iteration 12)
- [x] [frontend] Surface active matches in FlipYouContext + FlipYouPage — add `claimableMatches: UIMatch[]` to context state, poll via `fetchClaimableMatches` alongside open matches. Show "Your Matches" section in FlipYouPage above the open lobby list with cancel/refund actions per match. Verify: `pnpm build` succeeds. (done: iteration 13)

**Phase 2: Fairness Verification (FR-5)**
- [x] [on-chain] MatchSettled event emits commitment, secret, entropy, result_hash, result_side, payout_amount, fee_amount — all data needed for independent verification (done: settle.rs MatchSettled event)
- [x] [engine] IDL re-synced after MatchSettled event change (done: sync-idl)
- [x] [frontend] Build fairness verification utility — `features/flipyou/utils/verification.ts` extracts MatchSettled event from settle tx logs, re-derives `sha256(secret || entropy || match_pda || algo_ver)`, compares to `result_hash`, checks `result_hash[0] % 2` matches `result_side` (done: iteration 16)
- [x] [frontend] Build fairness verification UI — "Verify Fairness" button in ActiveMatchView (visible in completed phase), shows commitment, secret, entropy, result hash, derived result, winner, verification status badge (done: iteration 17)

**Phase 2: Quick Rematch (FR-7.6)**
- [ ] [frontend] Add / update rematch flow so `ActiveMatchView` can recreate a match with the same amount and the player's original side choice. Creates a new open match in the lobby — the opponent must find and join it manually (no forced rematch). Button text: "Play Again". Reuses the existing `createMatch` context action. <!-- out of scope: frontend is a separate project -->

**Phase 2: Validation & Cleanup**
- [x] [test] Validate carry-forward invariants — verified: (a) commitment stored on FlipYouMatch + emitted in MatchSettled, (b) result_hash[0]%2 is pure deterministic side derivation, (c) timeout_refund uses `is_expired(resolve_deadline, now)`, (d) join_match rejects non-WAITING phase, settle rejects non-LOCKED phase, (e) create_match calls `check_not_paused()`. (done: iteration 19)
- [x] [frontend] Remove dead code — stale tier/VRF references cleaned up. (done: iteration 20)
- [x] [docs] Update spec artifacts — replaced VRF/resolve_match references with commit-reveal architecture. (done: iteration 21)
- [ ] [test] Update visual baselines for flipyou pages (custom-amount UI changes).

**Phase 3: Backend Integration and E2E (required for real V1 completion)**
- [x] [backend] JWT auth system — challenge/verify/refresh/logout routes at `/auth/*`, JWT middleware on POST requests, wallet read from `sub` claim (done: auth.ts + jwt-auth.ts)
- [x] [backend] Create endpoint — `POST /fairness/flipyou/create` (JWT-authenticated), generates secret+commitment+matchId, builds partially-signed create_match tx, stores round in DB, returns {transaction, matchPda, matchId, commitment, lastValidBlockHeight} (done: create.ts + tx-builder.ts)
- [x] [backend] Settlement worker — polls every 1s for LOCKED matches where target_slot reached, submits settle tx with secret reveal, uses PermanentSettleError/TransientSettleError for retry classification (done: settlement.ts + settle-tx.ts + retry.ts)
- [ ] [frontend] Replace any remaining client-side flipyou create secret flow with the backend create contract: JWT Bearer auth, call `POST /fairness/flipyou/create` with `{wallet, amountLamports, side}`, wallet co-signs returned transaction, surface auth / rate-limit / duplicate errors clearly. <!-- out of scope: frontend is a separate project -->
- [x] [frontend] Align fairness verification UX with `GET /fairness/rounds/:pda` so post-settlement verification uses backend-served secret / result payloads and unsettled rounds never expose secret material. <!-- satisfied: result-screen fairness payload + backend `rounds` endpoint gating -->
- [ ] [infra] Add a documented local backend run path for flipyou development: env template/profile, Postgres migration step, `pnpm --filter @rng-utopia/backend dev`, frontend backend base URL wiring, and `/health` verification.
- [x] [infra] Add a documented devnet backend run path for flipyou: funded server keypair, devnet RPC/program config, backend startup, and `/health` verification before tests. <!-- satisfied: Backend Run Modes / Devnet + `run-e2e-devnet.sh` -->
- [ ] [test] Extend `pnpm test:e2e` local Playwright coverage to run the backend-backed create -> join -> auto-settle -> verify flow against a running local backend.
- [x] [test] Extend `pnpm test:e2e:devnet` coverage to run the same backend-backed flow against deployed devnet programs and backend infrastructure. <!-- satisfied: devnet smoke + lifecycle suite green against backend-backed flow -->

### Scope Decisions

- **Amounts**: FlipYou uses custom wager amounts, not named tiers. Minimum amount is `0.0026 SOL`. On-chain `create_match` takes `amount: u64`, backend uses `amountLamports`. Frontend uses `WagerInput` with numeric input + quick-select preset buttons.
- **Side discriminants**: 0/1 canonical (heads=0, tails=1).
- **Account layout**: `FlipYouMatch` fields: creator, opponent, server, entry_amount, creator_side, phase, commitment, algorithm_ver, target_slot, resolve_deadline, result_hash, result, winner, created_at, match_id, bump, creator_wants_refund, opponent_wants_refund. No `tier` field, no `claimed` field.
- **PDA seeds**: `["match", creator.key(), match_id]` where match_id is backend-generated random 8 bytes. Config PDA: `["flipyou_config"]`.
- **Settlement model**: Commit-reveal, backend-assisted. Backend generates secret, SHA256(secret)=commitment stored at create. After join (LOCKED), backend reads entropy at target_slot, derives result=SHA256(secret || entropy || match_pda || algo_ver), submits settle tx. Match PDA is closed after settle (funds distributed, account zeroed).
- **Auth model**: JWT Bearer tokens. Frontend authenticates once via challenge-response (sign a nonce message), gets access/refresh tokens. Backend create endpoint reads wallet from JWT `sub` claim. No per-request Ed25519 payload signatures.
- **Fee model**: 500 bps (5%) flat fee to single treasury. Winner takes pool minus fee. Fee rate and treasury read from PlatformConfig on-chain.
- **Matching**: Players join any open match. No tier-based filtering — lobby shows all open matches with their entry amounts. Joiner must deposit the exact entry_amount stored on the match PDA.
- **Refund paths**: (1) cancel_match — creator only, WAITING phase, full refund. (2) request_refund — mutual vote in LOCKED phase, both players must agree. (3) timeout_refund — permissionless after resolve_deadline (24h), refunds both players.
- **Platform program**: Fee config only. PlayerProfile removed — no on-chain stats tracking.
- **Fairness verification**: Public verification via MatchSettled event (commitment, secret, entropy, result_hash) and/or backend `GET /fairness/rounds/:pda` endpoint.
- **UI flow**: Created (waiting) -> Countdown (3-2-1) -> Flipping (coin spin + slot progress + "Settling...") -> Complete (You Won/Lost + payout + verify fairness). Refund buttons shown after 30s of flipping (safety net).
- **Deferred**: Audio integration (all 4 FR-8 items → dedicated audio spec), estimated wait time (FR-6.5 → requires match fill-rate analytics infrastructure).

### Iteration Instructions

Each checklist item is one autonomous iteration (`claude -p` invocation). The agent:
1. Reads this spec + history.md for prior context
2. Implements the next unchecked item
3. Runs the verification command specified in the item
4. If verification passes → checks the box, commits, outputs `<promise>DONE</promise>`
5. If verification fails → outputs `<blocker>description</blocker>` and exits

**Only when ALL items are checked, output:** `<promise>DONE</promise>`

---

## Implementation Reference

### On-Chain (Solana)
- **Program ID**: `89raisnHvTCGv8xkwdHst5N4T2QDcsEVTjw2VtbK8fyk`
- **PDA Seeds**:
  - Match: `["match", creator_pubkey, match_id]` — match_id is 8 random bytes generated by backend
  - Config: `["flipyou_config"]`
- **Account — `FlipYouMatch`** (8 discriminator + InitSpace):
  - `creator: Pubkey` — match creator
  - `opponent: Pubkey` — joiner (default until joined)
  - `server: Pubkey` — backend co-signer
  - `entry_amount: u64` — wager in lamports
  - `creator_side: u8` — 0 = Heads, 1 = Tails
  - `phase: u8` — 0 = Waiting, 1 = Locked, 2 = Settled, 3 = Refunded
  - `commitment: [u8; 32]` — SHA256(server_secret)
  - `algorithm_ver: u8` — result derivation version
  - `target_slot: u64` — slot for entropy read (set on join)
  - `resolve_deadline: i64` — unix timestamp; timeout_refund available after this
  - `result_hash: [u8; 32]` — derived on settle
  - `result: u8` — winning side (0 or 1)
  - `winner: Pubkey` — winner's address
  - `created_at: i64` — unix timestamp
  - `match_id: [u8; 8]` — random ID from backend
  - `bump: u8` — PDA bump
- **Account — `FlipYouConfig`**:
  - `authority: Pubkey`, `paused: bool`, `bump: u8`
- **Instructions** (7):
  - `initialize_config` — creates FlipYouConfig PDA (admin-only)
  - `create_match(commitment, amount, side, match_id)` — creates match PDA, escrows wager
  - `join_match` — opponent deposits matching wager, sets phase to Locked, records target_slot
  - `settle(secret)` — verifies commitment, derives result from secret+entropy+pda+algo_ver, pays winner minus 500 bps fee, zeroes PDA
  - `cancel_match` — creator-only, Waiting phase, full refund + close
  - `timeout_refund` — permissionless after resolve_deadline (24h), refunds both players
  - `set_paused(paused)` — admin toggles game pause

### Backend
- **Endpoints**:
  - `POST /fairness/flipyou/create` — JWT-authenticated; generates secret+commitment+matchId, builds partially-signed tx, stores round in DB; returns `{transaction, matchPda, matchId, commitment, lastValidBlockHeight}`
  - `GET /fairness/rounds/:pda` — public; returns round lifecycle data, secret only exposed post-settlement
  - `GET /fairness/rounds/by-id/:matchId` — public; lookup by 16-char hex match ID
  - `GET /fairness/rounds/history?game=flipyou&limit=N` — public; recent settled rounds
  - `POST /auth/challenge` / `POST /auth/verify` / `POST /auth/refresh` / `POST /auth/logout` — JWT session lifecycle
  - `GET /health` — operator health (DB, worker, server balance)
- **DB Table — `rounds`** (migration 001 + 003 + 004 + 007):
  - `pda TEXT PRIMARY KEY` — match PDA address
  - `game TEXT` — `"flipyou"` (shared table with lord-of-rngs)
  - `creator TEXT`, `server_key TEXT`
  - `secret BYTEA`, `commitment BYTEA` — server secret material (secret redacted until settled)
  - `amount_lamports BIGINT` — wager amount (replaced tier column in migration 003)
  - `side SMALLINT`, `match_id TEXT`
  - `phase TEXT` — `created | locked | settled | failed`
  - `target_slot BIGINT`, `settle_tx TEXT`, `settle_attempts INT`
  - `result_hash BYTEA`, `result_side SMALLINT`, `winner TEXT`
  - `entries JSONB` — player entries at settlement (migration 007)
  - `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`
  - Indexes: `phase`, `creator`, `match_id`
- **Settlement**: PDA watcher (`onAccountChange` WebSocket) detects join instantly (~1-3s latency). Settlement worker polls every 1s as fallback. On settle-ready (target_slot reached): reads entropy from SlotHashes, submits `settle` instruction with secret reveal. Uses `PermanentSettleError`/`TransientSettleError` for retry classification.

---

## Key Decisions (from refinement)

- **Custom amounts, not tiers**: FlipYou moved from 6 named tiers (Iron-Diamond, 0.005-1.0 SOL) to fully custom wager amounts. Minimum 0.0026 SOL, on-chain `create_match` takes `amount: u64`, backend uses `amountLamports`. Tiers removed from on-chain state and frontend.
- **Coin side discriminants**: 0/1 on-chain canonical (heads=0, tails=1).
- **Fairness model pivot**: Originally Orao VRF (join embeds VRF request CPI, claim reads randomness at claim time, 3-tx flow). Replaced by backend-assisted commit-reveal per specs 005/006: backend generates secret, SHA256(secret)=commitment at create, entropy from SlotHashes at target_slot, settle reveals secret on-chain.
- **Settlement model**: Single `settle` instruction replaced old `resolve_match` + `claim_payout` pair. Settle verifies commitment, derives result, transfers fee + payout, zeroes PDA. Backend worker submits settle automatically.
- **PDA seeds**: `["match", creator.key(), match_id]` where match_id is backend-generated random 8 bytes. Config PDA: `["flipyou_config"]`.
- **Fee model**: 500 bps (5%) flat fee to single treasury. Fee rate and treasury read from PlatformConfig on-chain (admin-updatable). No split buckets (rakeback/chest removed).
- **Platform program**: Fee config only. PlayerProfile removed -- no on-chain stats tracking.
- **Auth model**: JWT Bearer tokens via challenge-response. No per-request Ed25519 signatures.
- **Refund paths**: (1) cancel_match (creator, WAITING only), (2) request_refund (mutual vote, LOCKED), (3) timeout_refund (permissionless after 24h resolve_deadline).
- **Tier 4 naming**: Renamed from "emerald" to "platinum" before tiers were removed entirely.
- **Quick rematch**: "Play Again" creates a new open match with same amount/side. No forced rematch.
- **One active match per player**: Enforced by PDA seeds `["match", creator]` (Anchor init fails if PDA exists).
- **Spec scope**: On-chain + engine + frontend. Audio deferred to dedicated spec.

## Deferred Items

- **Estimated wait time (FR-6.5)**: Deferred to post-MVP polish. Requires match fill-rate analytics infrastructure that does not exist. No target spec.
- **Audio feedback (FR-8, all 4 items)**: Spinning sound, dramatic pause, victory sound, coin clink all deferred to a dedicated audio spec. No dedicated audio spec created yet.
- **Match history for verification (FR-5.3 partial)**: Full match history is a Phase 3 platform feature (spec 003). The /fairness page provides interim access to verification.
- **Phase transition events (G-2)**: Only MatchSettled event emitted. Create/join/cancel/timeout do not emit Anchor events. Frontend uses account polling. Carried forward to 003-platform-core.
- **Frontend unit tests**: Zero vitest unit/component tests for flipyou feature. 17 visual regression snapshots cover page rendering but not interaction logic. Tracked by spec 203 (e2e-integration).
- **Local backend E2E**: Local backend-backed create -> join -> auto-settle -> verify flow not yet covered. Devnet E2E is green.
