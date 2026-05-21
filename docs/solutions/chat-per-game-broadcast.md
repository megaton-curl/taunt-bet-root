---
tags: [chat, realtime, sse, settlement]
area: platform
---

# Per-game chat broadcast topics for join + settle events

## Problem

The FE and the chain refresh at different times. A player watching a Flip You
or Pot Shot round would see a stale UI for several seconds after the opponent
joined or the round settled, until the next poll round-tripped. The existing
`TICKER_PUBLISH` event already publishes settled-game notifications, but it
fans them out to a single global `system` chat topic — every subscriber hears
about every game, which (a) wastes fan-out cost on uninterested clients and
(b) does not include join events at all.

## Decision

Introduce a second chat publish event, `GAME_BROADCAST`, scoped per game type:

- Topic naming: `system:<game>` — one of `system:flipyou`, `system:potshot`,
  `system:closecall`. The chat broadcaster fan-out is `O(listeners-on-topic)`,
  so per-game topics keep publish cost proportional to actual interest.
- Event kinds (discriminated union, see
  `backend/src/queue/handlers/game-broadcast.ts`):
  - `flipyou.match_joined` → `{ matchId, amountLamports }`
  - `flipyou.match_settled` → `{ matchId, winnerName?, side, amountLamports }`
  - `potshot.entry_added` → `{ matchId, totalEntries, totalPotLamports }`
  - `potshot.round_settled` → `{ matchId, winnerName?, prizeLamports, totalEntries }`
  - `closecall.round_settled` → `{ roundNumber, winningSide, poolLamports }`

The legacy `TICKER_PUBLISH` → `system` topic emit is **kept** in parallel —
that's what powers the global news ticker — so this change is additive and
non-breaking for existing FE consumers.

## Emit sites

- **Join (Flip You)** — `pda-watcher` `onJoinDetected` (lock transition).
  Wired in `backend/src/worker/start-background.ts`.
- **Entry added (Pot Shot)** — new `onLordEntryAdded` callback on
  `pda-watcher`. The watcher tracks the last seen `entries.length` per PDA
  and fires only when it strictly grows, so on-chain account-data churn does
  not produce duplicate broadcasts. Wired the same way.
- **Settle (Flip You / Pot Shot)** — `backend/src/worker/persist-settlement.ts`,
  inside the same DB transaction that already emits `GAME_SETTLED` +
  `TICKER_PUBLISH`. Atomic with the settlement write.
- **Settle (Close Call)** — `backend/src/worker/closecall-clock.ts`, same DB
  transaction. Refunds skipped (only `green` / `red` outcomes broadcast).

## Subscribing (FE contract)

A round page or lobby view should open one SSE stream per game it cares
about:

```
GET /feeds/system:flipyou/stream
GET /feeds/system:potshot/stream
GET /feeds/system:closecall/stream
```

`Last-Event-ID` replay is supported by the chat service, so brief
disconnects do not drop the settle event. Clients are expected to filter
by `matchId` if they only care about a specific round.

A round-detail page should refetch `GET /rounds/by-id/:matchId` (or the
Close Call equivalent) whenever its game's stream emits an event whose
`metadata.matchId` matches the page id.

## Why per-game and not per-match

Per-match (`match:<matchId>`) was considered and rejected for now: it would
require one SSE connection per open round page **and** per open lobby card,
which gets expensive on lobby views that surface ~20 live matches. Per-game
keeps the connection count bounded at 1 per game the client is interested
in, with client-side `matchId` filtering. If lobby viewership ever pushes
the broadcaster fan-out cost above what we observe, switching to multiplexed
multi-topic subscriptions over a single SSE is the next step — the publish
side does not need to change.

## Rollout

- Backend is shipped first and is additive (no removal, no contract break).
- Frontend (`webapp/`) is a separate project and is not modified here.
  Until FE subscribes to `system:<game>` topics, the new broadcasts are
  fan-out-to-zero and cost effectively nothing. There is no functional
  regression in the meantime — the legacy `system` ticker continues to
  receive settled events as before.

## Verification

- `cd backend && pnpm exec vitest run src/queue/__tests__/game-broadcast.test.ts`
- `cd backend && pnpm exec vitest run src/queue/__tests__/ticker-publish.test.ts`
- `cd backend && pnpm typecheck && pnpm lint`
