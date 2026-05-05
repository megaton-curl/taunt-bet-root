# FlipYou Audit Pass — Summary

**Pass type:** Internal audit-prep, FlipYou-only.
**Plan followed:** `docs/audits/solana-games-audit-prep/flipyou.md` (Tasks 1–6).
**Scope:** `solana/programs/flipyou`, `solana/programs/platform`, `solana/shared`,
backend create + settlement (`backend/src/routes/create.ts`,
`backend/src/worker/settle-tx.ts`, `backend/src/worker/settlement.ts`,
`backend/src/fairness.ts`), `solana/tests/flipyou.ts`.
**Out of scope per CLAUDE.md:** `webapp/`, `waitlist/` (read-only references).

## TL;DR

The on-chain FlipYou program is small, readable, and the lamport-flow
invariants for the *successful* paths hold up. Three issues block sending the
audit packet in its current shape:

1. **Backend computes `winner` from the wrong bytes of the SlotHashes sysvar
   (FY-1).** The off-chain settlement worker reads
   `entropyInfo.data.subarray(0, 32)`, which is `count(8) || newest_slot(8) ||
   first_16_bytes_of_first_hash(16)` — not a hash. The on-chain settle reads
   the entropy at `target_slot` correctly, so payouts are correct, but the DB
   `winner` / `result_hash` / `result_side` (and therefore the public
   `/flip-you/verify/:pda` response) disagree with on-chain reality ~50% of the
   time. Funds OK, public-API contract violated. The bug also exists in the
   Pot Shot settle path — same call site idiom.
2. **`join_match` does not enforce pause; the test suite asserts it does
   (FY-2).** `tests/flipyou.ts` is therefore failing today
   (`24 passing, 2 failing` in the bankrun run captured during this pass). An
   external auditor cannot be handed a red test suite.
3. **`settle` returns rent to `caller`, while `cancel_match` and
   `timeout_refund` return rent to `server` (FY-3).** The existing test
   asserts the cancel/timeout pattern; settle violates it. Either implementation
   or test is wrong; both ship in the audit packet.

The remaining findings are operational hygiene and clarification work
(timing windows, error-code reuse, doc drift, missing automated tests for the
verification endpoint).

## Test Run Captured

Command: `cd solana && pnpm exec mocha --require tsx/cjs -t 1000000 --exit tests/flipyou.ts`

Result on this commit: **24 passing, 2 failing**.
- ✗ `flipyou › join_match › rejects join while game is paused` (see FY-2)
- ✗ `flipyou › settle › permissionless settle — third party with valid secret succeeds` (see FY-3)

Both failures are diagnostic — they reveal mismatch between code and the
behavior the test asserts. They are not red herrings.

## Findings Index (see `claude_findings.md` for full bodies)

| ID | Severity | Category | Subject |
|----|----------|----------|---------|
| FY-1 | HIGH | Must Fix Before External Audit | Backend reads wrong bytes from SlotHashes sysvar |
| FY-2 | HIGH | Must Fix Before External Audit | `join_match` does not enforce pause; test asserts it does |
| FY-3 | MEDIUM | Needs Test Proof | `settle` rent-refund target inconsistent with cancel/timeout |
| FY-4 | MEDIUM | Needs Test Proof | `timeout_refund` mutates phase after lamport transfers |
| FY-5 | MEDIUM | Ask External Auditor | `read_slot_hash_entropy` skip-window scan radius is ±8 |
| FY-6 | LOW | To Do Soon | Resolve timeout (15 min) >> SlotHashes window (~3.5 min) |
| FY-7 | LOW | Needs Test Proof | Verification endpoint secret-leak not test-asserted |
| FY-8 | LOW | To Do Soon | `EntropySlotExpired` error reused for "not yet reached" |
| FY-9 | LOW | Document As Trust Assumption | `initialize_config` uses `init_if_needed` |
| FY-10 | INFO | To Do Soon | `solana/CLAUDE.md` program IDs drift from source |
| FY-11 | INFO | Document As Trust Assumption | `creator == server` not rejected in `create_match` |

## What I Confirmed Holds

