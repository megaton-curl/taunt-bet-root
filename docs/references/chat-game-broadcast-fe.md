# FE note — Per-Game Chat Broadcast Topics

**Status**: Backend ready (shipped 2026-05-21). Frontend adoption is the open
side; this doc is the contract.

The backend now publishes join + settle lifecycle events to **per-game**
chat-service topics so a round page / lobby card can refresh on the same
tick that the chain updates, without polling. Each game has its own topic;
subscribe only to the games whose UI is mounted.

## Subscribe endpoints

The chat service exposes the same SSE stream shape used by the existing
ticker, just at three new topic paths:

```
GET {CHAT_BASE_URL}/feeds/system:flipyou/stream
GET {CHAT_BASE_URL}/feeds/system:potshot/stream
GET {CHAT_BASE_URL}/feeds/system:closecall/stream
```

- No auth header required — these are public read-only feeds.
- Server-Sent Events. `Content-Type: text/event-stream`.
- Reconnect with `Last-Event-ID: <last seen event.id>` to replay anything
  missed during a brief disconnect. The chat service keeps a rolling buffer.
- A `event: ping` heartbeat fires every 15s. Use it to detect dead
  connections; no payload action needed.

### REST snapshot (optional, for cold loads)

```
GET {CHAT_BASE_URL}/feeds/system:<game>/events
→ { topic, events: FeedEvent[] }
```

Useful for hydrating the most recent N events on mount before the SSE
catches up. Same `FeedEvent` shape as below.

## SSE payload envelope

Each SSE message is named `feed` and the `data` field is JSON:

```ts
interface FeedEvent {
  id: string;        // UUID — pass back as Last-Event-ID on reconnect
  topic: string;     // "system:flipyou" | "system:potshot" | "system:closecall"
  kind: string;      // one of the event kinds below
  metadata: object;  // shape depends on `kind` (see below)
  createdAt: string; // ISO8601
}
```

Example wire frame:

```
event: feed
id: 1d5c…-uuid
data: {"id":"1d5c…","topic":"system:flipyou","kind":"flipyou.match_joined","metadata":{"matchId":"abcdef0123456789","amountLamports":"5000000000"},"createdAt":"2026-05-21T09:12:00.000Z"}
```

## Event kinds & metadata

Discriminated by `kind`. Treat anything unrecognized as a no-op (forward-
compat).

### `system:flipyou`

```ts
// kind: "flipyou.match_joined"
// Fires when the opponent joins and the match is now locked / ready to settle.
{
  matchId: string;         // 16-hex
  amountLamports: string;  // per-side wager
}

// kind: "flipyou.match_settled"
{
  matchId: string;
  winnerName?: string;     // username if known
  side: "heads" | "tails";
  amountLamports: string;  // payout to winner
}
```

### `system:potshot`

```ts
// kind: "potshot.entry_added"
// Fires when on-chain entry list grows. The backend dedupes; you will not
// see this twice for the same entry-count snapshot.
{
  matchId: string;
  totalEntries: number;
  totalPotLamports: string;
}

// kind: "potshot.round_settled"
{
  matchId: string;
  winnerName?: string;
  prizeLamports: string;
  totalEntries: number;
}
```

### `system:closecall`

```ts
// kind: "closecall.round_settled"
// Refund outcomes are NOT broadcast — only green/red resolutions.
{
  roundNumber: number;
  winningSide: "green" | "red";
  poolLamports: string;
}
```

## Recommended client pattern

Round-detail page (`/flip-you/:matchId`, `/pot-shot/:matchId`):

1. On mount, open the matching `system:<game>` SSE stream.
2. On each event, ignore anything whose `metadata.matchId` ≠ the page id.
3. On a match, trigger a single refetch of `GET /rounds/by-id/:matchId`
   (or the Close Call equivalent). Do **not** trust the SSE payload as the
   source of truth — it's a refresh signal. The REST endpoint stays
   authoritative.

Lobby / list views:

- Subscribe to the per-game stream and reconcile the lobby card whose
  `matchId` matches. Multiple cards share one stream — no per-card
  connection.
- For Close Call there is no `matchId`; key by `roundNumber`.

## Coexistence with the legacy `system` ticker

The backend still publishes settled-game events to the global `system`
topic for the existing news ticker. That feed is unchanged. The new
per-game topics are additive — subscribe to them in addition to or instead
of `system` depending on the surface.

## Rollout / verification

- Backend lives in `backend/src/queue/handlers/game-broadcast.ts` and is
  emitted from `worker/pda-watcher.ts`, `worker/persist-settlement.ts`, and
  `worker/closecall-clock.ts`.
- Decision record: `docs/DECISIONS.md` → "Per-Game Chat Topics For Lifecycle
  Broadcasts" (2026-05-21).
- Recipe: `docs/solutions/chat-per-game-broadcast.md`.
- To smoke-test locally, run a join on devnet and watch:
  `curl -N {CHAT_BASE_URL}/feeds/system:flipyou/stream`
