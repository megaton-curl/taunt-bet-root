# Platform Features Checklist

Source of truth: [TAUNT - Platform Features v1 (Living Document)](references/TAUNT%20-%20Platform%20Features%20→%20v1%20(Living%20Document).md)

Legend:
- `[x]` done
- `[~]` partial
- `[ ]` todo — backend/infra work needed
- `fe/design` — frontend/design team owns this
- `tokenomics` — blocked on TBD figures that affect implementation design

---

## 1. Profiles

### Public
- [x] Username + avatar
- [x] Stats: games played, wagered, wins, win rate, streaks, PnL, game breakdown
- [x] Public profile endpoint (`GET /public-profile/:identifier`)
- [ ] Bio field — `todo` (no DB column)
- [ ] Connected X / Discord socials displayed — `todo` (OAuth + DB)
- [ ] Referral link shown if set up — `fe/design` (data exists via `GET /referral/code`)
- [ ] Shareable profile link with unfurl — `fe/design`
- [ ] Heat metric as primary visual element — `fe/design` + `tokenomics`

### Private
- [x] Transaction history (`GET /profile/transactions`)
- [ ] Fairness proof link per game in tx list — `fe/design` (verification endpoint exists)

### Settings
- [x] Wallet address display — `fe/design`
- [ ] Link X account — `todo` (OAuth)
- [ ] Link Discord account — `todo` (OAuth)

---

## 2. The Multiplier — HEAT

> "This single number, purely a function of lifetime wagered volume, governs all rewards"

- [x] `heat_multiplier` column in DB (default 1.0)
- [x] Returned in profile API
- [ ] Compute from lifetime wagered volume — `todo` + `tokenomics` (curve shape, cap)
- [ ] Apply to points earned per dollar wagered — `todo`
- [ ] Apply to loot crate drop-rate probability — `todo`
- [ ] Starting value, mid-level, cap (`[TBD 1]x` → `[TBD 2-3]x` → `[TBD 5]x`) — `tokenomics`
- [ ] Logarithmic curve (flattens as it goes up) — `tokenomics`
- [ ] Global/Lifetime × Seasonal multiplier design — `tokenomics`
- [ ] Dynamic progression feel during gameplay — `fe/design`

---

## 3. Points System (Pre-TGE)

- [x] Points accrual on every settled game (wager-based)
- [x] `player_points` table + `point_grants` ledger
- [x] Balance + history endpoints (`GET /points/mine`, `/mine/history`)
- [ ] Accelerated by HEAT multiplier — `todo` (multiplier exists but not applied)
- [ ] Points visible on leaderboards — `fe/design`
- [ ] Points → $TAUNT conversion at TGE — `tokenomics`
- [ ] Emission rate (points per $) — `tokenomics`
- [ ] Season 1 end date — `tokenomics`
- [ ] Airdrop 1: `[TBD 10m]` tokens / `[TBD 1m]` points / `[TBD 10,000]` players — `tokenomics`

---

## 4. Quests

> "Daily quests reset at 00:00 UTC; Weekly quests reset Monday"

- [x] Challenge engine (campaigns, assignments, progress, bonuses)
- [x] Daily challenges (lazy-assigned, expire at midnight UTC)
- [x] Weekly challenges (expire Monday UTC)
- [x] Onboarding chain (Set Nickname → Play First Game → Win → Try All 3)
- [x] Completion bonuses (all dailies done → bonus crate)
- [x] API: `GET /challenges/mine`, `GET /challenges/mine/history`
- [x] Admin CRUD for campaigns + challenges
- [~] Quest rewards: points + crate types exist, but completing a quest should drop a Crate — `todo` (reward_type=crate path works, but not all quests use it)
- [ ] Expanded quest list from doc — `todo`:
  - [ ] Face 5 unique opponents
  - [ ] Create 1 game that gets filled
  - [ ] Play during a Dogpile window
  - [ ] Hit a 1/3/5/7 day streak
  - [ ] Beat 2 unique opponents
  - [ ] Join 2 open lobbies
