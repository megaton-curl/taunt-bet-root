# Specification: 201 Unit Tests

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Phase | 1 |
| NR_OF_TRIES | 0 |

---

## Overview

Add vitest unit tests for the shared TypeScript packages (game-engine, fairness, wallet/treasury). These tests validate that frontend math (fee calculations, payout logic, custom amount validation, cryptographic verification) exactly matches the on-chain program behavior. They run without any chain, browser, or React dependency.

## User Stories

- As a developer, I want unit tests for fee/payout math so that I know the frontend agrees with the on-chain program's integer arithmetic.
- As a developer, I want tests for the fairness module so that commitment verification and crash point computation are proven correct.
- As a developer, I want tests for balance formatting utilities so that display values are accurate.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Section 9 (Quality & Testing)
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 1 — validates correctness of existing packages

## Required Context Files

- `packages/game-engine/src/` — payouts.ts, coinflip.ts, RoundStateMachine.ts, types.ts
- `packages/fairness/src/` — commitment.ts, crash.ts, verification.ts
- `packages/wallet/src/balance/` — formatBalance.ts
- `packages/wallet/src/treasury/` — constants.ts (calculateFee, calculatePayout)
- `solana/shared/src/` — Rust fee/amount constants (source of truth for expected values)

## Contract Files

- `solana/shared/src/fees.rs` — canonical fee constants (TOTAL_FEE_BPS=300)
- `solana/shared/src/amounts.rs` — canonical minimum amount and amount validation helpers
- `solana/tests/coinflip.ts` — on-chain test assertions (expected payout values to match)

---

## Functional Requirements

### FR-1: Game Engine — Payout Math

Test that payout calculations match the on-chain settlement math exactly.

**Acceptance Criteria:**
- [ ] `calculatePariMutuelPayout` returns correct payout for representative custom amounts (pool minus 500 bps fee)
- [ ] `calculateWinnerPayout` handles the 500 bps (5%) fee correctly
- [ ] `verifyPayoutInvariant` returns true for valid payout splits and false for tampered values
- [ ] Integer rounding matches Rust behavior (floor division, no floating point)
- [ ] Edge cases: minimum amount (`0.0026 SOL`), large-amount inputs, zero-value inputs

### FR-2: Game Engine — Coinflip Helpers

Test PDA derivation, side logic, and randomness interpretation.

**Acceptance Criteria:**
- [ ] `getMatchPda(creator)` produces deterministic addresses
- [ ] `getConfigPda()` produces the expected platform config address
- [ ] `getOppositeSide(heads)` returns tails and vice versa
- [ ] `determineWinnerFromRandomness` matches on-chain logic: `randomness[0] % 2 == 0` → heads
- [ ] Custom amount helpers convert SOL input to lamports correctly and reject values below `0.0026 SOL`

### FR-3: Game Engine — State Machine

Test round phase transitions.

**Acceptance Criteria:**
- [ ] Valid transitions succeed: waiting→locked, locked→resolving, resolving→settled
- [ ] Invalid transitions throw: waiting→settled, settled→waiting
- [ ] Cancel only valid from waiting phase

### FR-4: Fairness — Commitment Verification

Test cryptographic commitment and verification functions.

**Acceptance Criteria:**
- [ ] `computeCommitment(seed)` returns SHA256 hex
- [ ] `verifyCommitment(seed, commitment)` returns true for matching pairs, false for mismatches
- [ ] `computeCrashPoint` produces deterministic results for known inputs
- [ ] `hashToCrashPoint` edge cases: hash producing exactly 1.0x, very high multipliers
- [ ] `verifyRound` returns valid=true with correct data, valid=false with tampered data, and populates error messages

### FR-5: Wallet — Balance Utilities

Test formatting and conversion functions.

**Acceptance Criteria:**
- [ ] `solToLamports` and `lamportsToSol` are inverse operations (round-trip)
- [ ] `formatAmount` displays correct decimal places (e.g., 1.005 SOL, 0.00001 SOL)
- [ ] `formatAmountCompact` abbreviates correctly (e.g., 1.2K, 3.5M)
- [ ] `parseSOLInput` handles valid inputs, rejects negative/NaN/overflow
- [ ] `isValidSOLAmount` boundary cases: 0, negative, dust amounts, max bet

### FR-6: Wallet — Treasury Fee Math

Test that fee calculations match on-chain constants.

**Acceptance Criteria:**
- [ ] `calculateFee(pool)` returns exactly `floor(pool * 500 / 10000)` for representative custom-amount pools
- [ ] `calculatePayout(pool)` returns `pool - fee` for representative custom-amount pools
- [ ] Fee is a single flat amount (no split breakdown) — 500 bps (5%) to single treasury
- [ ] Fee rate matches PlatformConfig.fee_bps on-chain value: 500 bps

---

## Success Criteria

- All package test suites pass with `pnpm test`
- Fee/payout math tests use the same input values as on-chain bankrun tests for cross-validation
- Zero `--passWithNoTests` flags remain (every package has at least one real test)
- Test coverage: all exported public functions have at least one test

---

## Dependencies

- vitest already configured in each package
- On-chain constants in `solana/shared/` as reference values

## Assumptions

- Vitest is the test runner (already configured)
- No React or DOM dependencies needed for these tests
- Rust integer division behavior (floor) is replicated in TypeScript via `Math.floor`

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Payout math matches on-chain | Compare test values with bankrun test assertions | Matching values documented |
| 2 | All packages have tests | `pnpm test` runs real tests in each package | Test output showing counts |
| 3 | No passWithNoTests | Grep package.json files | Zero matches |
| 4 | Fairness crypto correct | Known test vectors (SHA256 of known input) | Test assertions |

---

## Completion Signal

### Implementation Checklist
- [ ] game-engine test file(s) created with payout, coinflip, state machine tests
- [ ] fairness test file(s) created with commitment, crash, verification tests
- [ ] wallet/balance test file(s) created with formatting tests
- [ ] wallet/treasury test file(s) created with fee math tests
- [ ] `--passWithNoTests` removed from all packages that now have real tests

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests pass
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Cross-validated against on-chain test values

#### Visual Verification (if UI)
- [ ] N/A (no UI in this spec)

#### Console/Network Check (if web)
- [ ] N/A (no web in this spec)

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
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
