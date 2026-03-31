# Specification: 003 Platform Core Systems

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Ideation | Active (cross-cutting, always active) |
| Priority | P0 |
| Phase | 0-3 |
| NR_OF_TRIES | 0 |

---

## Overview

Platform Core covers the shared systems that all V1 games depend on: wallet connection, session authentication, custom-amount betting, platform fee collection, provably fair verification, basic user profile/history, XP system, and operational controls. These are not a standalone feature but rather the cross-cutting foundation that Coinflip and Lord of the RNGs both require.

**Authentication model**: JWT Bearer tokens via a challenge-response flow (see Spec 006 FR-5, Spec 007). The wallet signs a one-time nonce to establish a session; subsequent API requests use the JWT access token. This is NOT per-request Ed25519 wallet signatures over payloads.

## User Stories

- As a player, I want to connect my Solana wallet so that I can participate in games.
- As a player, I want to enter a custom SOL amount so that I can play at stakes I'm comfortable with.
- As a player, I want to verify that game outcomes are provably fair so that I trust the platform.
- As a player, I want to view my game history so that I can track my performance over time.
- As a player, I want to see my profile with XP and level so that I can track my progression.
- As an operator, I want to pause and resume games so that I can respond to incidents.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 2 (wallet connection, non-custodial flow, fairness verification, basic profile/history, operational controls), Section 6 (Functional Requirements), Section 7 (Non-Functional Requirements)
- **Scope status**: V1 In Scope
- **Phase boundary**: Cross-cutting; needed from Phase 0 through Phase 3

## Required Context Files

- `backend/docs/PLATFORM.md` (all platform-wide systems)
- `docs/SCOPE.md` (scope boundaries)

## Contract Files

- `packages/ui/src/layouts/WagerInput.tsx` — Custom-amount wager input component (SOL formatting + preset buttons)
- `packages/ui/src/layouts/BettingPanel.tsx` — Betting panel layout using WagerInput
- `services/backend/src/middleware/jwt-auth.ts` — JWT Bearer token middleware for authenticated API requests
- `services/backend/src/routes/auth.ts` — Challenge-response auth endpoints (challenge, verify, refresh, logout)

---

## Functional Requirements

### FR-1: Wallet Connection

V1 ships normal Solana wallet flow using external wallets. Players connect, sign transactions, and disconnect.

**Acceptance Criteria:**
- [ ] Player can connect via standard Solana wallet (Phantom, Solflare, etc.)
- [ ] Connected state shows wallet address and SOL balance
- [ ] Wallet state persists across page refreshes
- [ ] Player can sign and submit transactions
- [ ] Player can disconnect, clearing session state
- [ ] Wallet connection errors are clearly communicated

### FR-2: Custom Amount Betting System

Custom SOL amounts structure all P2P games — there are no predefined tiers. Each round or match is amount-scoped, so all participants in the same round or match commit the exact same wager amount. The field name at all API and contract boundaries is `amountLamports`.

**Acceptance Criteria:**
- [ ] Players can enter a custom SOL amount instead of choosing from preset brackets
- [ ] Minimum wager enforced: 0.0026 SOL
- [ ] Wager amounts are validated and stored in lamports (`amountLamports`) for all contract boundaries
- [ ] Open matches / rounds can be grouped, searched, or filtered by exact amount or amount range
- [ ] Amount selection is locked once a bet is placed for that round
- [ ] Countdown timers displayed where applicable

### FR-3: Flexible Betting System

For pari-mutuel games, players can wager any amount within platform limits using the
`WagerInput` component (`packages/ui/src/layouts/WagerInput.tsx`). This replaces any
prior tier-based selector with a numeric input featuring SOL formatting and preset buttons.

**Acceptance Criteria:**
- [ ] `WagerInput` component: numeric input field with SOL formatting for manual entry
- [ ] 1/2 button halves current bet
- [ ] x2 button doubles current bet
- [ ] MAX button sets to maximum allowed (balance or platform limit)
- [ ] Minimum bet enforced: 0.0026 SOL
- [ ] Maximum bet enforced [NEEDS CLARIFICATION - may vary by game or player level]

### FR-4: Platform Fee Collection

A percentage fee is deducted from each round pool and collected to a treasury PDA on-chain.

**Acceptance Criteria:**
- [ ] Fee deducted from each pool after settlement
- [ ] Fee collected to treasury PDA for transparency
- [ ] Fee amount is auditable on-chain
- [ ] Fee is 500 bps (5%), flat fee to single treasury (read from PlatformConfig.fee_bps)

### FR-5: Provably Fair Verification

Applicable RNG games use deterministic, verifiable hybrid fairness. Players can independently verify results from public backend verification payloads plus on-chain settlement evidence.

**Acceptance Criteria:**
- [ ] Applicable games expose wallet-authenticated create flows and public verification payloads as part of the fairness contract
- [ ] Outcomes can be recomputed from public inputs (for example: commitment, revealed secret, entropy slot/hash, round identifier, algorithm version)
- [ ] Secrets are withheld before settlement and only revealed when the round is verifiable
- [ ] Players can recalculate outcomes and confirm they match displayed results
- [ ] Verification UI accessible for any completed round/match
- [ ] Public verification endpoints are available where backend-assisted fairness is used (for example `/fairness/*`)

