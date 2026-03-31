# 999 — Enhancements & Housekeeping

## Meta

| Key | Value |
|-----|-------|
| Status | Rolling |
| Priority | Low |
| Phase | Ongoing |
| NR_OF_TRIES | 0 |

## Overview

Rolling backlog of self-contained improvements, cleanups, and small refactors that don't warrant their own spec. Each item should be completable in a single iteration.

Items graduate here from `TECH_DEBT.md`, gap-analysis recommendations, or ad-hoc discovery. When an item grows too large (3+ iterations), it should be promoted to its own numbered spec.

## Scope

- Small, independent improvements (1 iteration each)
- No new features — only refactors, cleanups, and DX improvements
- Items must not break existing tests or visual baselines

---

## Backlog

### Config & Constants

- [ ] [frontend] Centralized config package — create `packages/config/` exporting all program IDs (`COINFLIP_PROGRAM_ID`, `PLATFORM_PROGRAM_ID`), network defaults (`DEFAULT_RPC_URL`), fairness-backend base URLs, and fee constants. Update runtime consumers to import from it instead of hardcoding. IDL `address` fields and `Anchor.toml` remain authoritative at build time; runtime code uses one source.
- [ ] [frontend] Remove deprecated `PROGRAM_IDS` export in `packages/game-engine/src/coinflip.ts:15-17` — replace all usages with `COINFLIP_PROGRAM_ID` directly.
- [ ] [frontend] Consolidate fairness backend config — move create/verification endpoint base URLs and environment-specific defaults into centralized config (depends on config package above).
- [ ] [frontend] `.env` template cleanup — reconcile `.env.example`, `.env.devnet`, backend env templates, and any other env files. Ensure all runtime vars are documented in one place.

### Code Quality (from TECH_DEBT.md)

- [ ] [frontend] Fix relaxed ESLint rules — resolve underlying `react/no-unescaped-entities`, `no-console`, and `react-hooks/exhaustive-deps` issues in `apps/platform/`, then remove overrides from `eslint.config.js`. Remove item from `TECH_DEBT.md` when done.
- [ ] [frontend] Fix standalone build script mismatch — align `build:all` to either make scaffold apps buildable or exclude them. Remove item from `TECH_DEBT.md` when done.

### Cleanup

- [ ] [frontend] Audit unused dependencies in `apps/platform/package.json` — remove any packages no longer imported.
- [ ] [docs] Consolidate deploy info — document devnet program addresses, deploy wallet, and upgrade authority in a single `docs/DEPLOY.md` or `solana/README.md`.

### UX (Nice to Have)

- [ ] [frontend] Active match persistence — when a player has joined a match that hasn't concluded yet, it should remain visible in their match list so they can navigate back to it and close/resolve it. Currently unjoined-from-view matches may disappear from the list.

### DevOps / Key Management

- [ ] [infra] **Deterministic key derivation from a single seed**: Replace per-key env vars with a single `SOLANA_SEED_PHRASE` in `.env.<network>`. Derive deployer wallet, program keypairs, and E2E player keypairs from BIP44 derivation paths (`m/44'/501'/0'`, etc.) at container startup. Eliminates managing multiple secrets and makes adding new programs/players trivial (just use the next path index).
- [ ] [infra] **Program upgrade authority transfer**: After initial devnet deploy, transfer program upgrade authority to a multisig (e.g., Squads) instead of the deployer wallet. Reduces blast radius of a leaked deployer key.
- [ ] [infra] **Pre-mainnet key rotation**: Before mainnet launch, generate fresh production keys (never reuse devnet keys). Document the ceremony and store mainnet keys in a secrets manager (Vault, AWS Secrets Manager, etc.) — not in env files.

### On-Chain Contract Hardening (Resolved)

- [x] ~~**Make Coinflip nonce consumption atomic inside `create_match`**~~: **Resolved** — Replaced nonce-based PDA derivation with backend-generated random 8-byte match IDs (`[u8; 8]`). `PlayerProfile` removed entirely; stats moved off-chain. Match PDA seeds are now `["match", creator, match_id]` where `match_id` is generated server-side via `crypto.randomBytes(8)`. No nonce, no profile CPI, no duplicate-PDA footgun.

---

## Completed

_Items move here when done, with iteration reference._

---

## Rules

1. **One item = one iteration** — if it needs more, promote to its own spec.
2. **No feature work** — features get their own spec.
3. **Clean up after yourself** — if an item came from `TECH_DEBT.md`, remove it there when done.
4. **Order doesn't matter** — pick whatever's most impactful or blocking.
