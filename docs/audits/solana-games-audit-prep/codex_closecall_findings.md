# Close Call Audit Findings - Codex

> Internal audit pass over Close Call per `closecall.md`.
> Findings map to the audit packet categories and focus on concrete stale-price, wrong-feed, payout, refund, account-ordering, and liveness paths.

## Active Findings

### [HIGH] CCC-1 - Settlement trusts backend-supplied close prices instead of verified Pyth price updates

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs`; `backend/src/worker/settle-tx.ts`; `backend/src/worker/closecall-clock.ts`
- **Game:** Close Call
- **Threat actor:** Backend operator with compromised settlement signer; RPC/oracle integration failure
- **Invariant:** Open and close prices must refer to the configured BTC/USD Pyth feed, must be fresh for the intended candle boundary, and must use compatible exponent/scaling before any payout or refund is made.
- **Issue:** `settle_round` accepts `close_price` and `close_price_expo` as instruction arguments. It checks only that `close_price_expo == round.open_price_expo`; it does not receive or validate a Pyth price update account, does not compare against `CloseCallConfig.pyth_feed_id`, and does not enforce freshness or publish time. The configured feed ID is stored in config but unused by settlement.
- **Exploit Path:** A compromised backend signer submits `settle_round` for a live round with arbitrary `close_price` that flips the outcome, produces an equal-price refund, or chooses stale data from another time/feed. The program validates treasury/rent receiver and account ordering, then pays or refunds according to the supplied price.
- **Impact:** Unfair outcome or no-fee refund controlled by the settlement signer; direct player funds risk in decisive rounds.
- **Proof:** `settle_round.rs:46-53` documents direct price arguments; `settle_round.rs:83-87` checks only exponent equality; `settle_round.rs:95-105` derives outcome from those arguments. `CloseCallConfig.pyth_feed_id` exists in `state.rs:46-47`, but no settlement account or validation path uses it. `buildCloseCallSettleRoundIx` in `settle-tx.ts` says "Price is passed as instruction args (no on-chain Pyth account)."
- **Discovered via:** Manual review against `closecall.md` Task 2.
- **Confidence:** High
- **Fix Direction:** Implement on-chain Pyth price-update validation before external audit. Settlement should accept the relevant Pyth price update account/proof, validate feed ID against `CloseCallConfig.pyth_feed_id`, validate publish time/freshness for the candle close, reject invalid/stale data, and normalize or strictly validate exponent handling for open and close prices. Add wrong-feed, stale-price, exponent, and equal-price tests.
- **Status:** Open

### [HIGH] CCC-2 - Configurable `max_entries_per_side` can exceed fixed round account capacity

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/closecall/src/state.rs`, `solana/programs/closecall/src/instructions/initialize_config.rs`, `solana/programs/closecall/src/instructions/bet.rs`
- **Game:** Close Call
- **Threat actor:** Platform/config admin; accidental misconfiguration
- **Invariant:** Admin-configured entry limits must never exceed the account layout's allocated vector capacity, and bets must reject before any lamport movement when a side is full.
- **Issue:** `CloseCallRound` allocates both `green_entries` and `red_entries` with `#[max_len(32)]`, but `initialize_config` accepts any `u8` for `max_entries_per_side` and stores it directly. `bet` compares the current vector length against the configured value, not against the allocated capacity. If config is set above 32, the 33rd bet on a side passes the program's explicit max-entry check and reaches the transfer/push section.
- **Exploit Path:** Admin initializes or reinitializes config with `max_entries_per_side = 64`. Thirty-two players fill green. The 33rd green bettor passes `len() < 64`, the program attempts to transfer the wager and push another entry into a vector allocated for 32 entries. The transaction should fail atomically, but the user sees a late failure after the explicit guard that was supposed to reject the condition. If a future code path mutates before push or capacity behavior changes, this becomes a funds/liveness footgun.
- **Impact:** Misconfigured production ceiling can make the advertised entry limit unachievable and can cause late bet failures. It also invalidates compute/account-load assumptions in `closecall.md` because the config can state a max larger than the account can store.
- **Proof:** `state.rs:71-76` sets both entry vectors to `#[max_len(32)]`; `initialize_config.rs:23-40` stores arbitrary `max_entries_per_side: u8`; `bet.rs:129-143` checks only against the configured value before transfer/push.
- **Discovered via:** Manual review against `closecall.md` Tasks 1 and 8.
- **Confidence:** High
- **Fix Direction:** Define a program constant such as `MAX_ENTRIES_PER_SIDE: u8 = 32`. Reject config initialization/update when `max_entries_per_side > MAX_ENTRIES_PER_SIDE`, and in `bet` enforce both the configured limit and the hard layout limit before transfer. Add boundary tests for 32, configured max, and configured max above 32.
- **Status:** Open