- PDA seeds for `FlipYouMatch` (`["match", creator, match_id]`) and
  `FlipYouConfig` (`["flipyou_config"]`) match `Anchor.toml`, `declare_id!`,
  and the IDL — for FlipYou specifically. `./scripts/check-program-ids.sh`
  exists for this gate (CLAUDE.md doc drift in FY-10 is separate).
- `create_match` validates wager bounds (`validate_wager`), side
  (`is_valid_side`), and binds the server signer to
  `FlipYouConfig.authority`.
- `join_match` rejects same-wallet self-join and rejects join when phase
  isn't `Waiting`.
- `settle` checks `m.phase == Locked`, validates the SlotHashes account
  via `#[account(address = SLOT_HASHES_ID)]`, validates the platform
  config via `read_platform_config` (owner + discriminator + fee cap),
  and binds caller-supplied `creator` / `opponent` / `treasury` to the
  match-stored values.
- `cancel_match` only allows `Waiting` and binds `server` against
  `flipyou_match.server`.
- `timeout_refund` is permissionless after the deadline, refunds both
  sides their exact entry, and binds all three player keys.
- `update_platform_config` clamps `fee_bps <= MAX_FEE_BPS = 1000`, so
  fee-overflow underflow in `calculate_net_payout` is unreachable as
  long as the platform program is the canonical fee source (which
  `read_platform_config` enforces via owner + discriminator).
- The on-chain `read_slot_hash_entropy` correctly extracts the hash at
  `target_slot` — the off-chain bug in FY-1 is purely a backend reading
  mistake.
- Account closure semantics: settle / cancel / timeout all `close_pda`
  (zero data, drain lamports). Subsequent re-entry on the same PDA fails
  on account-not-found, so double-settle / double-refund / settle-after-cancel
  paths are rejected by the runtime, not by phase guards.
- Commit-reveal binding domain: `derive_result(secret, entropy, match_pda,
  algo_ver)` salts with the match PDA, so cross-match secret reuse cannot
  steer outcomes.

## Suggested Triage Before External Packet Ships

In dependency order (each unlocks the next):

1. Fix FY-1. Add an integration test that uses a real-shape SlotHashes
   buffer and asserts backend == on-chain `result_hash`. This is the only
   public-API correctness defect.
2. Decide pause-on-join contract (FY-2). Update either `join_match.rs` or
   the test, then push the bankrun suite back to green.
3. Decide settle rent destination (FY-3). Same: code or test must move.
4. Add the verification-endpoint pre-settle test (FY-7).
5. Sweep the cross-game settle path for FY-1 in Pot Shot
   (`settleLordRound`) and the rent-destination question in
   `claim_payout` — these are part of the cross-game consistency pass.
6. Refresh `solana/CLAUDE.md` program IDs (FY-10) and fill in the
   Deployment Posture custody table in `README.md`. Both are blocker-class
   for an external packet.

After (1)–(3), `pnpm exec mocha tests/flipyou.ts` should be green and the
public API should match on-chain truth. FY-4 / FY-5 / FY-6 / FY-8 / FY-9 /
FY-11 are independent and can be triaged in any order against the bigger
audit budget.

## Files Read During the Pass

On-chain:
- `solana/programs/flipyou/src/{lib.rs, state.rs, error.rs, events.rs}`
- `solana/programs/flipyou/src/instructions/{initialize_config.rs,
  create_match.rs, join_match.rs, settle.rs, cancel_match.rs,
  timeout_refund.rs, set_paused.rs, mod.rs}`
- `solana/programs/platform/src/{lib.rs, state.rs}` and
  `instructions/update_platform_config.rs`
- `solana/shared/src/{lib.rs, escrow.rs, fairness.rs, fees.rs,
  platform_config.rs, wager.rs, pause.rs, timeout.rs, constants.rs,
  commit_reveal.rs, lifecycle.rs}`
- `solana/Anchor.toml`

Backend:
- `backend/src/routes/create.ts` (full)
- `backend/src/worker/settle-tx.ts` (full)
- `backend/src/worker/settlement.ts` (full)
- `backend/src/tx-builder.ts` (FlipYou-relevant section)
- `backend/src/fairness.ts`

Tests:
- `solana/tests/flipyou.ts` (full + executed)

Audit packet:
- `docs/audits/solana-games-audit-prep/{README.md, flipyou.md, findings.md}`