- [ ] Weekly quest list — `todo` (doc says "TODO")
- [ ] S2+ rotating quests — `todo`

---

## 5. Loot Crates

> "Probability of a good drop is multiplied by the HEAT multiplier"

- [x] `crate_drops` table
- [x] Weighted probability roll (SOL > points > miss)
- [x] SOL payout handler (on-chain transfer)
- [x] Configurable rates via `reward_config`
- [x] Crate history endpoint (`GET /crates/mine`)
- [ ] HEAT multiplier applied to drop probability — `todo`
- [ ] Crate expiration per season — `todo`
- [ ] Provably fair crate mechanism — `todo`
- [ ] Final probabilities — `tokenomics` (doc has illustrative table: 64.24% / 23% / 12.5% / 0.25% / 0.01%)
- [ ] SOL drop amounts — `tokenomics`
- [ ] Large SOL drop as % of incentive pool — `tokenomics`
- [ ] Crate opening UX — `fe/design`
- [ ] Show base probability vs player probability vs Dogpile buff — `fe/design`

---

## 6. Dogpile / Gangbang

> "A lobby-fill event running once every 6hrs for a 60 minute window"

- [x] `dogpile_events` table (scheduled → active → ended)
- [x] Status worker (time-based transitions)
- [x] Public endpoints (`GET /dogpile/current`, `/dogpile/schedule`)
- [x] Admin can create events
- [ ] Multiplier applied during active window — `todo` (field exists, not applied to settlement)
- [ ] Volume threshold (must be met or prize rolls over) — `todo`
- [ ] Prize pool distribution to participants — `todo`
- [ ] Fee rollover when threshold not met — `todo`
- [ ] HEAT maxed during window for points + crate chances — `todo`
- [ ] Multiplier value (`[TBD 2]x`) — `tokenomics`
- [ ] Volume threshold amount — `tokenomics`
- [ ] Multiplier design: pro-rata by volume OR flat for everyone — `tokenomics`
- [ ] Reward structure: leaderboard race vs random drop vs hybrid — `tokenomics`
- [ ] Dogpile countdown / status widget — `fe/design`

---

## 7. Weekly Leaderboard Races

> "Volume-based, resetting Monday 00:00 UTC"

- [x] `GET /leaderboard/weekly` — volume-ranked, game filter, pagination
- [x] Week boundaries: Monday 00:00 UTC
- [x] Global + per-game filter
- [ ] Top 10 get Crate drops (scaled by rank) — `todo`
- [ ] Top 3 get larger SOL/points drop — `todo` + `tokenomics`
- [ ] Leaderboard on profiles — `fe/design`
- [ ] Reward amounts per rank — `tokenomics`

---

## 8. Referral System

> "KOLs earn a permanent percentage of platform fees, paid in SOL, claimable on-chain"

- [x] Code generation + application
- [x] Permanent wallet attribution (first-touch)
- [x] Referral earnings tracking per game
- [x] Pending balance + claim (on-chain SOL)
- [x] KOL custom rates (`referral_kol_rates`)
- [x] Stats + earnings endpoints
- [x] Referee rebate
- [ ] Rate scaling with lifetime attributed volume (`[TBD %]` → `[TBD %]`) — `todo` + `tokenomics`
- [ ] KOL tier thresholds — `tokenomics`
- [ ] Tier maintenance rule (min new wagers in 6 months) — `todo` + `tokenomics`
- [ ] Public leaderboard of referral counts (pre-launch) — `todo`
- [ ] Referred player gets Loot Crate — `todo`
- [ ] KOL tier percentages — `tokenomics`

---

## 9. Incentive Pool & Financial Allocation

> "Profit = [TBD %] × (fees - referrals), Incentive_Pool = [TBD %] × (fees - referrals)"

- [x] `reward_pool` table (balance, lifetime funded/paid)
- [x] Pool funding from fees (configurable %)
- [ ] Allocation split: Dogpile vs Leaderboard vs Crates — `todo` + `tokenomics`
- [ ] Profit vs incentive pool split — `tokenomics`
- [ ] All allocation percentages — `tokenomics`

