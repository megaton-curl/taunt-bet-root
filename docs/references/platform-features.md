# TAUNT - Platform Features (Non-Game)

> Converted from `TAUNT - Platform Features.docx` on 2026-03-31.

---

## Profiles

Public by default. Profile pic, username, and a stats block that is the only progression mechanic on the platform — no XP, no levels. The only thing that matters is volume and wins.

### Stats shown on your own profile

- Games played
- Total wagered
- Total wins
- Win rate
- Win streak (current and all-time)
- Net PnL
- Game breakdown by type
- Full transaction history with fairness proof links per game

> **IDEA**: Tier matching with other platforms? Log in with an account you played on SOLPUMP or others and we match your tier somehow?

### Stats shown on someone else's profile

Everything above **except** transaction history. You can see their record, you cannot see their individual hands.

### Settings

- Connected wallet address
- Option to link X and Discord for display on profile

---

## The Multiplier — HEAT / BAND / BODY COUNT

There is **one number** on your profile that governs everything. It is purely a function of your **lifetime wagered volume**. You play more, your multiplier goes up, everything gets better.

### The multiplier applies to

- Points earned per dollar wagered (pre-TGE — post-TGE it will be tokens not points)
- Loot Crate drop rate
- Every system that rewards activity reads from this single number

### Display

It should be the most visually prominent element on the profile — displayed large, always visible, impossible to miss. When it increases, something should happen on screen.

### Scale

Starts at 1x, reaches meaningful territory (2–3x) at mid-level volume, caps at 5x for the highest-volume players. The gap between 1x and 5x should feel significant enough that high-volume players have a visible, real advantage in every reward system on the platform.

**Tier table (later edit):**

| Tier | Volume | HEAT Multiplier |
|------|--------|-----------------|
| Peasant | $0–$5k | 1x |
| Degenerate | $5k–$25k | 1.25x |
| Concerning | $25k–$100k | 1.75x |
| Denial | $100k–$250k | 2.5x |
| Addict | $250k–$1M | 3.5x |
| Intervention | $1M+ | 5x |

---

## Points System (Pre-TGE)

Points are earned by wagered volume, scaled by the HEAT multiplier. The more you wager, the higher your multiplier, the faster points accrue. Points convert to $TAUNT at TGE proportionally based on the amount of points accrued.

**Airdrop 1**: 10M tokens. Snapshot before airdrop: 1M points across 10,000 players.

Points are visible on the profile and on leaderboards. Before TGE they function as the primary progression signal — your points balance is your standing in the community. After TGE they convert and the system transitions to direct $TAUNT emissions via wager-to-earn.

---

## Quests

Daily quests reset at 00:00 UTC. Weekly quests reset Monday.

**Examples**: play 3 games today, win 2 in a row, play during a Dogpile window, send a taunt that gets replied to.

Completing a quest drops a Crate.

**Quest design principle**: every quest should either fill a lobby or make the platform feel more alive for other players. No quests that reward solo behaviour with no social benefit.

---

## Loot Crates (***)

Simple mechanic. Crates drop from quest completions, Dogpile participation, and weekly leaderboard finishes.

Contents are either points (pre-TGE) or $TAUNT (post-TGE) or plain SOL. Drop probability scales inversely with value — small SOL drops are common, large token drops are rare. No complex rarity tables, no cosmetic items, no NFTs. Cash or points, nothing else. Open a crate, get something real or get nothing.

The probability of getting a drop is multiplied by the HEAT multiplier as well.

### Drop table (illustrative)

| Contents | Probability |
|----------|-------------|
| Small points bundle | 64.24% |
| Medium points bundle | 23% |
| Large points bundle | 12.5% |
| SOL drop | 0.25% |
| Large SOL drop | 0.01% |

---

## Dogpile / Gangbang (***)

### During event

- **Points**: `HEAT * GANGBANG_MULTIPLIER * emission_rate`
- **Crates**: `HEAT * GANGBANG_MULTIPLIER * drop_probability`

Optional:
- Rakeback: `HEAT * GANGBANG_MULTIPLIER * plain_rakeback_rate`
- Cashback: `HEAT * GANGBANG_MULTIPLIER * plain_cashback_rate`

### Mechanic

Runs X times per day on a fixed schedule — spaced to cover US, EU, and APAC timezones. A 60-minute window where a shared boss has HP.

Every game played during the window deals damage proportional to the stake. If the community collectively hits the damage threshold before the window closes, a percentage of fees collected during that window gets dropped back to participants based on damage dealt. If the threshold isn't hit, no drop — the boss survives and HP resets for the next one.

Fee rolls over to make next one more attractive.

This is the **lobby-fill mechanic**. Players have a reason to be online at the same time. KOLs have a reason to tweet "Dogpile in 30 minutes." Lobbies fill because everyone wants to deal damage. The community wins together or doesn't win at all.

Admin can trigger manual Dogpile windows for launch day, KOL events, or special occasions.

During the Dogpile, everyone's HEAT multiplier is maxxed out for points and loot crate chances.

---

## Weekly Leaderboard Races

Volume-based weekly leaderboard, resets Monday 00:00 UTC. Ranked by total wagered volume that week. Top 10 get Crate drops at reset — size scales with rank. Top 3 get a larger SOL or points drop.

Separate leaderboards per game type for players who want to specialise. Global leaderboard for overall volume. Both live on the leaderboards page and embedded on profiles.

---

## Referral System

### Pre-launch

Generate a link, every wallet that signs up via it is attributed permanently. Public leaderboard of referral counts. Build your base before launch, collect from day one.

### Post-launch

KOLs earn a permanent percentage of platform fees from attributed players, paid in SOL, on-chain, claimable any time. Rate scales with lifetime attributed volume from 10% to 40%.

Players who join via a referral link get a permanent fee reduction forever. For their first $200 wagered they play fee-free and get 2x Loot Crate drop rate. After that window the permanent rebate stays.

---

## Global Chat

Single global chat visible on the main lobby screen. No per-game private chat here — that lives inside the game session. Global chat is for the community: trash talk, reactions to live wins showing up in the feed, Dogpile coordination. Moderated minimally — this is a trash-talk platform. Wallet addresses shown by default, username if set.

---

## Provable Fairness Page

Standalone page. Enter any game session ID and see the full verification trace: commitment hash, entropy slot used, slot hash value, derivation steps, final result. Anyone can verify any outcome independently without trusting TAUNT. Written in plain language with the raw data alongside. This page is linked from every settled game in transaction history.

---

## Landing Page — The Pit

The home screen before you connect. Shows the platform alive in real time: recent big wins scrolling as a live ticker, active game count by type, current Dogpile status and countdown to next one, total platform volume, biggest pot of the day. The goal is to make it feel like walking into a venue that's already busy. No hero copy, no explainer sections — just live activity. The product explains itself.

After connecting, The Pit becomes the lobby — open games to jump into, Dogpile status, your active quests, your points balance, global chat.

---

## Incentive Pool

> `***` = the incentive pool feeds these systems.

Out of all the fees collected (5% of wagered volume), **20% (= 1% of total volume)** goes towards this pool:

- X% goes toward Dogpile rewards
- (100–X)% goes toward the weekly leaderboards
