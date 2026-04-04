# TAUNT — Challenge Engine Service Spec

> Internal platform service. Not a standalone product.
> Synthesized from competitor research (Galxe, Zealy, Absinthe, TaskOn, QuestN) and three independent design opinions, filtered against the TAUNT product spec v4.
> April 2026

---

## Design Principles

These are non-negotiable filters. Every feature must pass all three.

1. **Every challenge must fill a lobby or make the platform more alive for other players.** No social media chores, no off-platform actions, no engagement theater.
2. **One progression number: HEAT.** No XP, no levels, no badges, no cosmetics. Points exist only as a pre-TGE allocation signal. Don't re-introduce complexity the spec already killed.
3. **Rewards are crates and points. That's it.** No redemption catalogs, no shops, no badge collections. Crate contents are points or SOL, scaled by HEAT. Keep the reward surface area small.

---

## Service Architecture

```
Campaign → Challenge → Step → Reward
```

One internal service (`challenge-engine`) with three supporting components.

### Core Service: `challenge-engine`

Owns:

- Challenge and campaign CRUD
- Rule evaluation (eligibility, completion conditions)
- Progress state per user per challenge
- Completion detection and reward trigger emission
- Admin APIs for create / edit / publish / kill

### Supporting Components

| Component | Responsibility |
|---|---|
| `verification-workers` | Async adapter-based task verification. Listens to platform events, evaluates step completion, reports back to challenge-engine. One adapter per action type. |
| `reward-service` | Receives `challenge_completed` events. Grants crates, points. Applies HEAT scaling. Handles Incentive Pool accounting. Separate from challenge logic. |
| `admin-console` | Internal UI for creating, editing, publishing challenges. Includes fraud review queue and analytics dashboards. |
| `analytics-pipeline` | Events → warehouse. Every state transition emits an event. |

---

## Data Model

### Core Entities

| Entity | Purpose |
|---|---|
| **Campaign** | Container grouping challenges. Has start/end, visibility, optional link to Dogpile events or KOL activations. Examples: "Daily Rotation," "Weekly Rotation," "Launch Week," "KOL Partner Event." |
| **Challenge** | The definition. Action + scope + condition + threshold + timeframe + reward trigger. Has optional `prerequisite_challenge_id` for chains. Belongs to a Campaign. Has recurrence type. |
| **ChallengeStep** | For multi-step challenges. Most M1 challenges are single-step, but multi-step is modeled from day one. Each step has its own adapter type and completion condition. |
| **EligibilityRule** | Conditions for accessing a challenge. At M1: `min_heat_tier`, `min_games_played`. Extensible later. |
| **ChallengeAssignment** | A specific challenge assigned to a specific player for a specific period. Tracks: `assigned_at`, `expires_at`, status (`active` / `completed` / `expired` / `claimed`). |
| **StepProgress** | Current progress against each step. `current_count`, `target_count`, `completed_at`. |
| **CompletionBonus** | Meta-reward for completing a set of challenges (e.g., "complete all 3 dailies → bonus crate"). Any set of challenges can have a CompletionBonus defined on top. |
| **RewardGrant** | Record of what was awarded, when, from which challenge. Links to crate drop or point grant. Supports `clawback` flag. |
| **FraudFlag** | Flags on suspicious completions. Velocity anomalies, self-play patterns, repeated opponent abuse. Linked to RewardGrant for potential clawback. |

---

## Verification Adapters

Each adapter listens to a specific platform event stream and reports step completion to the challenge engine. Adding a new game or action type means writing a new adapter — the core engine doesn't change.

### M1 Adapters (mandatory)

| Adapter | Listens to | Reports |
|---|---|---|
| `game_completed` | Game settlement events | Player completed a game (any type or specific type) |
| `game_won` | Game settlement events | Player won a game (any type or specific type) |
| `lobby_joined` | Lobby accept events | Player joined a lobby, optionally within N seconds of posting |
| `dogpile_participated` | Dogpile window events | Player completed at least one game during a Dogpile window |
| `dogpile_damage` | Dogpile damage events | Player dealt N damage during a Dogpile window |
| `taunt_sent` | In-game taunt events | Player sent a taunt during an active game |
| `referral_converted` | Referral events | Referred player completed their first game |
| `unique_opponents` | Game settlement events | Player faced N distinct opponents within timeframe |

### M2+ Adapters (add as features ship)

| Adapter | For |
|---|---|
| `wager_volume` | Track cumulative wager amount within challenge window |
| `win_streak` | Consecutive wins without a loss |
| `game_type_variety` | Played N distinct game types within period |
| `pull_out_survived` | Game-specific adapter when Pull Out ships |
| `chat_message_sent` | Participated in global chat (if you ever want social-liveness quests) |

