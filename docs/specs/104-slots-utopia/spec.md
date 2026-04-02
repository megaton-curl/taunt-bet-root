# Specification: 104 Slots Utopia

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Ideation | On Hold — not yet properly defined |
| Priority | P3 |
| Phase | Deferred |
| NR_OF_TRIES | 0 |

---

## Overview

A peer-to-peer slot game with high RTP. Players contribute to a shared pot via custom entry amounts. Each spin redistributes the pool to nine positions on a 3x3 grid, with the center position winning the largest share. Access is gated to players meeting a monthly wagering threshold (loyalty perk).

## User Stories

- As a loyal player, I want to play slots with fair redistribution so that I compete against other players, not a house edge.
- As a player, I want the center position to win big so that there's an exciting top prize each spin.
- As a new player, I want to understand what loyalty threshold I need to meet so that I can work toward access.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Not listed in V1 In Scope
- **Scope status**: Deferred (Post-V1)
- **Phase boundary**: Post-V1

## Required Context Files

- `backend/docs/SLOTS_UTOPIA.md` (game concept source - minimal)
- `backend/docs/PLATFORM.md` (custom-amount betting, platform fee, loyalty/XP)

## Contract Files

- [NEEDS CLARIFICATION] No contracts exist yet

---

## Functional Requirements

> **Scope note (2026-04-02)**: Frontend UI is handled by a separate team in a separate repo. Acceptance criteria below cover on-chain programs, backend API, settlement, game engine, and tests only. Frontend items are marked out of scope.

### FR-1: Loyalty Gate

Access restricted to players meeting a monthly wagering threshold.

**Acceptance Criteria:**
- [ ] Players below threshold see a message explaining requirements
- [ ] Players meeting threshold can access the game
- [ ] [NEEDS CLARIFICATION] Monthly wagering threshold amount
- [ ] [NEEDS CLARIFICATION] How threshold is tracked (total wagers across all games?)
- [ ] [NEEDS CLARIFICATION] Reset cadence (monthly? rolling window?)

### FR-2: Spin Entry

Players pay a custom entry amount to join the current spin.

**Acceptance Criteria:**
- [ ] Players can enter a custom SOL amount with a minimum of `0.0026 SOL`
- [ ] Entry fee contributes to shared pot
- [ ] All players in the same spin commit the exact same amount
- [ ] [NEEDS CLARIFICATION] Minimum number of players per spin (9 required for full grid?)
- [ ] [NEEDS CLARIFICATION] What happens with fewer than 9 players?
- [ ] [NEEDS CLARIFICATION] How are players assigned to grid positions?

### FR-3: 3x3 Grid Spin and Payout

The spin assigns players to positions on a 3x3 grid with fixed payout distribution.

**Acceptance Criteria:**
- [ ] 3x3 grid animation plays on spin
- [ ] Payout distribution (after 3% platform fee):
  - Position 5 (center): 50%
  - Positions 2, 4, 6, 8 (edges): 8.5% each (34% total)
  - Positions 1, 3, 7, 9 (corners): 4% each (16% total)
- [ ] Backend-assisted hybrid fairness determines position assignments from revealed secret + public entropy
- [ ] [NEEDS CLARIFICATION] Can one player occupy multiple positions?
- [ ] [NEEDS CLARIFICATION] Are positions assigned before or after spin animation?

### FR-4: Results Display

**Acceptance Criteria:**
- [ ] All nine positions shown with assigned players
- [ ] Player's own position highlighted
- [ ] Payout amount displayed per position
- [ ] [NEEDS CLARIFICATION] Is there a results history?

---

## Success Criteria

- Payouts sum to exactly pool minus 500 bps (5%) fee
- Position assignment is verifiably random
- Loyalty gate correctly allows/denies access
- Grid visualization is clear and engaging

---

## Dependencies

- Shared fairness contract (`docs/specs/005-hybrid-fairness/spec.md`) for deterministic position assignment inputs
- Backend fairness service pattern (`docs/specs/006-fairness-backend/spec.md`) for create / settle / verify flow
- Custom amount betting system (003 FR-2)
- XP/loyalty tracking system (003 FR-6)
- On-chain settlement infrastructure

## Assumptions

- Exactly 9 players needed per spin (one per grid position)
- Loyalty gate uses the XP/wagering system from Platform Core
- This is a deferred feature with minimal source specification

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Payout distribution correct | Run spin, verify amounts per position | Calculation proof |
| 2 | Loyalty gate works | Test with below/above threshold players | Access allowed/denied |
| 3 | Fairness assigns positions | Verify public fairness payload for assignment | Verification payload |
| 4 | Payouts sum to 97% | Total all payouts, compare to pool | Math verification |

---

## Completion Signal

### Implementation Checklist
- [ ] Loyalty gate check
- [ ] Spin entry and pool collection
- [ ] Backend-assisted hybrid-fairness position assignment
- [ ] 3x3 grid animation
- [ ] Fixed payout distribution
- [ ] Settlement and payout
- [ ] Grid UI with results display
- [ ] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs)
- [ ] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes
- [ ] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests for payout distribution math
- [ ] New tests for loyalty gate
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases: exactly 9 players, loyalty threshold boundary

#### Visual Verification
- [ ] Grid renders correctly on desktop
- [ ] Mobile responsive layout works

#### Console/Network Check
- [ ] No JS console errors
- [ ] No failed network requests

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
| 1 | Monthly wagering threshold amount undefined | FR-1 | Yes |
| 2 | Threshold tracking method undefined | FR-1 | Yes |
| 3 | Threshold reset cadence undefined | FR-1 | Yes |
| 4 | Minimum players per spin undefined (9 assumed) | FR-2 | Yes |
| 5 | Handling fewer than 9 players undefined | FR-2 | Yes |
| 6 | Position assignment method undefined (VRF assumed) | FR-2 | Yes |
| 7 | Multi-position per player rules undefined | FR-3 | No |
| 8 | Results history undefined | FR-4 | No |
| 9 | Platform fee inconsistency (2.0-2.2% vs 3%) | Assumption | Yes |
| 10 | No contract files | Contract | No (deferred) |

### Refinement Carry-Forward (Pivot)

- [ ] Lock Slots fairness proof contract fields and verification path for selected VRF provider.
- [ ] Confirm determinism boundary: seat assignment and payout distribution derive only from verified randomness and on-chain rules.
- [ ] Specify timeout/refund behavior for underfilled lobbies and unresolved rounds.
- [ ] Define replay/idempotency protections for seat entry, lock, resolve, and payout distribution.
- [ ] Add failure-mode acceptance checks for fewer-than-target players, duplicate seat claims, and VRF delays/failures.

### Checklist Notes

- Source (SLOTS_UTOPIA.md) is minimal - "Specifications to be defined"
- Payout distribution IS defined clearly (50/8.5/4 split) - this is the most concrete element
- Loyalty gate adds dependency on XP/wagering tracking system
- Core question: what happens with fewer than 9 players? This is the central design challenge
- 6 blocking items focused on player count and loyalty mechanics
- 4 functional requirements extracted
