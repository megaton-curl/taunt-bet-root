# Close Call Audit Prep Plan

> **For agentic workers:** Treat oracle validation, proportional payout math, and remaining-account handling as the highest-risk surfaces. Every issue needs a concrete stale-price, wrong-feed, payout, refund, or liveness path.

**Goal:** Audit Close Call's oracle-priced pari-mutuel settlement so BTC candle outcomes, proportional payouts, fee collection, and invalid-round refunds are correct.

**Architecture:** Close Call uses a minute-aligned round PDA. Players bet Green or Red during the betting window, and the backend submits settlement after candle close with close price data. Current code passes open/close prices as instruction arguments; on-chain Pyth price-update validation is a To Do Soon before external audit and should validate configured feed ID, freshness, and exponent handling before paying winners or refunding invalid rounds.

**Tech Stack:** `solana/programs/closecall`, `solana/shared`, `solana/programs/platform`, `solana/tests/closecall.ts`, backend Close Call clock/oracle/settlement paths.

---

## Primary Files

- Program entrypoint: `solana/programs/closecall/src/lib.rs`
- State and events: `solana/programs/closecall/src/state.rs`
- Instructions: `solana/programs/closecall/src/instructions`
- Errors: `solana/programs/closecall/src/error.rs`
- Shared helpers: `solana/shared/src/escrow.rs`, `solana/shared/src/fees.rs`, `solana/shared/src/pause.rs`, `solana/shared/src/timeout.rs`, `solana/shared/src/wager.rs`
- Platform config: `solana/programs/platform/src`
- Tests: `solana/tests/closecall.ts`
- Backend paths: `backend/src/routes/closecall.ts`, `backend/src/routes/price.ts`, `backend/src/worker/closecall-clock.ts`, `backend/src/worker/pyth-poster.ts`, `backend/src/worker/settlement.ts`, `backend/src/worker/settle-tx.ts`, health reporting, round verification endpoint
- Specs: `docs/specs/100-close-call/spec.md`

## Core Invariants

- A round PDA is unique for `["cc_round", minute_ts.to_le_bytes()]`.
- `minute_ts` is aligned to the intended 60-second candle boundary.
- Betting is accepted only before `betting_ends_at`.
- One wallet can bet at most once per round.
- Each side cannot exceed configured `max_entries_per_side`.
- `green_pool` and `red_pool` equal the sums of their entries.
- Open and close prices must refer to the configured BTC/USD Pyth feed and compatible exponents. Current code relies on backend-supplied instruction arguments; on-chain Pyth validation is To Do Soon.
- Equal price, one-sided pools, single-player rounds, and no-bet rounds refund or close with no fee.
- Decisive rounds collect exactly one platform fee from total pool.
- Winner payouts are proportional to `player_bet / winning_pool` over net pool.
- Rounding dust, if any, is handled intentionally and cannot be captured by an attacker.
- Remaining accounts cannot redirect winner payouts or refunds.
- Timeout refund remains available if backend settlement fails.

## Review Tasks

### Task 1: Round Creation, Minute Alignment, And Betting Window

- [ ] Review `bet.rs` for initialization and join behavior.
- [ ] Confirm first bet creates the round with the expected PDA and stores open price.
- [ ] Confirm `minute_ts` alignment is enforced on-chain or explicitly documented as a backend trust assumption.
- [ ] Confirm betting window calculation cannot be manipulated by a player-supplied timestamp.
- [ ] Confirm late bets at exactly `betting_ends_at` are rejected.
- [ ] Confirm one-wallet-one-bet is enforced across both sides.
- [ ] Confirm max entries per side is enforced before transfer and state mutation.

### Task 2: Oracle And Price Validation

- [ ] **To Do Soon:** implement on-chain Pyth price-update validation for Close Call settlement before external audit.
- [ ] Review all Pyth parsing and validation code used by settlement. Current code passes prices as instruction arguments; this is a backend trust assumption until on-chain validation lands.
- [ ] Confirm configured feed ID from `CloseCallConfig.pyth_feed_id` is checked against the price update.
- [ ] Confirm stale prices are rejected according to the intended freshness window.
- [ ] Confirm open and close price exponents are compatible or normalized safely.
- [ ] Confirm a malicious backend cannot settle a BTC round with a different feed or arbitrary price account.
- [ ] Confirm equal price uses exact equality after the same scaling rules used for directional outcomes.
- [ ] Document residual trust if close price is passed as an instruction argument rather than read directly from a verified account.

### Task 3: Pari-Mutuel Payout Math

- [ ] Review `settle_round.rs` decisive branch.
- [ ] Confirm fee is calculated from total pool and only for decisive rounds.
- [ ] Confirm net pool is allocated proportionally to winning entries.
- [ ] Confirm checked arithmetic is used for multiplication, division, total pool, and fee math.
- [ ] Confirm rounding behavior is deterministic and documented.
- [ ] Confirm dust remains in a controlled place or is intentionally returned.
- [ ] Add tests for uneven winner pools, large values, many winners, and rounding edge cases.

