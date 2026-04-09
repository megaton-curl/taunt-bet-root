# TAUNT — Platform Product Specification v4

> **Product vision — not a spec.** Roadmap and intent; engineering contracts live in `docs/specs/`.

> Converted from `TAUNT Product Spec v3.docx` on 2026-03-31.
> Renamed from `product-spec-v3.md` on 2026-04-07 to match the document's actual v4 title.
> End-to-End Product Design · GTM & Dev Team Reference · Milestone Roadmap
> Confidential · Pre-Launch · 2026

---

## Change Tracking Key

- **CHANGED VS V2** — section updated from v2
- **NEW IN V4** — section did not exist in v2
- **REMOVED VS V2** — section removed since v2

> M0 AND M1 ARE LOCKED. These are what we launch with.
> M2 and beyond are directional and subject to change.

---

## M0 — Pre-Launch Infrastructure

**Goal**: capture signups and warm up KOLs before the product exists.

### M0.1 Landing Page and Waitlist (CHANGED VS V2)

Single page at taunt.bet.

**What changed vs v2**: Removed waitlist position numbers, badge tiers (Founding Player / Early Degen / Pre-Launch), Degen Score mechanic, Call Your Shot mechanic. Removed ARG leaderboard and `/cards` Telegram command. Waitlist mechanics simplified to minimum viable form.

#### Page Sections

- **Hero**: one-line pitch above the fold. "PvP on-chain betting. No house. Just you and your opponent." Single CTA: Connect Wallet to Join.
- **Product motion**: looping game animation. The Arena Game demo is the intended asset.
- **How it works**: three steps only. Connect wallet. Pick a game. Win their money.
- **Why different**: one sentence each contrasting TAUNT against sportsbooks, prediction markets, and traditional crypto casinos.
- **Live counter**: X wallets already joined. Updates in real time.
- **Social links**: X and Telegram. Both must be active before this page goes live.

#### Waitlist Mechanic

- Connecting a wallet is the signup action. No form. No email required. Wallet address is the record.
- On connect: a unique referral link is generated immediately and shown as the primary post-connect element. `taunt.bet/r/[hash]` — Users can generate their own code.
- Referral count shown on the user's view: how many wallets have connected via their link. Updates live.

### M0.2 Waitlist Page States (NEW IN V4)

The page renders differently depending on wallet connection state and whether a referral code is present in the URL. Four distinct states, not separate pages.

| State | What the user sees |
|-------|-------------------|
| **Anonymous** | Full pitch. Connect wallet as primary action. Optional ref code input field below. Code must be entered before connecting to be locked in. |
| **Arrived via ref link** | Code read from URL silently on load. Referrer name shown in attribution block before user takes any action. Connect button reads "Connect to Claim". Invalid URL code falls back to anonymous state with no error shown. |
| **Connected, no code** | Referral link shown as most prominent element. Referral count live. Code input still available for retroactive apply until launch day, then removed. |
| **Connected via code** | Referrer name shown as confirmed. Own link immediately available. Referral list shows attributed wallets and their status. |

#### Flow Rules

- Wallet connect is the only gate.
- Code locks atomically on connect. No separate confirmation step.
- Code input persists through a failed wallet connect attempt.
- **First-touch attribution only**. The first KOL link a wallet uses is permanent and cannot be overwritten.
- A player cannot apply their own referral code. Rejected silently.
- Retroactive code apply available in connected state until launch day, then input removed.

### M0.3 Telegram Bot (CHANGED VS V2)

**What changed**: Removed `/cards` command. ARG card submission no longer handled via bot.

- `/start`: welcome message and link to waitlist page.
- `/notify`: registers user for launch notification. One broadcast message when platform goes live.
- `/waitlist`: returns connected wallet's referral link and current referral count.

---

## M1 — Core Platform Launch

**Goal**: a live platform with 3 games, the full non-game feature set, KOL referral system, and basic rev share. Lobbies must fill from the first hour.

### M1 Launch Scope

