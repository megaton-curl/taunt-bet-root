# Gap Analysis: 400 — Challenge Engine & Reward System

- **Date**: 2026-04-04
- **Spec status**: Ready
- **Previous analysis**: First run

## Implementation Inventory

### Event Types
| Event | Constant | File | Line |
|-------|----------|------|------|
| game.settled | GAME_SETTLED | queue/event-types.ts | 11 |
| reward.pool_fund | REWARD_POOL_FUND | queue/event-types.ts | 12 |
| points.grant | POINTS_GRANT | queue/event-types.ts | 13 |
| crate.drop | CRATE_DROP | queue/event-types.ts | 14 |
| crate.sol_payout | CRATE_SOL_PAYOUT | queue/event-types.ts | 15 |

### Event Emission in Settlement
| Worker | Game | File | Line |
|--------|------|------|------|
| settle-tx.ts | flipyou | worker/settle-tx.ts | ~442 |
| settle-tx.ts | lord (jackpot) | worker/settle-tx.ts | ~729 |
| closecall-clock.ts | closecall | worker/closecall-clock.ts | ~611 |

### Migration
| File | Tables | Seeds |
|------|--------|-------|
| migrations/011_challenge_engine.sql | 14 tables | reward_config defaults, 3 campaigns, ~13 challenge templates, daily completion bonus |

### Handlers
| Handler | Event | File |
|---------|-------|------|
| game-settled | GAME_SETTLED | queue/handlers/game-settled.ts |
| reward-pool-fund | REWARD_POOL_FUND | queue/handlers/reward-pool-fund.ts |
| points-grant | POINTS_GRANT | queue/handlers/points-grant.ts |
| crate-drop | CRATE_DROP | queue/handlers/crate-drop.ts |
| crate-sol-payout | CRATE_SOL_PAYOUT | queue/handlers/crate-sol-payout.ts |

### Adapters
| Adapter | Action | File |
|---------|--------|------|
| gameCompletedAdapter | game_completed | queue/handlers/challenge-adapters.ts |
| gameWonAdapter | game_won | queue/handlers/challenge-adapters.ts |
| lobbyFilledAdapter | lobby_filled | queue/handlers/challenge-adapters.ts |
| questEligible | (gate) | queue/handlers/challenge-adapters.ts |

### Routes
| Method | Path | File |
|--------|------|------|
| GET | /challenges/mine | routes/challenges.ts |
| GET | /challenges/mine/history | routes/challenges.ts |
| GET | /points/mine | routes/points.ts |
| GET | /points/mine/history | routes/points.ts |
| GET | /crates/mine | routes/points.ts |
| GET | /dogpile/current | routes/dogpile.ts |
| GET | /dogpile/schedule | routes/dogpile.ts |
| GET | /admin/reward-config | routes/admin.ts |
| PUT | /admin/reward-config/:key | routes/admin.ts |
| GET | /admin/reward-pool | routes/admin.ts |
| POST | /admin/campaigns | routes/admin.ts |
| PUT | /admin/campaigns/:id | routes/admin.ts |
| POST | /admin/challenges | routes/admin.ts |
| PUT | /admin/challenges/:id | routes/admin.ts |
| POST | /admin/dogpile | routes/admin.ts |
| PUT | /admin/dogpile/:id | routes/admin.ts |
| GET | /admin/dogpile | routes/admin.ts |

### Workers
| Worker | File |
|--------|------|
| Dogpile status (scheduled->active->ended) | worker/dogpile-worker.ts |

### Tests (12 test suites, all passing)
| Test | Type | File |
|------|------|------|
| Challenge adapters (9 tests) | Unit | queue/__tests__/challenge-adapters.test.ts |
| Reward pool fund handler | Integration | queue/__tests__/reward-pool-fund.test.ts |
| Points grant handler | Integration | queue/__tests__/points-grant.test.ts |
| Crate drop handler | Integration | queue/__tests__/crate-drop.test.ts |
| Game settled handler | Integration | queue/__tests__/game-settled.test.ts |
| Completion bonus | Integration | queue/__tests__/completion-bonus.test.ts |
| Onboarding chain | Integration | queue/__tests__/onboarding-chain.test.ts |
| Challenges API | Integration | __tests__/challenges-api.test.ts |
| Points + crates API | Integration | __tests__/points-crates-api.test.ts |
| Dogpile + history API | Integration | __tests__/dogpile-history-api.test.ts |
| Admin API | Integration | __tests__/admin-api.test.ts |
| Crate SOL payout handler | Integration | queue/__tests__/crate-sol-payout.test.ts |

## Acceptance Criteria Audit

All 15 FRs audited. Every acceptance criterion checkbox annotated in spec.md.

| FR | Name | Criteria | Satisfied |
|----|------|----------|-----------|
| FR-1 | Game Settlement Event Emission | 7 | 7/7 |
| FR-2 | Challenge Engine Data Model | 7 | 7/7 |
| FR-3 | Points Earning System | 8 | 8/8 |
| FR-4 | Reward Pool & SOL Crate Economics | 10 | 10/10 |
| FR-5 | Loot Crate Drops | 9 | 9/9 |
| FR-6 | Dogpile Scheduled Events | 7 | 7/7 |
| FR-7 | Verification Adapters | 6 | 6/6 |
| FR-8 | Challenge Template Evaluation Engine | 10 | 10/10 |
| FR-9 | Completion Bonus | 5 | 5/5 |
| FR-10 | Anti-Gaming & Quest Eligibility | 5 | 5/5 |
| FR-11 | Daily & Weekly Challenge Assignment | 8 | 8/8 |
| FR-12 | Onboarding Quest Chain | 6 | 6/6 |
| FR-13 | Reward Configuration | 7 | 7/7 |
| FR-14 | Player-Facing API Endpoints | 12 | 12/12 |
| FR-15 | Admin API Endpoints | 6 | 6/6 |

**Total: 116/116 SATISFIED**

## Issues Found & Fixed During Analysis

| # | FR | Issue | Severity | Resolution |
|---|-----|-------|----------|------------|
| 1 | FR-14 | Dogpile endpoints missing JWT auth | moderate | Added JWT middleware to /dogpile/* (index.ts:312-315) |
| 2 | FR-8 | unique_game_types double-counting on queue retry | moderate | Added dedup check on existing progress_events metadata (game-settled.ts:207-216) |
| 3 | N/A | 5 legacy test files used hardcoded localhost:5432 TCP | low | Replaced with Unix socket fallback pattern (makeSql) |

## Deferred Items

All deferrals are explicit M2 scope decisions documented in the spec's "Deferred to M2" section. No stale or untracked deferrals.

| Item | Deferred To | Stale? |
|------|-------------|--------|
| Pool rotation with dynamic lobby weighting | M2 | No |
| Event-triggered ephemeral quests | M2 | No |
| Quest completion leaderboard | M2 | No |
| Game-specific quest chains | M2 | No |
| KOL-triggered custom challenges | M2 | No |
| Flash quests | M2 | No |
| Advisory fraud flags | M2 | No |
| unique_opponents, referral_converted, win_streak, wager_volume adapters | M2 | No |
| Fraud review admin APIs, clawback execution | M2 | No |

## Recommendations

1. **SOL crate payout handler**: Tech debt entry in `docs/TECH_DEBT.md` flags manual review before production. Review transfer amounts, error handling, and retry behavior against real treasury wallet before enabling SOL crate drops.
2. **Spec status**: All 116 acceptance criteria satisfied. Recommend updating spec status from Ready to Done.