---

## Challenge Template System

Challenges are defined declaratively. The engine evaluates templates — it doesn't contain game-specific logic.

### Template Fields

```
{
  action:       "win"                    // adapter type
  scope:        "flip_you"               // game filter (or "any")
  condition:    "count"                   // count, streak, volume, unique
  threshold:    3                         // target value
  timeframe:    "daily"                   // daily, weekly, event, one_time
  recurrence:   "rotating"               // fixed, rotating, one_time
  reward:       "crate"                   // reward trigger type
  prerequisite: null                      // challenge_id for chains
  eligible_if:  { min_heat_tier: 0 }     // eligibility rules
}
```

### Example M1 Challenges (expressed as templates)

**Dailies (pool of ~12, 3 drawn per player per day):**

| Title | Template |
|---|---|
| Win 3 rounds | `{action: win, scope: any, condition: count, threshold: 3}` |
| Play 5 games | `{action: game_completed, scope: any, condition: count, threshold: 5}` |
| Face 3 unique opponents | `{action: unique_opponents, scope: any, condition: count, threshold: 3}` |
| Win a Flip You round | `{action: win, scope: flip_you, condition: count, threshold: 1}` |
| Win a Pot Shot round | `{action: win, scope: pot_shot, condition: count, threshold: 1}` |
| Win a Close Call round | `{action: win, scope: close_call, condition: count, threshold: 1}` |
| Join a lobby within 60s | `{action: lobby_joined, scope: any, condition: within_seconds, threshold: 60}` |
| Play during a Dogpile | `{action: dogpile_participated, scope: any, condition: count, threshold: 1}` |
| Deal 500 Dogpile damage | `{action: dogpile_damage, scope: any, condition: volume, threshold: 500}` |
| Send 3 taunts in active games | `{action: taunt_sent, scope: any, condition: count, threshold: 3}` |
| Play 3 different game types | `{action: game_completed, scope: any, condition: unique_game_types, threshold: 3}` |
| Win 2 games in a row | `{action: win, scope: any, condition: streak, threshold: 2}` |

**Weeklies (pool of ~6, 2 drawn per player per week):**

| Title | Template |
|---|---|
| Win 20 rounds this week | `{action: win, scope: any, condition: count, threshold: 20}` |
| Play every game type | `{action: game_completed, scope: any, condition: unique_game_types, threshold: 3}` |
| Refer a player who plays | `{action: referral_converted, scope: any, condition: count, threshold: 1}` |
| Face 15 unique opponents | `{action: unique_opponents, scope: any, condition: count, threshold: 15}` |
| Play in 3 Dogpile events | `{action: dogpile_participated, scope: any, condition: count, threshold: 3}` |
| Win 5 Flip You rounds | `{action: win, scope: flip_you, condition: count, threshold: 5}` |

---

## Quest Assignment: Pool + Rotation

Challenges are drawn from pools, not hardcoded per day.

- **Daily pool**: ~12 templates. Each player gets 3 drawn at daily reset (00:00 UTC). Drawing is semi-random: at least one quest from the pool targets the game type with the lowest current lobby activity (dynamic lobby-aware weighting).
- **Weekly pool**: ~6 templates. Each player gets 2 drawn at weekly reset (Monday 00:00 UTC).
- **Overlap guarantee**: at least 1 of the 3 daily quests is shared across all players that day. Ensures common lobby pressure.
- **No-repeat rule**: a player won't get the same quest on consecutive days (from the daily pool).

---

## Anti-Gaming & Fraud

### Eligibility Function

Every game session is evaluated before counting toward quest progress:

```
quest_eligible(game_session) -> bool
```

Checks:

- Both players joined from public lobby (not direct invite, once that exists in M2+)
- Opponent is not in player's top-5 most-frequent opponents this week
- Game settled normally (not voided, not timed out)
- Wager amount meets minimum threshold (prevents dust-amount farming)

### Fraud Flags

| Signal | Action |
|---|---|
| Completed 5+ challenges in < 10 minutes | Flag for review |
| Same opponent in > 50% of games this week | Flag + exclude from quest progress |
| Quest completion velocity 3x above platform average | Flag for review |
| Reward claim immediately after suspicious completion | Hold reward, queue for review |

### Controls

- **Velocity limits**: max challenges completable per day (soft cap, e.g., 5 — the 3 dailies + completion bonus + 1 event quest).
- **Clawback**: any RewardGrant linked to a FraudFlag can be reversed. Points deducted, crate voided.
- **Audit log**: every state transition (assigned → in_progress → completed → claimed) is logged with timestamp, triggering game session IDs, and adapter source.