---

## 10. Landing Page — The Pit

### Pre-connect
- [ ] Recent wins live ticker — `fe/design` + `todo` (event feed)
- [ ] Active game count by type — `fe/design` + `todo` (backend query)
- [ ] Dogpile status/countdown — `fe/design` (endpoint exists)
- [ ] Total platform volume — `fe/design` + `todo` (backend query)
- [ ] Biggest pot of the day — `fe/design` + `todo` (backend query)

### Post-connect (Lobby)
- [ ] Open games board — `fe/design`
- [ ] Dogpile status — `fe/design` (endpoint exists)
- [ ] Active quests inline — `fe/design` (endpoint exists)
- [ ] Points balance — `fe/design` (endpoint exists)
- [ ] Global chat panel — `fe/design` (chat service exists)

---

## 11. Global Chat

- [x] Chat service (Hono + SSE, room-based, JWT auth, rate-limited)
- [x] Message store with retention
- [x] SSE reconnect replay
- [x] Admin message deletion
- [ ] Chat UI in lobby — `fe/design`
- [ ] Wallet / username display — `fe/design`

---

## 12. Provable Fairness Page

- [x] Verification endpoint (`GET /rounds/:pda`)
- [x] Fairness package (commitment + verification)
- [x] Commit-reveal: `SHA256(secret || entropy || pda || algo_ver)`
- [ ] Per-game standalone fairness page — `fe/design`
- [ ] Loot crate provably fair mechanism — `todo`

---

## 13. Waitlist

- [x] Waitlist app deployed
- [ ] Early access benefit (1 week) — `todo`
- [ ] Points benefit (`[TBD $]` in volume worth) — `todo` + `tokenomics`

---

## 14. Telegram Bot (@taunt_bot)

- [ ] /start — welcome + platform link — `todo`
- [ ] /profile [username] — public profile link — `todo`
- [ ] /referral [username] — referral link — `todo`
- [ ] /games — Flip You, Pot Shot, Close Call links — `todo`
- [ ] /wen — Dogpile countdown — `todo`
- [ ] /therapy — gambling support resources — `todo`
- [ ] /ngmi — random one-liners — `todo`
- [ ] V2: account linking, /stats, /challenge — `todo`

---

## 15. Share & Social

- [ ] Shareable links with/without referral codes — `todo`
- [ ] Contextual Open Graph unfurl descriptions — `fe/design` + `todo`

---

## 16. Dashboards

- [x] Admin API (`/admin/*` — reward config, campaigns, challenges, dogpile)
- [x] Admin auth (X-Admin-Key)
- [ ] KOL referral dashboard — `fe/design`
- [ ] Admin panel UI — `fe/design`
- [ ] Admin authentication (proper login) — `todo`

---

## Summary

| Category | Done | Partial | Todo | FE/Design | Tokenomics |
|----------|------|---------|------|-----------|------------|
| Profiles | 4 | 0 | 3 | 4 | 1 |
| HEAT Multiplier | 2 | 0 | 2 | 1 | 4 |
| Points | 3 | 0 | 1 | 1 | 4 |
| Quests | 7 | 1 | 3+ | 0 | 0 |
| Loot Crates | 5 | 0 | 3 | 2 | 3 |
| Dogpile | 4 | 0 | 5 | 1 | 4 |
| Leaderboard | 3 | 0 | 2 | 1 | 1 |
| Referral | 7 | 0 | 4 | 0 | 3 |
| Incentive Pool | 2 | 0 | 1 | 0 | 2 |
| The Pit | 0 | 0 | 5 | 10 | 0 |
| Chat | 4 | 0 | 0 | 2 | 0 |
| Fairness | 3 | 0 | 1 | 1 | 0 |
| Waitlist | 1 | 0 | 1 | 0 | 1 |
| Telegram | 0 | 0 | 8 | 0 | 0 |
| Share/Social | 0 | 0 | 1 | 1 | 0 |
| Dashboards | 2 | 0 | 1 | 2 | 0 |
| **Total** | **47** | **1** | **41** | **26** | **23** |
