# Solana Games Formal Implementation Audit - 2026-05-06

This audit reviews the shipped implementation and runtime behavior of FlipYou, Close Call, and Pot Shot. Specs were used only as orientation; stale spec text is not treated as a finding unless it exposes implementation risk.

## Scope And Method

- **On-chain**: every exported instruction in `solana/programs/flipyou`, `solana/programs/closecall`, `solana/programs/potshot`, plus platform fee config and shared helpers.
- **Backend**: game routes, settlement workers, retry logic, PDA watcher, DB state transitions, accounting rows, verification/history/current endpoints.
- **Client/IDL**: checked-in IDLs, program IDs, PDA derivations, account decoders, game-engine verification helpers, transaction builders.
- **Tests/proof**: Solana bankrun tests, backend unit/integration tests, E2E coverage, `scripts/verify` behavior.

Severity reflects likely user-funds, settlement correctness, oracle/fairness, accounting, or operational impact.

## Critical / High Findings

### H-1 - FlipYou and Close Call config PDAs can be captured by the first initializer

- **Severity**: High
- **Area**: Deployment / admin authority
- **Evidence**: `flipyou/src/instructions/initialize_config.rs` and `closecall/src/instructions/initialize_config.rs` use `init_if_needed` on singleton config PDAs. The first signer to create the PDA becomes `authority`. Create/bet flows then require the server to match that authority.
- **Impact**: If an attacker or wrong key initializes first, they become the game authority and can block the intended operator from creating valid backend-assisted games. Pot Shot avoids this by using one-shot `init`.
- **Remediation**: Change FlipYou and Close Call config initialization to strict `init`, or add a deploy-time authority guard/migration story that prevents first-writer capture. Add frontrun tests.

### H-2 - Backend never submits timeout refunds for any game

- **Severity**: High
- **Area**: Liveness / lifecycle completion
- **Evidence**: `backend/src/worker/retry.ts` stops retrying when `resolve_deadline` passes or entropy expires and records `timeout_detected`, but does not build or submit `timeout_refund`. `buildCloseCallTimeoutRefundTx` exists in `settle-tx.ts` but is not referenced by a worker.
- **Impact**: On-chain refunds are permissionless, so funds are not necessarily lost, but the platform does not complete the failed-settlement lifecycle itself. DB phase, transactions, game entries, and operator events can remain unreconciled unless a user/operator manually refunds.
- **Remediation**: Add a timeout-refund worker for FlipYou, Pot Shot, and Close Call. It should detect eligible rounds from DB plus decoded account state, submit the relevant refund instruction, and reconcile DB rows idempotently.

### H-3 - Close Call settlement trusts the server-provided close price

- **Severity**: High
- **Area**: Oracle trust boundary
- **Evidence**: `closecall/src/instructions/settle_round.rs` accepts `close_price` and `close_price_expo` as instruction args and restricts settlement to `caller == round.server`. It does not verify a Pyth `PriceUpdateV2` account on-chain. `CloseCallConfig.pyth_feed_id` is stored but not enforced in `bet` or `settle_round`.
- **Impact**: A compromised or malicious server key can settle with arbitrary prices. Current safety is operator-key trust plus off-chain VAA archiving, not on-chain oracle verification.
- **Remediation**: Implement on-chain Pyth receiver verification for open and close prices, or add strong pre-broadcast controls that compare settle args to signed VAAs. Until then, document this as an explicit trusted-operator model.

### H-5 - Close Call settlement performs no sanity check on submitted close price

- **Severity**: High
- **Area**: Oracle trust boundary / fairness
- **Evidence**: `closecall/src/instructions/settle_round.rs` accepts `close_price` and `close_price_expo` from the caller and feeds them straight into win-condition logic. There is no positivity check, no exponent-vs-`open_price_expo` consistency check, and no acceptable-deviation bound versus `round.open_price`.
- **Impact**: Compounds H-3. Even without a malicious operator, an honest server bug (stale value, sign flip, exponent mismatch, zero) settles the round with a nonsense price and pays out the wrong winners. There is no on-chain second line of defense.
- **Remediation**: Reject non-positive prices, require `close_price_expo == round.open_price_expo` (or normalize), and bound `|close_price - open_price| / open_price` to a configurable max deviation. Pair with H-3's on-chain Pyth verification.

