# Solana Games Audit Prep Plan

> **For agentic workers:** Review this packet before starting any game-specific pass. Keep findings evidence-based: every issue needs a code reference, exploit path or invariant break, severity, and a proposed verification test.
>
> **For external auditors:** Sections [Deployment Posture](#deployment-posture), [Threat Model](#threat-model), and [Trust Assumptions](#trust-assumptions-and-residual-risks) describe what is being audited, who we defend against, and what we deliberately accept as trusted. The [Open Questions for External Audit](#open-questions-for-external-audit) section is the list we want your judgment on.

**Goal:** Reduce findings before external audit by running deep, bounded internal reviews of the three shipped Solana games — FlipYou, Pot Shot, and Close Call — so the external audit can focus on the subtle protocol, math, oracle, and Solana-runtime questions that internal review cannot answer with confidence.

**The threat being audited:** the programs are intended for mainnet deployment with real player funds. Every invariant in this packet exists to prevent funds loss, stuck funds, unfair outcomes, or production-liveness failure under that deployment.

---

## Deployment Posture

This section answers questions every external auditor asks in the first hour. Fill in concrete values before sending the packet out.

### Programs Being Audited

| Program | Devnet ID | Cluster Audited | Target Cluster |
|---------|-----------|-----------------|----------------|
| `flipyou` | `sCLNVCC3x85cTvTHawJd6ZwiHpRRFTHEsE1NibyRg2Z` | devnet | mainnet-beta |
| `potshot` | `AisGseQmbxT1AWVrEWty6Swsr3vbwipDbYQyVKFhidby` | devnet | mainnet-beta |
| `closecall` | `AmBWwLNXsGocN8fhBhwGa75vZKXaMyyW6Gan8j6uYLLN` | devnet | mainnet-beta |
| `platform` | `91RFAVsAu5DYgeHpQR1Ypjv9QUhQR2iX7AuMsKeTX3tr` | devnet | mainnet-beta |

> **Action before sending packet:** mainnet program keypairs will differ from devnet. Document final mainnet IDs and confirm `declare_id!()`, `Anchor.toml`, and IDL JSON match (`./scripts/check-program-ids.sh`).

### Custody and Authority Model

Document each of the following before sending to external audit. "TBD" is acceptable as long as it is filled in before mainnet.

| Authority | Who holds it | Custody mode | Rotation plan |
|-----------|--------------|--------------|---------------|
| BPF program upgrade authority (per program) | TBD | TBD (cold key / multisig / immutable) | TBD |
| `PlatformConfig.authority` (admin: platform fee BPS and treasury) | TBD | TBD | TBD |
| `PlatformConfig.treasury` (fee recipient) | TBD | TBD | TBD |
| `CloseCallConfig.authority` (admin: pause/unpause, Pyth feed ID, betting window, `max_entries_per_side`) | TBD | TBD | TBD |
| Backend settlement signer (co-signs creation, reveals secret on settlement) | TBD | TBD (HSM / hot wallet) | TBD |
| Pyth account custody | external (Pyth Network) | n/a | n/a |

External auditors should be able to read this table and know which compromise scenarios to simulate.

### External Dependencies

| Dependency | Devnet | Mainnet target | Failure mode if down |
|------------|--------|----------------|----------------------|
| Pyth BTC/USD price account | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | TBD | Close Call settlement blocked -> timeout refund path must work |
| Pyth feed ID (stored in `CloseCallConfig.pyth_feed_id`) | TBD (hex) | TBD (hex) | Wrong feed accepted on settle if not validated on-chain |
| RPC provider (used by backend settlement worker) | dRPC | TBD | Settlement delays → timeout refund must remain available |
| Slot leader at `target_entropy_slot` (FlipYou, Pot Shot) | external (validator set) | external | Colluding validator can choose `SlotHash` value — see Trust Assumptions |

## Threat Model

The packet defends against the following actors. Each invariant in the per-game plans should be traceable to one or more rows.

| Actor | Capabilities we defend against | Constraints we rely on |
|-------|-------------------------------|------------------------|
| **Player A** (any one wallet) | Submit any valid client tx; choose match parameters; refuse to reveal | On-chain account constraints; commit-reveal; timeout refund |
| **Player B / opponent** | Same as Player A; collude with A; sign late or never | On-chain constraints; timeout refund; one-wallet-one-bet (Close Call) |
| **Sybil player** (one party with many wallets) | Split funds across N wallets to evade per-wallet limits or bias weighted draws | Pot Shot: `MAX_ENTRIES = 64`; Close Call: `max_entries_per_side` per-wallet check; weighted-draw math |
| **Backend operator (honest)** | Generates secrets, builds settlement tx, holds settlement signer key | Trusted within the documented hybrid-fairness model |
| **Backend operator (compromised key)** | Sign arbitrary settlement tx with backend signer; reveal/withhold any secret; supply arbitrary Close Call prices until on-chain Pyth validation lands | FlipYou/Pot Shot: on-chain validation of commitment, PDA, side, amount, entropy slot. Close Call: on-chain Pyth validation is To Do Soon. Treasury fixed in `PlatformConfig`; pause does not block settlement of in-flight rounds |
| **Validator at `target_slot`** (FlipYou, Pot Shot) | Choose `SlotHash` value at slot they produce | See Trust Assumptions — biased outcome possible if colluding with backend |
| **Pyth publisher** (Close Call) | Publish stale/wrong/missing prices | Current draft target: backend price fetch plus upcoming on-chain feed-ID/freshness checks; one-sided / equal-price refund paths |
| **Treasury keyholder** | Spend collected fees | Out of program scope; treasury custody is a documented operational risk |
| **Platform admin** (`PlatformConfig.authority`) | Pause programs, change fee BPS, change treasury, force-close stuck rounds | Pause must not strand in-flight settlement; treasury change must not redirect in-flight winnings; force-close must refund principal, never confiscate |
| **Permissionless caller** (anyone) | Trigger `timeout_refund` after deadline | Deadline check; per-round phase guard; remaining-account ownership checks |
| **RPC provider** | Censor / reorder / delay tx; serve stale account state | Timeout refund; settlement retry worker; health checks for stuck settlement |
| **Frontend (transaction construction)** | Construct partial tx the user signs | **Out of audit scope** — frontend is a separate project. Residual risk: a malicious frontend can show one match and sign another. Documented as accepted risk. |

## Trust Assumptions and Residual Risks

These are intentional — listed here so they are not refiled as findings, and so the external auditor knows where the trust boundary actually sits.

1. **Backend selective non-reveal (FlipYou, Pot Shot).** A compromised backend signer that knows the secret in advance can choose not to reveal a secret that produces an outcome unfavorable to the backend/operator's preferred result. Mitigation: timeout refund returns principal to all players. Residual risk: backend can grief by forcing every match to time out. Monitoring requirement: settlement-success-rate alert.

2. **Validator + backend collusion at `target_entropy_slot` (FlipYou, Pot Shot).** The validator producing block at `target_entropy_slot` controls that slot's hash. If they collude with a backend that knows the secret, they can bias the outcome by trying multiple block contents until the `SlotHash` produces the desired result. Mitigation: `SlotHashes` is constrained on-chain to the canonical sysvar, and the secret is committed before the slot is known. Residual risk: a determined adversary controlling both surfaces can bias outcomes within one block of compute.

3. **Close Call price source — Option A (backend-trusted, VAA archival).** The on-chain program accepts open/close prices as instruction arguments supplied by the backend; it does not validate a Pyth `PriceUpdateV2` account today. The trust surface is contained by two complementary measures: (a) `settle_round` is restricted to `caller == round.server` so an attacker without the server signer cannot pick the price (CC-1 mitigation in `solana/programs/closecall/src/instructions/settle_round.rs`); (b) every settled round's boundary VAA is archived in `closecall_candles.hermes_vaa` and exposed via `GET /closecall/by-id/:roundId` (`verification.boundaryVaaBase64` + `boundaryFeedId` + `boundaryMinuteTs`), so anyone can replay the captured VAA against Pyth's guardian set off-chain and verify the settled `closePrice` matches what Pyth signed at the candle boundary. The settlement path uses the *captured boundary* (cached or persisted at `minute_ts + 60`), not a fresh post-candle Hermes fetch (CC-2). The residual trust is operator key custody plus Pyth signature authenticity. **Upgrade path (CC-9):** replace instruction-arg prices with on-chain `PriceUpdateV2` validation via `pyth-solana-receiver-sdk` (post-update + consume + close, net rent zero). With cryptographic on-chain verification the caller restriction can be relaxed to permissionless and the VAA archival becomes belt-and-suspenders. Tracked in `docs/specs/100-close-call/spec.md` FR-3.

4. **Backend signer custody.** A leaked backend signer key allows any settlement transaction the program's on-chain checks would otherwise accept. The on-chain checks bind commitment, PDA, side, and amount, but cannot prevent a leaked-key attacker from settling rounds in any order they choose with any secret matching the stored commitment.

5. **Platform admin authority.** `PlatformConfig.authority` can pause, change fee BPS, change treasury, and force-close. A compromised admin can grief liveness or redirect future fees. They cannot redirect *in-flight* winnings — winners' payouts are computed from the round's stored amounts and paid to the round's stored player keys, not to the current treasury.

6. **Live platform fee and treasury config at settlement.** FlipYou and Pot Shot read `PlatformConfig.fee_bps` and `PlatformConfig.treasury` at settlement time, not at round creation/join time. This keeps fee policy globally adjustable, but it means in-flight rounds settle under the current platform config rather than a per-round snapshot. Snapshotting fee terms would require on-chain account layout changes, IDL updates, backend decoder updates, and deployment handling for in-flight accounts. Mitigation: `fee_bps` is capped by `MAX_FEE_BPS`, treasury changes are admin-only, and this behavior must be disclosed before external audit. Open question: whether production should freeze fee/treasury per round before mainnet.

7. **Frontend transaction construction.** The frontend is out of scope. A malicious frontend can mis-display match parameters before the user signs. Players must verify match terms in their wallet UI. This is a UX problem, not an on-chain problem, but it is the smallest residual risk worth naming.

8. **RPC censorship of timeout refund.** If the chosen RPC provider refuses to forward `timeout_refund` calls, players cannot recover funds until they switch providers. `timeout_refund` is permissionless, so any RPC works.

---

## Architecture

The audit is split into one shared baseline pass plus one focused pass per game. Each game pass reviews on-chain code first, then the backend paths that supply secrets, prices, settlement transactions, and verification payloads.

**Tech stack:** Anchor programs in `solana/programs`, shared Rust helpers in `solana/shared`, bankrun/mocha tests in `solana/tests`, Hono/TypeScript backend settlement code in `backend`.

## Scope

### In Scope

- `solana/programs/flipyou`
- `solana/programs/potshot`
- `solana/programs/closecall`
- `solana/programs/platform`
- `solana/shared`
- Game-specific tests in `solana/tests`
- Backend create, settlement, retry, health, verification, and oracle/entropy paths needed to understand trust assumptions
- Root scripts that verify fee parity, program IDs, IDL sync, and full test lifecycle

### Out of Scope

- Frontend implementation, except as read-only context for player flow impact
- New game specs and deferred games
- Production migrations, deployment, or key rotation
- Refactors that are not needed to fix a confirmed audit risk
- Pyth Network internal correctness (treated as external dependency)

## Execution Order

Run the work in this order:

1. **Threat-model review.** Confirm the [Threat Model](#threat-model) and [Trust Assumptions](#trust-assumptions-and-residual-risks) sections are complete, accurate, and signed off internally. Every later finding should map back to one of these rows.
2. **Findings register setup.** Create or update `findings.md` before any review starts.
3. **Shared money-flow baseline.** `solana/shared`, `solana/programs/platform`, fee routing, pause behavior, timeout behavior, escrow helpers, close/rent assumptions, `PlatformConfig` admin paths (fee BPS and treasury rotation), and game-config admin paths.
4. **Close Call pass.** Backend-supplied price settlement today, upcoming on-chain Pyth price validation, proportional payouts, invalid-round refunds, and remaining-account safety.
5. **Pot Shot pass.** Weighted-entry commit-reveal settlement, aggregate refunds, entry accounting, and remaining-account safety.
6. **FlipYou pass.** Two-player commit-reveal escrow, equal-wager settlement, cancel, and timeout refund.
7. **Cross-game consistency pass.** Confirm every game uses the shared helpers identically: fee transfer order, escrow open/close pattern, pause guard placement, timeout deadline computation, secret-reveal ordering. Divergence between games is the most common source of bugs the per-game passes miss.
8. **Compute and account-load reality check.** Run max-entries Pot Shot and max-pool Close Call settlements on real devnet. Capture compute units used and account count. Confirm settlements fit under the 1.4M CU per-tx limit and the address-loading limit with the LUT strategy in use.
9. **Consolidation pass.** Dedupe findings, classify fix priority, rerun verification, and prepare the external-auditor package.

This order is intentionally risk-first, not simplicity-first. Close Call and Pot Shot have more complex payout/refund surfaces than FlipYou, and Solana bugs hide in lamport movement, remaining-account ordering, account close behavior, and fee/refund edge cases.

## Codex Budget

Two passes. Do not collapse them into one — the shallow pass tells the deep pass where to look.

### Pass 1 — Shallow Breadth (5h)

| Slot | Target | Budget | Deliverable |
|------|--------|--------|-------------|
| 1 | Shared money-flow baseline | 45 min | Shared lamport, fee, pause, timeout, close/rent risks |
| 2 | Close Call | 75 min | Findings against `closecall.md`, especially oracle and payout/refund paths |
| 3 | Pot Shot | 75 min | Findings against `potshot.md`, especially weighted accounting and remaining accounts |
| 4 | FlipYou | 60 min | Findings against `flipyou.md`, especially commit-reveal and escrow paths |
| 5 | Cross-game consistency | 30 min | Diffs in shared-helper usage across games |
| 6 | Triage | 15 min | Sort shallow findings into deep-pass focus areas |

### Pass 2 — Deep Targeted (5h)

Spend after the shallow pass. Allocate the full 5 hours across the highest-suspicion surfaces identified in shallow triage. Typical allocation:

- 2h on Close Call price-source trust boundary + proportional payout math (this is where most of the funds-loss surface lives)
- 1.5h on Pot Shot weighted draw + remaining-account safety
- 1h on shared escrow / fee helpers if shallow pass surfaced doubts
- 0.5h on FlipYou settlement edge cases or commit-reveal binding

Stop each slot when its budget expires. Do not let one uncertain finding consume the whole review — record it in the **Open Investigation** bucket of `findings.md` with the exact files and invariant involved.

### Codex Prompting Rules

Do not ask Codex to "audit this repo" or run a broad review across all games. Use narrow prompts with one surface and one expected output.

**Good prompts:**

- Audit only `settle_round.rs` remaining-account payout safety. Produce exploit paths, missing tests, and severity.
- Audit only Pot Shot refund aggregation when a wallet has multiple entries. Check whether malicious remaining-account ordering can steal or duplicate refunds.
- Audit only FlipYou settlement lamport movement, including fee transfer, winner payout, rent handling, and account close.
- Audit only shared fee and escrow helpers for overflow, account substitution, and inconsistent fee/refund behavior across games.
- Audit only `claim_payout.rs` for the cumulative-range math: prove `winning_offset < total_amount_lamports` and that no entry is ever skipped or double-counted.

Each Codex pass must write results into `findings.md` using the template and categories defined there. Treat `findings.md` as the source of truth for finding format.

### Out of Scope for Findings

The following are **not** valid findings for this packet. Do not file them; surface them as separate workstreams if needed.

- Code style, naming, formatting, comment density, lint warnings.
- Test-coverage observations that are not tied to a specific invariant.
- Refactor suggestions that do not fix a confirmed risk.
- Hypothetical "what if Anchor changed" findings without a concrete current-version exploit.
- Performance optimizations that are not liveness-blocking.
- Anything already documented in [Trust Assumptions](#trust-assumptions-and-residual-risks).

If a Codex pass produces output in these categories, drop it. The point of the register is to be the auditor-shippable artifact; noise dilutes signal.

## Shared Review Checklist

### Account And Authority Invariants

- Confirm every PDA seed matches the documented seed and every account constraint binds the instruction to that seed.
- Confirm config authority can only pause, unpause, initialize, or force-close where intended.
- Confirm `PlatformConfig` is canonical for treasury and fee BPS, and game config is canonical for game-specific values such as Close Call `pyth_feed_id` and `max_entries_per_side`.
- Confirm no game can redirect fees to an arbitrary account through unchecked treasury accounts.
- Confirm pausing blocks new value entering the game while preserving settlement, refunds, and force-close recovery.
- Confirm BPF upgrade authority is documented and matches the [Deployment Posture](#deployment-posture) custody table; flag if any audited program is mainnet-targeted with unexpected upgrade-authority configuration.
- Confirm config updates cannot strand in-flight rounds (`update_platform_config` for treasury/fee changes; Close Call config updates for Pyth feed and max-entry changes).

### Lamport Movement

- Trace every lamport path from player deposit to payout, refund, fee, rent return, and account close.
- Confirm every losing/refund path returns exact principal where the spec requires it.
- Confirm fee is collected only on decisive settlement paths.
- Confirm account close behavior cannot strand rent or drain unrelated accounts.
- Confirm arithmetic cannot overflow or silently underpay under max wager and max-entry conditions.
- Confirm state mutations occur **before** external lamport transfers where the program directly manipulates `**lamports.borrow_mut()`. Any "transfer first, mutate state after" path is a bug-shape worth flagging even if Anchor's atomicity covers it.

### State Machine

- Enumerate valid phase transitions for each program.
- Confirm every instruction rejects invalid phases.
- Confirm timeout and force-close cannot run before their intended deadline or authority condition.
- Confirm double settlement, double refund, double close, and late entry paths are rejected.

### Fairness And Oracle Inputs

- For FlipYou and Pot Shot, verify the commitment is stored before target entropy is known.
- Verify result derivation binds secret, entropy, game PDA or round identifier, and algorithm version.
- Verify `SlotHashes` access cannot be substituted with attacker-controlled entropy.
- For Close Call, file the missing on-chain Pyth validation as To Do Soon until implemented. Once implemented, verify the Pyth feed ID stored in `CloseCallConfig` is checked against every settlement price-update account; verify staleness window is enforced; verify exponent handling.
- Confirm backend-served verification payloads do not expose secrets before settlement (must be tested, not just code-reviewed).

### Compute And Account-Load Limits

- Pot Shot at `MAX_ENTRIES = 64` and Close Call at `max_entries_per_side` (configurable) iterate remaining-accounts in settlement and refund paths. The hard ceiling is 1.4M CU per transaction and the V0 + LUT account-loading limit.
- Required: run `claim_payout` with 64 distinct-player Pot Shot entries on devnet; capture CU usage. Run a Close Call settlement at the configured `max_entries_per_side` ceiling on each side; capture CU usage and remaining-account count.
- Confirm headroom is at least 20% under both limits. A round whose settlement does not fit is permanently stuck (timeout-refund is the only recovery path, and the same compute limits apply).

### Backend Trust Boundary

- Identify which off-chain actions are trusted and which on-chain checks constrain them.
- Confirm secrets are generated before creation, revealed only after settlement, and persisted for retry/verification.
- Confirm retry workers distinguish transient and permanent settlement failures.
- Confirm health checks expose stuck settlement, low signer balance, and worker liveness.
- Confirm backend request validation mirrors on-chain constraints without replacing them.
- Confirm the verification endpoint test asserts `secret = null` while phase ≠ settled, and `secret = revealed_value` after settlement — automated, not code-review.

## Required Commands

Run targeted on-chain verification during each game pass:

```bash
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/flipyou.ts)
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/potshot.ts)
(cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/closecall.ts)
```

Run backend verification for the routes the packet references:

```bash
(cd backend && pnpm test)
(cd backend && pnpm typecheck)
(cd backend && pnpm lint)
```

Run the cross-repo invariants:

```bash
./scripts/check-program-ids.sh
./scripts/check-fees.sh
./scripts/verify
```

Compute-budget reality check (run on real devnet, not bankrun):

```bash
# Pot Shot: 64 distinct-player round, settle, capture CU
# (See potshot.md Task 7 for the exact recipe.)

# Close Call: max-entries-per-side round, settle, capture CU
# (See closecall.md Task 7 for the exact recipe.)
```

## Finding Format

Use the template and status buckets in [findings.md](findings.md) for every finding. This README describes scope and execution; `findings.md` is the source of truth for finding fields and categories.

## Open Questions For External Audit

Lifted from the per-game plans. The external auditor should explicitly weigh in on each.

### FlipYou

- Is commit-reveal + `SlotHashes` sufficient for a two-player wager where the backend can choose whether to reveal?
- Are lamport close semantics and rent surplus treatment acceptable and documented clearly enough?
- Are PDA seeds and account constraints strong enough to prevent account substitution in every instruction?
- Should the audit include backend secret custody and settlement worker behavior as part of the threat model?

### Pot Shot

- Is the cumulative weighted selection implementation unbiased and boundary-safe enough for lamport-weighted entries?
- Are remaining-account payout and refund patterns safe under duplicate players and malicious account ordering?
- Does the countdown-based target entropy slot create any exploitable timing or liveness issue?
- Is `MAX_ENTRIES = 64` compatible with worst-case compute and account-load limits on the target cluster?

### Close Call

- Is the planned on-chain Pyth validation model strong enough for the production trust boundary, and what residual backend price-source trust remains after implementation?
- Should minute alignment be enforced on-chain, or is backend-only alignment acceptable?
- Is proportional payout rounding acceptable, and where should dust go?
- Are remaining-account payout/refund paths safe at the configured `max_entries_per_side` on both sides?
- Should settlement authority be permissionless, server-only, or current backend-triggered with on-chain validation?

### Cross-Cutting

- Is the SlotHashes-based entropy model acceptable for production wagers given the validator-collusion residual risk?
- Are config updates safe to invoke while rounds are in flight, including platform fee/treasury changes and Close Call feed/max-entry changes?
- Is the BPF program upgrade authority custody plan adequate for production?

## External Auditor Packet

Before sending to an external auditor, prepare:

- Current commit SHAs for root, `solana`, and `backend`.
- Mainnet program IDs and devnet program IDs side-by-side; confirm `./scripts/check-program-ids.sh` is green for each cluster.
- Cluster being audited and target cluster.
- IDLs for `flipyou`, `potshot`, `closecall`, and `platform`.
- BPF program upgrade-authority configuration (per program, per cluster).
- `PlatformConfig` snapshot per cluster: `authority`, `treasury`, `fee_bps`, paused state.
- Close Call config snapshot per cluster: `authority`, `pyth_feed_id` (hex), `betting_window_secs`, `max_entries_per_side`, paused state.
- Pyth feed configuration: account address per cluster, feed ID hex, freshness window the program enforces after on-chain validation is implemented.
- Backend signer custody description.
- Specs: `docs/specs/001-flip-you/spec.md`, `docs/specs/101-pot-shot/spec.md`, `docs/specs/100-close-call/spec.md`, `docs/specs/005-hybrid-fairness/spec.md`, `docs/specs/006-fairness-backend/spec.md`, and `docs/DESIGN_REFERENCE.md`.
- Test commands and expected environment notes from `solana/CLAUDE.md` and `backend/CLAUDE.md`.
- Compute-budget evidence: CU usage for max-entries Pot Shot settlement, max-pool Close Call settlement, worst-case timeout refund.
- Known trusted components: backend signer, secret store, Pyth price source, RPC provider, config authority, treasury.
- Known limitations and open questions discovered during these internal passes (this packet's [Trust Assumptions](#trust-assumptions-and-residual-risks) and [Open Questions](#open-questions-for-external-audit) sections).
- Disclosure / bug-bounty / NDA terms agreed with the auditor before code share.