- **Non-game features**: Profiles, HEAT Multiplier, Points, Referral System, Quests, Loot Crates, Dogpile, The Pit lobby, Global Chat, Provable Fairness Page, KOL Dashboard.
- **Games**: Flip You, Pot Shot (Pot Shot), Close Call.
- **Deferred to M2**: Taunts system.

---

### M1.1 Wallet Authentication and Identity

- No accounts. No email. Wallet address is identity.
- **Supported wallets**: all wallets supported by the Jupiter Unified Wallet adapter (`unified.jup.ag`). Covers the full Solana wallet ecosystem at launch.
- On first connect: username auto-generated using adjective + noun + 4-digit suffix format. User-editable once per 30 days.
- Player record created on first completed game, not on first wallet connect.

**What changed vs v2**: Supported wallets updated from Phantom/Solflare/Backpack to full Jupiter Unified Wallet adapter.

---

### M1.2 Lobby and Stake Matching (CHANGED VS V2)

**What changed**: Removed tolerance band matching (±20%), 120-second matching timeout, custom challenge board (wallet-to-wallet challenges), escrow complexity on mismatch. Matching is now exact amount only.

- Players post a game at a specific amount. The lobby is a live board of open games. Another player accepts to match. No preset tiers.
- Open games persist on the board **indefinitely** until accepted or manually withdrawn.
- Live open game count shown per game type on lobby screen.

> **OPEN QUESTION**: Escrow timing — does the creator's stake lock into escrow immediately when they post, or only when another player accepts? Affects UX and smart contract design.

---

### M1.3 Player Profiles (CHANGED VS V2)

**What changed**: Removed XP system, level curve, level-gated unlocks, badge tiers from waitlist. Added HEAT Multiplier as primary progression element. Added Points balance display. Simplified cosmetics (avatar only via Loot Crates).

Every wallet has a public profile.

#### Profile Elements

- **Profile pic**: default assigned on first game. Unlockable via Loot Crates. Custom uploads by users, auto-generated avatars before.
- **Username**: auto-generated. User-editable once per 30 days.
- **HEAT Multiplier**: displayed large. Primary progression indicator.
- **Points balance**: shown on profile and leaderboards.

#### Stats — Own Profile

Games played, total wagered, total wins, win rate, win streak (current and all-time), net PnL, game breakdown by type. Full transaction history with fairness proof link per game.

#### Stats — Visiting Another Profile

Everything above **except** transaction history.

#### Settings

- Connected wallet address displayed.
- Option to link X and Discord accounts for display on profile.
- Profile is public by default and **cannot** be set to private.

---

### M1.4 HEAT Multiplier (NEW IN V4)

HEAT is the single progression number. No XP. No levels. One number governs all reward mechanics.

#### What HEAT is

- Function of **lifetime wagered volume** only. Nothing else feeds it.
- Starts at 1x, scales to 5x at highest volume tier.
- Gap between 1x and 5x is intentionally significant.

#### What HEAT governs

- Points earned per dollar wagered
- Loot Crate drop probability
- Dogpile damage dealt

#### HEAT on the profile

- Displayed large. Most prominent visual element.
- Visible on-screen event when HEAT increases.
- On leaderboards, HEAT shown as a column alongside volume and points.

#### Tier Table

| Tier | Volume | HEAT Multiplier |
|------|--------|-----------------|
| Peasant | $0–$5k | 1x |
| Degenerate | $5k–$25k | 1.25x |
| Concerning | $25k–$100k | 1.75x |
| Denial | $100k–$250k | 2.5x |
| Addict | $250k–$1M | 3.5x |
| Intervention | $1M+ | 5x |

> **OPEN QUESTION**: Exact volume thresholds — calibrate so meaningful percentage of regularly active players reach 2x+ within first month.

---

### M1.5 Points System (NEW IN V4)

- Points per dollar wagered = base rate × HEAT multiplier.
- Generated by every completed game. Calculated on stake amount wagered, not on winnings.
- Visible on profile and leaderboards.
- At TGE: wallet's $TAUNT allocation = (wallet points / total points) × Wave 1 pool size.
- Post-TGE: transitions to direct $TAUNT wager-to-earn emissions. Points mechanic sunsets.

