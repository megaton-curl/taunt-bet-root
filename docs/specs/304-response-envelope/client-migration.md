# 304 — Client Migration Guide

Backend spec: [`spec.md`](./spec.md).

This doc tells every client in this repo how to adopt the new API envelope
contract introduced by 304. Every public JSON response now uses one of two
shapes:

```ts
// Success (any 2xx)
{ ok: true, data: T }

// Error (any non-2xx)
{ ok: false, error: { code: string; message: string; retryable?: boolean; details?: unknown } }
```

HTTP status codes stay semantically meaningful (`401`, `403`, `404`, `409`,
`422`, `429`, `503`, etc.). Clients branch on status where they already did;
the only body-shape change is unwrapping `.data` on success and reading
`.error.code` / `.error.message` on failure.

`204 No Content` responses (currently only `POST /auth/logout`) keep no body.

---

## Rollout Order (Atomic Switch)

Per spec refinement (2026-04-22): **atomic switch, no tolerant shim, no feature
flag.** Backend and clients cut over together.

1. **Backend** — merged in this spec's iterations 1–23. All public routes now
   emit envelopes.
2. **Telegram bot** (`telegram/`) — merged in iteration 24. Already consumes
   envelopes; reference implementation for other clients.
3. **Waitlist** (`waitlist/`) — separate project, needs a coordinated deploy
   with the backend cutover. Follow the per-file diffs in §Waitlist below.
4. **Webapp** (`webapp/`) — separate project, same coordinated deploy window.
   Follow the per-file diffs in §Webapp below.

Because there is no tolerant shim, the backend cutover deploy must go out at
the same time as the client deploys, or clients must ship their envelope
parsers first (they tolerate the old shape only if written defensively — see
`isEnvelope()` below). The simplest sequence is:

1. Ship the client envelope parsers to staging pointed at a backend running
   the new envelope contract.
2. Promote backend → waitlist → webapp to production in one window.
3. Revert is a coordinated rollback of the same set.

There is no `docs/TECH_DEBT.md` entry because the cutover is clean — no
shipped code expects the old `{ error: "..." }` shape after the deploy
window closes.

---

## Canonical Parser (copy into each client)

Every client adds the same envelope types and a single guard. The telegram
bot's parser (`telegram/src/backend-client.ts:30-111`) is the reference.

```ts
interface ApiEnvelopeSuccess<T> { ok: true; data: T }
interface ApiEnvelopeError {
  ok: false;
  error: { code: string; message: string; retryable?: boolean; details?: unknown };
}
type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}
```

On success, return `envelope.data`. On error, throw/return something that
carries `envelope.error.code` and `envelope.error.message` plus the HTTP
status (so callers can still branch on `401` / `404` / `409` / `429`).

---

## Telegram — `telegram/src/backend-client.ts`

**Status:** ✅ Migrated in iteration 24. Use as the reference implementation.

**After** (`telegram/src/backend-client.ts:89-111`):

```ts
async function parseEnvelope<T>(
  op: string,
  response: Response,
): Promise<ApiEnvelope<T> | null> {
  try {
    const body = (await response.json()) as unknown;
    if (!isEnvelope<T>(body)) {
      logger?.error("backend response missing envelope", { op, status: response.status });
      return null;
    }
    return body;
  } catch (error) {
    logger?.error("backend response parse failed", { op, status: response.status, error });
    return null;
  }
}
```

**Per-endpoint success extraction** (`backend-client.ts:113-128`):

```ts
const envelope = await parseEnvelope<{ userId: string }>("getLinkedUserId", response);
if (!envelope || !envelope.ok) return null;
return envelope.data.userId;
```

**Per-endpoint error-code branching** (`backend-client.ts:165-174`):

```ts
switch (envelope.error.code) {
  case "TELEGRAM_ALREADY_LINKED": return { ok: false, error: "TELEGRAM_ALREADY_LINKED" };
  case "TELEGRAM_TOKEN_EXPIRED":  return { ok: false, error: "TOKEN_NOT_FOUND" };
  case "AUTH_REQUIRED":           return { ok: false, error: "UNAUTHORIZED" };
  default:                        return { ok: false, error: "UNKNOWN" };
}
```