### FR-6: XP System

Players earn XP based on participation and performance, awarded after each round during settlement.

**Acceptance Criteria:**
- [ ] XP awarded based on wager amount: participation XP and win XP (per table in PLATFORM.md)
- [ ] XP contributes to visible player levels on profiles
- [ ] Leaderboard rankings based on total XP accumulated
- [ ] XP awards shown after each round

### FR-7: Game History

Complete record of all player activity across all games, filterable and verifiable.

**Acceptance Criteria:**
- [ ] Records include: game type, amount, wager, outcome, payout, timestamp, round ID, other players
- [ ] Filterable by game type, date range, outcome
- [ ] Sortable by date, amount, game
- [ ] Running totals: total wagered, total won, net profit/loss
- [ ] Win rate statistics per game
- [ ] Each game links to provably fair verification
- [ ] Paginated list view with infinite scroll
- [ ] Quick filters: "Today", "This Week", "This Month", "All Time"
- [ ] Color coding: green for wins, red for losses
- [ ] Expandable rows for detailed game info
- [ ] Accessible from user profile/dashboard

### FR-8: User Profile

Basic profile display for player identity and stats.

**Acceptance Criteria:**
- [ ] Profile displays wallet address (or linked username if accounts are created)
- [ ] Shows XP level and progression
- [ ] Shows aggregate stats (total games, win rate, net P/L)
- [ ] Account creation is optional [NEEDS CLARIFICATION - account system details undefined]

### FR-9: Operational Controls

Operators can manage the platform for safety and incident response.

**Acceptance Criteria:**
- [ ] Operators can pause individual games
- [ ] Operators can resume paused games
- [ ] Monitoring surfaces errors and key events
- [ ] Rate limiting protects against abuse
- [ ] Incident response and rollback procedure documented

---

## Success Criteria

- Wallet connection works reliably for standard Solana wallets
- Custom amount system correctly scopes matches/rounds and enforces exact amounts
- Fee collection is accurate and auditable on-chain for every round
- Any player can independently verify the fairness of any completed round
- Game history accurately reflects all player activity with correct totals
- Operators can pause/resume games within seconds of an incident

---

## Dependencies

- Solana wallet adapter libraries (Phantom, Solflare support)
- On-chain treasury PDA for fee collection
- JWT session auth backend (Spec 006 FR-5, Spec 007) — challenge-response flow for wallet authentication
- Indexing service for game history aggregation
- Backend fairness services and verification endpoints for applicable RNG games
- Monitoring/alerting infrastructure

## Assumptions

- External wallets only for V1 (no embedded wallet)
- Non-custodial model (no internal platform balance)
- XP system is informational in V1 (no gating on game access until post-V1 loyalty program)
- Account creation is optional and basic
- Operational controls are admin-only (no public-facing ops UI)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Wallet connect/disconnect | Connect wallet, verify state, disconnect | Screenshot of connected + disconnected states |
| 2 | Balance display accuracy | Compare displayed balance vs on-chain | Explorer balance vs UI balance |
| 3 | Custom amount rules enforced | Attempt to bet below minimum or join with mismatched amount | Error response or UI enforcement |
| 4 | Fee reaches treasury PDA | Check treasury PDA after settlement | Explorer link showing fee deposit |
| 5 | Provably fair verification | Recalculate result from public inputs and public verification payloads | Verification UI output |
| 6 | XP awarded correctly | Play round, check XP change matches table | Before/after XP comparison |
| 7 | Game history accuracy | Play rounds, verify history entries | History UI showing correct records |
| 8 | Pause/resume games | Trigger pause, verify game stops accepting bets | Admin action + game state screenshot |
| 9 | Session persistence | Connect wallet, refresh page, verify still connected | Before/after refresh screenshots |

---

## Completion Signal

### Implementation Checklist
- [ ] Wallet connection/disconnection flow
- [ ] Custom-amount betting UI and enforcement
- [ ] Flexible betting UI and controls
- [ ] Platform fee collection to treasury PDA
- [ ] Provably fair verification UI and public verification payload integration
- [ ] XP award and display system
- [ ] Game history UI (list, filter, sort, totals)
- [ ] User profile UI
- [ ] Operational pause/resume controls
- [ ] Monitoring and error surfacing
- [ ] Rate limiting
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for fee calculations
- [ ] New tests for XP award logic
- [ ] New tests for custom amount validation and matching
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: wallet disconnect during transaction, zero-balance wallet, rate limit trigger
- [ ] Fee accuracy verified across multiple rounds

#### Visual Verification
- [ ] Wallet connection UI correct on desktop
- [ ] Game history UI correct on desktop
- [ ] Profile UI correct on desktop
- [ ] Mobile responsive layout works

#### Console/Network Check
- [ ] No JS console errors
- [ ] No failed network requests
- [ ] On-chain transactions succeed on devnet

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