### Task 4: Invalid Round And Timeout Refunds

- [ ] Review refund branches in `settle_round.rs`.
- [ ] Review `timeout_refund.rs` and `force_close.rs`.
- [ ] Confirm no-bet rounds close cleanly with rent returned to the intended server account.
- [ ] Confirm one-sided, single-player, and equal-price rounds refund exact principal with no fee.
- [ ] Confirm timeout refund is permissionless only after `resolve_deadline`.
- [ ] Confirm force close is authority-only and cannot be used to confiscate funds.
- [ ] Confirm duplicate remaining accounts cannot steal or duplicate refunds.

### Task 5: Remaining Accounts And Account Ordering

- [ ] Map the exact remaining-account order required for decisive settlement.
- [ ] Map the exact remaining-account order required for refund settlement, timeout refund, and force close.
- [ ] Confirm every remaining account is checked against the stored player pubkey before transfer.
- [ ] Confirm missing accounts fail atomically before partial payout/refund.
- [ ] Confirm extra accounts are ignored safely or rejected.
- [ ] Confirm backend transaction builder supplies all entries under max-entry conditions.

### Task 6: Backend Clock, Oracle, And Settlement Path

- [ ] Trace the Close Call clock worker from minute boundary detection to round creation and settlement.
- [ ] Confirm backend uses the same minute boundary model as the on-chain PDA seeds.
- [ ] Confirm price cache/fetch logic cannot reuse stale open or close prices silently.
- [ ] Confirm failed settlement is retried until success or timeout-refund eligibility.
- [ ] Confirm health exposes stale oracle data, failed settlement queue depth, low signer balance, and worker liveness.
- [ ] Confirm verification payload includes round PDA, open price, close price, price source/update metadata once available, outcome, pools, fee, winners, settlement tx, and refund reason where applicable.

### Task 7: Tests To Strengthen Before External Audit

- [ ] Add minute-alignment rejection test if alignment is intended on-chain.
- [ ] Add wrong-feed and stale-price rejection tests once on-chain Pyth validation lands (Pyth feed ID mismatch must reject; price older than the configured freshness window must reject).
- [ ] Add exponent mismatch or normalization tests.
- [ ] Add one-wallet-both-sides rejection test.
- [ ] Add max entries per side tests at limit and over limit.
- [ ] Add exact proportional payout tests with rounding assertions.
- [ ] Add remaining-account substitution tests for payout and refund paths.
- [ ] Add no-bet, one-sided, single-player, equal-price, and timeout refund lamport-delta tests.
- [ ] Add pause tests for bet blocked and settle/refund allowed.
- [ ] Add automated test that pre-settlement price-source metadata does not expose any private settlement-only data while phase != settled, and that public price evidence is present after settlement.

### Task 8: Compute Budget And Account-Load Reality Check (Devnet)

`settle_round` and `timeout_refund` iterate per-side entries (capped by `CloseCallConfig.max_entries_per_side`, settable by admin) and pay each player via remaining accounts. If either path exceeds 1.4M CU per tx or the address-loading limit at the configured ceiling, the round is **permanently stuck** — including the timeout-refund recovery path.

- [ ] Read the current `max_entries_per_side` from on-chain `CloseCallConfig` for the audited cluster. Record it in the External Auditor Packet.
- [ ] Build a devnet round filled to `max_entries_per_side` on **both** sides with distinct players. Settle decisive (one side wins). Capture: CU consumed, accounts loaded, V0 + LUT used yes/no, ALT contents.
- [ ] Build a devnet round filled to `max_entries_per_side` on both sides, force an invalid-round refund (one-sided / equal-price equivalent if achievable, else `timeout_refund`). Capture: CU consumed, accounts loaded.
- [ ] Confirm headroom is at least 20% under both 1.4M CU and the runtime account-loading limit.
- [ ] If headroom is insufficient at the current `max_entries_per_side`, this is a Must Fix Before External Audit finding — either reduce the configured ceiling on mainnet or remediate the program.
- [ ] Confirm that increasing `max_entries_per_side` via Close Call config updates cannot exceed the account's allocated vector capacity or push an already-in-flight round past the compute ceiling (the round captures the live config value at creation, or the program rejects oversized rounds at settle time).

## Targeted Verification

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/closecall.ts)
```

Before closing the Close Call pass:

```bash
./scripts/check-fees.sh
./scripts/check-program-ids.sh
```

## Auditor Questions

- Is the planned on-chain Pyth validation model strong enough for the production trust boundary, and what residual backend price-source trust remains after implementation?
- Should minute alignment be enforced on-chain, or is backend-only alignment acceptable?
- Is proportional payout rounding acceptable, and where should dust go?
- Are remaining-account payout/refund paths safe at the configured `max_entries_per_side` on both sides?
- Should settlement authority be permissionless, server-only, or current backend-triggered with on-chain validation?