### H-4 - Close Call can report settlement success after DB persistence fails

- **Severity**: High
- **Area**: Backend state / accounting
- **Evidence**: After a successful on-chain `sendAndConfirm`, `closecall-clock.ts` wraps settlement persistence in an inner `try/catch`; the catch logs a warning and execution still returns `true`.
- **Impact**: The chain can be settled while `/closecall/history`, `/closecall/by-id`, `transactions`, `game_entries`, fee allocation, referrals, and events are missing or stale. Operators lose a hard failure signal.
- **Remediation**: Treat chain-success / DB-failure as a distinct non-success state. Return failure, enqueue a repair job, persist an operator event like `chain_settled_db_pending`, and alert.

## Medium Findings

### M-1 - Close Call backend payout rows do not mirror on-chain rounding

- **Area**: Accounting / stats / rewards
- **Evidence**: On-chain Close Call pays winners with integer math and gives the last winning entry the remainder. Backend persistence uses JS `number` and `Math.floor((entry / pool) * netPool)` for each winner.
- **Impact**: Actual SOL transfers can diverge from `transactions` and `game_entries` by rounding dust or precision loss. This can affect stats, leaderboards, referrals, rewards, and support.
- **Remediation**: Use bigint math and the same last-winner remainder rule/order as `settle_round`.

### M-2 - Pot Shot verification assumes static 500 bps fees

- **Area**: Public verification / fee governance
- **Evidence**: On-chain `claim_payout` reads `fee_bps` from `PlatformConfig`; `backend/packages/game-engine/src/potshot.ts` verifies `feeAmount` against static `FEE_CONSTANTS.TOTAL_BPS`.
- **Impact**: If platform fee config changes, honest Pot Shot settlements can fail client-side verification.
- **Remediation**: Include effective fee bps in the verification context/payload, or make fairness verification check only `payout + fee == total` when fee bps is unknown.

### M-3 - FlipYou / Pot Shot commit-reveal settlement depends on backend secret retention

- **Area**: Liveness / operations
- **Evidence**: On-chain state stores commitments, not secrets. Settlement requires the backend DB secret. Workers ignore or cannot settle on-chain locked PDAs that have no corresponding secret row.
- **Impact**: If DB insert/retention fails, normal settlement cannot happen. Recovery is timeout refund only.
- **Remediation**: Monitor locked on-chain PDAs with missing DB rows/secrets, backup secret material until terminal state, and make timeout-refund automation reliable.

### M-4 - `initialize_config` re-entry clears pause on FlipYou and Close Call

- **Area**: Operational controls
- **Evidence**: Because FlipYou and Close Call use `init_if_needed`, authorized re-calls of `initialize_config` overwrite config fields and set `paused = false`.
- **Impact**: Emergency pause can be unintentionally lifted by a config update/re-init path.
- **Remediation**: Do not mutate pause in initialize/update paths, or only set it on first init. Keep pause changes exclusively in `set_paused`.

### M-5 - Pot Shot settled-round API can underreport total pot

- **Area**: Verification payload / UX
- **Evidence**: `formatPotShotRound` initializes `totalAmountLamports` from `round.amount_lamports`, then only corrects it if a `settle_confirmed` operator event includes `totalAmountLamports`.
- **Impact**: If enrichment is missing, multi-entry settled rounds can report the creator's first stake as the total pot.
- **Remediation**: Persist total pool at settlement or compute it from entries instead of relying on optional operator event payloads.

### M-6 - Pot Shot `claim_payout` maps all entropy failures to one error

- **Area**: Operability / retries
- **Evidence**: `potshot/src/instructions/claim_payout.rs` maps every `read_slot_hash_entropy` failure to `PotShotError::EntropyTooShort`, unlike FlipYou's dedicated slot-not-reached / slot-expired mapping.
- **Impact**: Operators and clients cannot distinguish "too early" from "entropy expired", which affects retry classification and incident diagnosis.
- **Remediation**: Mirror FlipYou's entropy error mapping.

