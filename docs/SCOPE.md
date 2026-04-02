# Taunt Bet - Capability Baseline

> Temporary status note: `docs/SCOPE.md` is currently out of date during active replanning.
> Treat implementation, active game/backend specs, `docs/DECISIONS.md`, and `docs/DESIGN_REFERENCE.md` as the current source of truth until this document is rewritten.
> For now, this file should be considered informational only and may lag behind reality.

Non-custodial P2P gaming platform on Solana. This document captures current implementation boundaries, architectural constraints, and planning direction without release labels.

---

## 1) Product Focus

Current platform priorities:
- Real, playable game loops with on-chain settlement
- Verifiable fairness for completed rounds/matches
- Reliable wallet-authenticated flows
- Basic player history and operational safety controls

This document is intentionally product-facing and avoids implementation-level details.

---

## 2) Current Capability Set

### Core Platform Capabilities
- Wallet connection (normal Solana wallet flow)
- Non-custodial transaction flow for all financial actions
- Fairness verification experience for supported games
- Basic user profile/history views
- Operational controls (pause/resume, monitoring, incident response)

### Not Implemented in Current Baseline
- Internal custodial balance model
- Multichain support
- Token utility and token-gated mechanics
- Referral and creator monetization systems
- Full social layer (global chat rewards, advanced social graph)

### Planned Backlog Themes (Unscheduled)
- Chat and social features
- Reward loops and progression expansion
- Additional games and game variants
- Extended wallet and account UX

---

## 3) Architecture Direction (Locked)

### Core Decisions
- Chain: Solana
- Custody: Non-custodial
- Program model: Standard Anchor programs (per-game + shared crate, see `docs/specs/004-shared-infrastructure/spec.md`)
- Wallet approach: normal wallets first, embedded wallet support evaluated later

### Explicit Constraint
- Do not build temporary architecture with planned rewrite.
- Stay on a single architecture path: program-per-game + shared Rust crate (`solana/shared/`). See `docs/DESIGN_REFERENCE.md`.

---

## 4) Trust Boundaries

### On-Chain Source of Truth
- All money movement
- Round settlement outcomes
- Payout eligibility and claim state

### Off-Chain Responsibilities
- Read models and indexing for UX/performance
- Profile/history aggregation
- Backend-assisted fairness services (secret generation, partial-sign create flows, settlement workers, verification endpoints)
- Fairness presentation and verification UX
- Real-time coordination where needed for UX

### Rule
- If it changes user funds or determines payouts, it must be validated on-chain.

---

## 5) Active Game Coverage

### Jackpot (Lord of the RNGs)
- Multiplayer weighted-entry jackpot pool
- Backend-assisted hybrid fairness (commitment at create, public entropy capture at spin/start, automatic settlement)
- Timeout-protected refund fallback
- Public verification payloads plus on-chain settlement evidence

### Close Call
- Pari-mutuel BTC price prediction (green/red binary)
- Pyth oracle pricing via Hermes REST API
- 30s betting window, automatic settlement
- Max 32 entries per side

### Coinflip
- Match creation/join flow
- Backend-partially-signed create flow with wallet-authenticated requests
- Hybrid fairness outcome from revealed secret + future slot-hash entropy
- Automatic settlement with timeout-protected refund fallback
- Public verification payloads plus on-chain settlement evidence

### Shared Game Requirements
- Idempotent action handling
- Replay protection for signed actions
- Clear error states for failed transactions
- Devnet-first validation before production rollout

---

## 6) Functional Baseline

- Users can connect wallets and perform game actions
- All financial interactions are on-chain
- Coinflip and Lord of the RNGs are playable end-to-end
- Users can verify fairness for completed rounds/matches
- Users can view basic profile and recent history
- Operators can pause/resume games

---

## 7) Non-Functional Baseline

- Reliability: stable under expected load
- Observability: errors and key events are visible
- Security baseline: rate limiting, validation, abuse protections
- UX baseline: clear transaction state feedback and recovery paths
- Operational readiness: incident checklist and rollback procedure

---

## 8) Workstreams

### Workstream A: Core Game Reliability
- Keep Coinflip and Lord of the RNGs robust end-to-end
- Maintain fairness verification and settlement correctness
- Continue devnet and local lifecycle validation

### Workstream B: Player Data and UX Hardening
- Improve profile/history accuracy and completeness
- Strengthen wallet and transaction UX
- Improve error handling and recovery paths

### Workstream C: Operations and Safety
- Keep pause/resume and incident handling reliable
- Improve monitoring and alerting
- Maintain rollback and operator runbook quality

---

## 9) Readiness Checklist

### Functional
- [ ] Wallet connection works across supported wallet paths
- [ ] Lord of the RNGs playable end-to-end with real settlement path
- [ ] Coinflip playable end-to-end with real settlement path
- [ ] Fairness verification works for Lord of the RNGs
- [ ] Fairness verification works for Coinflip
- [ ] Basic profile/history available and accurate

### Security and Integrity
- [ ] On-chain payout invariants validated
- [ ] Idempotency and replay protections validated
- [ ] Critical abuse paths mitigated
- [ ] Emergency pause tested

### Operational
- [ ] Monitoring and error reporting active
- [ ] Incident and rollback playbook documented
- [ ] Devnet soak tests completed

---

## 10) Risks and Mitigations

### Risk: Uncontrolled feature expansion
- Mitigation: Require explicit decision records for major product shifts

### Risk: Fairness complexity in multiplayer mechanics
- Mitigation: Keep acceptance checks explicit for entry weighting, winner selection, settlement, and public verification

### Risk: Integration drift across docs and code
- Mitigation: Keep architecture and workflow defaults centralized in `docs/DECISIONS.md`, `docs/WORKFLOW.md`, and this baseline file

### Risk: Wallet UX friction
- Mitigation: Prioritize stable normal wallet flows and clear transaction feedback

---

## 11) Success Metrics

Primary:
- Successful completion rate of game rounds/matches
- Settlement correctness and claim success rate
- Fairness verification usage and pass rate
- Critical error rate within acceptable threshold

Secondary:
- Early retention and repeat play behavior
- Time-to-complete for core game loops

---

## 12) Governance

- Temporary override: this document is currently non-authoritative while replanning is in progress and should be ignored when it conflicts with implementation or newer decision/spec docs.
- Until `docs/SCOPE.md` is rewritten, use implementation, active specs, `docs/DECISIONS.md`, and `docs/DESIGN_REFERENCE.md` as the operational source of truth.
- New features require explicit decision records before broad rollout.
- Architecture model changes require a dedicated decision memo.

---
