# Pot Shot Audit Findings - Codex

> Fresh internal audit pass over Pot Shot per `potshot.md`.
> Findings focus on weighted entries, settlement, refunds, entropy, remaining accounts, and audit-readiness tests.

## Active Findings

### [MEDIUM] CPS-1 - `claim_payout` returns server-paid rent to unconstrained `caller`

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/potshot/src/instructions/create_round.rs`, `solana/programs/potshot/src/instructions/claim_payout.rs`, `solana/programs/potshot/src/instructions/cancel_round.rs`, `solana/programs/potshot/src/instructions/timeout_refund.rs`, `solana/programs/potshot/src/instructions/force_close.rs`, `backend/src/worker/settle-tx.ts`
- **Game:** Pot Shot
- **Threat actor:** Backend operator with leaked secret access; permissionless caller who obtains a valid settlement secret before backend settlement lands
- **Invariant:** The server funds round rent at account creation, so every terminal close path should return residual rent to the stored `round.server`, unless a different settler-bounty policy is explicitly documented.
- **Issue:** `create_round` initializes the round PDA with `payer = server` and stores `round.server`. `cancel_round`, `timeout_refund`, and `force_close` all validate a rent receiver against `round.server`. `claim_payout` instead declares `close = caller`, and `caller` is only a signer, not constrained to `round.server`.
- **Exploit Path:** A valid secret leaks before settlement. An attacker calls `claim_payout` with themselves as `caller`, the correct treasury, SlotHashes sysvar, and derived winner account. On-chain checks still pin the winner payout and fee, but Anchor closes residual rent to the attacker's signer.
- **Impact:** Server-paid rent can be diverted on successful settlement. Player payout is not redirected by this issue, but the lifecycle contract is inconsistent and measurable over repeated leaked/raced settlements.
- **Proof:** `create_round.rs:31-33` uses `payer = server`; `create_round.rs:62` documents server-paid rent. `claim_payout.rs:14-22` accepts any signer as `caller` and uses `close = caller`. `cancel_round.rs:47-67`, `timeout_refund.rs:16-20` plus `timeout_refund.rs:50`, and `force_close.rs:14-18` plus `force_close.rs:51` route close rent to `round.server`. `settle-tx.ts:652` labels the caller as receiving rent refund.
- **Discovered via:** Manual review; confirmed from earlier rent-focused pass.
- **Confidence:** High
- **Fix Direction:** Add a mutable `rent_receiver` or `server` account to `ClaimPayout`, validate it equals `round.server`, and set `close = rent_receiver`. Update backend transaction construction and generated IDLs. Add a test where a non-server caller settles with a leaked valid secret and rent still returns to `round.server`, plus a wrong-rent-receiver rejection test.
- **Status:** Open

### [MEDIUM] CPS-2 - `claim_payout` has no executable test coverage

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/potshot/src/instructions/claim_payout.rs`, `solana/tests/potshot.ts`
- **Game:** Pot Shot
- **Threat actor:** Backend operator; player affected by settlement math or account-substitution regression
- **Invariant:** Weighted settlement must verify the secret, consume canonical SlotHashes entropy, derive a boundary-safe winning offset, pay only the derived winner, collect exactly one fee, and close rent to the intended account.
- **Issue:** The only `claim_payout` test is skipped, so bankrun does not assert settlement behavior, wrong-secret rejection, wrong-winner rejection, fee transfer, rent destination, or weighted boundary behavior.
- **Exploit Path:** A regression in `verify_commitment`, `derive_result`, winner-account validation, fee transfer, or close destination can ship without failing the Pot Shot unit suite. Devnet E2E coverage is useful but does not replace deterministic edge tests for the payout math and account constraints.
- **Impact:** Audit-readiness and regression risk on the highest-value instruction.
- **Proof:** `solana/tests/potshot.ts:767-773` contains only a skipped `claim_payout` placeholder. `claim_payout.rs:74-98` contains the settlement-critical checks and lamport transfers.
- **Discovered via:** Test suite topology review against `potshot.md` Tasks 3 and 6.
- **Confidence:** High
- **Fix Direction:** Add deterministic tests using a controllable SlotHashes fixture or focused lower-level tests for the result mapping. Cover first/middle/last winner, exact boundary offsets, wrong secret, wrong winner account, fee transfer, rent receiver behavior after CPS-1, and settlement before countdown/target slot rejection.
- **Status:** Open