### [MEDIUM] CCC-3 - Close Call pause behavior is untested

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/closecall/src/instructions/bet.rs`; `solana/tests/closecall.ts`
- **Game:** Close Call
- **Threat actor:** Platform admin responding to incident or settlement/oracle outage
- **Invariant:** Pause must block new value entering the game while preserving settlement, timeout refund, and force-close recovery.
- **Issue:** `bet` calls `check_not_paused`, while `settle_round`, `timeout_refund`, and `force_close` intentionally do not. This is the desired shape, but the Close Call test suite has no pause assertions.
- **Exploit Path:** A future change removes `check_not_paused` from `bet` or adds pause checks to settlement/refund. CI would not catch either regression, allowing paused games to accept new funds or paused in-flight rounds to become stuck until unpause/admin intervention.
- **Impact:** Regression risk on a load-bearing operational invariant.
- **Proof:** `bet.rs:54` checks pause. `rg -n "pause|GamePaused|setPaused" solana/tests/closecall.ts` finds no pause tests.
- **Discovered via:** Manual review against shared pause invariant.
- **Confidence:** High
- **Fix Direction:** Add tests that `set_paused(true)` rejects new `bet` calls, while `settle_round`, `timeout_refund`, and `force_close` still work for in-flight rounds.
- **Status:** Open

### [MEDIUM] CCC-4 - Remaining-account substitution and ordering are not adversarially tested

- **Category:** Needs Test Proof
- **Surface:** `settle_round.rs`, `timeout_refund.rs`, `force_close.rs`, `solana/tests/closecall.ts`
- **Game:** Close Call
- **Threat actor:** Permissionless caller or compromised backend constructing malicious remaining accounts
- **Invariant:** Remaining accounts cannot redirect winner payouts or refunds; missing, extra, reordered, or substituted accounts must fail atomically before any partial payout/refund can persist.
- **Issue:** The program checks `remaining.len()` and validates each account key against the stored bettor key before each transfer. That looks correct under Anchor atomicity, but the tests cover only correct account order. They do not assert rejection for wrong winner, swapped refund accounts, missing accounts, or extra accounts.
- **Exploit Path:** Future refactor weakens a `require_keys_eq!`, changes account ordering, or ignores extra accounts. Without adversarial tests, a malicious settlement/refund transaction could redirect payouts or cause partial logic to be missed in review.
- **Impact:** No current exploit proven; high-value regression surface because all payouts/refunds use remaining accounts.
- **Proof:** `settle_round.rs:126-162` validates decisive winner accounts; `settle_round.rs:164-199`, `timeout_refund.rs:66-92`, and `force_close.rs:59-85` validate refund account order. `solana/tests/closecall.ts` settlement/refund helpers pass only valid remaining-account arrays.
- **Discovered via:** Manual review against `closecall.md` Task 5.
- **Confidence:** Medium
- **Fix Direction:** Add negative tests for decisive settlement with wrong winner account, refund settlement with swapped green/red accounts, timeout refund with missing/extra accounts, and force close with substituted account. Assert expected `AccountMismatch` or `RemainingAccountsMismatch`.
- **Status:** Open

### [LOW] CCC-5 - Settlement/refund handlers mutate soon-to-be-closed state after lamport transfers

- **Category:** Needs Test Proof
- **Surface:** `settle_round.rs`, `timeout_refund.rs`, `force_close.rs`
- **Game:** Close Call
- **Threat actor:** Future maintainer introducing CPI or non-close terminal behavior
- **Invariant:** State mutations should occur before direct lamport transfers where the program writes through `**lamports.borrow_mut()`, or be omitted entirely when the account is closed in the same instruction.
- **Issue:** `settle_round`, `timeout_refund`, and `force_close` perform direct lamport transfers and then write terminal phase/outcome fields on accounts that Anchor closes at instruction exit. The writes are effectively dead because close zeroes the account, and the order violates the audit packet's lamport-movement baseline.
- **Exploit Path:** No current exploit under instruction atomicity and immediate close. The pattern becomes risky if future code inserts CPI between transfers and close, or if a terminal path stops closing the account while preserving the transfer-first ordering.
- **Impact:** Latent bug-trap and audit-baseline violation; no immediate funds loss shown.
- **Proof:** `settle_round.rs:155-162` and `settle_round.rs:179-197` transfer lamports before `settle_round.rs:222-231` state writes. `timeout_refund.rs:81-91` transfers before `timeout_refund.rs:102-104` state writes. `force_close.rs:74-84` transfers before `force_close.rs:88-90` state writes.
- **Discovered via:** Cross-game lamport-movement baseline review.
- **Confidence:** High on the pattern, low on immediate exploitability.
- **Fix Direction:** Remove terminal state writes on close paths and rely on emitted events plus account closure as the lifecycle signal, or move meaningful state writes before transfers if any terminal path stops closing.
- **Status:** Open

### [LOW] CCC-6 - `initialize_config` can silently re-unpause and rewrite oracle/entry settings

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/closecall/src/instructions/initialize_config.rs`
- **Game:** Close Call
- **Threat actor:** Close Call config authority
- **Invariant:** Operational pause/unpause and oracle/config changes are explicit trusted-authority actions.
- **Issue:** `initialize_config` uses `init_if_needed`. Once initialized, the existing config authority can call it again to rewrite `pyth_feed_id`, `betting_window_secs`, `max_entries_per_side`, and `paused = false`.
- **Exploit Path:** Authority pauses Close Call due to incident, then calls `initialize_config` with new parameters and resets `paused` to false. This crosses no new privilege boundary because the same authority controls config, but it creates a second unpause/config-update path.
- **Impact:** Operational surprise and documentation risk rather than unauthorized access.
- **Proof:** `initialize_config.rs:11-18` uses `init_if_needed`; `initialize_config.rs:29-41` permits the stored authority to rewrite config fields and always sets `paused = false`.
- **Discovered via:** Cross-game config review.
- **Confidence:** High
- **Fix Direction:** Document as accepted authority behavior, or split first-time initialization from explicit update instructions and preserve `paused` on reinitialization.
- **Status:** Open