Mapping table used by the telegram service-auth routes:

| Backend `error.code`       | Telegram `RedeemLinkResult.error` |
|----------------------------|------------------------------------|
| `TELEGRAM_ALREADY_LINKED`  | `TELEGRAM_ALREADY_LINKED`          |
| `TELEGRAM_TOKEN_EXPIRED`   | `TOKEN_NOT_FOUND`                  |
| `AUTH_REQUIRED`            | `UNAUTHORIZED`                     |
| anything else              | `UNKNOWN`                          |

---

## Waitlist

### `waitlist/src/lib/auth-api.ts`

Endpoints: `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/refresh`,
`POST /auth/logout`.

**Before** (`waitlist/src/lib/auth-api.ts:29-39`):

```ts
async function parseResponse<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    const msg = typeof json?.error === "string"
      ? json.error
      : `Auth request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}
```

**After**:

```ts
async function parseResponse<T>(res: Response): Promise<T> {
  // POST /auth/logout is 204, no body.
  if (res.status === 204) return undefined as unknown as T;

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !("ok" in body)) {
    throw new Error(`Auth request failed (${res.status})`);
  }
  if (!body.ok) {
    throw new Error(body.error.message || `Auth request failed (${res.status})`);
  }
  return body.data;
}
```

**Error codes to expect** (all `401` on the auth flows):

| Status | `error.code`              | When                        |
|--------|---------------------------|-----------------------------|
| 401    | `INVALID_SIGNATURE`       | `/auth/verify` bad sig      |
| 401    | `CHALLENGE_EXPIRED`       | `/auth/verify` reused nonce |
| 401    | `REFRESH_TOKEN_INVALID`   | `/auth/refresh` bad token   |
| 422    | `VALIDATION_FAILED`       | malformed body              |

No status-based branching currently; none needs to be added.

### `waitlist/src/lib/referral-api.ts`

Endpoints: `GET /public-referral/code/:code`, `POST/GET /referral/code`,
`POST /referral/apply`, `GET /referral/referrer`, `GET /referral/stats`,
`GET /referral/referrals`.

**Before** (`waitlist/src/lib/referral-api.ts:44-57`):

```ts
async function parseResponse<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    const err = json?.error;
    const msg = typeof err === "string"
      ? err
      : typeof err?.message === "string"
        ? err.message
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}
```

**After** — same pattern as `auth-api.ts` plus expose status/code so callers
can branch (self-referral is `409`, invalid code is `422`, etc.):

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !("ok" in body)) {
    throw new ApiError(`Request failed (${res.status})`, res.status, "UNKNOWN");
  }
  if (!body.ok) {
    throw new ApiError(body.error.message, res.status, body.error.code);
  }
  return body.data;
}
```

**`checkReferralCode` probe** (`referral-api.ts:68-82`) — no change needed
beyond shape. Current behaviour "anything non-ok or throwing returns false"
still works, but update the success branch to read `.data.exists`:

```ts
const res = await fetch(`${BACKEND_URL}/public-referral/code/${code}`);
if (!res.ok) return false;
const body = (await res.json()) as ApiEnvelope<{ exists: boolean }>;
return body.ok && body.data.exists === true;
```

**Error codes to expect**:

| Status | `error.code`          | Endpoint                              |
|--------|-----------------------|----------------------------------------|
| 409    | `CODE_ALREADY_SET`    | `POST /referral/code`                  |
| 409    | `CODE_TAKEN`          | `POST /referral/code`                  |
| 422    | `INVALID_CODE`        | `POST /referral/code`, `/apply`        |
| 409    | `SELF_REFERRAL`       | `POST /referral/apply`                 |
| 409    | `ALREADY_LINKED`      | `POST /referral/apply`                 |
| 404    | `CODE_NOT_FOUND`      | `POST /referral/apply`                 |
| 404    | `PROFILE_NOT_FOUND`   | any authenticated `/referral/*`        |

### `waitlist/src/components/TelegramCard.tsx`

Endpoint: `POST /telegram/generate-link`.

**Before** (`waitlist/src/components/TelegramCard.tsx:56-67`):

