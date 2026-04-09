**TAUNT \- Platform Features → v1 (Living Document)**

**Public:**

* Profile pic, username, bio, stats block and a heat metric that serves as the only progression mechanic (volume and wins).  
* Need ability to send link to public profile  
* Shows connected X/Discord socials, and the referral link if set up.  
* Stats shown: games played, total wagered, total wins, win rate, win streak (current and all-time), net PnL, game breakdown by type.

**Private:**

* Includes public profile information plus full transaction history with fairness proof links per game.

**Settings:**

* Displays connected wallet address and offers an option to link X and Discord for profile display.

The Multiplier \- HEAT / BAND / BODY COUNT → VIP TIER

This single number, purely a function of lifetime wagered volume, governs all rewards:

* Points earned per dollar wagered (pre- and post-TGE).  
* Loot Crate drop rate probability.  
* **Progression:** Starts at **\[TBD 1\]x**, reaches meaningful territory at **\[TBD 2-3\]x** at mid-level volume, and caps at **\[TBD 5\]x** for the highest-volume players.  
* **Design Consideration:** The progression experience must feel dynamic and alive, especially during gameplay.  
* **Curve:** The multiplier curve should flatten as it goes up (logarithmic, not linear forever).  
* **Open Question:** Use a **Global / Lifetime multiplier \* Seasonal multiplier** to avoid discouraging newer players.

