# Privacy Model

This document describes what wallet ↔ identity exposure exists in our system, what we do to limit casual leaks, and what residual exposure is fundamental to the architecture and cannot be closed at the API layer.

## What we expose by design

- **Public usernames + avatars** for any registered player. Visible in leaderboards, chat, match listings, and public profiles.
- **On-chain match/round accounts**, signed by player wallets. These are public to anyone running a Solana RPC client. Wallets show up in `creator`, `joiner`, and per-entry positions on every game program account.

## What our public API does **not** expose

- **Wallet pubkeys for other players** in any game-round/match response. As of 2026-05-04, the following endpoints return a wallet-free `PlayerRef = { userId, username, avatarUrl }` for `creator`, `winner`, and `entries[].player`:
  - `GET /flip-you/by-id/{matchId}` · `GET /flip-you/history` · `GET /flip-you/verify/{pda}`
  - `GET /pot-shot/current` · `GET /pot-shot/by-id/{matchId}` · `GET /pot-shot/history` · `GET /pot-shot/verify/{pda}`
  - `GET /closecall/current-round` · `GET /closecall/by-id/{roundId}` · `GET /closecall/history`
- **No `wallet → user` resolver endpoint**. There is intentionally no `POST /profiles/by-wallets`. We do not publish a directory mapping wallets to usernames.
- **No on-chain enumeration required from the frontend** for Flip You lobby/match listings. The webapp uses backend listings (`GET /flip-you/open` for the lobby, `GET /flip-you/mine` for the caller's matches, `GET /flip-you/by-id` for live match state) instead of `getProgramAccounts` / `program.account.flipYouMatch.fetch`. This matches the pattern already used by Pot Shot and Close Call. The on-chain accounts themselves remain public — anyone running an RPC client can still enumerate them; we just no longer require our users to do so.

## Residual exposure (we will not lie about this)

Closing the on-chain ↔ off-chain mapping is **architecturally infeasible** in the current trust model:

1. Anyone can call `getProgramAccounts(<our_program_id>)` on a Solana RPC and receive every match/round account, including the `creator`/`joiner`/entry pubkeys.
2. Each on-chain account carries the `match_id` (or minute-`round_id` for Close Call) used as PDA seed.
3. Our public `*/by-id/*` endpoints look up the same `match_id` and return a `PlayerRef` for the participants.

A scraper joining (1)+(3) reconstructs `wallet ↔ (userId, username, avatarUrl)` for every active and historical participant. Removing the `by-id` endpoints does not solve this — the same join can be performed via `/history` (the wallet-free response still returns the same `match_id`s, joined back to chain).

The only architectures that break this join are:

- **Custodial/pooled treasury** — players deposit into a single platform PDA and play under usernames inside our system. On-chain wallets never enter rounds.
- **Per-match throwaway PDAs not signed by the user wallet**. Loses the trust property that backs commit-reveal fairness.

Both are large architectural changes and are out of scope for the current platform.

## What this change does buy

- **No casual leak.** No browser-devtools inspection, no third-party API consumer, and no screenshot of an API response will surface another player's wallet.
- **No directory.** We do not publish a wallet → identity index that scrapers without on-chain tooling could trivially walk.
- **Forward compatibility.** Any future privacy feature (anonymous mode, pseudonymous handles per match, custodial play) can land without retroactively unpublishing wallet fields.

## Harm reduction we may add later

These are not part of the current change but are reasonable next steps if the threat model demands more:

- **Anonymous mode** opt-in: render the player as `Player#NNNN` in match/round responses while keeping their real username on their own profile, leaderboard (opt-in), and chat.
- **Aggressive rate-limiting** on `*/by-id/*` and `*/history` endpoints to slow bulk on-chain ↔ API joining.
- **Strip lamport amounts from public listings** at finer granularity (e.g. don't pair username with exact won-amount in the public ticker). Reduces social value of any scraped mapping.
- **Per-day public-history cap**: serve only the recent N days of round history to unauthenticated callers; require auth (or hide entirely) for older rounds. Limits corpus growth.

## Operator/admin contexts

- **Peek admin** (`peek/`): intentionally shows full wallets for support / audit / incident-response purposes. Access is gated behind operator auth; treat the operator pool as trusted.
- **Internal events** (settlement, fee allocation, operator events): wallets are stored internally for on-chain operations. They never leak through public endpoints.

## When in doubt

If you are adding a new public endpoint that touches game state, pre-resolve any wallet to a `PlayerRef` server-side using `resolveWalletRefs()` from `backend/src/utils/player-ref.ts`. Do not return raw wallet strings to clients.