```ts
if (!res.ok) throw new Error("Failed");
const data = await res.json();
if (data.alreadyLinked) {
  setState({
    step: "linked",
    botUrl: data.botUrl ?? null,
    communityUrl: data.communityUrl ?? null,
  });
} else {
  setState({ step: "idle" });
}
```

**After** — add the envelope unwrap; the rest of the flow is unchanged:

```ts
if (!res.ok) throw new Error("Failed");
const envelope = (await res.json()) as ApiEnvelope<{
  alreadyLinked?: boolean;
  telegramUserId?: string;
  telegramUsername?: string | null;
  linkedAt?: string;
  token?: string;
  deepLink?: string;
  expiresAt?: string;
  botUrl: string | null;
  communityUrl: string | null;
}>;
if (!envelope.ok) throw new Error(envelope.error.message);
const data = envelope.data;
if (data.alreadyLinked) {
  setState({
    step: "linked",
    botUrl: data.botUrl ?? null,
    communityUrl: data.communityUrl ?? null,
  });
} else {
  setState({ step: "idle" });
}
```

Apply the same unwrap inside `handleJoin` (lines 92-100) — read `data.deepLink`
from the envelope's `.data`, not the raw body.

Backend always returns `200` here (already-linked and new-token both success)
so there's no new error-code handling to add; the existing catch-all
`setState({ step: "error" })` on any throw is sufficient.

---

## Webapp

### `webapp/src/lib/api.ts`

Central helper used by most authenticated surfaces. The `ApiError` class
already carries `status`; extend it with `code` so callers can branch on
the envelope's error code.

**Before** (`webapp/src/lib/api.ts:13-46`):

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}
```

**After**:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string = "UNKNOWN",
    public details?: unknown,
  ) { super(message); }
}

interface ApiEnvelopeSuccess<T> { ok: true; data: T }
interface ApiEnvelopeError {
  ok: false;
  error: { code: string; message: string; retryable?: boolean; details?: unknown };
}
type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

export async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !("ok" in body)) {
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }
  if (!body.ok) {
    throw new ApiError(
      body.error.message,
      res.status,
      body.error.code,
      body.error.details,
    );
  }
  return body.data;
}
```

**Why add `code`:** `webapp/src/lib/parse-transaction-error.ts:60-80` already
branches on `status` (401/409/429). With `code` in hand, callers that need
more granular behavior (e.g. "distinguish `ROUND_NOT_FOUND` from
`PROFILE_NOT_FOUND`" or "show a specific message for `SELF_REFERRAL`") can do
so without parsing `message` strings.

**Existing `err.status === 404` checks still work** — `status` is unchanged.
See `profile-data.ts` below.

### `webapp/src/lib/auth/api.ts`

Same pattern as `waitlist/src/lib/auth-api.ts` — the files are near-duplicates.

**Before** (`webapp/src/lib/auth/api.ts:35-42`):

```ts
async function parseResponse<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    const msg = typeof json?.error === "string"
      ? json.error
      : `Auth request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}
