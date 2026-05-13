# Solana Contracts Deep Dive Audit - 2026-05-13

Scope: `solana/programs/platform`, `flipyou`, `closecall`, `potshot`, `fairness-test`, plus `solana/shared/src`.

Method: manual Anchor review using the Solana security checklist: owner/signer checks, PDA seeds, account relationship checks, CPI/program validation, lifecycle transitions, timeout/refund behavior, entropy/oracle trust, closure patterns, arithmetic, and remaining-account payout paths. I also compared against `docs/audits/solana-games-audit-2026-05-06.md` and `solana/README.md` to avoid re-reporting resolved items as new.

## Executive Summary

No immediate arbitrary-drain issue was found in the main payout paths. The strongest current issue is Pot Shot's entropy timing: the target SlotHashes slot is estimated at countdown start while entries remain open, which can expose entropy before late entries close under faster slot production. A second cross-cutting issue remains in manual PDA closure used by FlipYou and Pot Shot cancel paths: it is weaker than Anchor's `close` constraint and should be removed.

Close Call's trusted-operator price model remains the dominant accepted trust boundary. The code documents it clearly and adds sanity checks, but `pyth_feed_id` is still metadata only until on-chain Pyth receiver verification is implemented.

## Findings

### H-1 - Pot Shot entropy can be knowable before entries close

- Severity: High
- Area: Pot Shot fairness / late-entry manipulation
- Evidence:
  - `join_round` starts countdown at the second distinct wallet and sets `target_entropy_slot = now.slot + COUNTDOWN_SLOT_ESTIMATE + ENTROPY_SLOT_OFFSET`.
  - Entries remain open by wall-clock until `countdown_ends_at`.
  - `COUNTDOWN_SLOT_ESTIMATE` is only an approximation of slots over 60 seconds.
- Files:
  - `solana/programs/potshot/src/state.rs:11`
  - `solana/programs/potshot/src/instructions/join_round.rs:91`
  - `solana/programs/potshot/src/instructions/buy_more_entries.rs:95`
- Impact: If slots are produced faster than the estimate, the target entropy slot can be produced before `countdown_ends_at`. A player can observe the target slot hash, simulate whether adding weight helps, then join or buy more entries before the wall-clock entry window closes.
- Remediation: Do not choose the entropy slot while entries are still open. Add an explicit lock/finalize instruction after `countdown_ends_at` that sets `target_entropy_slot = current_slot + ENTROPY_SLOT_OFFSET`, or reject all joins/buys once `Clock::get()?.slot >= target_entropy_slot`. The lock-instruction design is cleaner because it avoids relying on slot-speed estimates.

### M-1 - Manual PDA closure remains in FlipYou and Pot Shot cancel paths

- Severity: Medium
- Area: Account lifecycle / revival hardening
- Evidence:
  - Shared `close_pda` drains lamports and fills data with zeroes manually.
  - FlipYou `settle`, `cancel_match`, and `timeout_refund` call it.
  - Pot Shot `cancel_round` calls it.
  - Close Call and most Pot Shot terminal paths already use Anchor `close = rent_receiver`.
- Files:
  - `solana/shared/src/escrow.rs:43`
  - `solana/programs/flipyou/src/instructions/settle.rs:150`
  - `solana/programs/flipyou/src/instructions/cancel_match.rs:54`
  - `solana/programs/flipyou/src/instructions/timeout_refund.rs:77`
  - `solana/programs/potshot/src/instructions/cancel_round.rs:67`
- Impact: Anchor's `close` constraint is the standard hardened pattern. Manual zero-lamport closure can be more exposed to same-transaction account-revival edge cases, especially because the account remains an `Account<T>` that Anchor may still process on exit. This is not an immediate public drain in the reviewed flows, but it is unnecessary risk on escrow accounts.
- Remediation: Replace manual terminal close calls with Anchor `#[account(close = rent_receiver)]` / `#[account(close = server)]` constraints, after doing explicit principal/fee transfers. Remove `close_pda` unless a path truly cannot use Anchor close.

### M-2 - Close Call still does not verify Pyth on-chain

- Severity: Medium, accepted trust boundary
- Area: Oracle trust / operator key custody
- Evidence:
  - `settle_round` accepts `close_price` and `close_price_expo` as instruction args.
  - `CloseCallConfig.pyth_feed_id` is stored and updateable, but settlement does not consume a Pyth `PriceUpdateV2` account.
  - The handler restricts settlement to `caller == round.server` and checks positive price, exponent match, and a 50% drift cap.
- Files:
  - `solana/programs/closecall/src/instructions/settle_round.rs:56`
  - `solana/programs/closecall/src/instructions/settle_round.rs:77`
  - `solana/programs/closecall/src/instructions/settle_round.rs:112`
  - `solana/programs/closecall/src/instructions/settle_round.rs:118`
