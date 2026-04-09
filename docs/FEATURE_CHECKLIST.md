# Platform Features Checklist

Cross-referenced against [Platform Features v1](references/platform-features.md) and current codebase.

Legend: `[x]` done | `[~]` partial | `[ ]` todo | `fe/design` = frontend/design team | `tokenomics` = needs TBD figures resolved

---

## Profile

### Public Profile
- [x] Username + avatar
- [x] Stats block: games played, total wagered, wins, win rate, streaks (current + all-time), net PnL, game breakdown
- [x] Public profile endpoint (`GET /public-profile/:identifier`)
- [ ] Bio field — `todo` (no DB column, no API)
- [ ] X / Discord social links on profile — `todo` (no DB columns, no backend)
- [ ] Shareable public profile link — `fe/design`
- [ ] Heat metric display + progression feel — `fe/design` + `tokenomics`

### Private Profile
- [x] Full transaction history (`GET /profile/transactions`)
- [x] Fairness commitment returned per round (`GET /rounds/:pda`)
- [ ] Fairness proof link per game in transaction list — `fe/design`

### Settings
- [x] Connected wallet address display — `fe/design` (backend provides wallet via profile)
- [ ] Link X account — `todo` (OAuth flow + DB column)
- [ ] Link Discord account — `todo` (OAuth flow + DB column)

---

## Heat Multiplier

- [x] `heat_multiplier` column exists in `player_profiles` (default 1.0)
- [x] Returned in profile API responses
- [ ] Actually applied to points accrual rate — `todo`
- [ ] Actually applied to crate drop probability — `todo`
- [ ] Multiplier progression curve (logarithmic) — `tokenomics` (base rate, cap, curve shape)
- [ ] Seasonal multiplier layer — `tokenomics` (global vs seasonal design)
- [ ] Dynamic progression UX during gameplay — `fe/design`

---

## Points System (Pre-TGE)

- [x] Points accrual on every settled game (wager-based, via `game.settled` handler)
- [x] `player_points` table (balance + lifetime_earned)
- [x] `point_grants` ledger
- [x] Points balance endpoint (`GET /points/mine`)
- [x] Points history endpoint (`GET /points/mine/history`)
- [ ] Heat multiplier accelerating points rate — `todo` (multiplier field exists but not applied)
- [ ] Points visible on leaderboard — `fe/design`
- [ ] Points → $TAUNT conversion at TGE — `tokenomics`
- [ ] Emission rate (points/$) — `tokenomics`
- [ ] Season 1 end date — `tokenomics`
- [ ] Airdrop 1 targets (token count, points threshold, player count) — `tokenomics`

---

## Quests / Challenges

- [x] Full challenge engine: campaigns, challenges, assignments, progress tracking, bonuses
- [x] Daily challenges (lazy-assigned on first GET, expire at midnight UTC)
- [x] Weekly challenges (lazy-assigned, expire Monday UTC)
- [x] Onboarding chain (Set Nickname → Play First Game → Win a Game → Try All 3 Types)
- [x] Completion bonuses (e.g., complete all 3 dailies → bonus crate)
- [x] Challenge progress API (`GET /challenges/mine`, `GET /challenges/mine/history`)
- [x] Admin CRUD for campaigns + challenges (`POST /admin/campaigns`, `/admin/challenges`)
- [~] Quest reward: points + crate types exist, but crate drops are game-triggered not quest-triggered — `todo` (quest completion → crate drop)
- [ ] Expanded quest list (face 5 unique opponents, play during Dogpile window, etc.) — `todo` (needs new adapter actions)
- [ ] Rotating quests in Season 2+ — `todo`

---

## Loot Crates

- [x] `crate_drops` table with type, contents, status
- [x] Crate drop handler with weighted probability roll (SOL drop > points drop > miss)
- [x] Crate SOL payout handler (on-chain transfer)
- [x] Configurable rates via `reward_config` (sol_drop_rate, points_drop_rate, pool_pct, min values)
- [x] Crate history endpoint (`GET /crates/mine`)
- [ ] Heat multiplier affecting drop probability — `todo`
- [ ] Crate expiration per season — `todo`
- [ ] Drop probabilities finalized — `tokenomics`
- [ ] SOL drop amounts finalized — `tokenomics`
- [ ] Large SOL drop as % of incentive pool — `tokenomics`
- [ ] Crate opening UX — `fe/design`
- [ ] Provably fair crate mechanism — `todo`

---

## Dogpile

- [x] `dogpile_events` table (scheduled → active → ended lifecycle)
- [x] Dogpile status worker (transitions based on time)
- [x] Public endpoints (`GET /dogpile/current`, `GET /dogpile/schedule`)
- [x] Admin endpoint to create dogpile events
- [ ] Multiplier applied during active window (settlement reads dogpile status) — `todo`
- [ ] Volume threshold (minimum wagered to activate prize pool) — `todo`
- [ ] Prize pool distribution (leaderboard race, random drop, or hybrid) — `todo` + `tokenomics`
- [ ] Interval and window duration — `tokenomics` (currently configurable per event)
- [ ] Multiplier value — `tokenomics`
- [ ] Dogpile countdown / status widget — `fe/design`

---

## Weekly Leaderboard

- [x] `GET /leaderboard/weekly` — volume-ranked, game filter, pagination
- [x] Week boundaries: Monday 00:00 UTC → next Monday
- [x] Per-game filter (flip-you, pot-shot, close-call, or all)
- [ ] Rewards for top 10 (crate drops scaled by rank) — `todo`
- [ ] Rewards for top 3 (SOL or points drop) — `todo` + `tokenomics`
- [ ] Global leaderboard separate from per-game — `fe/design`
- [ ] Leaderboard reward amounts — `tokenomics`