### M-7 - Game config decoders/encoders include ghost treasury fields

- **Area**: IDL/client/test infrastructure
- **Evidence**: `backend/src/worker/account-decoder.ts` types/encodes `treasury` on FlipYou, Pot Shot, and Close Call config decoders, but on-chain configs and checked-in IDLs do not contain treasury fields. Treasury now comes from `PlatformConfig`.
- **Impact**: Production round decoders appear mostly unaffected because config decoders are unused, but test helpers can encode account data that does not match real accounts, weakening test proof.
- **Remediation**: Remove treasury fields from game config decoder types/encoders and update test helpers to match committed IDLs.

### M-8 - Pot Shot create route lacks backend max wager validation

- **Area**: API bounds / consistency
- **Evidence**: FlipYou create validates min and max wager in the route schema. Pot Shot create validates only the minimum and relies on the program for the maximum.
- **Impact**: The chain still rejects above-max values, but the API does less early validation and behaves inconsistently across games.
- **Remediation**: Add the same max-wager schema bound as FlipYou and centralize wager constants.

### M-10 - Backend `PlatformConfig` cache never invalidates

- **Area**: Fee governance / settlement accounting
- **Evidence**: `backend/src/platform-config.ts:56` keeps a module-scope `_cache` populated on first call; `getPlatformConfig` only refetches if it is null, and the file's own comment states "Cache lives for the process lifetime — restart the backend to pick up on-chain config changes." `update_platform_config` on-chain has no notification path back to running backends.
- **Impact**: After `update_platform_config` lands, all settlement tx construction (treasury account, fee math) and DB accounting rows continue using the stale `feeBps`/`treasury` until every backend instance is restarted. On-chain enforcement will reject a stale-fee tx, so settlements then fail until restart, blocking lifecycle completion. Generalizes M-2's Pot Shot-specific concern to the whole stack.
- **Remediation**: Add a TTL (e.g. 30–60s) or invalidate on platform-program log/onAccountChange subscription. Expose `resetPlatformConfigCache` in an admin route for emergency flushes. Rolling restarts are not a sufficient operational answer.

### M-11 - Webapp hardcodes 500 bps fees in all three games

- **Status**: Out of scope for this repo (frontend is a separate project — see CLAUDE.md). Recorded so the rollout gap is tracked.
- **Area**: Quote / preview accuracy
- **Evidence**: User-facing quote paths hardcode 500 bps in FlipYou (`webapp/src/pages/flip-you/api.ts:122`), Pot Shot (`webapp/src/pages/pot-shot/api.ts:267`), and Close Call (`webapp/src/pages/close-call/types.ts:72`).
- **Impact**: A live `update_platform_config` change makes the UI quote/preview drift from real settlement payouts even when the backend (post-M-10 fix) reads correct values.
- **Remediation**: Hand off to the frontend team — surface effective `feeBps` via a public read endpoint or session bootstrap and consume it in all three game preview helpers. Backend should expose a stable read once M-10 lands so the frontend has a single source.

### M-9 - Pot Shot `distinct_players` vs entries vector — design choice

- **Status**: Accepted as design — not a remediation target.
- **Area**: Round lifecycle / fairness gating
- **Behavior**: `potshot/src/instructions/join_round.rs` increments `distinct_players` only when `!round.has_player(...)` and always pushes the entry. Repeat entries from the same wallet are intentionally allowed; `distinct_players` deliberately tracks unique wallets while `entries` tracks every weighted stake. The defined-but-unused `PlayerAlreadyInRound` variant (see L-3) reflects an earlier model and should be cleaned up there.
- **Implication**: Any gating that reads `distinct_players` (countdown, min-players-to-settle) is intentionally on unique wallets, not entry count. Documentation and operator tooling should reflect this.

## Low / Informational Findings

### L-1 - Retry state is process-local

- **Evidence**: `retry.ts` stores retry/finalized/timeout sets in memory.
- **Impact**: Restarts lose retry classification and can amplify duplicate work until DB/on-chain state catches up.
- **Remediation**: Drive idempotency from DB phase plus on-chain state, or persist retry cursor if needed.