### [MEDIUM] CPS-3 - `cancel_round` is untested

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/potshot/src/instructions/cancel_round.rs`, `solana/tests/potshot.ts`
- **Game:** Pot Shot
- **Threat actor:** Creator and backend/operator relying on creator recovery before another player joins
- **Invariant:** A Waiting round can be canceled only by its creator; the creator receives exact principal and the server receives rent.
- **Issue:** `cancel_round` performs phase, creator, rent receiver, refund, and close logic, but there are no tests invoking it.
- **Exploit Path:** A future change weakens the creator constraint, allows cancel after Active, or changes refund/rent destinations. CI would not catch it.
- **Impact:** Regression risk on a funds-handling terminal path.
- **Proof:** `cancel_round.rs:23-28` constrains the creator, `cancel_round.rs:43-50` checks phase and rent receiver, and `cancel_round.rs:57-67` refunds principal then closes rent to server. `rg -n "cancel_round|cancelRound" solana/tests/potshot.ts` returns no matches.
- **Discovered via:** Test suite topology review against `potshot.md` Task 4.
- **Confidence:** High
- **Fix Direction:** Add happy-path creator cancel, non-creator rejection, Active-round rejection, wrong-rent-receiver rejection, and exact lamport-delta assertions for creator principal and server rent.
- **Status:** Open

### [MEDIUM] CPS-4 - Pause behavior is untested

- **Category:** Needs Test Proof
- **Surface:** `create_round.rs`, `join_round.rs`, `buy_more_entries.rs`, `claim_payout.rs`, `timeout_refund.rs`, `force_close.rs`, `solana/tests/potshot.ts`
- **Game:** Pot Shot
- **Threat actor:** Platform admin responding to incident or settlement outage
- **Invariant:** Pause must block new value entering the game while preserving settlement, timeout refund, and force-close recovery.
- **Issue:** `create_round`, `join_round`, and `buy_more_entries` call `check_not_paused`; terminal/recovery paths do not. This is the desired shape, but the test suite has no pause assertions.
- **Exploit Path:** A future change removes a pause guard from a value-entry instruction or adds one to settlement/refund. CI would not catch either regression.
- **Impact:** Operational regression risk: paused games could continue accepting funds or in-flight rounds could be stranded while paused.
- **Proof:** `create_round.rs:51`, `join_round.rs:45`, and `buy_more_entries.rs:45` check pause. `rg -n "pause|setPaused|GamePaused" solana/tests/potshot.ts` finds only config initialization's `paused=false` assertion.
- **Discovered via:** Manual review against shared pause invariant.
- **Confidence:** High
- **Fix Direction:** Add tests for `set_paused(true)` blocking create, join, and buy-more, while timeout refund and force close remain callable. Add settlement-while-paused coverage once `claim_payout` is testable.
- **Status:** Open

### [MEDIUM] CPS-5 - Remaining-account substitution/order failures need adversarial tests

- **Category:** Needs Test Proof
- **Surface:** `claim_payout.rs`, `timeout_refund.rs`, `force_close.rs`, `solana/tests/potshot.ts`
- **Game:** Pot Shot
- **Threat actor:** Permissionless refund caller; compromised backend; malicious caller with leaked settlement secret
- **Invariant:** Remaining accounts cannot redirect winner payouts or aggregate refunds. Missing, extra, reordered, or substituted accounts must fail atomically before any persistent partial payout/refund.
- **Issue:** The program validates winner/refund account keys before transfer. The logic looks sound, but tests cover only correct timeout/force-close account order and do not cover malicious ordering/substitution. `claim_payout` has no executable tests at all.
- **Exploit Path:** A future refactor weakens `require_keys_eq!`, changes aggregation order, or accepts extra accounts. Without adversarial tests, a malicious caller could redirect refunds or winner payouts unnoticed.
- **Impact:** No current exploit proven; high-value regression surface because every payout/refund path depends on caller-supplied accounts.
- **Proof:** `claim_payout.rs:93-98` validates and pays the winner; `timeout_refund.rs:60-75` aggregates refunds and validates each remaining account; `force_close.rs:55-70` repeats the pattern. Current tests use valid remaining-account arrays and do not assert wrong-order/substitution failures.
- **Discovered via:** Manual review against `potshot.md` Tasks 4 and 5.
- **Confidence:** Medium
- **Fix Direction:** Add negative tests for wrong winner account, swapped refund accounts, duplicate remaining accounts, missing account, and extra account. Assert `AccountMismatch` or a specific length-mismatch error.
- **Status:** Open

### [LOW] CPS-6 - Terminal handlers mutate soon-to-be-closed state after lamport transfers

- **Category:** Needs Test Proof
- **Surface:** `claim_payout.rs`, `timeout_refund.rs`, `force_close.rs`
- **Game:** Pot Shot
- **Threat actor:** Future maintainer introducing CPI or non-close terminal behavior
- **Invariant:** State mutations should occur before direct lamport transfers where the program writes through `**lamports.borrow_mut()`, or be omitted when the account is closed in the same instruction.
- **Issue:** `claim_payout`, `timeout_refund`, and `force_close` perform direct lamport transfers before writing terminal phase/result fields on accounts that are closed at instruction exit. The writes are effectively dead under Anchor close semantics and violate the audit packet's lamport-movement baseline.
- **Exploit Path:** No current exploit under instruction atomicity and immediate close. The pattern becomes risky if future code inserts CPI between transfer and close or stops closing the account while preserving transfer-first ordering.
- **Impact:** Latent bug-trap and audit-baseline violation; no immediate funds loss shown.
- **Proof:** `claim_payout.rs:97-98` transfers payout/fee before `claim_payout.rs:116-121` state writes. `timeout_refund.rs:72-75` transfers refunds before `timeout_refund.rs:81-82` state writes. `force_close.rs:67-70` transfers refunds before `force_close.rs:76-77` state writes.
- **Discovered via:** Cross-game lamport-movement baseline review.
- **Confidence:** High on the pattern, low on immediate exploitability.
- **Fix Direction:** Remove dead terminal state writes on close paths and rely on emitted events plus account closure as the lifecycle signal, or move meaningful state writes before transfers if a terminal path stops closing.
- **Status:** Open

### [LOW] CPS-7 - Verification endpoint pre-settlement secret gate is not asserted for Pot Shot

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/potshot-create.ts`, `backend/src/__tests__`
- **Game:** Pot Shot
- **Threat actor:** Public API consumer; attacker trying to obtain the backend secret before settlement
- **Invariant:** Public verification responses must expose commitment before settlement but never expose the secret until the round is settled.
- **Issue:** Code review shows the route only includes `secret` when `round.phase === "settled"`, but there is no Pot Shot route test asserting the pre-settlement and post-settlement response shapes.
- **Exploit Path:** A future formatter refactor moves `response.secret` outside the settled gate. Pre-settlement public `/pot-shot/verify/:pda` would leak the secret, enabling third-party settlement racing and potentially rent diversion until CPS-1 is fixed.
- **Impact:** Regression risk on secret confidentiality and settlement-race surface.
- **Proof:** `potshot-create.ts:611-612` emits `secret` only inside the settled branch today. `rg` over backend tests shows FlipYou verify secret tests but no Pot Shot equivalent.
- **Discovered via:** Backend verification review against `potshot.md` Task 5.
- **Confidence:** High
- **Fix Direction:** Add backend tests for `/pot-shot/verify/:pda` before settlement with `secret` absent and after settlement with `secret`, entropy, result hash, winning offset, entries, payout, fee, and total pool present.
- **Status:** Open