---

## Referral System

- [x] Referral code generation + application (`POST /referral/code`, `POST /referral/apply`)
- [x] Permanent wallet attribution via referral links
- [x] Referral earnings tracking per settled game
- [x] Pending balance + claim system (on-chain SOL transfer)
- [x] KOL custom rates via `referral_kol_rates` table (admin-set)
- [x] Referral stats endpoint (`GET /referral/stats`)
- [x] Referral earnings pagination (`GET /referral/earnings`)
- [x] Referee rebate (fixed 10% of fee)
- [ ] Rate scaling with lifetime attributed volume (automatic tiers) — `todo` + `tokenomics`
- [ ] Tier maintenance rules (minimum new player wagers in 6 months) — `todo` + `tokenomics`
- [ ] Public leaderboard of referral counts — `todo`
- [ ] Referee gets Loot Crate on first game — `todo`
- [ ] KOL tier thresholds + percentages — `tokenomics`

---

## Incentive Pool & Financial Allocation

- [x] `reward_pool` table (balance, lifetime funded/paid)
- [x] Reward pool funding from game fees (configurable % via `reward_pool_fee_share`)
- [ ] Pool allocation split: Dogpile vs Leaderboard vs Crates — `todo` + `tokenomics`
- [ ] Profit vs Incentive Pool split — `tokenomics`
- [ ] All allocation percentages — `tokenomics`

---

## Landing Page — The Pit

- [ ] Pre-connect: live activity ticker (recent wins) — `fe/design` + `todo` (backend event feed via chat SSE)
- [ ] Pre-connect: active game count by type — `fe/design` + `todo` (backend query)
- [ ] Pre-connect: Dogpile status/countdown — `fe/design` (backend endpoint exists)
- [ ] Pre-connect: total platform volume — `fe/design` + `todo` (backend query)
- [ ] Pre-connect: biggest pot of the day — `fe/design` + `todo` (backend query)
- [ ] Post-connect: open games board (lobby) — `fe/design`
- [ ] Post-connect: active quests widget — `fe/design` (backend endpoint exists)
- [ ] Post-connect: points balance widget — `fe/design` (backend endpoint exists)
- [ ] Post-connect: global chat panel — `fe/design` (chat service exists)

---

## Global Chat

- [x] Chat service (Hono + SSE, room-based, JWT auth, rate-limited)
- [x] Message store with retention
- [x] Feed store for event publishing
- [x] Admin message deletion
- [x] SSE reconnect replay via `Last-Event-ID`
- [ ] Chat UI integration in lobby — `fe/design`
- [ ] Username display (default to wallet truncation) — `fe/design`

---

## Provable Fairness

- [x] Fairness verification endpoint (`GET /rounds/:pda` — returns commitment, result_hash, secret)
- [x] Fairness package (`packages/fairness`) with commitment + verification functions
- [x] Commit-reveal scheme: `SHA256(secret || entropy || pda || algo_ver)`
- [ ] Per-game fairness explanation page — `fe/design`
- [ ] Loot crate provably fair mechanism — `todo`

---

## Waitlist

- [x] Waitlist app deployed (waitlist/ submodule, DigitalOcean)
- [ ] Early access benefit (1 week head start) — `todo` (gating logic)
- [ ] Points benefit for waitlist signups — `todo` + `tokenomics` (amount)

---

## Telegram Bot

- [ ] Bot setup (@taunt_bot, Telegram Bot API) — `todo`
- [ ] /start — welcome message — `todo`
- [ ] /profile [username] — public profile link — `todo`
- [ ] /referral [username] — referral link — `todo`
- [ ] /games — game links (Flip You, Pot Shot, Close Call) — `todo`
- [ ] /wen — Dogpile countdown — `todo`
- [ ] /therapy — gambling support resources — `todo`
- [ ] /ngmi — random one-liners — `todo`
- [ ] V2: account linking, /stats, /challenge — `todo`

---

## Share & Social

- [ ] Shareable game links with embedded referral codes — `todo`
- [ ] Open Graph meta tags for link unfurls — `fe/design` + `todo` (SSR or meta service)
- [ ] Contextual unfurl descriptions per page — `fe/design`

---

## Dashboards

- [x] Admin API routes (`/admin/*` — reward config, campaigns, challenges, dogpile CRUD)
- [x] Admin auth via `X-Admin-Key` header
- [ ] Admin panel UI — `fe/design`
- [ ] KOL referral dashboard — `fe/design`

---

## Summary

| Category | Done | Partial | Todo | FE/Design | Tokenomics |
|----------|------|---------|------|-----------|------------|
| Profile | 4 | 0 | 4 | 3 | 1 |
| Heat Multiplier | 2 | 0 | 2 | 1 | 2 |
| Points | 5 | 0 | 1 | 1 | 3 |
| Quests | 7 | 1 | 2 | 0 | 0 |
| Loot Crates | 5 | 0 | 2 | 1 | 3 |
| Dogpile | 4 | 0 | 3 | 1 | 2 |
| Leaderboard | 3 | 0 | 2 | 1 | 1 |
| Referral | 8 | 0 | 3 | 0 | 2 |
| Incentive Pool | 2 | 0 | 1 | 0 | 2 |
| The Pit | 0 | 0 | 5 | 9 | 0 |
| Chat | 5 | 0 | 0 | 2 | 0 |
| Fairness | 3 | 0 | 1 | 1 | 0 |
| Waitlist | 1 | 0 | 2 | 0 | 1 |
| Telegram | 0 | 0 | 9 | 0 | 0 |
| Share/Social | 0 | 0 | 2 | 2 | 0 |
| Dashboards | 2 | 0 | 0 | 2 | 0 |
| **Total** | **51** | **1** | **39** | **24** | **17** |