---

# Mandatory vs Great-to-Have

## MANDATORY — Ship with M1

### 1. Adapter-Based Verification

The pluggable adapter pattern where each action type (game_won, lobby_joined, dogpile_participated, etc.) is an independent worker that listens to platform events and reports step completion to the challenge engine. The core service never contains game-specific logic.

**Why mandatory**: without this, every new game or feature requires rewriting challenge evaluation logic. The M1 adapters listed above (8 total) cover the full quest spec. M2 games just need a new adapter each.

### 2. Challenge Template Engine

Declarative challenge definitions using the template schema (action + scope + condition + threshold + timeframe + reward). Challenges are data, not code. The engine evaluates templates against adapter reports.

**Why mandatory**: this is what makes the admin console useful. Without templates, every new quest is a code deploy. With templates, the team can create "Win 5 Pot Shot rounds this week" from a dashboard in 30 seconds.

### 3. Campaign Container

First-class entity that groups challenges. At M1 you have three campaigns: "Daily," "Weekly," and "Onboarding." Campaigns have start/end times, visibility rules, and optional event ties.

**Why mandatory**: without campaigns, you can't run themed events, time-boxed promotions, or the onboarding flow. It's the structural layer that everything else hangs off.

### 4. Reward Service Separation

Challenge engine emits `challenge_completed` events. A separate reward service handles crate drops, point grants, HEAT-scaled probabilities, and Incentive Pool accounting. These are different domains with different scaling characteristics.

**Why mandatory**: your reward mechanics (HEAT scaling, Incentive Pool funding, crate probability tables) are complex enough to warrant their own service boundary. Mixing reward logic into challenge evaluation creates a monolith that's hard to debug and harder to balance.

### 5. Completion Bonus (Meta-Quest)

Any set of challenges can have a bonus reward defined on top. At M1: "Complete all 3 daily challenges → 1 bonus crate." This is a first-class entity, not a special case hardcoded in the UI.

**Why mandatory**: already in your mockups. Making it a generic concept means you can later do "Complete all weekly quests → bonus" or "Complete 5 challenges this sprint → bonus" without new code.

### 6. Admin Create / Edit / Publish Flow

Internal dashboard where the team can create challenges from templates, set parameters, preview, publish, pause, and kill live challenges. Includes basic analytics (completion rate, reward cost per challenge).

**Why mandatory**: this is the difference between "we launched with 7 quests and never changed them" and "we iterate weekly based on what's filling lobbies." The quest system's value is in rapid experimentation, and that requires non-engineering access to challenge creation.

### 7. Anti-Gaming Eligibility Check

The `quest_eligible(game_session)` function that filters out self-play, dust-wager farming, and repeated-opponent abuse before counting progress. Plus the fraud flag system with clawback support.

**Why mandatory**: your quests pay out real SOL (through crates funded by the Incentive Pool). Farming will happen day one. Without eligibility checks, you're subsidizing sybil attackers from your fee revenue.

### 8. Onboarding Quest Chain

A one-time sequential challenge flow for new players: "Post your first game" → "Complete your first game" → "Open your first crate" → "Play during a Dogpile." Uses the `prerequisite_challenge_id` field on Challenge. Lives in its own "Onboarding" campaign. Teaches the core loop while handing out early rewards.

**Why mandatory**: your current spec has no guided first-session experience. The lobby, Dogpile, quests, crates — a new player needs to discover all of these. Competitor data (Galxe, Layer3) shows guided onboarding quests improve first-week retention by 15-25 percentage points. This is your one chance to teach the loop before the player bounces.

### 9. Analytics Events on Every State Transition

Every status change (challenge assigned, step progressed, challenge completed, reward granted, reward claimed, fraud flagged) emits a structured event to the analytics pipeline. At minimum: user_id, challenge_id, event_type, timestamp, metadata (game_session_id, adapter_source).

**Why mandatory**: you need to answer "for every SOL we spend on quest rewards, how much additional wagered volume do we generate?" from week one. The Incentive Pool is finite (1% of volume). If you can't measure quest ROI, you can't calibrate it.

---

## GREAT TO HAVE — Build After M1 Proves the Loop

### 1. Quest Pool Rotation with Dynamic Lobby Weighting

Instead of fixed dailies, draw 3 from a pool of ~12 per player per day, with at least one quest targeting the game type with the lowest current lobby count. Creates distributed activity and organic variety ("what dailies did you get?" in global chat).

**Why great-to-have, not mandatory**: you can launch with fixed dailies (the same 3 for everyone) and it works fine. Rotation adds engagement depth and balances lobby activity, but it's an optimization on a working system, not a prerequisite.

