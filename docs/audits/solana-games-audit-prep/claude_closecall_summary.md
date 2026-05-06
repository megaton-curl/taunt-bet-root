# Close Call Audit Pass — Summary

**Pass type:** Internal audit-prep, Close Call–only.
**Plan followed:** `docs/audits/solana-games-audit-prep/closecall.md`
(Tasks 1–7 on code; Task 8 deferred — see CC-14).
**Scope:** `solana/programs/closecall`, `solana/programs/platform`,
`solana/shared`, backend create + clock + settlement
(`backend/src/routes/closecall.ts`, `backend/src/worker/closecall-clock.ts`,
`backend/src/worker/pyth-poster.ts`, `backend/src/worker/settle-tx.ts`,
`backend/src/routes/health.ts`), `solana/tests/closecall.ts`.
**Out of scope per CLAUDE.md:** `webapp/`, `waitlist/` (read-only references).

## TL;DR

Close Call has the richest invariant surface of the three shipped games and
the bankrun suite is **green (23 / 0 failing)**, but this pass found two
HIGH issues that block sending an external auditor an honest packet:

1. **CC-1 — `settle_round` is permissionless and accepts any close_price.**
   The on-chain account struct has `caller: Signer<'info>` with no
   `caller == round.server` constraint, and the handler reads
   `close_price` from an unvalidated instruction argument. **Any
   participant can call settle with their preferred close price and
   force the outcome that maximises their share of the pool.** This is
   funds-loss for the losing side every round, repeatable indefinitely,
   exploitable by a single user with a single tx fee. The audit packet
   README's "Auditor Questions" already lists *"Should settlement
   authority be permissionless, server-only, or current
   backend-triggered with on-chain validation?"* — the current code is
   permissionless **without** validation, the worst of the three options.
   The bankrun suite does not exercise the attacker-as-caller scenario,
   so the bug is invisible to CI.

2. **CC-2 — Backend settles with a fresh-fetched Hermes price, not the
   captured minute-boundary price.** The clock-worker correctly captures
   a Pyth price with `publishTime ≥ boundaryTs` and saves it to
   `closecall_candles` for the chart, then in `settleRound` does a
   *separate* `hermes.fetchLatestBtcPrice()` and uses **that** price as
   the on-chain `close_price`. Empirically the on-chain close price
   reflects market action 1–10 s after the boundary. The chart and the
   settled outcome can disagree about the candle. Players whose visible
   chart says they won can lose funds; retries widen the drift further.

The remaining findings are MEDIUM-and-below: a config footgun
(`max_entries_per_side` can exceed `#[max_len(32)]`), a missing freshness
check on the cached boundary price at the bet route, the
transfer-then-mutate pattern (cross-game with PS-3 / FY-4), the
under-coverage of adversarial bankrun cases, the `pyth_feed_id`
documentation-only field, and the still-pending on-chain Pyth
validation.

## Test Run Captured

Command:
`cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/closecall.ts`

Result on this commit: **23 passing, 0 failing, 0 pending**. The suite
tests round creation timing, betting-window guards, duplicate-bet
rejection, multi-winner proportional payouts, single-player /
one-sided / equal-price refunds, candle-not-closed rejection, timeout
refund (permissionless after deadline), and force-close authority.

Notably absent: any test where a non-server signer settles, any pause
test, any `max_entries_per_side` boundary test, any exponent-mismatch
test, any wrong-remaining-account substitution test. See CC-10 for the
full list.

## Findings Index (see `claude_closecall_findings.md` for full bodies)

