# FlipYou Audit Findings — Claude Pass

> Internal audit pass over FlipYou per `docs/audits/solana-games-audit-prep/flipyou.md`.
> Format and status buckets follow `findings.md`. Every finding is mapped to a
> [Threat Model](README.md#threat-model) row. Severity uses **HIGH / MEDIUM / LOW / INFO**;
> any finding flagged as Must Fix is sized against funds risk or audit-shippability.
>
> **Run context.** Code reviewed at workspace HEAD on `dev`. Bankrun test suite
> `tests/flipyou.ts` was executed: 24 passing / 2 failing. Both failing tests
> are themselves diagnostic and are written up below as findings (TEST-1, FY-3).

## Pass Summary

| Category | Count |
|----------|-------|
| Must Fix Before External Audit | 2 |
| Needs Test Proof | 2 |
| To Do Soon | 1 |
| Document As Trust Assumption | 1 |
| Open Investigation | 0 |
| Ask External Auditor | 1 |

Findings cluster around three surfaces: (1) the off-chain settlement worker reads
the wrong bytes from the SlotHashes sysvar, so the backend's pre-computed winner
disagrees with the on-chain payout; (2) `join_match` does not check the pause
flag while the test suite asserts it does; (3) settle's rent-refund destination
(`caller`) diverges from cancel/timeout (`server`), and the existing test
contradicts the implementation. Three of the issues are cross-game (they live in
shared code or in the settlement worker that handles FlipYou and Pot Shot
identically) and should be picked up by the cross-game consistency pass.

---

## Active Findings

### [HIGH] FY-1 — Backend reads wrong bytes from SlotHashes sysvar

- **Category:** Must Fix Before External Audit
- **Surface:** `backend/src/worker/settle-tx.ts:306` (FlipYou) and `:574` (Pot Shot)
- **Game:** FlipYou (also Pot Shot — cross-game)
- **Threat actor:** Backend operator (honest) — the bug does not require an attacker
- **Invariant:** The backend's locally-computed `winner` / `result_side` /
  `result_hash` must match what the on-chain `settle` instruction will compute
  and persist to the player. Mismatch breaks the public API contract:
  `GET /flip-you/verify/:pda` returns `winner`, `resultSide`, and the
  verification formula advertising `sha256(secret || entropy || pda || algorithmVersion)`.
- **Issue:** The settlement worker reads
  `Buffer.from(entropyInfo.data.subarray(0, 32))`. The SlotHashes sysvar
  (bincode `Vec<(Slot, Hash)>`) is laid out as
  `count: u64 LE (8 bytes) || (slot: u64 LE, hash: [u8;32])*`. The first 32
  bytes are therefore `count(8) || newest_slot(8) || first 16 bytes of newest hash(16)` —
  not a hash, and not the hash at `target_slot`. The on-chain
  `read_slot_hash_entropy` (`solana/shared/src/fairness.rs:48`) correctly
  computes `index = newest_slot - target_slot` and returns
  `data[entries_start + index*40 + 8 .. + 40]`. The two reads disagree by
  construction, and SHA256 avalanche makes the resulting `result_hash` and
  `result_side` differ ~50% of the time.
- **Exploit Path:** No attacker required. On any production settlement:
  1. Backend pre-computes `resultHash`, `resultSide`, `winner` using the wrong
     32 bytes.
  2. Backend submits `settle` to chain. On-chain reads the correct entropy at
     `target_slot` and pays the correct winner.
  3. Backend writes its (wrong) `result_hash`, `result_side`, `winner` to the
     `rounds` table in the same DB transaction (`settle-tx.ts:381–388`).
  4. `formatFlipYouRound` returns the wrong `winner` and the wrong
     `resultHash` to the API consumer at `/flip-you/by-id/:matchId` and
     `/flip-you/verify/:pda`.
  5. Players with a wallet diff see SOL routed to one address while the API
     and verification page name a different winner.
- **Impact:** No funds loss (on-chain pay-out is correct), but a public-API
  correctness violation: the verification endpoint that anchors player trust
  contradicts on-chain reality 50% of the time. This is a credibility-blocker
  for an external audit packet, and a player-facing bug today.
- **Proof:** Code reasoning above. Requires a devnet repro to be definitive,
  hence the parallel **Needs Test Proof** entry FY-1-TEST below. The bug is
  masked in tests because `backend/src/__tests__/integration-test-helpers.ts:404`
  seeds the entropy account directly with raw 32-byte data instead of the
  bincode SlotHashes layout, so `subarray(0, 32)` happens to return what the
  on-chain code would return.
- **Discovered via:** Manual review of `settle-tx.ts:306` against
  `shared/src/fairness.rs:48` and the bincode layout of the SlotHashes sysvar.
- **Confidence:** High (reasoning); Medium (no devnet repro yet).
- **Fix Direction:** Replace `subarray(0, 32)` with a function that mirrors
  `read_slot_hash_entropy`: parse `count` at offset 0, compute
  `index = newest_slot - target_slot`, scan a small window for skipped slots,
  and return `data[entries_start + index*40 + 8 .. + 40]`. Add an
  integration test that uses a *real* SlotHashes-shaped buffer (not flat
  32 bytes) and asserts that backend and on-chain derive the same
  `result_hash` for the same `target_slot`. Apply the fix to both
  `settleMatch` (FlipYou) and `settleLordRound` (Pot Shot).
- **Status:** Open

### [HIGH] FY-2 — `join_match` does not enforce pause; test asserts it does

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/flipyou/src/instructions/join_match.rs` (handler);
  test `solana/tests/flipyou.ts:629` ("rejects join while game is paused")
- **Game:** FlipYou
- **Threat actor:** Platform admin (who paused for a security reason) and
  Player A / Player B (who can put new principal into a paused program)
- **Invariant:** Per shared README §"Account And Authority Invariants":
  *"Confirm pausing blocks new value entering the game while preserving
  settlement, refunds, and force-close recovery."* Joining transfers fresh
  player principal into escrow; that is "new value entering the game".
- **Issue:** `create_match` calls `check_not_paused(false, config.paused)`
  but `join_match.rs` has no such call and no `config.paused` read. The
  config account is fetched but only used to validate its bump. So while
  pause blocks creating a new match, it does not block an opponent from
  funding a still-Waiting match. Meanwhile, the test
  `tests/flipyou.ts:629` *asserts* that `join_match` returns `GamePaused`,
  which means either the test is right and the code missed the check, or the
  code is right and the test was written aspirationally. Either way the
  contract is undefined right now.
- **Exploit Path:** Admin pauses FlipYou after seeing a settlement-worker
  outage or a security alert. A player joins a Waiting match created moments
  before the pause; their lamports are escrowed in a program that the
  operator believes is taking no new value. If the underlying issue is
  worker liveness, the joined funds become refundable only after
  `FLIPYOU_RESOLVE_TIMEOUT_SECONDS = 900` seconds, while admin had assumed
  their pause stopped exposure.
- **Impact:** Pause as an operational tool is weaker than the spec claims.
  Not direct funds loss, but liveness/safety mismatch. Critically, it also
  means the test suite is currently red — the audit packet cannot be
  shipped to an external auditor while `pnpm exec mocha tests/flipyou.ts`
  reports failures.
- **Proof:** Bankrun run on this commit:
  ```
  flipyou
    join_match
      ✗ rejects join while game is paused
        TypeError: Cannot read properties of undefined (reading 'errorCode')
  ```
  The test sets `paused = true`, calls `joinMatch`, and expects
  `AnchorError.errorCode = "GamePaused"`. The call succeeds, no error is
  thrown, so `err` is undefined.
- **Discovered via:** Manual review of `join_match.rs` + bankrun run of
  `tests/flipyou.ts`.
- **Confidence:** High.
- **Fix Direction:** Decide the contract first. The most likely intent is
  "pause blocks new value entering the game", which means
  `join_match` should call `check_not_paused(false, ctx.accounts.config.paused)`
  before transferring lamports. Update `solana/CLAUDE.md` and the FlipYou
  spec to state explicitly that pause blocks both `create_match` and
  `join_match`. Keep `settle` and `timeout_refund` un-paused so in-flight
  rounds resolve. Then re-run `tests/flipyou.ts`.
- **Status:** Open

### [MEDIUM] FY-3 — `settle` rent-refund target inconsistent with cancel/timeout

- **Category:** Needs Test Proof (failing test in tree already exposes the
  divergence; classification is "Must Fix" if the spec says rent goes to
  server, "documentation fix" if the spec says rent goes to caller)
- **Surface:** `solana/programs/flipyou/src/instructions/settle.rs:139`
  (vs `cancel_match.rs:54` and `timeout_refund.rs:75`); test
  `tests/flipyou.ts:783`
- **Game:** FlipYou (cross-pattern: identical decision recurs in
  `potshot/claim_payout` and Close Call settlement / refund — cross-game
  consistency pass should re-verify all)
- **Threat actor:** Backend operator (honest) and any permissionless caller
- **Invariant:** Within a single game, lifecycle-terminal close should send
  rent to a single, documented destination. The README §"Lamport Movement"
  says: *"Confirm account close behavior cannot strand rent or drain
  unrelated accounts."* The README does not pin the destination, but
  `cancel_match` and `timeout_refund` both target `server` while `settle`
  targets `caller`. That divergence is silent.
- **Issue:** `close_pda(&match_info, &ctx.accounts.caller)?;` in `settle.rs`
  sends the residual rent (~`FlipYouMatch::INIT_SPACE` rent ≈ 0.00259608 SOL)
  to whoever signed the settle transaction. Cancel and timeout refund both
  send rent to `server` (the wallet that paid `init` rent). When settle is
  permissionless and a third party calls it, the third party pockets the
  rent that the server originally funded. The doc-comment on
  `settle.rs:138` says *"Remaining lamports (rent) go back to the caller
  (server that co-signed creation)"*, conflating "caller" with "server".
- **Exploit Path:** A third party who learns the secret (e.g. observes a
  `MatchSettled` event from a competing game where the same secret was
  used — note: secrets must be distinct per match for the on-chain commitment
  to verify, so this is theoretical) or who races the backend's settle tx
  to MEV-flip whose tx lands first, would receive the rent. In normal
  operation the backend always settles first, so the rent funds the
  backend's settle gas. The hard exposure is small (one rent's worth) but
  the invariant is unclear and the test asserts the opposite of the code.
- **Impact:** Minor lamport drift per match; failing test in the audit
  packet's authoritative test file.
- **Proof:** Bankrun run on this commit:
  ```
  flipyou
    settle
      ✗ permissionless settle — third party with valid secret succeeds
        AssertionError: expected +0 to equal 2596080
  ```
  Test expects `serverAfter - serverBefore == rentLamports` (server gets
  rent). Reality: caller gets rent. Comment on line 783 of
  `tests/flipyou.ts`: *"Rent returns to the server that funded the match
  PDA, not the arbitrary caller."*
- **Discovered via:** Code review of `close_pda` call sites + bankrun run.
- **Confidence:** High.
- **Fix Direction:** Pick a contract and document it.
  - Option A (recommended): Change `settle.rs:139` to
    `close_pda(&match_info, &ctx.accounts.server.to_account_info())?;` and
    declare `server: AccountInfo` (validated against `flipyou_match.server`)
    in `Settle`'s account struct. Matches cancel/timeout. Test passes.
  - Option B: Keep rent-to-caller in settle. Update test, update doc
    comment on line 138 to remove the misleading parenthetical, and
    accept the asymmetry across instructions.
- **Status:** Open

### [MEDIUM] FY-4 — `timeout_refund` mutates phase after lamport transfers

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/flipyou/src/instructions/timeout_refund.rs:61–66`
- **Game:** FlipYou
- **Threat actor:** Permissionless caller; defensively, future maintainers
- **Invariant:** README §"Lamport Movement": *"Confirm state mutations occur
  before external lamport transfers where the program directly manipulates
  `**lamports.borrow_mut()`. Any 'transfer first, mutate state after' path
  is a bug-shape worth flagging even if Anchor's atomicity covers it."*
- **Issue:** Lines 61–62 transfer entry amounts to opponent and creator via
  `transfer_lamports_from_pda` (which uses `**lamports.borrow_mut()` —
  see `shared/src/escrow.rs:33–34`). Lines 65–66 then set
  `m.phase = PHASE_REFUNDED`. The phase write also happens to be dead
  code: `close_pda` at line 75 overwrites all account data with zeros.
  The transfer-then-mutate ordering is shape-checked because Anchor wraps
  the whole instruction in a transaction, but the ordering is the kind of
  thing that breaks subtly when someone later adds CPI in between.
- **Exploit Path:** No current exploit. The pattern becomes a problem if a
  future PR introduces a CPI between the transfers and the close (e.g. an
  event-emitter CPI to a notifications program). Today, atomicity covers
  it.
- **Impact:** Latent. Audit-baseline violation and a bug-trap for future
  changes. No immediate funds risk.
- **Proof:** Code reading: `transfer_lamports_from_pda(...)` → `m.phase =
  PHASE_REFUNDED` → `close_pda(...)`.
- **Discovered via:** Manual review against shared README invariant.
- **Confidence:** High (the violation), Low (the runtime risk).
- **Fix Direction:** Move the phase write before the transfers, or remove
  it altogether (since `close_pda` zeroes the data anyway and there is no
  Refunded phase observable post-close). Recommended: drop the phase
  write entirely and add a one-line comment that the close itself is the
  refund signal. Apply the same review to `cancel_match.rs` (no phase
  write today, consistent with this recommendation).
- **Status:** Open

### [MEDIUM] FY-5 — `read_slot_hash_entropy` skip-window scan radius is ±8

- **Category:** Ask External Auditor (boundary-safety question for fairness)
- **Surface:** `solana/shared/src/fairness.rs:96–128`
- **Game:** FlipYou (also Pot Shot — shared helper)
- **Threat actor:** Validator at `target_entropy_slot` and the broader
  network operator (skipped slots are a normal cluster condition)
- **Invariant:** Settlement must succeed for any `target_slot` that is
  still inside the SlotHashes window, regardless of how many slots were
  skipped between `target_slot` and `newest_slot`.
- **Issue:** The implementation computes
  `index = newest_slot - target_slot` and reads at that index. If skipped
  slots compress the array, the actual entry sits at a smaller index. The
  fallback scans `[index - 8, index + 8]` (line 106). Nine or more skipped
  slots between `target_slot` and `newest_slot` will skip past the target
  and return `EntropySlotExpired`. Solana's mainnet skip rates routinely
  reach the low single-digit percent, so a settlement attempted ~5 minutes
  late could realistically encounter > 8 skips. The match becomes stuck
  for ~12 more minutes until `timeout_refund` opens (see FY-6).
- **Exploit Path:** No attacker required. A small-batch validator with a
  consistent skip rate, or a normal cluster blip during settlement, can
  push the actual index more than 8 below the computed index.
- **Impact:** Liveness only — funds are recoverable via `timeout_refund`.
  The user impact is a delayed payout. The audit relevance is that the
  fairness.rs file is the central crypto helper, and a hard-coded radius
  of 8 is a magic number with no recorded justification.
- **Proof:** Code reading. Live cluster skip rates are queryable via
  `solana validators` / Grafana but were not reproduced in this pass.
- **Discovered via:** Manual review.
- **Confidence:** Medium (correct algorithmically; depends on cluster
  conditions for trigger frequency).
- **Fix Direction:** Either (a) full linear scan capped at `count` —
  `count` is bounded at 512, so this is at most 512 * 40 = 20 KB of
  scans, well within compute budget — or (b) leave the O(1) hot path and
  fall back to a full scan only when the radius scan misses. Add a unit
  test in `fairness.rs` that simulates 16 skipped slots between newest
  and target and verifies the entropy is still found.
- **Status:** Open

### [LOW] FY-6 — Resolve timeout (15 min) >> SlotHashes window (~3.5 min)

- **Category:** To Do Soon
- **Surface:** `solana/shared/src/timeout.rs:9` —
  `FLIPYOU_RESOLVE_TIMEOUT_SECONDS = 900` (15 minutes)
- **Game:** FlipYou
- **Threat actor:** Backend operator (compromised key or worker outage)
  and Permissionless caller (who wants to drive the refund)
- **Invariant:** *Any* failure path should leave the player with a
  recoverable payment within bounded time. The bounds should be tight
  enough that "stuck for 12 minutes for no recoverable reason" is not a
  documented state.
- **Issue:** Once `target_slot` rolls off the SlotHashes window
  (~512 slots × 0.4 s ≈ 205 s, plus the 12-slot offset ≈ 5 s) settlement
  is permanently impossible (`EntropySlotExpired`). But
  `timeout_refund` only opens at `resolve_deadline = join_time + 900 s`.
  This creates a deterministic ~12-minute window where settle
  cannot succeed and refund is not yet allowed. The existing comment in
  `timeout.rs:7–9` acknowledges this: *"SlotHashes entropy expires in
  ~3 min, so if settlement didn't happen by then it won't. 15 min gives
  generous buffer for retries before opening public refund."* That
  reasoning collapses if settlement *cannot* succeed once entropy
  expires.
- **Exploit Path:** No exploit; it is a UX dead-zone.
- **Impact:** Liveness and player UX. After ~3.5 minutes, the round is
  certain to refund, but players cannot trigger that refund for another
  ~11.5 minutes. For 0.001–100 SOL stakes, this is felt by the player.
- **Proof:** Constants + read of fairness.rs. Already in tree as a
  developer comment.
- **Discovered via:** Manual review of `timeout.rs:9` against
  `fairness.rs:48`.
- **Confidence:** High.
- **Fix Direction:** Reduce `FLIPYOU_RESOLVE_TIMEOUT_SECONDS` to a value
  slightly above the SlotHashes window — e.g. 300 s (5 min) — keeping a
  small buffer for settle retries while also opening refund as soon as
  entropy expires. Document in the spec.
- **Status:** Open

### [LOW] FY-7 — Verification endpoint secret-leak not test-asserted

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/create.ts:625–626` (response shaping);
  `formatFlipYouRound` only sets `response.secret` inside `if (isSettled)`
- **Game:** FlipYou
- **Threat actor:** Player A or Player B (knowing the secret before the
  on-chain settle would let them race the settle tx and grief the
  outcome derivation by reordering events; they cannot bias the entropy,
  but they can cause an unnecessary entropy-expired stall if they front-run
  poorly)
- **Invariant:** README §"Backend Trust Boundary": *"Confirm the
  verification endpoint test asserts `secret = null` while phase ≠ settled,
  and `secret = revealed_value` after settlement — automated, not
  code-review."*
- **Issue:** Code review confirms the gating, but no integration test
  asserts both halves of the contract. The integration test suite exists
  for settlement (`backend/src/__tests__/integration-settlement.test.ts`)
  but does not cover the verify endpoint's pre-settle response shape.
- **Exploit Path:** N/A today. The risk is regression: a future refactor
  that lifts `response.secret` outside the `isSettled` block would silently
  expose every locked-phase secret to anyone hitting the public verify
  endpoint, and the backend's pre-computation in FY-1 means *every* round
  has a stored secret in the DB.
- **Impact:** No current leak. Without a test, future regressions are
  undetectable in CI.
- **Proof:** Reading `create.ts:608–664`. Integration test suite has no
  `verify` assertion against an unsettled round.
- **Discovered via:** Cross-check against README's "automated, not
  code-review" requirement.
- **Confidence:** High.
- **Fix Direction:** Add a vitest case to
  `backend/src/__tests__/integration-settlement.test.ts` (or a sibling
  file) that creates a match, joins it, hits `/flip-you/verify/:pda`
  before submitting settle, and asserts `body.data.secret === undefined`.
  Then settle, hit the same endpoint, and assert `body.data.secret`
  equals the persisted hex secret.
- **Status:** Open

### [LOW] FY-8 — `EntropySlotExpired` error reused for "not yet reached"

- **Category:** To Do Soon
- **Surface:** `solana/shared/src/fairness.rs:78–80` and `:153`
- **Game:** FlipYou (shared)
- **Threat actor:** None — operational clarity issue
- **Invariant:** Errors should distinguish recoverable timing windows from
  permanent unrecoverable ones, so retry workers can branch correctly.
- **Issue:** When `target_slot > newest_slot` (i.e. the slot has not been
  produced yet, fully recoverable by waiting), the program returns
  `EntropySlotExpired` — the same error returned when `target_slot` has
  rolled off the window (permanent, must wait for timeout refund). The
  retry worker in `backend/src/worker/settle-tx.ts:291–300` partially
  compensates by gating on a separately-computed `currentSlot` before
  raising `EntropyExpiredSettleError`, but the on-chain error itself
  conflates the two cases. The error message in line 153 says
  "Target slot has expired from the SlotHashes window (~512 slots / ~3.5 min)"
  even when the cause is "target slot is in the future".
- **Exploit Path:** None.
- **Impact:** Operational legibility and retry behavior of off-chain
  workers. Wrong error in logs trains operators to dismiss legitimate
  expiries.
- **Proof:** Reading the function.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Add a separate `EntropySlotNotYetReached` variant.
  Update the on-chain error mapping in `settle.rs::map_entropy_error` and
  the off-chain `EntropyExpiredSettleError` flow.
- **Status:** Open

### [LOW] FY-9 — `initialize_config` uses `init_if_needed`

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/flipyou/src/instructions/initialize_config.rs:14`
- **Game:** FlipYou
- **Threat actor:** Platform admin (`FlipYouConfig.authority`)
- **Invariant:** `init_if_needed` is an Anchor footgun — it does not
  re-validate existing account state on the "needed not" branch; the
  programmer must do so manually.
- **Issue:** The handler manually checks
  `config.authority != Pubkey::default()` then `require_keys_eq!` the
  signer to the existing authority. So an unauthorised re-init is
  rejected. But the handler then unconditionally writes
  `config.paused = false`, meaning the authority can call
  `initialize_config` again to silently un-pause without going through
  `set_paused`. There is also a separate `set_paused` instruction with
  the same authority gate, so the code path is redundant.
- **Exploit Path:** Authority compromise is already in the trust
  assumptions, so this surface is contained.
- **Impact:** Surface-area inflation. A compromised authority has one
  more way to manipulate state, but no new capability.
- **Proof:** Reading.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Replace `init_if_needed` with `init` and a separate
  `update_config` if a re-init is ever genuinely needed. Or, document the
  redundancy and the implicit "re-init resets paused".
- **Status:** Open

### [INFO] FY-10 — `solana/CLAUDE.md` program IDs drift from source

- **Category:** To Do Soon (doc hygiene)
- **Surface:** `solana/CLAUDE.md` "Programs" table; cross-checked against
  `solana/programs/{flipyou,potshot,closecall,platform}/src/lib.rs::declare_id!`
  and `solana/Anchor.toml`
- **Game:** All
- **Threat actor:** None
- **Invariant:** External auditor packet expects program IDs documented in
  CLAUDE.md to match `Anchor.toml` and `declare_id!`.
- **Issue:** `solana/CLAUDE.md` lists FlipYou as
  `89raisnHvTCGv8xkwdHst5N4T2QDcsEVTjw2VtbK8fyk` and Platform as
  `85qwC1cDpSYkBBHUcN4nuZ119hCx4N94X38GjAHxnWjA`. The repo source of
  truth (`Anchor.toml` + `declare_id!`) is FlipYou
  `sCLNVCC3x85cTvTHawJd6ZwiHpRRFTHEsE1NibyRg2Z` and Platform
  `91RFAVsAu5DYgeHpQR1Ypjv9QUhQR2iX7AuMsKeTX3tr`. `./scripts/check-program-ids.sh`
  checks Anchor.toml ↔ `declare_id!` ↔ IDL but does not check
  `CLAUDE.md`.
- **Exploit Path:** None.
- **Impact:** Documentation drift confuses any reader (including external
  auditor) who treats CLAUDE.md as a deployment-posture reference.
- **Proof:**
  - `solana/programs/flipyou/src/lib.rs:10` →
    `declare_id!("sCLNVCC3x85cTvTHawJd6ZwiHpRRFTHEsE1NibyRg2Z");`
  - `solana/Anchor.toml` → `flipyou = "sCLNVCC3x85cTvTHawJd6ZwiHpRRFTHEsE1NibyRg2Z"`.
- **Discovered via:** Routine consistency check.
- **Confidence:** High.
- **Fix Direction:** Update CLAUDE.md, or extend
  `./scripts/check-program-ids.sh` to grep CLAUDE.md.
- **Status:** Open

### [INFO] FY-11 — `creator == server` not rejected in `create_match`

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/flipyou/src/instructions/create_match.rs:43–69`
- **Game:** FlipYou
- **Threat actor:** Platform admin self-betting against an opponent
- **Invariant:** Server holds the secret; if `creator == server`, the
  creator knows the result before submitting the match and can pick a
  winning side, then optionally refuse to reveal if the entropy makes them
  lose.
- **Issue:** `create_match` requires `server == config.authority` but does
  not require `creator != server`. If the FlipYou config authority signs as
  both creator and server, the match is rigged: the admin chooses
  `secret` after seeing entropy at `target_slot` (or simply picks a side
  knowing all secrets they hold). The selective-non-reveal mitigation
  doesn't help because the admin is already gaming creation.
- **Exploit Path:** Admin generates a `secret`, picks a side, creates a
  match as themselves with a low entry, waits for an opponent to join.
  After the entropy slot passes, admin computes `result_side`. If they
  win, settle. If they lose, withhold secret → opponent's funds refund
  via timeout (admin loses nothing; opponent gets back principal but the
  admin gets the rent surplus from cancel via the asymmetric rent rule
  in FY-3).
- **Impact:** Already covered under README Trust Assumption 1 ("backend
  selective non-reveal") and 5 ("compromised admin can grief"), but the
  `creator == server` shortcut deserves an explicit note. The fix is one
  `require!` line.
- **Proof:** Reading + the threat model.
- **Discovered via:** Manual review.
- **Confidence:** High (the gap), Medium (the practical exploit, since it
  requires admin compromise/abuse).
- **Fix Direction:**
  `require!(ctx.accounts.creator.key() != ctx.accounts.server.key(), FlipYouError::CannotJoinOwnMatch);`
  Same constraint should be added for `creator != opponent` *would*
  already exist in `join_match`, but creator/server is uncovered.
- **Status:** Open

---

## Out-of-Scope Observations (not findings, recorded for the cross-game pass)

- The settlement worker's wrong-entropy bug (FY-1) repeats verbatim in
  `settleLordRound` for Pot Shot. Any fix should land in both call sites.
- The settle-rent-to-caller divergence (FY-3) recurs in
  `claim_payout` for Pot Shot — unverified in this pass; the cross-game
  consistency pass should re-check.
- `FlipYouMatch::PHASE_REFUNDED = 3` and `shared::constants::PHASE_CANCELLED = 3`
  collide on value but mean different things. FlipYou never stores
  Cancelled because cancel closes the account — but that means
  `shared::constants::PHASE_CANCELLED` is dead in FlipYou's universe and
  worth removing or at least namespacing per game.
- The `FlipYou` BPF upgrade authority is not documented in the
  Deployment Posture custody table in
  `docs/audits/solana-games-audit-prep/README.md`. That table should be
  filled before the external packet ships.
