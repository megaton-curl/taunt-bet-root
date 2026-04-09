# Platform Features Audit - 2026-04-07

## Scope and Scoring

Source of truth for product intent:

- `docs/references/platform-features.md`
- `docs/references/product-spec-v4.md`

Scoring rule for this audit:

- `[x]` = backed by an engineering spec or equivalent implementation doc **and** real backend/on-chain support
- `[-]` = partial, narrower than the latest platform vision, or internally inconsistent between specs and backend
- `[ ]` = missing in backend/spec coverage

Frontend is intentionally excluded from grading unless it exposes a backend or spec mismatch.

## Ruthless Summary

- The backend is strongest on profile/history, referrals, provable-fair verification, weekly volume ranking, and the challenge/points/crate event pipeline.
- The latest platform-features doc materially outruns the current implementation on HEAT, Dogpile as a real community event, leaderboard rewards, richer referral economics, and waitlist-specific backend flows.
- Several specs marked `Done` are honestly done against older or narrower scopes, not against the newer product-vision doc that now lives in `docs/references/platform-features.md`.

## Spec Consistency Problems

- The latest platform-features doc brings back a **public pre-launch referral leaderboard**, while `docs/references/product-spec-v4.md` explicitly removed it.
- The latest platform-features doc treats **HEAT** as the central progression system, but `docs/specs/008-user-profile/spec.md` only reserved `heat_multiplier` and `points_balance` fields and never turned HEAT into a live backend mechanic.
- The latest platform-features doc routes the **incentive pool** toward Dogpile and weekly leaderboard rewards, while `docs/specs/400-challenge-engine/spec.md` implements reward-pool accounting for crate economics instead.

## Docs Cleanup Applied

- Active `docs/references/` reduced to text-first sources:
  - `README.md`
  - `platform-features.md`
  - `product-spec-v4.md`
- Archived:
  - `docs/archive/references/challenge-engine-spec.md`
  - `docs/archive/references/TAUNT - Platform Features Latest.docx`
  - `docs/archive/ARCHITECTURE_REVIEW.md`
  - `docs/archive/AUTONOMY_INTEGRATION_PLAN.md`
  - `docs/archive/specs/program-audit-2026-03-20.md`
  - `docs/archive/superpowers/plans/2026-04-05-db-domain-split.md`
  - `docs/archive/superpowers/specs/2026-04-05-db-domain-split-design.md`
- Removed as extraneous binary duplicates:
  - `docs/references/TAUNT - Platform Features.docx`
  - `docs/references/TAUNT Product Spec v3.docx`

## Checklist

### Profiles

- `[x]` Core profile records, usernames, own transaction history, and aggregate stats.
  - Basis: `docs/specs/008-user-profile/spec.md` is `Done`; `docs/specs/008-user-profile/gap-analysis.md` audits `37/37` backend criteria as satisfied.
  - Backend: `backend/services/backend/src/routes/profile.ts`, `backend/services/backend/src/routes/public-profile.ts`, `backend/services/backend/src/db/profiles.ts`, `backend/services/backend/src/db/stats.ts`.
- `[-]` Public profile parity with the latest feature doc.
  - Current public API only returns `gamesPlayed`, `totalWins`, and `winRate`, not the fuller public stat block expected by the latest product vision.
- `[-]` Fairness links per transaction.
  - Verification APIs exist in `backend/services/backend/src/routes/rounds.ts`, but transaction rows do not expose a first-class fairness URL or verification pointer.
- `[ ]` Bio field.
- `[ ]` Linked X / Discord accounts on profile.
- `[ ]` Public referral link displayed on profile.
- `[ ]` Explicit logged-out profile unfurl contract.
- `[-]` Profile creation timing.
  - Current backend creates a profile on auth in `backend/services/backend/src/routes/auth.ts`, not on first completed game as the newer product doc says.

### HEAT and Points

- `[x]` Points ledger, wager-point grants, reward-point grants, and points history API.
  - Basis: `docs/specs/400-challenge-engine/spec.md` is `Done`; `docs/specs/400-challenge-engine/gap-analysis.md` audits `116/116` criteria satisfied.
  - Backend: `backend/services/backend/src/queue/handlers/points-grant.ts`, `backend/services/backend/src/routes/points.ts`, `backend/services/backend/migrations/011_challenge_engine.sql`.
- `[-]` Profile points integration.
  - `/profile/me` returns `player_profiles.points_balance`, but actual points are maintained in `player_points`; no backend path syncs them.
- `[ ]` Real HEAT progression based on lifetime wagered volume.
- `[ ]` HEAT tier table and multiplier thresholds.
- `[ ]` HEAT scaling of points.
- `[ ]` HEAT scaling of crate-drop odds.
- `[ ]` HEAT as the one universal backend reward multiplier.

### Quests and Challenge Engine

- `[x]` Daily, weekly, and onboarding challenge engine with automatic progress, bonus completion, and admin-configurable templates.
  - Basis: `docs/specs/400-challenge-engine/spec.md` is `Done`.
  - Backend: `backend/services/backend/src/routes/challenges.ts`, `backend/services/backend/src/queue/handlers/game-settled.ts`, `backend/services/backend/src/queue/handlers/challenge-progress.ts`, `backend/services/backend/migrations/011_challenge_engine.sql`.
- `[-]` Challenge coverage versus the latest product doc.
  - Current adapters only cover `game_completed`, `game_won`, `lobby_filled`, and username-setting flows.
- `[ ]` Dogpile participation quests.
- `[ ]` Taunt/chat-response quests.
- `[ ]` Unique-opponent quests.
- `[ ]` Win-streak quests.
- `[ ]` Referral-converted quests.
- `[ ]` Wager-volume quests as a first-class adapter.

