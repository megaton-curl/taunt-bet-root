# Pot Shot Audit Findings — Claude Pass

> Internal audit pass over Pot Shot per `docs/audits/solana-games-audit-prep/potshot.md`.
> Format and status buckets follow `findings.md`. Every finding maps to a row in
> [Threat Model](README.md#threat-model). Severity uses **HIGH / MEDIUM / LOW / INFO**;
> Must Fix entries are sized against funds risk or audit-shippability.
>
> **Run context.** Code reviewed at workspace HEAD on `dev`. Bankrun test suite
> `tests/potshot.ts` was executed: **25 passing / 1 pending** (the pending case
> is `claim_payout` deferred to devnet E2E). No failing tests.
>
> **Carry-overs from the FlipYou pass.** Two of the FY findings are now resolved
> in shared code on this commit and therefore do **not** appear here:
> - **FY-1 (backend reads wrong SlotHashes bytes)** — `parseSlotHashEntropy` in
>   `backend/src/worker/settle-tx.ts:115` now correctly walks the
>   `count(8) || (slot, hash)*` layout and returns the hash at `target_slot`.
>   `settleLordRound:619` calls it. Verified by reading code; on-chain
>   `read_slot_hash_entropy_from_data` is also a full bounded scan now, closing
>   the related FY-5 boundary concern as well.
> - **FY-5 (skip-window scan radius is ±8)** — replaced with a full bounded scan
>   over `count` entries (`solana/shared/src/fairness.rs:118`).
>
> **Carry-overs that DO repeat in Pot Shot.** Pattern findings inherited from
> the FlipYou pass and re-confirmed in Pot Shot code on this commit are filed
> below as PS-1 (rent-to-caller), PS-3 (transfer-then-mutate), PS-7 (verify
> endpoint not test-asserted), PS-8 (`init_if_needed`).

## Pass Summary

| Category | Count |
|----------|-------|
| Must Fix Before External Audit | 0 |
| Needs Test Proof | 4 |
| To Do Soon | 2 |
| Document As Trust Assumption | 2 |
| Open Investigation | 1 |
| Ask External Auditor | 1 |

Findings cluster around three surfaces: (1) **untested funds-handling code** —
`cancel_round` has zero coverage, `timeout_refund` lacks adversarial-input and
multi-entry-aggregate cases, and the public `verify` endpoint's pre-settle
secret gate has no integration assertion; (2) **cross-game divergence** — the
`claim_payout` rent destination is `caller` while every other refund/close in
Pot Shot (cancel, timeout_refund, force_close) routes rent to `server`, which
is the FlipYou FY-3 shape with a ~10× larger blast radius (Pot Shot rent is
~0.02 SOL vs FlipYou's ~0.0026 SOL); (3) **liveness assumptions on slot rate**
— the 162-slot fixed estimate for `target_entropy_slot` interacts with
`COUNTDOWN_SECONDS` and `DEFAULT_RESOLVE_TIMEOUT_SECONDS` in a way that is
correct at typical mainnet slot rates but worth an external eye.

The on-chain weighted-draw math is correct under inspection: cumulative-range
selection is boundary-safe given `winning_offset = raw % total_amount_lamports`
and `total > 0` is enforced upstream by `validate_wager`. Modulo bias at the
worst-case total (64 × 100 SOL ≈ 2^42 lamports) is bounded by `N / 2^64 ≈ 2^-22`
and is not a finding.

---

## Active Findings

### [MEDIUM] PS-1 — `claim_payout` rent goes to `caller`, not `server`

- **Category:** Needs Test Proof (the contract is silent in tests; the
  divergence is observable in code only)
- **Surface:** `solana/programs/potshot/src/instructions/claim_payout.rs:22`
  (`close = caller`) vs `cancel_round.rs:67`, `timeout_refund.rs:21`, and
  `force_close.rs:18` (which all close to `rent_receiver = round.server`)
- **Game:** Pot Shot (cross-pattern: same shape as FY-3 in FlipYou)
- **Threat actor:** Backend operator (compromised key) and any permissionless
  caller who learns the secret (e.g. a leaked DB row or a `RoundSettled` race)
- **Invariant:** Within one game, lifecycle-terminal close should send rent to
  one documented destination. Pot Shot's design has the **server** pay rent at
  `create_round` (`payer = server`); the natural symmetric destination for the
  refund is the same `server`. `cancel_round`, `timeout_refund`, and
  `force_close` all do this; `claim_payout` does not.
- **Issue:** `claim_payout`'s account struct declares
  `#[account(mut, close = caller, …)] pub round`. After payouts and fee
  transfer, Anchor drains the residual rent (~`PotShotRound::INIT_SPACE` rent ≈
  `8 + 2796` bytes ≈ 0.0195 SOL on devnet defaults) to whoever signed the
  settle transaction as `caller`. In normal operation the backend signer is
  the caller, so the server gets the rent back as it should — but the on-chain
  code does not require `caller == round.server`, so any signer with the
  secret can pocket the rent.
- **Exploit Path:** Backend secret leaks (DB compromise, log leak, future bug).
  Attacker observes leak, races the backend's settle tx, lands first, and
  pockets the ~0.0195 SOL rent per round. The on-chain commitment / target-slot
  / winner-account checks still pin the *outcome* — the attacker cannot redirect
  the player payout — but the rent is theirs. Cumulative cost over many rounds
  is non-trivial and the divergence is a footgun for future code that assumes
  "all close paths refund the server."
- **Impact:** Rent leakage on secret-leak path; cross-game inconsistency that
  is currently asymmetric. No funds-loss to players because winner derivation
  is deterministic and the winner account is bound to the derived winner key.
- **Proof:** Reading `claim_payout.rs:22` against the other three close sites;
  matches the verbatim shape called out by FY-3 for FlipYou.
- **Discovered via:** Cross-game diff against FY-3.
- **Confidence:** High.
- **Fix Direction:** Decide a contract and document it.
  - Option A (recommended; matches the rest of Pot Shot and what FY-3 also
    recommends): change `claim_payout` to `close = server` (or
    `close = rent_receiver` validated against `round.server`) and add a
    `server: AccountInfo` to the account struct. Update the backend's settle
    tx to include the server account.
  - Option B: keep rent-to-caller and document it as a deliberate "settler
    bounty" pattern. Update both Pot Shot and FlipYou specs.
  Add a bankrun test that asserts the chosen destination receives rent.
- **Status:** Open

### [MEDIUM] PS-2 — `cancel_round` has zero test coverage

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/potshot/src/instructions/cancel_round.rs`
  (full file); `solana/tests/potshot.ts` (no `describe("cancel_round")`)
- **Game:** Pot Shot
- **Threat actor:** Player A (creator who wants out) and the backend operator
  (whose monitoring should be able to assume cancel works)
- **Invariant:** Funds-handling instructions in audited programs require at
  least one positive happy-path test and one rejection test. Per audit packet
  README §"Refund And Force-Close Safety": *"Confirm cancel is limited to the
  intended phase and caller."* No automated test enforces either claim today.
- **Issue:** `cancel_round.rs` runs roughly 30 lines of logic (phase guard,
  creator-key constraint, rent-receiver = server check, refund transfer, close
  PDA), yet the bankrun suite has zero `it()` cases for it. The instruction
  refunds 100% of `round.total_amount_lamports` to the creator's wallet, then
  drains rent to `server` and closes. Bugs in any of those steps would not be
  caught by the existing suite.
- **Exploit Path:** Indirect — silent regressions in the cancel path (e.g. a
  future change that loosens `phase == Waiting` to `phase != Settled`, or that
  drops the `creator == caller` constraint, or that miscomputes
  `refund_amount`) ship without a CI signal. The audit packet should not be
  handed to an external reviewer with this surface uncovered.
- **Impact:** Audit-shippability and regression safety. No current funds
  exposure beyond untested code.
- **Proof:** `grep -E "cancel_round|cancelRound" solana/tests/potshot.ts` →
  zero matches.
- **Discovered via:** Manual review of the instructions list against the test
  suite topology.
- **Confidence:** High.
- **Fix Direction:** Add a `describe("cancel_round")` block with at minimum:
  (a) creator cancels a Waiting round, gets full refund, PDA closed, rent at
  server; (b) non-creator cancel attempt rejected with `AccountMismatch`; (c)
  cancel attempt on an Active round rejected with `InvalidPhase`; (d) cancel
  attempt with wrong `rent_receiver` rejected. Mirror the test topology of
  `force_close` since the shape is similar.
- **Status:** Open

### [MEDIUM] PS-3 — `claim_payout` and `timeout_refund` mutate phase after lamport transfers

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/potshot/src/instructions/claim_payout.rs:97–121`,
  `timeout_refund.rs:72–82`
- **Game:** Pot Shot (cross-pattern: same shape as FY-4 in FlipYou)
- **Threat actor:** None today; defensively, future maintainers introducing
  CPI between transfers and close
- **Invariant:** README §"Lamport Movement": *"Confirm state mutations occur
  before external lamport transfers where the program directly manipulates
  `**lamports.borrow_mut()`. Any 'transfer first, mutate state after' path
  is a bug-shape worth flagging even if Anchor's atomicity covers it."*
- **Issue:** In `claim_payout`, lines 97 and 98 invoke
  `transfer_lamports_from_pda` (which writes through `**lamports.borrow_mut()`
  in `solana/shared/src/escrow.rs:33–34`) for winner payout and treasury fee.
  Lines 117–121 then mutate `round.phase`, `result_hash`, `winning_offset`,
  `winning_entry_index`, `winner`. The state writes are dead — Anchor's
  `close = caller` zeros the data immediately after the handler returns — but
  the *order* still violates the audit baseline. `timeout_refund` exhibits the
  same pattern: lamport transfers in the per-player loop (line 75), then
  `phase = Refunded` at line 82. Anchor's instruction-level atomicity covers
  both today.
- **Exploit Path:** None today. The pattern becomes exploitable shape if a
  future PR introduces a CPI (e.g. an event-emitter program, a notifications
  CPI, or a referral CPI) between the transfers and the close in either
  instruction.
- **Impact:** Latent bug-trap. Audit-baseline violation. No immediate funds
  risk.
- **Proof:** Code reading: `transfer_lamports_from_pda(...)` →
  `round.phase = …` ordering in both files.
- **Discovered via:** Manual review against shared README invariant.
- **Confidence:** High (the violation), Low (the runtime risk).
- **Fix Direction:** Drop the phase / result writes in `claim_payout` and
  `timeout_refund` entirely — they precede an Anchor close that zeros the data,
  so the writes are dead. Replace with a one-line comment that close itself is
  the lifecycle signal. Cross-check `cancel_round.rs:67` (no phase write today,
  consistent with this recommendation) and `force_close.rs:77`. Apply
  consistently across all three programs in the cross-game pass.
- **Status:** Open

### [LOW] PS-4 — Pause checks present but not test-asserted

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/potshot/src/instructions/create_round.rs:51`,
  `join_round.rs:45`, `buy_more_entries.rs:45`; tests
  `solana/tests/potshot.ts` (no `describe("pause")` block)
- **Game:** Pot Shot
- **Threat actor:** Platform admin who pauses for an operational reason and
  expects no new value to enter the round
- **Invariant:** README §"Account And Authority Invariants": *"Confirm pausing
  blocks new value entering the game while preserving settlement, refunds, and
  force-close recovery."*
- **Issue:** Pot Shot is a positive carry-over from the FY-2 lesson:
  `create_round`, `join_round`, and `buy_more_entries` all call
  `check_not_paused(false, ctx.accounts.config.paused)`. `claim_payout` and
  `timeout_refund` correctly do **not** call it (so settlement / refund still
  work while paused). The code is right; the tests do not assert it. Compared
  to FY-2 (where the test was right and the code missed the check), Pot Shot
  has the inverse risk: a future regression that drops the pause check would
  ship green.
- **Exploit Path:** Latent regression. Drop the `check_not_paused(...)` line
  in `join_round.rs` → CI stays green → pause becomes a soft toggle.
- **Impact:** No current exploit; CI gap on a load-bearing operational
  invariant.
- **Proof:** `grep -E "paused|GamePaused" solana/tests/potshot.ts` → zero
  matches.
- **Discovered via:** Cross-game diff against FY-2's resolution shape.
- **Confidence:** High.
- **Fix Direction:** Add a `describe("pause")` block asserting:
  (a) `create_round` rejected with `GamePaused` after `set_paused(true)`;
  (b) `join_round` rejected with `GamePaused`;
  (c) `buy_more_entries` rejected with `GamePaused`;
  (d) `claim_payout` and `timeout_refund` succeed while paused (the explicit
  contract — pause does not strand in-flight rounds).
- **Status:** Open

### [LOW] PS-5 — Verification endpoint pre-settle secret gate not test-asserted

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/potshot-create.ts:611–612`
  (`if (isSettled) { response.secret = round.secret.toString("hex"); … }`)
- **Game:** Pot Shot (cross-pattern: same shape as FY-7 in FlipYou)
- **Threat actor:** Player A / Player B and any public consumer of
  `/pot-shot/verify/:pda` or `/pot-shot/by-id/:matchId`
- **Invariant:** README §"Backend Trust Boundary": *"Confirm the verification
  endpoint test asserts `secret = null` while phase ≠ settled, and
  `secret = revealed_value` after settlement — automated, not code-review."*
- **Issue:** Code review confirms `formatPotShotRound` only includes
  `response.secret` inside `if (isSettled)` (line 611). No integration test
  asserts both halves of the contract for Pot Shot. The risk is regression: a
  future refactor that lifts `response.secret` out of the gate would silently
  expose every locked-phase secret to anyone hitting `/pot-shot/verify/:pda`,
  and Pot Shot pre-computes secrets at create-time exactly like FlipYou.
- **Exploit Path:** None today. CI gap → future regression risk.
- **Impact:** No current leak. Without a test, future regressions are
  undetectable in CI.
- **Proof:** `grep -E "verify|secret" backend/src/__tests__/*.test.ts` shows
  no Pot Shot pre-settle verify assertion.
- **Discovered via:** Cross-check against README's "automated, not
  code-review" requirement.
- **Confidence:** High.
- **Fix Direction:** Add a vitest case (next to the existing endpoint tests)
  that creates a Pot Shot round, has a 2nd player join, hits
  `/pot-shot/verify/:pda` before settle, and asserts `body.data.secret === undefined`.
  After settle, hit the same endpoint and assert `body.data.secret` equals
  the persisted hex secret.
- **Status:** Open

### [LOW] PS-6 — `initialize_config` uses `init_if_needed`, silently re-unpauses

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/potshot/src/instructions/initialize_config.rs:11`
- **Game:** Pot Shot (cross-pattern: same shape as FY-9 in FlipYou)
- **Threat actor:** Pot Shot config authority (`LordConfig.authority`)
- **Invariant:** `init_if_needed` is an Anchor footgun — it does not
  re-validate existing account state on the "needed not" branch; the
  programmer must do so manually.
- **Issue:** The handler manually checks
  `config.authority != Pubkey::default()` then `require_keys_eq!` the signer
  to the existing authority, so an unauthorized re-init is rejected. But the
  handler then unconditionally writes `config.paused = false`, meaning the
  authority can call `initialize_config` again to silently un-pause without
  going through `set_paused`. There is also a separate `set_paused`
  instruction with the same authority gate, so the code path is redundant.
- **Exploit Path:** Authority compromise is already in the trust assumptions,
  so this surface is contained.
- **Impact:** Surface-area inflation. A compromised authority has one more
  way to manipulate state, but no new capability.
- **Proof:** Reading `initialize_config.rs:22–35`.
- **Discovered via:** Cross-game diff against FY-9.
- **Confidence:** High.
- **Fix Direction:** Same as FY-9 — replace `init_if_needed` with `init` and
  a separate `update_config` if a re-init is ever genuinely needed, or
  document the redundancy and the implicit "re-init resets paused".
- **Status:** Open

### [LOW] PS-7 — `start_spin` is a deprecated no-op shim still in IDL

- **Category:** To Do Soon (cleanup)
- **Surface:** `solana/programs/potshot/src/instructions/start_spin.rs`
  (full file); `solana/target/idl/potshot.json` (still declares the
  instruction); `solana/tests/potshot.ts:256–277` (test helper passes
  `oraoProgram`/`oraoNetworkState`/`oraoTreasury`/`oraoRandom` accounts that
  the current IDL no longer declares)
- **Game:** Pot Shot
- **Threat actor:** None — operational legibility
- **Invariant:** Programs in the audit packet should not ship dead
  instructions or accounts.
- **Issue:** `start_spin.rs` is documented as *"Deprecated compatibility shim"*
  with the comment *"intentionally performs no state transition"*. It still
  ships in the IDL, so wallets, tooling, and the external auditor will see it.
  The bankrun helper `startSpin(...)` passes mock Orao accounts that no longer
  appear in the IDL — Anchor's TS SDK silently discards them, but the helper
  becomes a misleading reference for anyone reading the test.
- **Exploit Path:** None. A caller can still invoke `start_spin`; it succeeds
  if the round is in `Active` and `now >= countdown_ends_at`, otherwise
  rejects. Either way, no state mutation.
- **Impact:** Audit packet noise; documentation rot risk.
- **Proof:** Reading the file; comparing the test helper signature against
  the current IDL accounts.
- **Discovered via:** Routine consistency check.
- **Confidence:** High.
- **Fix Direction:** Either remove `start_spin` entirely (simplest — drop the
  instruction, its handler, the test, and regenerate IDL), or document it
  prominently in the spec as an intentionally retained no-op. The test
  helper's mock-Orao parameters should be removed regardless.
- **Status:** Open

### [INFO] PS-8 — `buy_more_entries` is a renamed clone of `join_round`

- **Category:** To Do Soon (cleanup)
- **Surface:** `solana/programs/potshot/src/instructions/buy_more_entries.rs`
  vs `join_round.rs`
- **Game:** Pot Shot
- **Threat actor:** None — code-clarity issue
- **Invariant:** Distinct instructions should have distinct semantics, or
  they should be one instruction. Two instructions whose handlers are
  byte-equivalent invite drift bugs in the future.
- **Issue:** `buy_more_entries` is documented as *"Existing player purchases
  additional entries in a round"* but its handler does not enforce that the
  caller already has an entry. The body is structurally identical to
  `join_round` (pause check, wager validation, phase guard, entries-cap check,
  countdown-window check, lamport transfer to PDA, vec push, total update,
  is-new-player branch that increments `distinct_players`, countdown-start
  branch). Because `is_new_player = !round.has_player(&player_key)`, calling
  `buy_more_entries` as a brand-new player works exactly like `join_round`
  (the existing test `tests/potshot.ts:629` uses this pattern intentionally).
- **Exploit Path:** None — both code paths converge on the same on-chain
  state. The audit risk is that a future change to one path that should also
  apply to the other gets missed.
- **Impact:** Latent drift risk. One observation worth recording: any future
  per-player limit (e.g. PS-12) would have to be added in two places to be
  effective.
- **Proof:** `diff` of the two `handler` functions shows only the doc
  comment, the struct name, and the `_match_id` underscore on `join_round`
  vs `match_id` plus a `round.match_id == match_id` check on
  `buy_more_entries`. The `match_id` constraint check is also redundant
  given the seed already binds `match_id`.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Either delete `buy_more_entries` and have all callers
  use `join_round`, or rename and tighten its semantics (e.g. require the
  caller to already be in `round.entries`). The first option is simpler and
  IDL-shrinking.
- **Status:** Open

### [INFO] PS-9 — `lifecycle::transition()` does not model Pot Shot's flow

- **Category:** To Do Soon (cleanup / doc drift)
- **Surface:** `solana/shared/src/lifecycle.rs:39–58`;
  `claim_payout.rs:117` writes `phase = Settled` directly without calling
  `transition()`
- **Game:** Pot Shot (also Shared)
- **Threat actor:** None — documentation drift
- **Invariant:** The shared lifecycle module should be the documented source
  of truth for valid phase transitions across games. If a game bypasses it,
  the module's claims drift from reality.
- **Issue:** The shared `transition()` function rejects `Active → Settled`
  (it allows `Active → Locked`, `Active → Refunded`, `Locked → Resolving`,
  `Resolving → Settled`, etc.). Pot Shot transitions Active → Settled
  directly in `claim_payout`, by-passing `transition()`. This is intentional
  (Pot Shot has no Locked/Resolving sub-phases — the entire countdown +
  settle window collapses into Active), but the shared module is now
  inconsistent with the only Anchor program that actually uses
  `RoundPhase`. FlipYou uses the raw `PHASE_*` constants in
  `shared/src/constants.rs`, not the enum, so it doesn't surface this.
- **Exploit Path:** None.
- **Impact:** Audit packet legibility — an external reviewer reading
  `lifecycle.rs` would conclude `Active → Settled` is illegal, then read
  `claim_payout.rs` and find it's the actual happy path.
- **Proof:** Reading `lifecycle.rs::transition` and `claim_payout.rs:117`.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Either add `Active → Settled` to the allowed
  transitions and document it as Pot Shot's claim-flow, or rename the
  shared module to reflect the FlipYou-only lock-then-resolve flow and stop
  pretending it's general. The first option is cheaper and keeps the module
  load-bearing.
- **Status:** Open

### [INFO] PS-10 — Sybil DoS: one wallet can fill 64 entries before any opponent joins

- **Category:** Document As Trust Assumption (or Ask External Auditor if the
  team wants explicit signoff)
- **Surface:** `solana/programs/potshot/src/instructions/create_round.rs`,
  `join_round.rs`, `buy_more_entries.rs` (no per-player entry cap)
- **Game:** Pot Shot
- **Threat actor:** Sybil player (one party with many wallets) and Player A
  acting alone with `buy_more_entries`
- **Invariant:** Per-player participation should be bounded if `MAX_ENTRIES`
  is meant to bound *the round*, not just *the vec length*.
- **Issue:** `MAX_ENTRIES = 64` caps the entries vec but not entries per
  wallet. A single creator can call `create_round` then `buy_more_entries` 63
  times to fill the vec to 64 entries from one wallet. With `distinct_players`
  stuck at 1, the round stays in `Waiting` and never starts countdown — but
  no other player can `join_round` (entries-cap rejects). The creator can
  then `cancel_round` for a full refund. Cost: one tx fee per
  `buy_more_entries` call (~0.000005 SOL × 63 ≈ 0.0003 SOL) plus rent paid by
  the server. Even cheaper if done via a direct on-chain script, since the
  backend's API has no `buy_more_entries` endpoint exposed.
  - Variant: a sybil with N ≥ 2 wallets can fill the round, trigger countdown
    on the 2nd distinct wallet, and run all 64 entries themselves. Cost is
    real (64 × 0.001 SOL min wager + 5% fee on settle ≈ 0.067 SOL), and the
    sybil "wins" their own pot (minus 5%), so the only loss is the fee. Net
    cost to grief one round to legit players: ~0.0034 SOL ≈ $1 at $300/SOL.
- **Exploit Path:** Above. Result is liveness denial of one pot, not value
  loss to legit players (anyone who attempted to join is rejected before
  funds escrow).
- **Impact:** Liveness only. No funds-at-risk. The cost-per-griefed-pot is
  small enough that an adversary motivated by "make Pot Shot look unusable"
  could plausibly run this.
- **Proof:** Reading the three entry-creating handlers — no
  `entries_by_player` count, no per-player cap.
- **Discovered via:** Manual review of `MAX_ENTRIES` and the
  `is_new_player` logic.
- **Confidence:** High (the gap), Medium (the practical motivation).
- **Fix Direction:** Decide if a per-player entry cap is desired:
  - Option A (no change, document): accept that round liveness depends on
    the backend's single-active-round API gate, and flag this in the spec
    plus README Trust Assumptions.
  - Option B: add a per-player cap (e.g. 8 entries) on-chain. Implementation
    is cheap — count entries with the same `player` in the existing
    `has_player`-style scan during create / join / buy_more.
- **Status:** Open

### [INFO] PS-11 — `cancel_round` only callable by creator; no admin / permissionless escape for stuck Waiting rounds

- **Category:** Document As Trust Assumption
- **Surface:** `cancel_round.rs:27` (`constraint = round.creator == creator.key()`);
  `timeout_refund.rs:47` (`require!(round.phase == RoundPhase::Active, …)`)
- **Game:** Pot Shot
- **Threat actor:** A creator who creates a round and then never returns to
  cancel it
- **Invariant:** Funds in a round PDA should always have a recovery path
  bounded in time.
- **Issue:** A round stuck in `Waiting` (creator created, no one else joined,
  creator vanishes) cannot be cleaned up by anyone except the creator
  (`cancel_round`) or the config authority (`force_close`). `timeout_refund`
  is gated on `phase == Active`, so it cannot recover Waiting rounds.
  `resolve_deadline` is only set when countdown starts. So if the creator
  creates and never returns, the funds (creator's wager + server's rent
  payment) sit in the PDA until the admin runs `force_close` manually.
- **Exploit Path:** Not adversarial — a creator who loses their key, or who
  abandons the round before anyone joins. The amount at risk per round is
  the creator's own minimum wager (0.001 SOL) plus the server's rent
  (~0.0195 SOL).
- **Impact:** Operational. The risk is borne by the *server* (who paid the
  rent), not the creator (who gets their entry back as soon as anyone
  cancels or force-closes). Aggregate risk = (orphaned-Waiting-round count)
  × ~0.02 SOL per round. The admin can reclaim via `force_close`, so the
  funds are not permanently lost.
- **Proof:** Reading the two phase guards.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Decide:
  - Option A: accept and document. The server runs a periodic `force_close`
    sweep over Waiting rounds older than N hours.
  - Option B: open `timeout_refund` to Waiting rounds by setting
    `resolve_deadline = created_at + WAITING_TIMEOUT_SECONDS` at create-time
    and allowing the Waiting branch in `timeout_refund`. Adds a permissionless
    recovery path.
- **Status:** Open

### [LOW] PS-12 — Slot-rate sensitivity of `target_entropy_slot` math

- **Category:** Ask External Auditor (timing question for fairness +
  liveness on the target cluster)
- **Surface:** `solana/programs/potshot/src/state.rs:13`
  (`COUNTDOWN_SLOT_ESTIMATE: u64 = 150`); `join_round.rs:96–101`,
  `buy_more_entries.rs:95–100`; `solana/shared/src/timeout.rs:4`
  (`DEFAULT_RESOLVE_TIMEOUT_SECONDS: i64 = 120`)
- **Game:** Pot Shot
- **Threat actor:** None adversarial; the cluster's slot-rate variance
- **Invariant:** For any plausible mainnet slot rate, settlement and
  permissionless refund must both have a non-empty success window.
- **Issue:** The on-chain code computes
  `target_entropy_slot = current_slot + 150 + 12` at countdown start,
  with `COUNTDOWN_SECONDS = 60`. At a 0.4 s/slot baseline, target slot is
  reached ~65 s after countdown start (5 s after `countdown_ends_at`). The
  SlotHashes window is ~512 slots ≈ 205 s, so target slot is valid from
  `t0 + 65 s` to `t0 + 270 s`. `resolve_deadline = t0 + 60 + 120 = t0 + 180 s`.
  Timeout opens 90 s before entropy expires under the baseline — fine.
  - Under a sustained slow regime (~0.6 s/slot for several minutes, which
    has happened during Solana congestion incidents), 162 slots take ~97 s.
    target_slot is reached at `t0 + 97 s`, settle has only 83 s before
    timeout opens at `t0 + 180 s`. Still fine, but tighter.
  - Under a slow regime ≥ ~1.1 s/slot (not common, but observed during
    upgrade outages), `target_entropy_slot` is reached after timeout opens.
    A permissionless `timeout_refund` could fire before settle is even
    *possible*. Players get refunded; backend cannot settle even with all
    state correct. Liveness path is fine; UX is degraded (round refunds
    instead of paying out a winner).
  - Under an unusually fast regime (~0.3 s/slot, hypothetical): target slot
    is reached during countdown, valid window ends at `t0 + ~50 s + 205 s ×
    (0.3/0.4) = t0 + ~204 s`, timeout opens at `t0 + 180 s`. Both windows
    overlap. No stuck zone.
  At extreme slot rates (sub-0.25 s/slot, never observed), it is theoretically
  possible to construct a regime where entropy expires before timeout opens,
  but no realistic mainnet slot rate today produces that.
- **Exploit Path:** Not adversarial. Slot-rate variance during cluster
  incidents.
- **Impact:** Liveness — degraded UX during cluster slowdowns (Pot Shot
  rounds refund instead of settling). Funds are always recoverable.
- **Proof:** Reading the constants + slot-rate math.
- **Discovered via:** Manual review.
- **Confidence:** Medium (correct algorithmically; depends on cluster
  conditions).
- **Fix Direction:** External auditor should validate that the constants
  (`COUNTDOWN_SLOT_ESTIMATE = 150`, `ENTROPY_SLOT_OFFSET = 12`,
  `DEFAULT_RESOLVE_TIMEOUT_SECONDS = 120`) are well-chosen for mainnet
  conditions. Internally, options are: (a) tighten the resolve-deadline
  buffer; (b) compute `target_entropy_slot` from a target *time* rather than
  a fixed slot count; (c) document the trade-off in the spec.
- **Status:** Open

### [OPEN] PS-13 — Compute and account-load reality check not yet performed

- **Category:** Open Investigation (must be closed before external packet
  ships)
- **Surface:** `solana/programs/potshot/src/instructions/claim_payout.rs`,
  `timeout_refund.rs`, `force_close.rs`; per audit plan
  `docs/audits/solana-games-audit-prep/potshot.md` Task 7
- **Game:** Pot Shot
- **Threat actor:** Permissionless caller (who needs `timeout_refund` to fit
  in one tx) and the backend (who needs `claim_payout` to fit)
- **Invariant:** README §"Compute And Account-Load Limits": *"Confirm
  headroom is at least 20% under both 1.4M CU and the runtime account-loading
  limit at the V0+LUT strategy in use."*
- **Issue:** `claim_payout` and `timeout_refund` iterate the entries vec up
  to `MAX_ENTRIES = 64` and pay each player via remaining accounts. Bankrun
  reports CU but not the runtime account-loading limit. No devnet measurement
  of a 64-distinct-player round has been recorded. If either path exceeds 1.4M
  CU per tx or the address-loading limit at V0+LUT, the round becomes
  permanently stuck — `timeout_refund` shares the same compute ceiling, so it
  is also blocked.
- **Exploit Path:** Permanent stuck round if a 64-distinct-player settlement
  hits a runtime limit.
- **Impact:** Funds-stuck if hit; the audit packet should ship with measured
  CU numbers.
- **Proof:** Bankrun results in `tests/potshot.ts` show small CU numbers
  (8K–23K) for the small fixed-vec cases tested; nothing at 64-entry scale.
- **Discovered via:** Audit packet plan Task 7.
- **Confidence:** Medium (likely fine; needs measurement).
- **Fix Direction:** Per audit plan Task 7:
  - Build a devnet round with 64 distinct players (one entry each, minimum
    wager). Settle via `claim_payout`. Capture CU consumed, accounts loaded,
    V0+LUT yes/no.
  - Build a devnet round with 64 distinct players, trigger `timeout_refund`.
    Capture CU + account count.
  - Build a devnet round with 64 entries split across 2 players. Trigger
    `timeout_refund`. Capture CU.
  - Confirm ≥ 20 % headroom under both 1.4M CU and the address-loading limit.
  - If headroom is insufficient, promote to **Must Fix Before External Audit**
    with the exact CU number and a remediation plan (lower `MAX_ENTRIES`,
    paged settlement, or both).
- **Status:** Open

---

## Out-of-Scope Observations (not findings, recorded for the cross-game pass)

- The `claim_payout` rent-to-caller pattern (PS-1) is the verbatim shape of
  FlipYou FY-3. Resolving them together is preferable; the cross-game pass
  should pick one direction (rent → server everywhere, or rent → caller
  everywhere) and apply it.
- The phase-mutate-after-transfer pattern (PS-3) is the same as FY-4. Same
  fix shape applies. Close-time zeroing makes the writes dead in Pot Shot
  too, so the recommendation is removal, not reordering.
- The `init_if_needed` re-unpause pattern (PS-6) repeats the FY-9 shape in
  Pot Shot. Same fix candidates.
- The `start_spin` deprecated shim (PS-7) does not have a FlipYou analogue
  but is similar in spirit to FlipYou's empty-config `paused = false`
  artifact in FY-9.
- The Pot Shot BPF program upgrade authority is not documented in the
  Deployment Posture custody table in
  `docs/audits/solana-games-audit-prep/README.md`. That table should be
  filled in before the external packet ships (carries over from FY-10).
- `solana/CLAUDE.md` lists the Pot Shot program ID matching the on-chain
  source (`AisGseQmbxT1AWVrEWty6Swsr3vbwipDbYQyVKFhidby`); the FY-10 doc
  drift on FlipYou and Platform IDs has been resolved on this commit (the
  CLAUDE.md table now matches `Anchor.toml` and `declare_id!`).
- The Pot Shot `RoundSettled` event is emitted **before** the state writes
  at the bottom of `claim_payout.rs`. The event uses values computed from
  `secret`, `entropy`, and `round.entries` — all of which are read before
  the state mutation. This is correct: the event captures the post-settle
  truth even though `phase = Settled` follows it. No finding.