```

**After**:

```ts
async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !("ok" in body)) {
    throw new Error(`Auth request failed (${res.status})`);
  }
  if (!body.ok) {
    throw new Error(body.error.message || `Auth request failed (${res.status})`);
  }
  return body.data;
}
```

Same expected error codes as the waitlist auth client
(`INVALID_SIGNATURE`, `CHALLENGE_EXPIRED`, `REFRESH_TOKEN_INVALID`).

### `webapp/src/lib/parse-transaction-error.ts`

Mixed consumer: parses Solana tx errors and backend errors (detected by
`{ status, message }` shape).

**Before** (`webapp/src/lib/parse-transaction-error.ts:60-80`):

```ts
function checkBackendRequestError(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as Record<string, unknown>).status === "number" &&
    "message" in err
  ) {
    const status = (err as { status: number }).status;
    const message = (err as { message: string }).message;
    if (status === 401) return "Backend authentication failed. Please approve message signing and try again.";
    if (status === 409) return "Action failed due to a conflict — please retry.";
    if (status === 429) return "Too many attempts. Please wait a moment and try again.";
    return message;
  }
  return null;
}
```

**After** — no structural change needed. `ApiError` already exposes `status`
and `message`, and with the `code` addition callers can (optionally) pick
more specific messages:

```ts
function checkBackendRequestError(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as Record<string, unknown>).status === "number" &&
    "message" in err
  ) {
    const status = (err as { status: number }).status;
    const message = (err as { message: string }).message;
    const code = (err as { code?: string }).code;

    if (status === 401) return "Backend authentication failed. Please approve message signing and try again.";
    if (status === 403) return "Wallet doesn't match your logged-in account.";
    if (status === 409) {
      if (code === "MATCH_PHASE_INVALID") return "This match can't accept joins right now.";
      return "Action failed due to a conflict — please retry.";
    }
    if (status === 429) return "Too many attempts. Please wait a moment and try again.";
    if (status === 503 && code === "PRICE_UNAVAILABLE") return "Price feed temporarily unavailable. Please try again.";
    return message;
  }
  return null;
}
```

The file keeps its existing status-based branches; new `code` reads are
additive and optional.

### `webapp/src/pages/profile/profile-data.ts`

No parser changes — all calls flow through `authFetch<T>` so the envelope
unwrap is transparent. Existing 404 catches keep working because `status`
is preserved.

**Unchanged behaviour** (`webapp/src/pages/profile/profile-data.ts:92-106`):

```ts
export function useReferralCode(enabled: boolean) {
  return useQuery({
    queryKey: ["referral", "code"],
    queryFn: async () => {
      try {
        return await authFetch<{ code: string }>("/referral/code");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled,
    staleTime: Infinity,
  });
}
```

One behavioural note: after 304, `GET /referral/code` returns `200 { ok: true,
data: { code: string | null } }` for the "no code yet" case (FR-7), not `404`.
The `err.status === 404` branch now only fires for legitimate
`PROFILE_NOT_FOUND` responses. Adjust the callers so `{ code: null }` is
treated the same as the previous `null` return:

```ts
queryFn: async () => {
  try {
    const body = await authFetch<{ code: string | null }>("/referral/code");
    return body.code;                       // null when the user has no code yet
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
},
```

Same normalization applies to `useReferrer` (`profile-data.ts:120-134`):
`GET /referral/referrer` now returns `200` with all-nullable fields instead
of `404` when no referrer is linked. Treat `data.referrerUserId === null` as
the empty state and keep the 404 catch only for defense-in-depth.

**`useSolPrice`** (`profile-data.ts:76-88`) bypasses `authFetch`. Update the
inline parse:

```ts
queryFn: async () => {
  const res = await fetch(`${BACKEND_URL}/price/sol-usd`);
  if (!res.ok) return null;                 // 503 PRICE_UNAVAILABLE or network
  const body = (await res.json()) as ApiEnvelope<{ price: number; updatedAt: string }>;
  return body.ok ? body.data.price : null;
},
```

---

## Migration Checklist (per client)

For each client repo:

- [ ] Add the `ApiEnvelope<T>` types and `isEnvelope()` guard.
- [ ] Update the central fetch helper (`authFetch` / `parseResponse`) to
      unwrap envelopes and throw with `status` + `code` + `message`.
- [ ] Update any inline `fetch().then(r => r.json())` call sites that don't
      go through the helper (e.g. `TelegramCard.tsx`, webapp `useSolPrice`).
- [ ] Update 404 handlers where the backend now returns `200` with nullable
      data (waitlist + webapp `referral/code`, webapp `referral/referrer`).
- [ ] Grep for `json.error` / `body.error` reads to confirm nothing still
      assumes `{ error: "..." }` at the root.
- [ ] Run the client's typecheck and tests.
- [ ] Smoke test: sign-in, invalid-refresh, referral-self-referral (should
      surface the envelope error code/message cleanly).

---

## Testing Reference

- Backend envelope helpers: `backend/src/contracts/api-envelope.ts` (+ unit tests in `backend/src/__tests__/api-envelope.test.ts`)
- Error-code catalog: `backend/src/contracts/api-errors.ts`
- OpenAPI contract test: `backend/src/__tests__/openapi-contract.test.ts`
- Waitlist contract test: `backend/src/__tests__/waitlist-contract.test.ts`
- Telegram client tests: `telegram/src/__tests__/backend-client.test.ts`
