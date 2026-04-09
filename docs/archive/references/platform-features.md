# TAUNT - Platform Features

> **Product vision — not a spec.** Feature intent only; engineering contracts live in `docs/specs/`.

> Converted from `TAUNT - Platform Features Latest.docx` on 2026-04-07.
> The source doc is rough product working copy material. Open questions, TODOs, and speculative notes are preserved instead of being silently normalized away.

---

## Profiles

### Public surface

- Profile pic, username, bio, and a stats block as the main progression surface.
- Public profiles should be shareable and viewable while logged out.
- Decide what link unfurls show when a public profile URL is shared.
- If a player linked X or other socials, show them on the public profile.
- Show the player's referral link if they set one up.

### Private surface

Public profile plus full transaction history with fairness proof links per game.

### Stats shown on your own profile

- Games played
- Total wagered
- Total wins
- Win rate
- Win streak (current and all-time)
- Net PnL
- Game breakdown by type
- Full transaction history with fairness proof links per game

### Settings

- Connected wallet address
- Option to link X and Discord for display on profile

> **Idea**: tier matching with other platforms. Log in with an account used on SOLPUMP or elsewhere and map some equivalent tier.

---

## The Multiplier - HEAT / BAND / BODY COUNT / VIP Tier

There is one number on your profile that governs everything. It is purely a function of lifetime wagered volume. You play more, your multiplier goes up, everything gets better.

### The multiplier applies to

- Points earned per dollar wagered (pre-TGE; post-TGE details TBD)
- Loot Crate drop-rate probability
- Every activity-reward system on the platform

### Display

- Most visually prominent element on the profile
- Displayed large, always visible, impossible to miss
- When it increases, something should happen on screen

### Shape

Starts at `1x`, reaches meaningful territory (`2x-3x`) at mid-level volume, and caps at `5x` for the highest-volume players. The gap between `1x` and `5x` should feel material across every reward loop.

---

## Points System (Pre-TGE)

Points are earned by wagered volume and scale with the HEAT multiplier. The more you wager, the higher your multiplier, the faster points accrue. Points convert to `$TAUNT` at TGE proportionally based on the amount of points accrued.

**Airdrop sketch**:

- Airdrop 1: `10m` tokens
- Snapshot before airdrop: `1m` points across `10,000` players

Points are visible on profiles and leaderboards. Before TGE they act as the primary progression signal. After TGE they convert and the system transitions to direct `$TAUNT` wager-to-earn.

### Open questions

- Points emission rate (`points / $`)
- Leaderboard shape and season structure
- Season 1 end date depends on TGE timing
- How many points per `$` wagered should be emitted overall?

---

## Quests

Daily quests reset at `00:00 UTC`. Weekly quests reset on Monday.

Core rule: every quest should either fill a lobby or make the platform feel more alive for other players. No solo busywork with no social or matchmaking value.

Keep the first version simple. Season 1 is fixed; later seasons can rotate or expand quest logic.

### Example quests

- Play 3 games today
- Win 2 in a row
- Play during a Dogpile window
- Send a taunt that gets replied to

Completing a quest drops a Crate.

### Initial quest list

#### Daily

- Change your nickname
- Play 1 game
- Play each game once
- Face 5 unique opponents
- Hit a 1/3/5/7 day streak
- Beat 2 unique opponents
- Join 2 open lobbies
- Create 1 game that gets filled
- Play during a Dogpile window

#### Weekly

- TODO

---

## Loot Crates

Loot crates drop after each game settlement. The quality of the prize is defined by the probability table below. The probability of getting a good drop is multiplied by the HEAT multiplier.

Reference note from source doc:

- Provable fairness inspiration: `https://solpump.io/fairness/daily-case`

Display concept from source doc:

- Show base probability
- Show the player's probability
- Show any Dogpile buff

### Drop table (illustrative)