### [LOW] CPS-8 - `initialize_config` can silently re-unpause

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/potshot/src/instructions/initialize_config.rs`
- **Game:** Pot Shot
- **Threat actor:** Pot Shot config authority
- **Invariant:** Operational pause/unpause authority is an explicit trusted role.
- **Issue:** `initialize_config` uses `init_if_needed`. After initialization, the stored authority can call it again and it always writes `paused = false`.
- **Exploit Path:** Authority pauses Pot Shot due to an incident, then calls `initialize_config` and silently unpauses. This crosses no new privilege boundary because the same authority can call `set_paused(false)`, but it creates a second unpause path.
- **Impact:** Operational surprise and documentation risk, not unauthorized access.
- **Proof:** `initialize_config.rs:10-17` uses `init_if_needed`; `initialize_config.rs:22-33` validates existing authority and sets `paused = false`.
- **Discovered via:** Cross-game config review.
- **Confidence:** High
- **Fix Direction:** Document as accepted authority behavior, or split first initialization from explicit update/unpause behavior and preserve `paused` on reinitialization.
- **Status:** Open

### [INFO] CPS-9 - Compute/account-load headroom for max Pot Shot rounds was not verified

- **Category:** Open Investigation
- **Surface:** `claim_payout.rs`, `timeout_refund.rs`, `force_close.rs`, devnet E2E/LUT strategy
- **Game:** Pot Shot
- **Threat actor:** Production liveness failure under maximum entries
- **Invariant:** Settlement and refund transactions must fit Solana compute and account-loading limits at `MAX_ENTRIES = 64`.
- **Issue:** This pass did not run the devnet max-entry reality checks required by `potshot.md` Task 7. `timeout_refund` and `force_close` aggregate up to 64 entries, and worst-case account loading is 64 distinct player accounts plus fixed accounts. `claim_payout` has fewer accounts but still needs max-entry compute measurement for weighted scan.
- **Exploit Path:** A round reaches 64 entries. Settlement or refund exceeds compute/account limits and repeatedly fails; funds remain locked until force-close, timeout, or program/config remediation is available.
- **Impact:** Potential production liveness risk; unmeasured in this pass.
- **Proof:** `state.rs` caps `MAX_ENTRIES` at 64, and `potshot.md` explicitly requires devnet CU/account-load capture. No such numbers were produced here.
- **Discovered via:** Audit checklist gap.
- **Confidence:** Medium
- **Fix Direction:** Run the three devnet scenarios in `potshot.md` Task 7 and record CU consumed, accounts loaded, V0/LUT usage, and headroom. Lower `MAX_ENTRIES` or implement paged refunds/settlement if headroom is insufficient.
- **Status:** Open

### [INFO] CPS-10 - Ask external auditor to review fixed countdown slot estimate and SlotHashes liveness

- **Category:** Ask External Auditor
- **Surface:** `join_round.rs`, `buy_more_entries.rs`, `claim_payout.rs`, shared SlotHashes parsing
- **Game:** Pot Shot
- **Threat actor:** Validator/RPC liveness conditions; backend retry timing
- **Invariant:** The chosen `target_entropy_slot` should be far enough in the future that it is unknown at countdown start, while settlement should reliably occur before SlotHashes rolls it off.
- **Issue:** The program computes `target_entropy_slot = now.slot + COUNTDOWN_SLOT_ESTIMATE + ENTROPY_SLOT_OFFSET` when the second distinct wallet joins. This is simple and documented, but fixed slot estimates can diverge from wall-clock countdown under cluster slot-rate changes. Settlement also requires `now.slot >= target_entropy_slot` and the target slot must still be present in SlotHashes.
- **Exploit Path:** Under abnormal slot timing or backend delay, countdown can end before the target entropy slot is usable, or settlement can miss the SlotHashes window and force timeout refund.
- **Impact:** Liveness risk and fairness/timing assumption, not a direct arithmetic bug.
- **Proof:** `join_round.rs:91-101` and `buy_more_entries.rs:91-100` set the target slot from a fixed estimate; `claim_payout.rs:63-67` requires current slot to reach it and `claim_payout.rs:51-53` requires SlotHashes still contain it.
- **Discovered via:** Countdown/entropy review against `potshot.md` Tasks 2 and 7.
- **Confidence:** Medium
- **Fix Direction:** Include this as an explicit external-auditor question with observed devnet/mainnet slot-rate data and settlement retry metrics. Consider deriving refund deadline from SlotHashes retention constraints rather than a fixed wall-clock timeout alone.
- **Status:** Open

### [INFO] CPS-11 - Ask external auditor to review modulo bias and weighted-range boundary policy

- **Category:** Ask External Auditor
- **Surface:** `claim_payout.rs`, `backend/packages/game-engine/src/potshot.ts`
- **Game:** Pot Shot
- **Threat actor:** Strategic bettor optimizing tiny probability edges
- **Invariant:** Lamport-weighted winner selection must be boundary-safe and any modulo bias must be acceptable for production stakes.
- **Issue:** `winning_offset = raw % total_amount_lamports` uses the low 64 bits of the result hash, then maps the offset through cumulative lamport ranges. The boundary logic is correct under inspection, but modulo reduction has theoretical bias unless the pool divides `2^64`.
- **Exploit Path:** A bettor chooses stake sizes to marginally benefit from modulo bias. With current wager bounds the edge appears tiny, but external auditors should confirm the risk is acceptable or recommend rejection sampling/wider integer sampling.
- **Impact:** Fairness review question, not a confirmed funds-safety bug.
- **Proof:** `claim_payout.rs:75-90` derives a 64-bit raw value, applies modulo by `total_amount_lamports`, and selects the first cumulative range where `winning_offset < cumulative`. The backend verifier mirrors the same policy in `backend/packages/game-engine/src/potshot.ts`.
- **Discovered via:** Weighted winner-selection review against `potshot.md` Task 3.
- **Confidence:** Medium
- **Fix Direction:** Ask external auditors whether current modulo bias is acceptable for the max total pool, or whether to switch to rejection sampling or a wider hash-derived integer.
- **Status:** Open