> **OPEN QUESTION**: Base points rate per dollar wagered — coordinate with tokenomics partner.

---

### M1.6 Referral System (CHANGED VS V2)

**What changed**: Removed pre-launch public referral leaderboard. Rev share paid in SOL (not USDC). Tiered rev share table revised (10%–40%). Added referred player fee-free window.

#### Pre-Launch

KOL generates a referral link. Every wallet signing up via that link is attributed permanently. No pre-launch prize or leaderboard — post-launch rev share is the incentive.

#### Post-Launch — KOL Side

- Permanent percentage of platform fees from attributed players. Paid in SOL. Claimable on-chain any time.
- Rate scales with lifetime attributed volume:

| Attributed Volume | Rev Share |
|-------------------|-----------|
| $0–$50k | 10% |
| $50k–$250k | 20% |
| $250k–$1M | 30% |
| $1M+ | 40% |

- Attribution is wallet-level, first-touch, 30-day rolling window.

#### Post-Launch — Referred Player Side

- **Permanent fee reduction** on every game, forever. Locked at point of connecting via referral link.
- First $200 wagered: **completely fee-free**. Platform covers the fee.
- During that window: **2x Loot Crate drop rate**.
- After window: permanent rebate remains. KOL earns percentage from the reduced fee.

#### Creator Lobby Links (M1 Simplified)

Each KOL gets custom URL: `taunt.bet/ref/[kol_slug]`. No custom branding at M1. Full creator lobby is M3.

---

### M1.7 Quests (CHANGED VS V2)

**What changed**: Removed XP rewards. Quest completion drops a Loot Crate only. Renamed from Bounties.

Quest design principle: every quest must either fill a lobby or make the platform more active for other players.

#### Daily Quests (reset 00:00 UTC, 3 active per player)

- Win 3 rounds of any game type
- Send 5 taunts in active games
- Join an open lobby within 60 seconds of it being posted
- Play during a Dogpile window

#### Weekly Quests (reset Monday 00:00 UTC, 2 active per player)

- Win 20 rounds in a week
- Play every game type in a week
- Refer a player who completes their first game

---

### M1.8 Loot Crates (CHANGED VS V2)

**What changed**: Cosmetics and NFTs removed. Contents are points/TAUNT/SOL only. HEAT multiplier applies to all drop probabilities. Added Incentive Pool as funding source.

#### Drop Triggers

- Quest completion: one crate per completed quest.
- Dogpile participation: qualifying players receive a crate when window closes.
- Weekly leaderboard top 10: automatic distribution at Monday reset.
- **Guaranteed drop**: at 50 completed games without a drop, one is guaranteed regardless of HEAT. Counter resets on drop.

#### Drop Probability Table

Base probabilities — all rates multiplied by HEAT before being applied.

| Contents | Base Probability |
|----------|-----------------|
| Small points bundle | 64% |
| Medium points bundle | 23% |
| Large points bundle | 12.5% |
| SOL drop | 0.25% |
| Large SOL drop | 0.01% |

#### Incentive Pool

20% of all platform fees (= 1% of total volume) is ring-fenced into the Incentive Pool. Funds three things exclusively:

1. Dogpile reward drops
2. Loot Crate SOL contents
3. Weekly leaderboard prizes

Pool balance visible in UI. Undefeated Dogpile allocation rolls over.

---

### M1.9 Dogpile (CHANGED VS V2)

**What changed**: Added boss HP mechanic. Added undefeated pool rollover. Added HEAT maxed during window. Moved from M2 to M1.

60-minute community event, 3× per day on fixed schedule (US, EU, APAC). Primary mechanic for concentrating concurrent activity.

- Shared boss has HP set by admin per event.
- Every completed game during window deals damage proportional to stake wagered.
- If community hits HP threshold: percentage of fees collected during window is distributed proportional to damage dealt.
- If threshold not hit: boss survives, uncollected pool rolls over to next Dogpile.
- During window: every player's HEAT treated as maxed for points and Loot Crate chances.
- Admin can trigger manual Dogpile windows.
- Funded by Incentive Pool.