### Loot Crates and Incentive Pool

- `[x]` Points crates, SOL crates, crate history, and SOL crate payout handling.
  - Backend: `backend/services/backend/src/queue/handlers/crate-drop.ts`, `backend/services/backend/src/queue/handlers/crate-sol-payout.ts`, `backend/services/backend/src/routes/points.ts`.
- `[-]` Incentive pool semantics.
  - The backend reward pool is real, but it currently supports crate economics rather than the latest-doc split between Dogpile and weekly leaderboard rewards.
- `[ ]` HEAT-scaled crate probability.
- `[ ]` Dogpile crate-probability boost.
- `[ ]` Seasonal crate expiry.
- `[ ]` Broader crate contents/economics beyond points and SOL.

### Dogpile

- `[x]` Dogpile schedule, status worker, public status API, and admin scheduling/cancel flow.
  - Backend: `backend/services/backend/src/routes/dogpile.ts`, `backend/services/backend/src/worker/dogpile-worker.ts`, `backend/services/backend/src/routes/admin.ts`, `backend/services/backend/migrations/011_challenge_engine.sql`.
- `[x]` Active Dogpile point multiplier.
  - Backend: `backend/services/backend/src/queue/handlers/points-grant.ts`.
- `[ ]` Boss HP or stake-to-damage accounting.
- `[ ]` Community success threshold and failure state.
- `[ ]` Reward-share distribution back to participants.
- `[ ]` Fee rollover between Dogpile events.
- `[ ]` Max-HEAT behavior during Dogpile.
- `[ ]` Dogpile crate boost logic.

### Weekly Leaderboards

- `[x]` Weekly volume leaderboard with global or per-game ranking.
  - Backend: `backend/services/backend/src/routes/leaderboard.ts`, `backend/services/backend/src/db/stats.ts`.
- `[ ]` Weekly leaderboard reward distribution.
- `[ ]` Automatic top-10 crate payouts.
- `[ ]` Automatic top-3 larger SOL or points payouts.
- `[ ]` HEAT column in leaderboard output.
- `[ ]` Points column in leaderboard output.

### Referrals

- `[x]` Referral code creation, permanent referee linking, stats, referrals list, earnings log, and SOL claim flow.
  - Basis: `docs/specs/300-referral-system/spec.md` is `Done`.
  - Backend: `backend/services/backend/src/routes/referral.ts`, `backend/services/backend/src/db/referrals.ts`, `backend/services/backend/migrations/010_referral.sql`.
- `[x]` Referrer earnings recorded in settlement for coinflip and lord.
  - Backend: `backend/services/backend/src/worker/settle-tx.ts`.
- `[-]` KOL economics.
  - Current implementation supports a default rate plus per-user override, not the latest-doc automatic `10%` to `40%` attributed-volume ladder.
- `[-]` Referred-player benefit.
  - Current benefit is a fixed off-chain `10%` fee rebate, not the literal fee reduction model described in the latest product doc.
- `[ ]` First `$200` wagered fee-free window.
- `[ ]` `2x` loot-crate boost window for referred players.
- `[ ]` Referral earnings for Close Call settlement.
- `[ ]` Public pre-launch referral leaderboard.
- `[ ]` Anonymous/pre-connect referrer preview flow.
- `[ ]` Launch-day cutover and retroactive-apply cutoff logic.

### Global Chat

- `[-]` Dedicated global-chat backend service.
  - The service is real in `chat/`, with global-room public reads, authenticated posts, hidden page rooms, SSE streams, and tests.
  - But `docs/specs/009-chat/spec.md` is still `Draft`, so this is implementation ahead of a fully closed spec, not a cleanly finished platform feature.
- `[ ]` Chat-linked quest or taunt-replied progression hooks.

### Provable Fairness

- `[x]` Public verification APIs for coinflip, lord, and closecall rounds.
  - Backend: `backend/services/backend/src/routes/rounds.ts`.
  - On-chain: `solana/programs/coinflip`, `solana/programs/lordofrngs`, and `solana/programs/closecall` all expose deterministic settlement inputs.
- `[-]` Fairness history completeness.
  - `/rounds/history` only supports `coinflip` and `lord`; closecall lacks the same history surface.
- `[ ]` Dedicated standalone fairness-page contract beyond raw verification APIs.

### The Pit and Platform Lobby

- `[-]` Backend ingredients exist, but no unified platform-lobby contract does.
  - Existing pieces: per-game current/open-round endpoints, Dogpile status, settled-round history, leaderboard ranking, and price feed.
- `[ ]` Unified live-lobby aggregation endpoint for active-game counts, live ticker, total platform volume, biggest pot, and Dogpile countdown in one contract.

### Waitlist and Pre-Launch Flows

- `[-]` Wallet auth plus referral-code linkage exists and is enough for the current waitlist app to function.
  - Backend: `backend/services/backend/src/routes/auth.ts`, `backend/services/backend/src/routes/referral.ts`.
- `[ ]` Dedicated waitlist backend model.
- `[ ]` Anonymous signup/referrer-preview endpoint.
- `[ ]` Launch notification system or `/notify` equivalent.
- `[ ]` Telegram bot.
- `[ ]` Waitlist perks such as early-access entitlement or `$1000` worth of points credit.

## Bottom Line

If the standard is **spec completeness plus backend reality**, the repo is in decent shape for profile/history, referrals, weekly ranking, fairness APIs, and the challenge/points/crate machinery. If the standard is the **newer platform-features vision**, then the missing center of gravity is HEAT, followed by real Dogpile economics, leaderboard rewards, richer referral economics, and proper pre-launch backend flows.
