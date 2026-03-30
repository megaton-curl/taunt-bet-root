# Technical Debt & Temporary Fixes

Track temporary hacks, relaxed rules, and shortcuts here. 
**Goal**: Eliminate these items before V1 Launch (or explicitly defer them).

---

## High Priority (Fix ASAP)

### [Platform] Relaxed ESLint Rules
- **Date**: 2026-02-11
- **Location**: `apps/platform/eslint.config.js`
- **What**: Disabled `react/no-unescaped-entities`, `no-console` and downgraded `react-hooks/exhaustive-deps` to warning.
- **Why**: To establish a passing CI baseline without risking regressions in existing legacy code.
- **Fix Criteria**: Fix the underlying React issues (proper deps, escaping) and remove the override.

---

### [Lord of RNGs] Program needs full PDA + counter redesign
- **Date**: 2026-03-13
- **Location**: `solana/programs/lordofrngs/`
- **What**: Tier removed from PDA seeds and round counters, replaced with placeholder `tier=0`. Program compiles but is non-functional.
- **Why**: Migrating from fixed tiers to custom wager amounts. Lord's PDA seeds used `["jackpot_round", tier_bytes, round_number_bytes]` which no longer makes sense.
- **Fix Criteria**: Redesign PDA derivation (e.g., `["jackpot_round", creator, round_id]` like coinflip), replace `LordConfig.round_counters[8]` with a global counter or remove it, regenerate IDL, update frontend chain.ts.

---

## Medium Priority (Before Launch)

### [Scaffolds] Standalone Build Script Mismatch
- **Date**: 2026-02-11
- **Location**: `sources/rng-utopia/package.json` (`build:all`) and non-platform app folders under `sources/rng-utopia/apps/`
- **What**: `build:all` attempts standalone builds for scaffold apps that are currently platform-only and missing standalone Vite entry setup.
- **Why**: Preserve existing app folder structure during takeover while treating `apps/platform` as the only runtime target.
- **Fix Criteria**: After scope/planning finalization, either (a) make selected apps truly standalone buildable, or (b) align scripts to exclude platform-only scaffolds from standalone build expectations.

---

## Low Priority (Post-Launch cleanup)

---

## Post-V1 Backlog (Revisit When More Advanced)

Items that work today but deserve a proper implementation once the platform matures.

### [On-Chain] Stale account cleanup after program redeploys
- **Date**: 2026-03-15
- **Location**: `services/backend/src/worker/settlement.ts`, on-chain accounts
- **What**: Program redeploys can leave old accounts with incompatible layouts (different enum encoding, removed/reordered fields). Currently the settlement worker caches undecodeable PDAs and skips them after one warning. There's also one permanently undecodeable 888-byte Lord account on devnet from a pre-IDL-change deploy.
- **Current mitigation**: `undecodeablePdas` set in settlement worker, try/catch per-account in poll loop.
- **Proper solution**: (1) Admin "close any PDA" instruction that skips deserialization (transfer lamports + zero data), (2) Pre-deploy cleanup script that closes all game accounts before upgrade, (3) Account versioning (`version: u8` as first field) so decoders can branch on layout version.
- **Why not now**: Dev phase — redeploys are frequent, accounts are low-value, and the workaround is adequate.