> **OPEN QUESTION**: Boss HP calibration — target ~30 concurrent active players as defeat threshold.

---

### M1.10 The Pit — Landing and Lobby (NEW IN V4)

#### Pre-connect view

- Live ticker of recent large wins
- Active game count by game type
- Dogpile countdown and boss HP status
- Total platform volume (all-time and today)
- Biggest pot of the day
- Connect wallet as single CTA

#### Post-connect view (the lobby)

- Open games board: live list with game type, stake amount, accept button
- Post a game button as primary action
- Dogpile status and countdown
- Active quests shown inline
- Points balance and HEAT multiplier
- Global chat

---

### M1.11 Global Chat (NEW IN V4)

Single global chat on main lobby screen. Separate from in-game taunts. For community interaction: reactions to wins, Dogpile coordination, general conversation. Wallet address shown by default, username if set. Minimally moderated.

---

### M1.12 Provable Fairness Page (NEW IN V4)

Standalone page, no wallet connection required. Input any session ID to see full verification trace: commitment hash, entropy slot, slot hash value, derivation steps, final result. Plain language explanation alongside raw on-chain data. Linked from every settled game in transaction history.

---

### M1.13 KOL Dashboard (NEW IN V4)

Available from M1 launch:

- Players attributed (total wallets via link)
- Total volume from attributed players
- Earnings pending claim
- Claim button: on-chain, paid in SOL
- Attribution list: wallet, connection date, last active date

---

## M1 Games

> Games follow all non-game platform features deliberately. The platform layer (profiles, HEAT, points, referrals, quests, crates, Dogpile, lobby) is what gives the games context and retention.

### M1.14 Game: Flip You

1v1. Instant. Provably fair flipyou. On-chain entropy and commit-reveal.

#### Player Flow

1. Player A posts a game: picks heads or tails, sets stake amount, deposits to escrow. Game appears on lobby board.
2. Player B accepts from the board: takes opposite side, matches stake. Server commits hash at join.
3. At target block, server reads block hash, reveals secret, derives result. Contract verifies. Winner receives 95–97% of pot. Fee to treasury.
4. If server goes dark after escrow locks: permissionless timeout refund available to any party. Both players receive full principal, no fee.

#### Arena Game Variant

The flipyou mechanic is also presented as a physics arena game (primary marketing demo asset). Two avatar bubbles bounce around the arena:

- Each starts with 5 lives
- SAW power-ups give rotating blade that deals damage on collision
- HEART power-ups restore one life
- Round ends when one player reaches 0 lives
- Underlying 50/50 outcome is still provably fair
- Physics engine is the visual layer — template for reskinning other games

---

### M1.15 Game: Pot Shot / Pot Shot (CHANGED VS V2)

**What changed**: Replaces Pull Out (Crash) in M1 lineup. Pull Out moves to M2.

Multiplayer PvP lottery. More entries = better odds. 60-second entry window. On-chain entropy spins. One winner takes the pot.

#### Player Flow

1. Round opens. 60-second entry window. Players buy entries at a stake amount.
2. Additional entries from same player increase weighting.
3. At window close: entropy from block hash. Result maps to winning entry slot across weighted pool. Winner gets 95–97% of total pot. Fee to treasury.
4. Minimum 2 players to proceed. If only 1 player entered: full refund, no fee.
5. Maximum entries per player is configurable. Default is 10.

> **OPEN QUESTION**: Entry price — fixed cost per round or player-set entry size? Affects weighted pool and fairness model.

---

### M1.16 Game: Close Call

Multiplayer pari-mutuel. Predict whether next BTC 1-minute candle closes green or red.

#### Player Flow

1. 30-second betting window. Players bet LONG or SHORT at any stake amount.
2. Betting locks. BTC 1-minute candle in progress. Live price feed displayed.
3. Candle closes. Pyth oracle price captured on-chain as settlement price.
4. Winners split losing side's pool pro-rata by stake size.
5. Flat candle (open = close): round void, all stakes refunded, no fee.

---

## Removed vs V2

- **Taunt System** (M1.7 in v2): deferred to M2.
- **Pull Out / Crash game**: moved from M1 to M2.