### L-2 - Close Call pause blocks bets but not settlement

- **Evidence**: `bet` checks game pause; `settle_round` does not read `CloseCallConfig`.
- **Impact**: Likely acceptable if pause means "no new bets", but operators may assume pause stops all transfers.
- **Remediation**: Document pause semantics and keep settlement/refund allowed if intentional.

### L-3 - Unused / misleading on-chain plumbing

- **Evidence**: Shared `check_not_paused(global_paused, game_paused)` always receives `false` for global pause; `PlatformConfig` has no paused field. Pot Shot defines `PlayerAlreadyInRound` but repeated entries are allowed and the variant is unused.
- **Impact**: Audit noise and future misuse risk.
- **Remediation**: Remove unused parameters/variants or implement the intended behavior.

### L-4 - Legacy Pot Shot `start_spin` helper can mislead tooling

- **Evidence**: Current Pot Shot program has no `start_spin`, but an older devnet fallback helper still constructs a `start_spin` discriminator.
- **Impact**: If reachable, it will fail against the current IDL/program and confuse smoke-test diagnosis.
- **Remediation**: Remove or archive the helper.

## Test And Proof Gaps

### Verification blockers observed

- `NO_DNA=1 ./scripts/verify` failed before Anchor because backend tests expect a local Postgres database/schema that is not present (`taunt_bet_dev` and several relations missing).
- `NO_DNA=1 ./scripts/verify --anchor` built programs, then failed before test execution because `solana/tests/closecall.ts` uses a default Anchor import shape and crashes destructuring `BN`.
- Backend lint completed with one warning: unused eslint-disable in `backend/src/contracts/api-envelope.ts`.

These are proof blockers. They should be fixed before claiming full verification.

### Highest-priority missing tests

1. Pot Shot `claim_payout` in bankrun or equivalent deterministic local harness.
2. Backend timeout-refund worker coverage for all three games, including DB reconciliation.
3. Close Call DB-persist-fails-after-chain-settle repair behavior.
4. Close Call payout persistence matching on-chain remainder math.
5. FlipYou and Close Call config frontrun tests.
6. FlipYou and Close Call re-initialize-while-paused tests.
7. Platform fee update then settle for all three games.
8. Close Call wrong settler, double settle, max entries, exponent mismatch, paused bet rejection.
9. Pot Shot dynamic-fee verification and max-wager API validation.
10. Devnet E2E replacement or re-enablement for skipped FlipYou/Pot Shot lifecycle tests.

## Areas Reviewed With No Material Issue Found

- Shared escrow helpers check balances before debits and drain/zero PDAs on close.
- `read_platform_config` validates owner/discriminator and caps `fee_bps`.
- Commit-reveal derivation binds secret, entropy, PDA, and algorithm version.
- SlotHashes parser handles skipped slots with bounded fallback scan.
- FlipYou settlement cross-checks treasury, creator, opponent, and server accounts.
- Pot Shot and Close Call remaining account lists validate length and pubkey order before transfers.
- Close Call on-chain settlement uses `u128` intermediates and last-winner dust cleanup.
- Checked-in game IDLs match program IDs in `declare_id!` and `Anchor.toml`; `solana/target/idl` is absent in this checkout, so checked-in backend IDLs are the available source.

## Follow-Up Queue

1. Fix verification blockers: backend test DB/schema setup and `closecall.ts` Anchor import.
2. Replace `init_if_needed` config initialization for FlipYou and Close Call or add hard authority guards.
3. Implement backend timeout-refund automation and DB reconciliation.
4. Harden Close Call oracle path or explicitly ship with trusted-operator controls and signed-VAA enforcement.
5. Make Close Call DB persistence exact and repairable after chain success.
6. Make Pot Shot verification fee-aware and fix settled total-pool reporting.
7. Clean ghost config decoder fields and stale helper code.
8. Add the missing tests listed above, then re-run full verification.

---

## Resolution Log (2026-05-06)