### 2. Event-Triggered Ephemeral Quests

When a Dogpile starts, the challenge engine auto-pushes a bonus challenge to all online players — "Deal 1000 damage this Dogpile" or "Win 2 games before the boss falls." Ephemeral: appears when event starts, expires when event ends. Creates a real-time notification moment and extra urgency.

**Why great-to-have**: Dogpile already has its own incentive structure (damage → reward share, maxed HEAT). Ephemeral quests layer additional motivation on top, but the event works without them.

### 3. Quest Completion Leaderboard

A separate leaderboard ranked by challenge completions, not wagered volume. Rewards consistency and breadth of engagement. A player who completes every daily for a month has visibility even if their volume is modest. Second axis of status alongside the volume leaderboard.

**Why great-to-have**: the weekly volume leaderboard already serves the competitive function. A completions leaderboard creates a parallel status track for grinders who aren't whales, which is good for community health — but not critical for launch.

### 4. Quest Chains Beyond Onboarding

Sequential unlock chains tied to specific games: "Play Flip You" → "Win 3 Flip You" → "Win with 2x or higher" → "Win 5 in a single session." Teaches game depth while creating progression within each game type.

**Why great-to-have**: the onboarding chain (mandatory) proves the mechanic. Game-specific chains add depth for retained players, but M1 players are still discovering the platform — deep game mastery chains matter more at M2+ when the novelty wears off.

### 5. KOL-Triggered Custom Challenges

KOLs with active referral links can trigger time-limited challenges for their audience: "Win 3 games in the next hour — bonus crate for everyone who completes it." Appears only for players attributed to that KOL. Funded from a KOL challenge budget or the Incentive Pool.

**Why great-to-have**: powerful for activations and content moments ("challenge is live, join now" on stream). But requires KOL dashboard extensions and per-KOL challenge scoping — not trivial. Better suited for M2 when you have KOL feedback on what they actually want.

### 6. Flash Quests (Time-Pressured, Admin-Triggered)

Admin-triggered challenges available for a short window (30 min to 2 hours) with boosted rewards. "Next hour: every win counts as double progress toward your daily." Creates urgency spikes and fills lobbies during dead hours.

**Why great-to-have**: requires the event quest infrastructure and real-time push notifications to be effective. If players don't see the flash quest in time, it's wasted. Better to launch after you understand your daily activity curves and know which hours need boosting.

### 7. My Quests History View

Extend the quest UI beyond Active / In Progress to include a Completed history tab. Shows all past quest completions with timestamps. Lightweight progression signal — a log of accomplishment, not a badge system.

**Why great-to-have**: it's a feel-good feature that adds a sense of progression without violating the "no badges, no levels" philosophy. But it's purely UI — the backend already stores completion records. Can be shipped as a frontend-only update whenever it feels right.

---

## What We Deliberately Excluded

| Feature | Why excluded |
|---|---|
| Social media quests (follow, retweet, share) | Doesn't fill lobbies. Doesn't make the platform more alive. Violates design principle #1. |
| XP / levels / badges | Spec explicitly killed these. HEAT is the one number. |
| Redemption catalog / points shop | Points are a pre-TGE allocation signal, not a spendable currency. |
| Raffle-based quest rewards | Crates already have probabilistic rewards. Double-randomness is punishing. |
| Manual proof submission | Everything on Taunt is on-chain or observable through platform events. No screenshot uploads needed. |
| Quest marketplace / white-label | Building internal, not a service for others. |
| Complex targeting (geo, KYC, segments) | Wallet-only auth, no KYC, no geo restrictions at M1. Simple eligibility rules suffice. |
| Watch time / spectator quests | Taunt has no spectator mode at M1. Players play. |
| Shareable achievement cards | Organic sharing moment is winning a big pot. Manufactured achievement cards are weaker signal. |

---

## MVP Scope Summary

**Ship with M1:**

- Challenge engine core (CRUD, rule evaluation, progress, completion)
- 8 verification adapters
- Template-based challenge definitions
- Campaign container (Daily, Weekly, Onboarding)
- Completion bonus mechanic
- Reward service (separate, emits crate drops + point grants)
- Anti-gaming eligibility checks + fraud flags + clawback
- Onboarding quest chain (4-step, one-time)
- Admin create/edit/publish console
- Analytics event emission on every state transition

**Build after M1 validates:**

- Pool rotation with dynamic lobby weighting
- Event-triggered ephemeral quests
- Quest completion leaderboard
- Game-specific quest chains
- KOL-triggered challenges
- Flash quests
- Quest history UI