| Contents | Probability |
|----------|-------------|
| Small points bundle | 64.24% |
| Medium points bundle | 23% |
| Large points bundle | 12.5% |
| SOL drop | 0.25% |
| Large SOL drop (10 SOL) | 0.01% (1 in a million) |

### Open questions and future notes

- TODO: final crate probabilities
- Large SOL drops could be pro-rata from the incentive pool
- Crates may expire after each season
- Later version idea: buy or sell crates, bulk-open crates, temporary HEAT buffs

---

## Dogpile / Gangbang

### Multiplier options from source doc

- Pro-rata by wagered volume during the event, up to a maximum of `2x`
- Or give everyone the same event multiplier, capped at `2x`

### Mechanic

Runs `X` times per day on a fixed schedule to cover US, EU, and APAC time zones. Each event is a `60-minute` window where a shared boss has HP.

Every game played during the window deals damage proportional to stake. If the community hits the damage threshold before the window closes, a percentage of fees collected during the window gets dropped back to participants based on damage dealt. If the threshold is not hit, no drop; the boss survives and HP resets for the next event.

Fee rolls over to make the next one more attractive.

This is the lobby-fill mechanic. Players have a reason to be online together, and KOLs have a reason to drive coordinated traffic.

Admin can trigger manual Dogpile windows for launch day, KOL events, or special occasions.

During Dogpile, everyone's HEAT multiplier is maxed for points and Loot Crate chances.

---

## Weekly Leaderboard Races

Volume-based weekly leaderboard. Resets Monday `00:00 UTC`. Ranked by total wagered volume for that week.

- Top 10 get Crate drops at reset
- Top 3 get a larger SOL or points drop
- Separate leaderboards per game type
- Global leaderboard for overall volume
- Leaderboards live on the leaderboard page and are embedded on profiles

---

## Referral System

### Pre-launch

Generate a link. Every wallet that signs up via it is attributed permanently. Public leaderboard of referral counts. Build a base before launch and collect from day one.

### Post-launch

- KOLs earn a permanent percentage of platform fees from attributed players
- Paid in SOL, on-chain, claimable any time
- Rate scales with lifetime attributed volume from `10%` to `40%`
- Players who join via a referral link get a permanent fee reduction forever
- First `$200` wagered is fee-free
- During that window they get `2x` Loot Crate drop rate
- After that window, the permanent rebate remains

---

## Global Chat

Single global chat visible on the main lobby screen. No per-game private chat here; that lives inside game sessions.

Global chat is for trash talk, reactions to live wins, and Dogpile coordination. Moderation is intentionally light. Wallets are shown by default, username if set.

---

## Provable Fairness Page

Standalone page. Enter any game session ID and see the full verification trace:

- Commitment hash
- Entropy slot used
- Slot-hash value
- Derivation steps
- Final result

Anyone should be able to verify outcomes independently without trusting TAUNT. The page should be written in plain language and linked from every settled game in transaction history.

---

## Landing Page - The Pit

Before wallet connect, the home screen should make the platform feel alive in real time:

- Recent big wins as a live ticker
- Active game count by type
- Current Dogpile status and countdown to next event
- Total platform volume
- Biggest pot of the day

No explainer-heavy hero section. The product should explain itself through live activity.

After connecting, The Pit becomes the lobby:

- Open games to jump into
- Dogpile status
- Active quests
- Points balance
- Global chat

---

## Incentive Pool

- `Profit = 80% * (fees - referrals)`
- `Incentive_Pool = 20% * (fees - referrals)`
- `***` systems are fed by the incentive pool

Source-doc allocation notes:

- Fees are `5% * wagered_volume`
- `20%` of fees, or `1% * wagered_volume`, goes into the incentive pool
- `x%` goes toward Dogpile
- `(100 - x)%` goes toward weekly leaderboards
- `x%` goes toward Loot Crates

---

## Waitlist

Players joining the waitlist get:

- Early access, suggested as one week
- `$1000` in volume worth of points, depending on the final emission rate