| Finding | Status | Notes |
|---------|--------|-------|
| H-1 | Fixed | FlipYou, Close Call, and Pot Shot `initialize_config` now use strict `init` AND require the program's BPF-loader upgrade authority to co-sign (`Program<'info, T>` + `ProgramData` constraint). The first-init front-run race is closed completely: an attacker without the upgrade-authority key cannot land a config-creation tx even on a fresh deploy. The chosen game `authority` is a separate signer, set once at first init and immutable thereafter. Close Call gained an `update_config` ix for tunable fields (`pyth_feed_id`, `betting_window_secs`, `max_entries_per_side`) so post-init changes don't require redeploy. Tests cover attacker-init rejection (`ConstraintRaw`) and re-init rejection (system program "already in use") in all three suites. |
| H-2 | Spec'd | Future work tracked in `docs/specs/309-timeout-refund-worker/spec.md`. |
| H-3 | Documented | Accepted as operator-trust model. See `solana/README.md` § Known Issues. Pyth on-chain verification deferred to CC-9. |
| H-4 | Fixed | `closecall-clock.ts` now returns `false` when the DB persist throws after a chain-confirmed settle, writes a `chain_settled_db_pending` operator event with a self-contained replay payload (round id, sig, prices, entries, pools, fee bps), and the new `repairPendingCloseCallSettlements` sweep at the top of every tick replays the persist from that payload. Successful replays emit `chain_settled_db_done`; after `MAX_REPAIR_ATTEMPTS = 5` consecutive failures, `chain_settled_db_stuck` is emitted for paging. All persist writes are idempotent (`transactions` UNIQUE index + `ON CONFLICT DO NOTHING`, `game_entries` UPSERT, phase-guarded `settleCloseCallRound`). |
| H-5 | Fixed | `settle_round.rs` now enforces `close_price > 0`, exponent match, and 50% drift cap (5000 bps). |
| M-1 | Fixed | `closecall-clock.ts` settlement rows use bigint with last-winner remainder mirroring `settle_round.rs`. |
| M-2 | Fixed | `verifyLordRound(event, players, feeBps?)` strict-checks fee when provided; otherwise verifies `payout + fee == total` plus 50% sanity ceiling. |
| M-3 | Documented | Operational expectation captured in `solana/README.md` § Known Issues. Monitoring is part of the timeout-refund spec (309). |
| M-4 | Fixed | FlipYou and Close Call `initialize_config` only set `paused = false` on first init; re-entry preserves pause. |
| M-5 | Fixed | `formatPotShotRound` computes `totalAmountLamports` from persisted entries; settle-event payload may still override. |
| M-6 | Fixed | Pot Shot `claim_payout` mirrors FlipYou's `map_entropy_error`; new variants `EntropySlotExpired` (6113), `EntropySlotNotReached` (6114). |
| M-7 | Fixed | Removed `treasury` from `DecodedFlipYouConfig`, `DecodedLordConfig`, `DecodedCloseCallConfig`, their decoders, `encodeFlipYouConfig`, and the integration test helper. |
| M-8 | Fixed | Pot Shot create route now enforces `.max(MAX_WAGER_LAMPORTS = 100 SOL)`. |
| M-9 | Documented | Accepted as design — duplicate entries are intentional. See `solana/README.md` § Known Issues. |
| M-10 | Documented | Captured in `solana/README.md` § Known Issues. Cache TTL/invalidation remains future work. |
| M-11 | Open | Out of scope for this repo — tracked for the frontend team. |
| L-1 | Open | Pending — durable retry state. |
| L-2 | Documented | See `solana/README.md` § Known Issues. |
| L-3 | Fixed | Removed unused `global_paused` parameter from `check_not_paused`, dropped `PauseError::PlatformPaused` and `PotShotError::PlayerAlreadyInRound`. Subsequent `PotShotError` codes shifted by one (regenerate IDLs and redeploy). |
| L-4 | Fixed | Deleted `e2e/devnet/helpers/potshot-vrf-fallback.ts` and `cleanup-stale-rounds.ts` — both targeted the pre-2026-04 tiered + Orao architecture. |