| ID | Severity | Category | Subject |
|----|----------|----------|---------|
| CC-1 | HIGH | Must Fix Before External Audit | `settle_round` permissionless + accepts any close_price → outcome manipulation |
| CC-2 | HIGH | Must Fix Before External Audit | Backend settles with fresh-fetched Hermes price, not captured boundary price |
| CC-3 | MEDIUM | To Do Soon | `max_entries_per_side` config can exceed on-chain `#[max_len(32)]` capacity |
| CC-4 | MEDIUM | Needs Test Proof | Bet route does not validate cached boundary price's `minuteTs` |
| CC-5 | MEDIUM | Needs Test Proof | State writes after lamport transfers in settle / timeout / force_close |
| CC-6 | MEDIUM | Needs Test Proof | Health endpoint does not expose Hermes / clock / settlement-queue health |
| CC-7 | LOW | Document As Trust Assumption | `pyth_feed_id` stored on-chain but never validated |
| CC-8 | LOW | Document As Trust Assumption | `initialize_config` re-init silently re-writes feed ID + cap + paused |
| CC-9 | LOW | To Do Soon | On-chain Pyth validation still pending |
| CC-10 | LOW | Needs Test Proof | Bankrun suite under-covers adversarial surface |
| CC-11 | LOW | Needs Test Proof | `/closecall/by-id/:roundId` settled-shape gate not test-asserted |
| CC-12 | INFO | To Do Soon | Outcome dead clause `total_count == 1` |
| CC-13 | INFO | Ask External Auditor | `currentRoundRoute` returns previous-minute round without explicit signal |
| CC-14 | OPEN | Open Investigation | Compute and account-load reality check not yet performed |

## What I Confirmed Holds

- **PDA seeds.** `CloseCallRound` (`["cc_round", &minute_ts.to_le_bytes()]`)
  and `CloseCallConfig` (`["closecall_config"]`) match the on-chain
  source, the IDL, and `backend/src/worker/settle-tx.ts:878–883`. The
  `solana/CLAUDE.md` row matches the `declare_id!` at
  `programs/closecall/src/lib.rs:9`.
- **Minute alignment is enforced on-chain.** `bet.rs:75` requires
  `minute_ts == (now / 60) * 60`, so a player cannot place a bet for a
  past or future minute even if the backend mis-computes. (The backend
  compute uses `Date.now()`, but the on-chain check uses cluster time.
  The two must agree to within ~30 s of clock skew, which is normally
  the case via NTP.)
- **Betting window symmetry.** First-bet check
  `now - current_minute < betting_window` (bet.rs:78) and subsequent-bet
  check `now < betting_ends_at` (bet.rs:113) are equivalent
  (`betting_ends_at = current_minute + betting_window`). Both reject
  exactly at the boundary; both accept strictly before.
- **One-bet-per-wallet-per-round.** `bet.rs:120–127` chains
  `green_entries.iter().chain(red_entries.iter())` and rejects with
  `PlayerAlreadyBet` if any matches. Bankrun confirms this for both
  same-side and cross-side dupes.
- **Treasury and rent-receiver binding at settle.**
  `settle_round.rs:62–75` reads `read_platform_config` (which validates
  owner + discriminator + fee cap), then `require_keys_eq!` for
  `treasury == treasury_key` and `rent_receiver == round.server`. A
  caller cannot redirect either fee or rent.
- **Decisive payout math is internally correct.** Proportional payouts
  use checked u128 arithmetic; the last winner gets `net_pool -
  paid_out` to absorb integer-division dust. Bankrun's
  `multi-winner proportional payout` test exercises this at modest
  values; the formula is bounded by `entry_amount × net_pool ≤ 2^80 < 2^128`
  at the documented MAX_WAGER and `max_entries_per_side` ceilings, so
  the u128 path cannot overflow.
- **Refund branches are exhaustive.** `total_count == 0`,
  `!has_both_sides`, `total_count == 1`, and `close_price == open_price`
  all route to `Outcome::Refund` with no fee. Bankrun covers the
  one-sided, single-player, and equal-price cases. The `total_count == 1`
  branch is dead (subsumed by `!has_both_sides`) but harmless (CC-12).
- **Refund / force_close remaining-account safety.** Both
  `timeout_refund.rs:74–92` and `force_close.rs:67–85` walk
  `green_entries` then `red_entries`, indexing into `remaining_accounts`
  with `green_count + i` for the second loop and `require_keys_eq!`-ing
  each player against the entry's stored player. Wrong ordering or wrong
  pubkey is rejected.
- **Permissionless `timeout_refund` is correctly gated.** Deadline check
  `is_expired(round.resolve_deadline, now)` uses the strict ≥ semantics
  from `shared/src/timeout.rs`. Bankrun asserts both rejection-before
  and acceptance-after.