### [MEDIUM] CCC-7 - Backend settlement price freshness at candle close needs stronger binding

- **Category:** To Do Soon
- **Surface:** `backend/src/worker/closecall-clock.ts`; `backend/src/worker/pyth-poster.ts`; future on-chain Pyth validation path
- **Game:** Close Call
- **Threat actor:** RPC/oracle integration failure; backend operator
- **Invariant:** The close price used for settlement should be the intended candle-boundary price, not just any latest price fetched after the candle closes.
- **Issue:** The clock worker captures and stores boundary prices in DB, but settlement fetches `hermes.fetchLatestBtcPrice()` at settlement time and passes that latest price into the transaction. Until on-chain validation lands, the program cannot tell whether the supplied close price is the boundary price for `minute_ts + 60` or a later update.
- **Exploit Path:** Hermes polling, retry delay, or worker scheduling settles with a price published materially after candle close. A late price movement can flip Green/Red or convert a would-be equal-price refund into a decisive result.
- **Impact:** Fairness/accounting mismatch between advertised minute-candle game and actual settled price.
- **Proof:** `closecall-clock.ts` documents boundary capture, but `settleRound` fetches `hermes.fetchLatestBtcPrice()` during settlement and uses that value to pre-determine outcome and build `settle_round`.
- **Discovered via:** Backend settlement path review against `closecall.md` Task 6.
- **Confidence:** Medium
- **Fix Direction:** Bind settlement to the stored candle-close record for the round, or enforce on-chain publish-time/freshness rules that prove the price is from the accepted candle-close window. Include boundary publish time and source metadata in verification responses.
- **Status:** Open

### [INFO] CCC-8 - Compute/account-load headroom for max Close Call rounds was not verified

- **Category:** Open Investigation
- **Surface:** `settle_round.rs`, `timeout_refund.rs`, `force_close.rs`, devnet E2E/LUT strategy
- **Game:** Close Call
- **Threat actor:** Production liveness failure under maximum entry counts
- **Invariant:** Settlement and refund transactions must fit Solana compute and account-loading limits at the configured `max_entries_per_side`.
- **Issue:** This pass did not run the devnet max-entry reality checks required by `closecall.md` Task 8. The program iterates up to both side vectors and loads remaining accounts for winners or all refund recipients. If configured limits and transaction-building strategy exceed runtime limits, rounds can become stuck.
- **Exploit Path:** Fill a round to the configured max on both sides. Settlement or timeout refund exceeds compute/account limits and repeatedly fails; funds remain locked until admin lowers config for future rounds or a code change/migration lands.
- **Impact:** Potential production liveness risk; unmeasured in this pass.
- **Proof:** `closecall.md` explicitly requires devnet CU/account-load capture. No such numbers were produced here.
- **Discovered via:** Audit checklist gap.
- **Confidence:** Medium
- **Fix Direction:** Run the devnet max-entry settlement/refund scenarios in the audit plan, record CU consumed/accounts loaded/V0+LUT usage, and cap `max_entries_per_side` accordingly.
- **Status:** Open

### [INFO] CCC-9 - Ask external auditor to review proportional payout rounding and last-winner remainder policy

- **Category:** Ask External Auditor
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs`
- **Game:** Close Call
- **Threat actor:** Strategic bettor choosing entry order/amounts; fairness reviewer
- **Invariant:** Proportional payout rounding must be deterministic, documented, and not create an unacceptable strategic edge.
- **Issue:** Non-last winners receive floor division of `entry_amount * net_pool / winning_pool`; the last winner receives all remaining net pool. This prevents stranded dust, but it gives the final winner in entry order the rounding remainder. Because one wallet can bet once and order is determined by bet order, the edge is bounded but should be explicitly accepted.
- **Exploit Path:** A player who expects to be on the winning side may try to bet later on that side to receive any rounding remainder if their side wins.
- **Impact:** Small fairness edge from rounding dust allocation, not a funds-safety bug.
- **Proof:** `settle_round.rs:141-152` gives the last winning entry `net_pool - paid_out`; earlier entries use integer division.
- **Discovered via:** Payout math review against `closecall.md` Task 3.
- **Confidence:** Medium
- **Fix Direction:** Ask external auditors whether last-winner remainder is acceptable or whether dust should go to treasury, server, first winner, largest winner, or be distributed by a documented deterministic rule. Add tests documenting the accepted policy.
- **Status:** Open
