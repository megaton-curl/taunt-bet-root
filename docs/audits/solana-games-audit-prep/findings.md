# Solana Games Audit Findings Register

Use this file during internal audit-prep passes. Do not start filling it until an audit pass actually begins.

Every finding maps to a row in the [Threat Model](README.md#threat-model). If a finding does not, either the threat model is incomplete or the finding is out of scope.

## Status Buckets

### Must Fix Before External Audit

Findings that plausibly create funds loss, stuck funds, unfair outcomes, account substitution, authority bypass, or production-liveness failure. These block the packet from shipping.

### Needs Test Proof

Invariants that look important but need a targeted adversarial test before the team can rely on them. Convert to "Must Fix" if the test fails, or close once the test passes and is committed.

### To Do Soon

Known pre-audit implementation or documentation work that should be completed soon but is not itself a newly discovered audit finding yet. Promote to "Must Fix Before External Audit" if it remains open when the external-audit packet is being prepared.

### Document As Trust Assumption

Intentional behavior that depends on backend signer custody, secret handling, oracle source, RPC behavior, config authority, treasury custody, or operational monitoring. When accepted, lift the entry into [README §Trust Assumptions](README.md#trust-assumptions-and-residual-risks) so future readers do not refile it.

### Open Investigation

Codex or the reviewer ran out of budget on this surface. The entry records what was **not** verified, with exact files and invariants. These must be closed before the packet ships — either resolved (move to another bucket) or explicitly escalated to the external auditor's scope (move to Ask External Auditor).

### Ask External Auditor

Questions that should be explicitly included in the external audit packet because they involve subtle protocol, math, oracle, or Solana runtime behavior. When added here, also lift into [README §Open Questions](README.md#open-questions-for-external-audit).

## Finding Template

```markdown
### [SEV] Short Title

- **Category:** Must Fix Before External Audit | Needs Test Proof | To Do Soon | Document As Trust Assumption | Open Investigation | Ask External Auditor
- **Surface:** `path/to/file.rs` / instruction / backend route
- **Game:** Shared | FlipYou | Pot Shot | Close Call
- **Threat actor:** Which row from the [Threat Model](README.md#threat-model) this finding defends against
- **Invariant:** What must always be true
- **Issue:** What breaks that invariant
- **Exploit Path:** Minimal attacker or failure sequence
- **Impact:** Funds loss, stuck funds, unfair outcome, DoS, accounting mismatch, or operational risk
- **Proof:** Existing test, new failing test, local command output, or exact reasoning from code
- **Discovered via:** Codex prompt (verbatim) | Manual review | Failing test | Cross-game diff
- **Confidence:** High (have reproducer) | Medium (have reasoning) | Low (suspect, needs proof)
- **Fix Direction:** Smallest safe change, test, or documentation update
- **Status:** Open | Fixed | Needs Review | Accepted Risk
```

## Active Findings

### [MEDIUM] In-Flight Rounds Use Live Platform Fee And Treasury

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/flipyou/src/instructions/settle.rs`, `solana/programs/potshot/src/instructions/claim_payout.rs`, `solana/shared/src/platform_config.rs`
- **Game:** Shared
- **Threat actor:** Platform admin
- **Invariant:** Players should understand whether fee and treasury terms are fixed when value enters a round or read live at settlement.
- **Issue:** FlipYou and Pot Shot read `PlatformConfig.fee_bps` and `PlatformConfig.treasury` at settlement time. Updating platform config after players enter can change the fee recipient and fee rate for in-flight rounds.
- **Exploit Path:** Platform admin updates `PlatformConfig` after players join but before settlement; settlement reads the new config.
- **Impact:** Admin-controlled economics change for in-flight rounds. `MAX_FEE_BPS` caps fee rate, and player payout recipients remain the stored player accounts.
- **Proof:** `settle.rs` and `claim_payout.rs` call `read_platform_config` during settlement; round state does not store fee BPS or treasury.
- **Discovered via:** Codex prompt
- **Confidence:** Medium (have reasoning)
- **Fix Direction:** Accepted as a documented trust assumption for now. Snapshotting fee/treasury would require account layout, IDL, decoder, deployment, and in-flight-account handling.
- **Status:** Accepted Risk

### [LOW] FlipYou Initialize Config Can Re-Unpause

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/flipyou/src/instructions/initialize_config.rs`
- **Game:** FlipYou
- **Threat actor:** FlipYou config authority
- **Invariant:** Operational pause/unpause authority is an explicit trusted role.
- **Issue:** `initialize_config` uses `init_if_needed` and always writes `paused = false`, so the existing config authority can call it again to re-unpause the game.
- **Exploit Path:** Config authority pauses FlipYou, then calls `initialize_config` instead of `set_paused(false)`.
- **Impact:** No new privilege boundary is crossed because the same authority can already unpause via `set_paused(false)`, but the duplicate path should be known before external audit.
- **Proof:** `initialize_config.rs` derives the singleton `flipyou_config` PDA with `init_if_needed` and resets `paused` to `false`.
- **Discovered via:** Claude scan
- **Confidence:** High (have code proof)
- **Fix Direction:** Documented as accepted behavior for now. If we want a single unpause path later, split first-time initialization from config updates or preserve the current `paused` value when the account already exists.
- **Status:** Accepted Risk