- **Pause check on the right surfaces.** `bet.rs:54` calls
  `check_not_paused(false, config.paused)`. `settle_round`,
  `timeout_refund`, and `force_close` correctly do not — pause must
  not strand in-flight rounds. (CC-10 flags the missing test for this.)
- **`force_close` is authority-only via has_one.** `force_close.rs:23–28`
  uses Anchor's `has_one = authority` constraint on the config PDA.
  Non-admin attempts return `ConstraintHasOne` (Anchor's 2001),
  bankrun-confirmed.

## Suggested Triage Before External Packet Ships

In rough priority order:

1. **CC-1 first, with the matching bankrun test.** This is the
   load-bearing fix. The shortest fix is a one-line constraint
   (`require_keys_eq!(caller, round.server, AccountMismatch)`); the
   correct end-state is on-chain Pyth validation (CC-9). Either way,
   add a bankrun case where a non-server signer attempts settle.
2. **CC-2.** Once CC-1 is fixed, the close-price source still matters.
   Switch `settleRound` to use the `cachedBoundaryPrice` value (after
   asserting `cachedBoundaryPrice.minuteTs === round.minute_ts + 60`),
   delete the redundant Hermes fetch. Persist the same value to DB so
   the chart and verify endpoint stay in sync. Add a backend
   integration test that mocks Hermes to return a moving price.
3. **CC-4 in the same PR as CC-2.** The bet route should refuse to
   build a tx if the cached boundary's `minuteTs` is not the current
   minute; return `503 PRICE_UNAVAILABLE` with `retryable: true`.
4. **CC-3 + CC-8 together.** Add an `update_config` instruction that
   accepts optional fields; cap `max_entries_per_side ≤ 32`; preserve
   `paused` across updates. Replace `init_if_needed` with `init` in
   `initialize_config`. Add bankrun tests at the cap boundary.
5. **CC-10 last.** Some of the missing tests will land alongside the
   above fixes (CC-1, CC-2, CC-3 each motivate at least one case);
   the rest are independent and should be filled out before the
   external packet.
6. **CC-14 measurement.** Run the devnet 32×32 settle and refund
   recipes from audit plan Task 8; capture CU and account-load
   numbers. Confirm headroom or escalate.
7. **CC-9 (on-chain Pyth).** This is the durable fix that subsumes
   CC-1's auth-only mitigation, CC-2's price-source concern, and
   CC-7's documentation-only feed ID. It is the largest piece of work
   here. Ship it before mainnet.

CC-5 (transfer-then-mutate) is independent and can be picked up by
the cross-game pass in the same touch as PS-3 / FY-4. CC-6 (health
exposure) and CC-11 (verify-shape test) can be triaged into the
larger audit budget. CC-12 (dead clause) and CC-13 (current-round
signal) are cleanup.

## Files Read During the Pass

On-chain:
- `solana/programs/closecall/src/{lib.rs, state.rs, error.rs}`
- `solana/programs/closecall/src/instructions/{initialize_config.rs,
  bet.rs, settle_round.rs, timeout_refund.rs, force_close.rs,
  set_paused.rs, mod.rs}`
- `solana/programs/platform/src/{state.rs, instructions/
  initialize_platform.rs, instructions/update_platform_config.rs}`
- `solana/shared/src/{escrow.rs, fees.rs, pause.rs, platform_config.rs,
  timeout.rs, wager.rs}`
- IDL: `solana/target/idl/closecall.json` (instruction shape +
  `start_spin`-style cross-check)

Backend:
- `backend/src/routes/closecall.ts` (full)
- `backend/src/routes/health.ts`
- `backend/src/routes/price.ts`
- `backend/src/worker/closecall-clock.ts` (full)
- `backend/src/worker/pyth-poster.ts` (full)
- `backend/src/worker/settle-tx.ts` (Close Call section + tx
  builders)

Tests:
- `solana/tests/closecall.ts` (full + executed)

Audit packet:
- `docs/audits/solana-games-audit-prep/{README.md, closecall.md,
  findings.md, flipyou.md, potshot.md, claude_findings.md,
  claude_audit_summary.md, claude_potshot_findings.md,
  claude_potshot_summary.md}`
- `docs/specs/100-close-call/spec.md` (FR-1 through FR-3 — flagged the
  spec/code drift on FR-3)