Points System (Pre-TGE)[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Accrual:** Points are earned by wagered volume, accelerated by the HEAT multiplier.  
* **Conversion:** Points convert to **$TAUNT** proportionally at TGE.  
* **Visibility:** Points are visible on the profile and on leaderboards.  
* **Airdrop 1 Targets:** **\[TBD 10m\]** tokens distributed based on a snapshot of **\[TBD 1m\]** points across **\[TBD 10,000\]** players.  
* **Action Required:** Define the **points emission rate (points/$)**.  
* **Action Required:** Define the **end date of Season 1** based on the TGE date.  
* **Open Question:** Leaderboard structure (Seasonal?).

Quests[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **TODO: QUEST LIST** (Daily quests reset at 00:00 UTC; Weekly quests reset Monday).  
* **Goal:** Quests must promote platform activity, lobby filling, or social benefit.  
* **Reward:** Completing a quest drops a Loot Crate.  
* **Launch Scope:** Season 1 tasks are fixed; S2 onwards will move toward rotating quests.  
* **Progression Examples:** Change your nickname, Play 1 game, Play each game once.   
* **Other Examples:** Face 5 unique opponents, Create 1 game that gets filled, Play during a Dogpile window.  
* **Weekly Tasks:** Awaiting definition.

Loot Crates[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **TODO: CRATE PROBABILITIES** (The probability of a good drop is multiplied by the HEAT multiplier).  
* **V2 Idea:** Allow users to buy/sell loot crates that can contain items like temporary HEAT increases.  
* **Expiration:** Loot crates can expire after each season.  
* **Illustrative Drop Table (Needs Finalized Probabilities and Amounts):**[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * Small points bundle: **\[TBD %\]**  
  * Medium points bundle: **\[TBD %\]**  
  * Large points bundle: **\[TBD %\]**  
  * SOL drop: **\[TBD %\]**  
  * Large SOL drop (**\[TBD SOL AMOUNT\]**): **\[TBD %\]**  
* **IDEA:** Large SOL drop could be a **\[TBD %\]** of the Incentive Pool.

Dogpile / Gangbang[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Mechanic:** A lobby-fill event running once every **6hrs** for a **60 minute window**.  
* **Multiplier:** Grants a **\[TBD 2\]x** multiplier to your existing HEAT for rewards.  
* **Volume Threshold:** A volume threshold (**\[TBD SOL VALUE\]** or dynamic amount) must be met; otherwise, the prize pool rolls over.  
* **Prize Pool:** Consists of a lump sum from the marketing budget plus a percentage of the Incentive Pool.  
* **Decision Required (Gangbang Multiplier):**  
  * Based on the pro-rata amount of wagered volume during an event (up to a maximum of **\[TBD 2\]x**).  
  * **OR** Give the same multiplier to everyone during the event (at the maximum of **\[TBD 2\]x**).  
* **Decision Required (Reward Structure):**  
  * Leaderboard race (Top 3 get the prize).  
  * **OR** Random drop (to incentivize smaller players).  
  * **OR** Two prizes (leaderboard / volume based **AND** random).

Weekly Leaderboard Races[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* Volume-based, resetting Monday 00:00 UTC, ranked by total wagered volume that week.  
* **Reward:** Top 10 get Crate drops (size scales with rank); Top 3 get a larger SOL or points drop.  
* Includes a Global leaderboard and separate leaderboards per game type.

Referral System[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Pre-launch:** Generate a link; attributed wallets are permanent. Public leaderboard of referral counts.  
* **KOL Earning:** KOLs earn a permanent percentage of platform fees, paid in SOL, claimable on-chain.  
* **Rate Scaling:** Rate scales with lifetime attributed volume from **\[TBD %\]** to **\[TBD %\]**.  
* **KOL Tiers (Placeholder Values):**  
  * TIER1: **\[TBD MIN\] \- \[TBD MAX\]** \- **\[TBD %\]**  
  * TIER2: **\[TBD MIN\] \- \[TBD MAX\]** \- **\[TBD %\]**  
  * TIER3: **\[TBD MIN\] \- \[TBD MAX\]** \- **\[TBD %\]**  
  * TIER4: **\[TBD MIN\] \+** \- **\[TBD %\]**  
* **Maintenance Rule:** To keep your tier, you must generate minimum **\[TBD %\]** of new player wagers in the last 6 months relative to your tier minimum threshold.  
  * *Example:* If you are Tier 3, you need to bring in minimum **\[TBD $ VALUE\]** worth of new player wagers (**\[TBD %\]** x **\[TBD $ THRESHOLD\]**) in 6 months to maintain your tier.

  \-

* **Player benefits:** Players who join via a referral link we give a Loot Crate

Incentive Pool & Financial Allocation[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Fees Collected:** Out of all the fees we collect (**\[TBD %\]** \* wagered\_volume):[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * **Profit** \= **\[TBD %\]** \* (fees \- referrals)[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * **Incentive\_Pool** \= **\[TBD %\]** \* (fees \- referrals)[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
    * This pool feeds Gangbangs, Weekly Leaderboards, and Loot Crates.  
* **Allocation of Incentive Pool (Need Final Percentages):**[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * x% goes toward Dogpile/Gangbangs[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * 100-x% goes toward the weekly leaderboards[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)  
  * x% goes toward loot crates[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

Landing Page \- The Pit[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Pre-connect:** Shows live activity (recent wins ticker, active game count by type, Dogpile status/countdown, total platform volume, biggest pot of the day).  
* **Post-connect:** Becomes the lobby, showing the open games board, Dogpile status, active quests, points balance, and Global Chat.

Global Chat[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* Single global chat visible on the main lobby screen for community interaction, minimally moderated for trash-talk.  
* Wallet addresses shown by default, username if set.

Provable Fairness Page[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* Each game has it’s own version of the fairness page, tailored to the specific mechanism employed  
* Loot create drops will need a provable fair mechanism as well

Waitlist[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Benefit 1:** Early access (e.g., 1 week).  
* **Benefit 2:** **\[TBD $ VALUE\]** in volume worth of Points (depending on emissions rates).

Telegram Bot (@taunt\_bot)[1](https://docs.google.com/document/d/19Sg7NUoz-U_4xaKa79vjwIZ9Zl0wdYirppjwVGmaVCo/edit)

* **Type:** Telegram Bot API (stateless, no wallet connection required).  
* **Primary Context:** Group chats, triggered via commands (works in DMs too).  
* **V1 Commands:**  
  * /start: Welcome message with platform/waitlist link.  
  * /profile \[taunt\_username\]: Replies with a link to the player’s public profile.  
  * /referral \[taunt\_username\]: Replies with that player’s referral link.  
  * /games: Short menu of available games with direct links to start a new game (Flip You, Jackpot, Close Call).  
  * /wen: Countdown to the next Dogpile window or status if active.  
  * /therapy: List of gambling support resources.  
  * /ngmi: Random one-liners from a rotating list.  
  * /challenge @tg\_username \[game\_id\] (future use case for link generation).  
* **V2 Commands (Future Implementation):**  
  * Link Telegram account to Taunt.BET account  
  * /stats @tg\_username: Returns the tagged user’s stats as a formatted message.  
  * /challenge @tg\_username \[game\_id\]: Direct challenge command that posts a message tagging the challenged user with a direct game link.

Share and Social

* We need shareable links with and without embedded referral codes  
* Shared links should have a contextual correct unfurl description

Dashboards

* KOL referral dashboard  
* Admin panel  
  * Admin authentication