- Impact: A compromised operator key can settle with arbitrary in-bound prices. The drift checks protect against some honest-server failures, not malicious settlement.
- Remediation: Replace price args with a verified Pyth receiver account and enforce feed id, publish time/freshness, and exponent/normalization on-chain. Until then, keep this explicitly documented as operator-trusted.

### M-3 - Platform singleton init is first-writer-wins

- Severity: Medium
- Area: Deployment / governance
- Evidence: `platform::initialize_platform` uses strict `init` on `[b"platform_config"]`, but unlike the game configs it does not require the BPF-loader upgrade authority to co-sign.
- Files:
  - `solana/programs/platform/src/instructions/initialize_platform.rs:6`
  - `solana/programs/platform/src/instructions/initialize_platform.rs:25`
- Impact: On a fresh deployment, whoever initializes the PDA first chooses the fee authority and treasury. This is a deployment race, not an ongoing runtime exploit after correct initialization.
- Remediation: Mirror the game-config pattern: require the program's upgrade authority and ProgramData account on `initialize_platform`, or guarantee initialization in the same controlled deploy procedure before the program id is public.

### L-1 - Close Call config accepts unbounded operational values

- Severity: Low
- Area: Admin footgun / availability
- Evidence: `initialize_config` and `update_config` accept `betting_window_secs` and `max_entries_per_side` without on-chain bounds. The account allocation supports 32 entries per side, but config can be set above that.
- Files:
  - `solana/programs/closecall/src/instructions/initialize_config.rs:46`
  - `solana/programs/closecall/src/instructions/update_config.rs:23`
  - `solana/programs/closecall/src/instructions/bet.rs:129`
- Impact: A bad admin update can make betting behavior nonsensical or lead to failed serialization after too many entries. This is authority-gated, so it is an operational correctness issue.
- Remediation: Enforce `1 <= betting_window_secs <= 60` and `1 <= max_entries_per_side <= 32` in both initialize and update paths.

### L-2 - Fairness-test is unsafe as a production program

- Severity: Low if test-only, High if deployed for value
- Area: Test harness boundaries
- Evidence: `fairness-test` accepts arbitrary unchecked entropy, uses manual lamport/data closure, and derives one PDA per creator.
- Files:
  - `solana/programs/fairness-test/src/lib.rs:171`
  - `solana/programs/fairness-test/src/lib.rs:227`
  - `solana/programs/fairness-test/src/lib.rs:314`
- Impact: This is acceptable for a harness, but unsafe for production funds.
- Remediation: Keep it out of production deployments and CI-gate any mainnet/devnet deployment list so this program cannot be mistaken for a real game.

## Program-by-Program Notes

### Platform

The update path is correctly authority-gated via `has_one = authority`, uses a singleton PDA, and caps fees with `MAX_FEE_BPS`. `rng_shared::platform_config::read_platform_config` validates owner, data length, discriminator, and fee cap before game programs trust treasury/fee values.

Main issue: initialization should receive the same upgrade-authority guard now present in the game config initializers.

### FlipYou

Good controls:

- Create requires both creator and configured server authority signatures.
- Creator cannot equal server.
- Join prevents self-play and locks the match immediately.
- Settle validates SlotHashes address, PlatformConfig owner/discriminator, treasury, creator, opponent, and stored server.
- Commit-reveal binds secret, entropy, match PDA, and algorithm version.
- Timeout refund validates stored creator/opponent/server accounts.

Main issue: terminal paths still use manual `close_pda`. Convert to Anchor close constraints.

### Close Call

Good controls:

- Server authority co-signs bet creation and settlement.
- One bet per player per round.
- Remaining accounts are checked by exact pubkey and order before payout/refund.
- Settlement uses checked arithmetic, `u128` proportional math, and gives dust to the last winner.
- Terminal paths use Anchor `close`.

Main issue: price settlement remains operator-trusted. This is documented and partially mitigated, but not cryptographic until Pyth receiver verification lands. Add config bounds to reduce admin footguns.

### Pot Shot

Good controls:

- Server co-signs round creation.
- Wagers are bounded by shared validation.
- Settlement validates PlatformConfig, treasury, SlotHashes, rent receiver, commitment, and derived winner.
- Refund/force-close aggregate duplicate-wallet entries before returning funds.
- Most terminal paths use Anchor `close`.

Main issue: entropy slot is estimated while entries are still open. This should be fixed before treating the game as fairness-hardened. `cancel_round` should also stop using manual `close_pda`.

### Fairness Test

Treat as a local/test harness only. It intentionally bypasses real SlotHashes validation by reading arbitrary raw entropy and should not be included in production deployment operations.

## Verification

No contract code changes were made in this audit. I did not run the Anchor test suite; this pass was source review only. The previous audit noted verification blockers around local DB/schema setup and Anchor test imports, so test proof should be re-run after those are known fixed.