---

## Open Items (from checklist review)

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Platform fee percentage inconsistency (2.0-2.2% vs 3%) | FR-4 | Yes |
| 2 | Contract files not identified (wallet adapter, UI exports) | Contract | Yes |
| 3 | Maximum flexible bet limit undefined (may vary by game/player) | FR-3 | No |
| 4 | Provably fair API endpoint - is it required for V1? | FR-5 | No |
| 5 | Account system details undefined (optional account creation) | FR-8 | No |
| 6 | CSV export for game history - is it V1? | FR-7 | No |
| 7 | Edge case: wallet disconnect during active transaction | Edge Case | No |
| 8 | Edge case: stale balance display after external wallet activity | Edge Case | No |
| 9 | Monitoring tooling selection undefined | FR-9 | No |
| 10 | Rate limiting thresholds undefined | FR-9 | No |

### Cross-Game Refinement Obligations (Pivot)

- [ ] Standard proof envelope is defined once for all games (proof type, proof hash/ref, proof_version).
- [ ] Shared lifecycle invariants are reflected in every game spec checklist (timeout, pause, fee, refund).
- [ ] Shared idempotency/replay protection expectations are documented for all game actions.
- [ ] Shared observability/event requirements are defined for phase transitions and settlement outcomes.
- [ ] Provider decisions are locked and propagated to game specs (VRF provider, oracle policy, commit-reveal baseline).

### Gap Analysis Carry-Forward (004 Shared Infrastructure)

- [ ] Define canonical lifecycle event envelope and names for cross-game transitions (at minimum create, join, cancel, timeout, settled).
- [ ] Confirm event-driven consumption path for frontend/indexer while preserving account polling as fallback.
- [ ] Decide whether `settled_at` should remain event/indexer-derived (default) or be persisted in long-lived accounts for games that do not close immediately.

### Checklist Notes

- Platform Core is cross-cutting (Phase 0-3), not a single deliverable
- Some items here (wallet, tiers, fees) are prerequisites for Coinflip (Phase 1)
- Others (history, profile, ops controls) ship in Phase 3
- Implementation should be incremental: build what Coinflip needs first, expand for Lord of the RNGs, complete in Phase 3
- 9 functional requirements extracted covering the full platform surface
- Deferred items explicitly excluded: custodial balances, rakeback distribution, loyalty gating, token utility, leaderboard rewards
- Game history CSV export mentioned in PLATFORM.md but may be post-V1 - needs decision

---

## Open Items (from checklist review)

| # | Item | Category | Blocking? |
|---|------|----------|-----------|
| 1 | Platform fee percentage inconsistency (2.0-2.2% vs 3%) | FR-4 | Yes |
| 2 | Contract files not identified (wallet adapter, UI exports) | Contract | Yes |
| 3 | Maximum flexible bet limit undefined (may vary by game/player) | FR-3 | No |
| 4 | Provably fair API endpoint - is it required for V1? | FR-5 | No |
| 5 | Account system details undefined (optional account creation) | FR-8 | No |
| 6 | CSV export for game history - is it V1? | FR-7 | No |
| 7 | Edge case: wallet disconnect during active transaction | Edge Case | No |
| 8 | Edge case: stale balance display after external wallet activity | Edge Case | No |
| 9 | Monitoring tooling selection undefined | FR-9 | No |
| 10 | Rate limiting thresholds undefined | FR-9 | No |

### Cross-Game Refinement Obligations (Pivot)

- [ ] Standard proof envelope is defined once for all games (proof type, proof hash/ref, proof_version).
- [ ] Shared lifecycle invariants are reflected in every game spec checklist (timeout, pause, fee, refund).
- [ ] Shared idempotency/replay protection expectations are documented for all game actions.
- [ ] Shared observability/event requirements are defined for phase transitions and settlement outcomes.
- [ ] Provider decisions are locked and propagated to game specs (VRF provider, oracle policy, commit-reveal baseline).

### Gap Analysis Carry-Forward (004 Shared Infrastructure)

- [ ] Define canonical lifecycle event envelope and names for cross-game transitions (at minimum create, join, cancel, timeout, settled).
- [ ] Confirm event-driven consumption path for frontend/indexer while preserving account polling as fallback.
- [ ] Decide whether `settled_at` should remain event/indexer-derived (default) or be persisted in long-lived accounts for games that do not close immediately.

### Notes (from checklist)

- Platform Core is cross-cutting (Phase 0-3), not a single deliverable
- Some items here (wallet, tiers, fees) are prerequisites for Coinflip (Phase 1)
- Others (history, profile, ops controls) ship in Phase 3
- Implementation should be incremental: build what Coinflip needs first, expand for Lord of the RNGs, complete in Phase 3
- 9 functional requirements extracted covering the full platform surface
- Deferred items explicitly excluded: custodial balances, rakeback distribution, loyalty gating, token utility, leaderboard rewards
- Game history CSV export mentioned in PLATFORM.md but may be post-V1 - needs decision
