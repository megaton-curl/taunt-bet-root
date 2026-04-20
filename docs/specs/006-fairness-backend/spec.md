# Specification: [006] Fairness Backend — FlipYou MVP

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 21 |

---

## Overview

Off-chain service that holds server secrets and orchestrates the commit-reveal fairness
model defined in Spec 005 (Hybrid Fairness). Today the frontend generates secrets
client-side (dev-mode) for some flows — this service moves secret generation to the
server, co-signs creation transactions, watches for rounds that have reached their stored
entropy target, and settles them by revealing the secret on-chain.

FlipYou is the proven MVP path. Pot Shot now follows the same backend-assisted
pattern, with a game-specific timing contract: countdown starts when two distinct wallets
have entered, the round closes by wall time without a separate lock tx, and the backend
submits one settlement tx after the precomputed entropy slot.

## User Stories

- As a player, I want the server to generate and guard the secret so that neither I nor
  the server alone can predict the outcome.
- As a player, I want to create a match with a single wallet approval so that the
  experience feels instant despite server co-signing.
- As a player, I want my match settled automatically after my opponent joins so that I
  don't have to take any action to see the result.
- As an operator, I want locked matches settled within seconds of entropy availability
  so that players never wait unnecessarily.
- As a verifier, I want a public endpoint that serves the secret (post-settlement) and
  all inputs to the result formula so that I can independently confirm fairness.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: FlipYou (Phase 1), Backend Services
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 1 — required before flipyou can leave dev-mode fairness

## Required Context Files

- `docs/specs/005-hybrid-fairness/spec.md` — On-chain commit-reveal + slot hash model
- `docs/FOUNDATIONS.md` — Architecture patterns, testing strategy
- `docs/DECISIONS.md` — VRF provider decision, fee structure
- `solana/programs/flipyou/src/instructions/create_match.rs` — Account layout, signer requirements
- `solana/programs/flipyou/src/instructions/settle.rs` — Permissionless settlement, account layout, event shape
- `solana/programs/flipyou/src/state.rs` — `FlipYouMatch` fields, phases, `MatchSettled` event
- `solana/shared/src/fairness.rs` — `verify_commitment()`, `derive_result()`, `ALGORITHM_VERSION`
- `solana/shared/src/fees.rs` — `calculate_net_payout()` (fee_bps read from PlatformConfig)

## Contract Files

- `backend/packages/fairness/src/commitment.ts` — `computeCommitment()`, `verifyCommitment()` (reuse in backend)
- `backend/packages/anchor-client/src/flipyou.json` — Typed IDL for tx building

---

## Core Design

### Architecture

Single Node.js/TypeScript process using **Hono** (lightweight HTTP framework) with three
internal modules:

```
┌─────────────────────────────────────────────┐
│                 Fairness Service             │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Signing  │  │Settlement│  │  Rounds   │ │
│  │ Module   │  │ Worker   │  │  Module   │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │       │
│       └──────────┬───┘──────────────┘       │
│                  │                          │
│           ┌──────┴──────┐                   │
│           │  Postgres   │                   │
│           │  (rounds +  │                   │
│           │   events)   │                   │
│           └─────────────┘                   │
└─────────────────────────────────────────────┘
```

**Signing Module** — Handles `POST /fairness/flipyou/create`. Generates secret,
computes commitment, builds the `create_match` transaction using the flipyou IDL,
partially signs with the server keypair, returns the serialized transaction to the caller.

**Settlement Worker** — Polls for matches in PHASE_LOCKED where `target_slot` has been
reached. Reads entropy, builds and submits the `settle` transaction with the stored secret.
Retries on transient failures; logs to `operator_events`.

**Rounds Module** — Handles `GET /fairness/rounds/:pda`. Serves round lifecycle data
and verification payloads. Reads from DB, redacts secret for unsettled rounds.

### Signer Model

One server keypair for MVP, loaded from environment (`SERVER_KEYPAIR`). This keypair:
- Co-signs `create_match` transactions (appears as `server: Signer` in the instruction)
- Pays the settlement transaction fee (~0.000005 SOL per settle)
- Does NOT need to be the same key that calls `settle` (settle is permissionless — anyone
  with the secret can call it), but using the server key simplifies operational monitoring

Future: split into separate signing authority (cold, for create) and settlement authority
(hot, for settle). The on-chain program already supports this — `settle` has no server
signer constraint.

### Transaction Flow

```
Player                    Backend                     Chain
  │                          │                          │
  ├─ POST /create ──────────►│                          │
  │ {amountLamports, side, wallet} │                   │
  │                          │─ generate secret         │
  │                          │─ commitment = sha256()   │
  │                          │─ build create_match tx   │
  │                          │─ server partial-sign     │
  │                          │─ store secret in DB      │
  │◄─ {tx, matchPda} ───────│                          │
  │                          │                          │
  ├─ co-sign + submit ─────────────────────────────────►│
  │                          │                          │─ create match PDA
  │                          │                          │
  │         ... opponent joins (user-submitted) ...     │
  │                          │                          │─ PHASE_LOCKED, target_slot set
  │                          │                          │
  │                          │◄── poll / subscription ──│
  │                          │─ wait for target_slot    │
  │                          │─ build settle tx         │
  │                          │─ submit settle ─────────►│
  │                          │                          │─ verify commitment
  │                          │                          │─ derive result
  │                          │                          │─ pay winner
  │                          │                          │─ emit MatchSettled
  │                          │                          │
  │                          │─ update DB (settled)     │
```

### Database Schema

Two tables — `rounds` for state, `operator_events` for append-only audit trail.

#### `rounds`

| Column | Type | Notes |
|--------|------|-------|
| `pda` | `TEXT PRIMARY KEY` | Base58 match PDA address |
| `game` | `TEXT NOT NULL` | `'flipyou'` (extensible later) |
| `creator` | `TEXT NOT NULL` | Base58 creator wallet |
| `server_key` | `TEXT NOT NULL` | Base58 server pubkey used |
| `secret` | `BYTEA NOT NULL` | 32-byte server secret |
| `commitment` | `BYTEA NOT NULL` | SHA256(secret) |
| `amount_lamports` | `BIGINT NOT NULL` | Exact creator wager in lamports |
| `side` | `SMALLINT NOT NULL` | Creator's chosen side |
| `match_id` | `TEXT NOT NULL` | Backend-generated 8-byte random match ID (hex) |
| `phase` | `TEXT NOT NULL` | `created`, `locked`, `settling`, `settled`, `expired` |
| `target_slot` | `BIGINT` | Set when match transitions to locked |
| `settle_tx` | `TEXT` | Settlement tx signature |
| `settle_attempts` | `INT DEFAULT 0` | Retry counter |
| `result_hash` | `BYTEA` | 32-byte result (post-settlement) |
| `result_side` | `SMALLINT` | 0=Heads, 1=Tails (post-settlement) |
| `winner` | `TEXT` | Base58 winner address (post-settlement) |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | |

#### `operator_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGSERIAL PRIMARY KEY` | Auto-increment |
| `pda` | `TEXT` | Nullable — some events are system-level |
| `event_type` | `TEXT NOT NULL` | `secret_generated`, `tx_built`, `match_detected`, `settle_submitted`, `settle_confirmed`, `settle_failed`, `settle_retried`, `timeout_detected` |
| `payload` | `JSONB` | Event-specific data |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

**Indexes**: `rounds(phase)` for settlement worker queries, `rounds(creator)` for lookup,
`operator_events(pda, created_at)` for round history, `operator_events(event_type, created_at)` for monitoring.

---

## Functional Requirements

> **Note (2026-04-02)**: Frontend is now a separate project. Frontend criteria below were satisfied at completion time but are no longer maintained in this repo.

<!-- FR acceptance criteria checkboxes are audited by /gap-analysis after completion.
     Each checkbox gets an HTML comment annotation: satisfied/deferred/gap with evidence. -->

### FR-1: Secret Generation & Transaction Signing

The service generates a cryptographically secure secret, computes the commitment,
builds a `create_match` transaction with the server's partial signature, and returns it
to the requesting wallet for co-signing and submission.

**Endpoint**: `POST /fairness/flipyou/create`

**Authentication**: JWT Bearer token (see FR-5). The backend reads `userId` from the
JWT `sub` claim, resolves the wallet from the player profile, and cross-checks it against
the `wallet` field in the request body.

**Request body**:
```json
{
  "wallet": "<base58 creator pubkey>",
  "amountLamports": 100000000,
  "side": 0
}
```

**Response** (200):
```json
{
  "transaction": "<base64 serialized partial tx>",
  "matchPda": "<base58 PDA address>",
  "matchId": "<hex 8-byte match ID>",
  "commitment": "<hex commitment>",
  "lastValidBlockHeight": 312000000
}
```

**Acceptance Criteria:**
- [x] Secret is 32 bytes generated via Node.js `crypto.randomBytes(32)` (CSPRNG) <!-- satisfied: fairness.ts:10 — randomBytes(32) from node:crypto -->
- [x] Commitment is computed using the same algorithm as `packages/fairness/src/commitment.ts` (`sha256(secret)`) <!-- satisfied: fairness.ts:18 — createHash("sha256").update(secret).digest(); cross-checked in fairness.test.ts -->
- [x] Transaction is built using the flipyou IDL (`create_match` instruction) with correct accounts and args, passing `amountLamports` (not tier). Instruction data is 57 bytes: 8 disc + 32 commitment + 8 amount u64 LE + 1 side + 8 matchId <!-- satisfied: tx-builder.ts:56-80 — encodeCreateMatchData produces 57-byte buffer -->
- [x] Server keypair partially signs the transaction (server appears as `server: Signer`) <!-- satisfied: tx-builder.ts:96 isSigner:true + tx-builder.ts:120 tx.partialSign(serverKeypair) -->
- [x] User's wallet is set as fee payer — server pays zero on-chain cost for creation <!-- satisfied: tx-builder.ts:113 — feePayer: creator -->
- [x] Secret is stored in the `rounds` table keyed by match PDA before the response is returned <!-- satisfied: routes/create.ts:140-151 — db.insertRound({...secret...}) before response at line 172 -->
- [x] An `operator_events` entry of type `secret_generated` is written <!-- satisfied: routes/create.ts:164 — db.insertOperatorEvent(matchPdaStr, "secret_generated", {...}) -->
- [x] Match PDA is derived using seeds `["match", creator, match_id]` matching the on-chain program, where `match_id` is a backend-generated random 8-byte ID <!-- satisfied: fairness.ts — [Buffer.from("match"), creator.toBuffer(), matchId] -->
- [x] If the same PDA already exists in the DB (match ID collision), the endpoint returns 409 Conflict <!-- satisfied: routes/create.ts:104-111 (pre-check) + 150-158 (DB constraint). Tests: endpoints.test.ts, integration.test.ts -->
- [x] Recent blockhash is fetched at request time (transaction expires naturally via Solana's ~60s blockhash window) <!-- satisfied: tx-builder.ts:109-110 — connection.getLatestBlockhash() -->

### FR-2: Settlement Worker

A background process that detects locked matches and submits settlement transactions
once entropy is available.

**Acceptance Criteria:**
- [x] Worker polls the chain (via `getProgramAccounts`) for `FlipYouMatch` accounts in `PHASE_LOCKED` where the `server` field matches the service's keypair. Account size: 247 bytes. Offsets: server@72, phase@113, target_slot@147 <!-- satisfied: worker/settlement.ts:14-17 — ACCOUNT_SIZE=247, SERVER_OFFSET=72, PHASE_OFFSET=113, TARGET_SLOT_OFFSET=147; settlement.ts:53-69 — getProgramAccounts with memcmp filters -->
- [x] For each locked match, worker checks if `target_slot` has been reached (current slot >= target_slot) <!-- satisfied: worker/settlement.ts:95 — BigInt(currentSlot) >= targetSlot -->
- [x] Worker retrieves the stored secret from the `rounds` table using the match PDA <!-- satisfied: worker/settle-tx.ts:137 — db.getRoundByPda(pda), line 147 reads round.secret -->
- [x] Worker builds and submits the `settle` instruction with the secret, all required accounts (caller, match PDA, config, entropy, treasury, creator, opponent, system_program — 8 accounts, no profiles or platform_program CPI), and the server keypair as caller. Uses parallel RPC calls (`Promise.all` for getAccountInfo × 3 + getLatestBlockhash) <!-- satisfied: worker/settle-tx.ts:150-158 — Promise.all for 4 parallel fetches; settle-tx.ts:199-216 — 8 accounts in IDL order, signed with serverKeypair -->
- [x] On successful settlement, worker updates the round's DB phase to `settled` and stores `settle_tx`, `result_hash`, `result_side`, `winner` <!-- satisfied: worker/settle-tx.ts:258-264 — db.updateRoundPhase(pda, "settled", {settle_tx, result_hash, result_side, winner}) -->
- [x] On transient failure (tx dropped, blockhash expired, network error), worker retries up to 5 times with exponential backoff (base 2s, max 30s) <!-- satisfied: worker/retry.ts:19-21 MAX_RETRIES=5, BASE_DELAY_MS=2000, MAX_DELAY_MS=30000; retry.ts:156-175 -->
- [x] On permanent failure (commitment mismatch, invalid phase, account not found), worker marks the round as failed and logs to `operator_events` without retrying <!-- satisfied: worker/retry.ts:143-154 — PermanentSettleError → failedPdas.add, logs settle_failed -->
- [x] Worker poll interval is configurable (default: 1 second) <!-- satisfied: config.ts:78-80 WORKER_POLL_INTERVAL_MS default 1000; settlement.ts:133 setTimeout(loop, pollIntervalMs) -->
- [x] Worker logs each attempt to `operator_events` with type `settle_submitted`, `settle_confirmed`, `settle_failed`, or `settle_retried` <!-- satisfied: settle-tx.ts:155 (submitted), 267 (confirmed); retry.ts:106,147 (failed), 165 (retried) -->
- [x] If `resolve_deadline` has passed and settlement has not succeeded, worker logs a `timeout_detected` event (the on-chain timeout refund is triggered by any user, not by the backend) <!-- satisfied: worker/retry.ts:118-128 — isResolveDeadlinePassed checks offset 156, logs timeout_detected -->

### FR-3: Round State Storage

Postgres tables store the full lifecycle of each round with an append-only operator
event log for auditability.

**Acceptance Criteria:**
- [x] `rounds` table schema matches the design in Core Design section (all columns, types, constraints) <!-- satisfied: migrations/001_init.sql:3-22 — all 18 columns match spec exactly -->
- [x] `operator_events` table schema matches the design in Core Design section <!-- satisfied: migrations/001_init.sql:24-30 — id BIGSERIAL PK, pda TEXT, event_type TEXT NOT NULL, payload JSONB, created_at TIMESTAMPTZ -->
- [x] Phase transitions follow this state machine: `created` → `locked` → `settling` → `settled`; or `created` → `expired` (if tx never lands on-chain). The worker discovers matches on-chain via polling — no intermediate states needed for phases the backend can't directly observe. <!-- satisfied: db.ts:73-79 — VALID_TRANSITIONS defines exactly this state machine -->
- [x] Phase transitions are unidirectional — no backward transitions allowed at the application layer <!-- satisfied: db.ts:81-88 — assertPhaseTransition() throws on invalid transitions; settled/expired have empty allowed lists -->
- [x] `secret` column is stored as raw bytes, never logged or exposed in error messages <!-- satisfied: migrations/001_init.sql:8 BYTEA type; no log call in codebase outputs secret value -->
- [x] `updated_at` is set on every phase transition <!-- satisfied: db.ts:169 — updated_at = now() in every updateRoundPhase query -->
- [x] Database migrations are versioned and idempotent (can re-run safely) <!-- satisfied: migrate.ts:60-102 — _migrations tracking table, CREATE TABLE/INDEX IF NOT EXISTS -->
- [x] Indexes exist on `rounds(phase)`, `rounds(creator)`, `operator_events(pda, created_at)`, and `operator_events(event_type, created_at)` <!-- satisfied: migrations/001_init.sql:33-36 — all four indexes -->

### FR-4: Round Verification Endpoint

Public endpoint serving round lifecycle data and post-settlement verification payloads.

**Endpoint**: `GET /fairness/rounds/:pda`

**Response** (settled round):
```json
{
  "pda": "<base58>",
  "game": "flipyou",
  "phase": "settled",
  "commitment": "<hex>",
  "secret": "<hex>",
  "algorithmVersion": 1,
  "targetSlot": 312000000,
  "resultHash": "<hex>",
  "resultSide": 0,
  "winner": "<base58>",
  "settleTx": "<base58 tx signature>",
  "createdAt": "2026-03-11T12:00:00Z",
  "verification": {
    "commitmentCheck": "sha256(secret) == commitment",
    "resultFormula": "sha256(secret || entropy || pda || algorithmVersion)",
    "entropySource": "SlotHashes sysvar at target_slot"
  }
}
```

**Acceptance Criteria:**
- [x] Endpoint returns round data for any known PDA <!-- satisfied: routes/rounds.ts:57-65 — queries DB by PDA, returns formatRoundResponse() -->
- [x] For unsettled rounds (`phase` != `settled`), the `secret` field is omitted from the response <!-- satisfied: routes/rounds.ts:17,36 — isSettled check, secret only in if(isSettled) block. Test: integration.test.ts "unsettled round does not expose secret" -->
- [x] For settled rounds, the response includes `secret`, `resultHash`, `resultSide`, `winner`, and `settleTx` <!-- satisfied: routes/rounds.ts:37-41 — all five fields in settled response -->
- [x] Response includes a `verification` object with human-readable descriptions of the fairness checks <!-- satisfied: routes/rounds.ts:42-46 — {commitmentCheck, resultFormula, entropySource} -->
- [x] Endpoint returns 404 for unknown PDAs <!-- satisfied: routes/rounds.ts:61-63 — c.json({error: "Round not found"}, 404). Test: integration.test.ts, endpoints.test.ts -->
- [x] Response is JSON with consistent field naming (camelCase) <!-- satisfied: routes/rounds.ts:16-50 — pda, game, phase, commitment, createdAt, updatedAt, targetSlot, resultHash, etc. -->
- [x] No sensitive operational data (server keypair, internal IDs) is exposed <!-- satisfied: routes/rounds.ts:16-50 — server_key and internal IDs omitted from response -->

### FR-5: Request Authentication

Requests to state-changing endpoints are authenticated via JWT Bearer tokens issued
through a challenge-response auth flow. The old per-request Ed25519 signature middleware
(`middleware/auth.ts`) still exists in the codebase but is **not mounted** — `middleware/jwt-auth.ts`
is the active authentication middleware.

**Auth flow**:
1. `POST /auth/challenge` — client sends `{ wallet }`, backend returns `{ nonce, message, expiresAt }`
2. Wallet signs the human-readable `message` (Ed25519 over plaintext, one-time nonce)
3. `POST /auth/verify` — client sends `{ nonce, wallet, signature }`, backend returns `{ accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }`
4. Subsequent `POST /fairness/*` requests include `Authorization: Bearer <accessToken>`
5. Backend reads `userId` from JWT `sub` and resolves wallet from the player profile via `db.getProfileByUserId(userId)` — no wallet claim in JWT, no per-request wallet signature needed

**Acceptance Criteria:**
- [x] `POST /fairness/flipyou/create` requires a valid JWT Bearer token in the `Authorization` header <!-- satisfied: middleware/jwt-auth.ts wired at index.ts:65-68 on /fairness/* -->
- [x] JWT is verified as HS256, `sub` (`userId`) is extracted as the canonical request identity, and wallet is resolved from player profile <!-- satisfied: middleware/jwt-auth.ts — jwtVerify with HS256, c.set("userId", payload.sub); wallet resolved via db.getProfileByUserId(userId) -->
- [x] Create endpoint cross-checks the profile-resolved wallet against the `wallet` field in the request body (defense-in-depth) <!-- satisfied: routes/create.ts — resolved wallet !== body.wallet → 403 -->
- [x] Requests with missing, malformed, or expired tokens return 401 Unauthorized <!-- satisfied: middleware/jwt-auth.ts:26-30 (missing), jwt-auth.ts:48-53 (invalid/expired). Tests: auth.test.ts, endpoints.test.ts -->
- [x] `GET` endpoints (rounds, health) require no authentication <!-- satisfied: middleware/jwt-auth.ts:21-23 — if (c.req.method !== "POST") return next() -->
- [x] Auth endpoints (`/auth/*`) are not behind JWT middleware — they are the login flow <!-- satisfied: index.ts:41-62 — /auth routes mounted before /fairness JWT middleware -->
- [x] Challenge nonce is single-use (consumed atomically on verify) with configurable TTL (default: 300s) <!-- satisfied: routes/auth.ts:109 — authDb.consumeChallenge(); config.ts:58-60 CHALLENGE_TTL_SECONDS default 300 -->
- [x] Refresh token rotation with reuse detection (revokes entire token family on replay) <!-- satisfied: routes/auth.ts:208-214 — stored.revoked → revokeTokenFamily -->
- [x] Access token TTL is configurable (default: 86400s / 24h) <!-- satisfied: config.ts:61-64 ACCESS_TOKEN_TTL_SECONDS default 86400 -->

### FR-6: Health & Observability

Operational endpoints and structured logging for monitoring service health.

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "serverKey": "<base58 server pubkey>",
  "solBalance": 1.5,
  "dbConnected": true,
  "workerRunning": true,
  "unsettledCount": 3,
  "oldestUnsettledAge": 12
}
```

**Acceptance Criteria:**
- [x] `GET /health` returns server status including: service version, server public key, SOL balance of server keypair, DB connectivity, worker status, count of unsettled rounds, age (seconds) of oldest unsettled round <!-- satisfied: routes/health.ts:58-67 — all fields: status, version, serverKey, solBalance, dbConnected, workerRunning, unsettledCount, oldestUnsettledAge -->
- [x] Health endpoint requires no authentication <!-- satisfied: index.ts:67-76 — /health mounted outside /fairness/* middleware chain -->
- [x] All log output is structured JSON (timestamp, level, message, optional fields) <!-- satisfied: logger.ts:15-28 — JSON with timestamp, level, message + spread fields -->
- [x] Logs include round PDA context where applicable (settlement attempts, errors) <!-- satisfied: worker/retry.ts:110,125,136,151,170 — all log calls include pda field -->
- [x] No secrets or private keys appear in logs at any level <!-- satisfied: verified all log calls across all source files — none output secret or keypair data -->
- [x] SOL balance below a configurable threshold (default: 0.1 SOL) triggers a warning-level log on each health check <!-- satisfied: routes/health.ts:50-56 logger.warn(); config.ts:58 MIN_SOL_BALANCE default 0.1 -->
- [x] `operator_events` table is queryable for monitoring dashboards (no dedicated endpoint required for MVP; direct DB access is acceptable) <!-- satisfied: migrations/001_init.sql:24-36 — table with indexes on (pda,created_at) and (event_type,created_at) -->

### FR-7: Rate Limiting

Per-userId and global rate limits to prevent abuse of the create endpoint.

**Acceptance Criteria:**
- [x] `POST /fairness/flipyou/create` is rate-limited per userId (default: 10 requests per minute) <!-- satisfied: middleware/rate-limit.ts:74-86 per-userId window; config.ts:45-48 RATE_LIMIT_PER_WALLET default 10 -->
- [x] A global rate limit caps total create requests (default: 100 requests per minute) <!-- satisfied: middleware/rate-limit.ts:56-60 global window; config.ts:49-52 RATE_LIMIT_GLOBAL default 100 -->
- [x] Rate limiting is in-memory (no Redis dependency for MVP) <!-- satisfied: middleware/rate-limit.ts:44-45 — Map + SlidingWindow object, no external deps -->
- [x] Exceeded limits return HTTP 429 with a `Retry-After` header <!-- satisfied: middleware/rate-limit.ts:58-59 (global) and 82-83 (per-userId) — Retry-After header + 429. Test: rate-limit.test.ts -->
- [x] `GET` endpoints are not rate-limited for MVP <!-- satisfied: middleware/rate-limit.ts:48-50 — if (c.req.method !== "POST") return next(). Test: rate-limit.test.ts -->
- [x] Rate limit windows and thresholds are configurable via environment variables <!-- satisfied: config.ts:45-52 — RATE_LIMIT_PER_WALLET and RATE_LIMIT_GLOBAL env vars -->

---

## Success Criteria

- Server generates secrets and co-signs create transactions — frontend no longer holds secrets
- Locked matches are settled automatically within 10 seconds of entropy availability (p95)
- Settlement retry logic handles transient RPC failures without manual intervention
- Any settled round can be independently verified via the public rounds endpoint
- Service runs as a single process with < 100 MB memory footprint under normal load
- Zero SOL cost for match creation (server is signer but user is fee payer)

---

## Dependencies

- Spec 005 (Hybrid Fairness) — on-chain commit-reveal model must be implemented. **Spec 005 must set timeout to 300s** (not 120s) so that if the backend is down, players get a permissionless refund. The backend requires server co-sign for new games, so no new matches can be created during downtime anyway — timeout refund is the complete safety net.
- FlipYou program deployed with `server: Signer` on `create_match` and permissionless `settle`
- `packages/fairness/` — `computeCommitment()` and `verifyCommitment()` functions
- `packages/anchor-client/src/flipyou.json` — Typed IDL for transaction building
- Postgres instance (local Docker for dev, managed for production)
- Solana RPC endpoint with `getProgramAccounts` support

## Assumptions

- The on-chain flipyou program is already deployed with the Spec 005 commit-reveal model
- A single server keypair is sufficient for MVP (no key rotation during operation)
- In-memory rate limiting is acceptable (service restarts reset counters)
- Postgres is the only external dependency (no Redis, no message queue)
- The settlement worker is the only settler — no competing settlers for MVP
- Frontend will be updated separately to call the backend instead of generating secrets client-side

---

## Deferred Items

| Item | Rationale |
|------|-----------|
| Multi-game support (Crash, Pot Shot, Slots) | Prove the model on flipyou first; each game has different entropy capture timing |
| Key rotation / split authorities | Single keypair is fine for MVP; add when operational maturity requires it |
| WebSocket push for settlement notifications | Frontend already polls on-chain state; adding WS is a UX optimization, not a blocker |
| Redis-backed rate limiting | In-memory is sufficient until horizontal scaling is needed |
| Batch settlement (multiple matches per tx) | Premature optimization; single-match settlement is simpler to debug |
| Verification page / UI | The endpoint exists; a standalone verification UI is a frontend concern |
| Automated server keypair funding | Manual top-up for MVP; automate when tx volume justifies it |
| Horizontal scaling / multiple workers | Single process handles expected MVP load; scale when needed |
| Event-driven settlement (geyser/websocket subscription) | Polling is simpler and sufficient; switch if latency budget tightens |
| Metrics endpoint (Prometheus) | Structured logs + operator_events table is sufficient for MVP observability |
| Privileged historical entropy submission | Allow a backend-only function to submit a historical slot hash and settle matches that missed the SlotHashes window (~200s). Would enable recovery from extended backend outages without timeout refund. Requires on-chain changes (trusted caller + verified slot hash). |

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Secret is CSPRNG, commitment matches on-chain algorithm | Unit test: generate secret, compute commitment, verify against Rust `verify_commitment` | Test output |
| 2 | Partial tx is valid and co-signable | Integration test: build tx, user co-signs, submit to bankrun validator | Tx confirmation |
| 3 | Settlement worker detects locked matches | Integration test: create + join match in bankrun, verify worker picks it up within poll interval | Worker log + DB state |
| 4 | Settlement succeeds with correct secret | Integration test: full lifecycle in bankrun — create, join, settle, verify on-chain state | On-chain match PDA in PHASE_SETTLED |
| 5 | Settlement retries on transient failure | Unit test: mock RPC failure, verify retry with backoff, verify max retries respected | Test output + operator_events |
| 6 | Rounds endpoint redacts secret pre-settlement | HTTP test: GET round before settlement → no secret; after → secret present | Response body |
| 7 | Auth rejects invalid/expired JWT tokens | HTTP test: submit with missing token → 401; submit with expired token → 401; submit with valid token → 200 | Response status |
| 8 | Rate limiter enforces per-userId and global limits | HTTP test: exceed per-userId limit → 429; exceed global limit → 429 | Response status + Retry-After header |
| 9 | Health endpoint reports accurate state | HTTP test: check health with DB up/down, check balance reporting | Response body |
| 10 | Duplicate match ID returns 409 | HTTP test: create with colliding match PDA → 409 | Response status |

---

## Completion Signal

### Implementation Checklist

#### Infrastructure
- [x] [infra] Add PostgreSQL to devcontainer (done: installed via apt in Dockerfile + auto-start in startup.sh + `rng_utopia_dev` database created. `DATABASE_URL=postgresql://vscode@localhost:5432/rng_utopia_dev`)
- [x] [infra] Scaffold `backend/` package: `package.json` (name `@rng-utopia/backend`), `tsconfig.json`, Hono HTTP server entry point (`src/index.ts`), env config loader (`src/config.ts`) reading `DATABASE_URL`, `RPC_URL`, `SERVER_KEYPAIR`, `PORT`. Verify `pnpm install` and `pnpm build` succeed. Add `dev` script. (done: iteration 1)

#### Database
- [x] [backend] Postgres migrations: create `rounds` and `operator_events` tables matching the Core Design schema (all columns, types, constraints). Add indexes on `rounds(phase)`, `rounds(creator)`, `operator_events(pda, created_at)`, `operator_events(event_type, created_at)`. Use a simple migration runner (e.g. `postgres-migrations` or raw SQL files with version tracking). Migrations must be idempotent. (done: iteration 2)
- [x] [backend] DB client module (`src/db.ts`): connection pool (`pg` or `postgres` library), typed query functions for: `insertRound`, `updateRoundPhase`, `getRoundByPda`, `getRoundsByPhase`, `insertOperatorEvent`. Phase transitions must be unidirectional (application-level guard). `updated_at` set on every phase change. `secret` column never logged. (done: iteration 3)

#### Core Signing Module
- [x] [backend] Secret generation + commitment utilities (`src/fairness.ts`): generate 32-byte secret via `crypto.randomBytes(32)`, compute commitment using same algorithm as `packages/fairness/src/commitment.ts` (sha256). PDA derivation matching on-chain seeds `["match", creator, matchId]` where `matchId` is a backend-generated random 8-byte ID. Export typed functions. Add unit tests in `src/__tests__/fairness.test.ts`. (done: iteration 4)
- [x] [backend] Partial transaction builder (`src/tx-builder.ts`): build `create_match` instruction with raw Borsh encoding (57 bytes: 8 disc + 32 commitment + 8 amount u64 LE + 1 side + 8 matchId), set creator wallet as fee payer, server keypair as `server` signer. Partially sign with server keypair. Return base64-serialized transaction + match PDA + lastValidBlockHeight. Fetch recent blockhash at build time. (done: tx-builder.ts)
- [x] [backend] `POST /fairness/flipyou/create` endpoint handler (`src/routes/create.ts`): validate request body, generate secret, compute commitment, derive PDA, check for duplicate PDA in DB (409 Conflict), build + partial-sign tx, store round in DB (phase `created`), write `secret_generated` operator event, return `{transaction, matchPda, commitment}`. Wire into Hono router. (done: iteration 6)

#### Authentication & Rate Limiting
- [x] [backend] JWT auth middleware (`src/middleware/jwt-auth.ts`): verify HS256 JWT Bearer token on POST requests. Extract `userId` from `sub` claim, set on request context; wallet resolved from player profile when needed. Skip for GET routes. Old Ed25519 per-request signature middleware (`src/middleware/auth.ts`) retained but not mounted. Auth endpoints (`/auth/*`: challenge, verify, refresh, logout) in `src/routes/auth.ts` with challenge DB in `src/auth-db.ts`. (done: jwt-auth.ts + auth.ts routes)
- [x] [backend] Rate limiting middleware (`src/middleware/rate-limit.ts`): in-memory sliding window, per-userId limit (default 10/min via `RATE_LIMIT_PER_WALLET`), global limit (default 100/min via `RATE_LIMIT_GLOBAL`). Return 429 with `Retry-After` header. Apply only to POST routes. Counters reset on service restart (acceptable for MVP). (done: iteration 8)

#### Settlement Worker
- [x] [backend] Settlement worker poll loop (`src/worker/settlement.ts`): poll chain via `getProgramAccounts` for `FlipYouMatch` accounts in `PHASE_LOCKED` where `server` field matches service keypair. Check `target_slot` reached (current slot >= target_slot). Configurable poll interval (default 1s via `WORKER_POLL_INTERVAL_MS`). Start worker on service boot. Log `match_detected` operator event for newly discovered locked matches. (done: iteration 9)
- [x] [backend] Settle transaction builder + submission (`src/worker/settle-tx.ts`): retrieve secret from `rounds` table by PDA, build `settle` instruction with 8 accounts (caller, match PDA, config PDA, entropy account, treasury, creator, opponent, system_program — no profiles or platform_program CPI). Uses `Promise.all` for parallel RPC fetches (getAccountInfo × 3 + getLatestBlockhash). Entropy account address configurable via `ENTROPY_ACCOUNT` env var (mock for tests, SlotHashes sysvar for production). Submit with server keypair as caller. On success: update DB phase to `settled`, store `settle_tx`, `result_hash`, `result_side`, `winner`. Log `settle_submitted` / `settle_confirmed` operator events. (done: iteration 10)
- [x] [backend] Settlement retry logic (`src/worker/retry.ts`): on transient failure (tx dropped, blockhash expired, network error), retry up to 5 times with exponential backoff (base 2s, max 30s). On permanent failure (commitment mismatch, invalid phase, account not found), mark round as failed, log `settle_failed` operator event, do not retry. If `resolve_deadline` passed without settlement, log `timeout_detected` event (on-chain refund is user-triggered, not backend-triggered). Log `settle_retried` on each retry attempt. (done: iteration 11)

#### Read Endpoints & Observability
- [x] [backend] `GET /fairness/rounds/:pda` endpoint (`src/routes/rounds.ts`): query round by PDA from DB. Return 404 for unknown PDAs. For unsettled rounds: omit `secret` field. For settled rounds: include `secret`, `resultHash`, `resultSide`, `winner`, `settleTx`. Include `verification` object with human-readable check descriptions. Response uses camelCase. No sensitive operational data exposed. (done: iteration 12)
- [x] [backend] `GET /health` endpoint (`src/routes/health.ts`) + structured logging (`src/logger.ts`): health returns service version, server pubkey, SOL balance, DB connectivity, worker running status, unsettled count, oldest unsettled age. All log output structured JSON (timestamp, level, message, optional PDA context). SOL balance below threshold (default 0.1 SOL via `MIN_SOL_BALANCE`) triggers warning log. No secrets or private keys in logs at any level. (done: iteration 13)

#### Testing
- [x] [test] Unit tests (`src/__tests__/`): secret generation produces 32 bytes, commitment matches `packages/fairness` algorithm, PDA derivation matches on-chain seeds, auth middleware rejects invalid/expired signatures and accepts valid ones, rate limiter enforces per-userId and global limits and returns correct `Retry-After` header. (done: iteration 15)
- [x] [test] Integration tests for full create → join → settle lifecycle against bankrun: create match via POST endpoint → verify DB state → simulate join on-chain (bankrun) → trigger worker poll → verify settlement tx lands → verify DB updated to `settled` → verify GET /rounds/:pda returns secret and verification payload. (done: iteration 16)
- [x] [test] HTTP endpoint tests: POST /create with valid JWT → 200, missing/expired JWT → 401, wallet mismatch → 403, duplicate match ID → 409, rate limit exceeded → 429. GET /rounds/:pda → 200 for known, 404 for unknown. GET /health → 200 with expected fields. (done: iteration 17)
- [x] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) (done: iteration 18 — N/A: backend-only HTTP service, no browser UI. Full HTTP lifecycle covered by integration tests in `backend/src/__tests__/integration.test.ts`)
- [x] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes (done: iteration 19 — N/A: backend-only HTTP service with zero UI changes. All code lives in `backend/`, no `apps/platform/` files modified. Existing visual baselines unaffected.)
- [x] [test] If external provider/oracle/VRF integration is in scope, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason) (done: iteration 20 — N/A: no external provider/oracle/VRF integration in scope. Spec 006 uses Solana's native SlotHashes sysvar for entropy via commit-reveal model, not an external VRF provider. Settlement worker reads entropy from a system account, not a third-party oracle.)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Visual Regression
- [ ] `pnpm test:visual` passes (all baselines match)
- [ ] If this spec changes UI: affected baselines regenerated and committed
- [ ] Local deterministic E2E passes (`pnpm test:e2e`) for user-facing flows, or N/A documented
- [ ] Devnet real-provider E2E passes (`pnpm test:e2e:devnet`) when provider-backed flows are in scope

#### Visual Verification (if UI)
- [ ] Desktop view correct
- [ ] Mobile view correct

#### Console/Network Check (if web)
- [ ] No JS console errors
- [ ] No failed network requests

#### Smoke Test (Human-in-the-Loop)

Before declaring done, trace every user-facing flow and verify the experience
makes sense from a player's perspective. Customize this list per spec.

- [ ] Create request returns valid partial transaction that can be co-signed
- [ ] Settlement completes automatically after opponent joins (no manual trigger)
- [ ] Verification endpoint shows correct data for settled rounds
- [ ] Secret is never exposed for unsettled rounds
- [ ] Health endpoint reflects actual service state
- [ ] Rate limiting triggers at configured thresholds
- [ ] [Add spec-specific checks here]

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit

---

## Implementation Reference

### Backend

- **Endpoints**:
  - `POST /fairness/flipyou/create` -- generate secret, build co-signed create_match tx (JWT auth)
  - `POST /fairness/lord/create` -- generate secret, build co-signed create_lord_round tx (JWT auth)
  - `GET  /fairness/lord/current` -- active Lord round with on-chain enrichment
  - `GET  /fairness/rounds/:pda` -- round lifecycle + post-settlement verification payload
  - `GET  /fairness/rounds/by-id/:matchId` -- lookup by match_id (flipyou/lord hex or closecall numeric)
  - `GET  /fairness/rounds/history?game=<game>&limit=<n>` -- recent settled rounds
  - `POST /closecall/bet` -- co-sign a Close Call bet tx (JWT auth)
  - `GET  /closecall/current-round` -- active round from on-chain
  - `GET  /closecall/history?limit=<n>` -- last N settled/refunded rounds
  - `GET  /closecall/candles?limit=<n>` -- minute-boundary BTC price candles
- **DB Tables**:
  - `rounds` (PK: `pda`) -- commit-reveal round state for flipyou + lord. Key columns: `game`, `creator`, `secret`, `commitment`, `amount_lamports`, `side`, `match_id`, `phase`, `target_slot`, `settle_tx`, `result_hash`, `result_side`, `winner`, `entries`
  - `closecall_rounds` (PK: `round_id`) -- pari-mutuel rounds. Key columns: `pda`, `phase`, `open_price`, `close_price`, `outcome`, `green_pool`, `red_pool`, `green_entries`, `red_entries`, `settle_tx`
  - `operator_events` (PK: `id`) -- append-only audit trail. Key columns: `pda`, `event_type`, `payload`
  - `closecall_candles` (PK: `minute_ts`) -- cached Hermes BTC boundary prices
- **Key Files**:
  - `backend/src/routes/create.ts` -- flipyou create endpoint
  - `backend/src/routes/lord-create.ts` -- lord create + current round endpoints
  - `backend/src/routes/rounds.ts` -- round verification/lookup endpoints
  - `backend/src/routes/closecall.ts` -- Close Call bet + read endpoints
  - `backend/src/worker/settlement.ts` -- poll-based settlement worker (discovers locked rounds)
  - `backend/src/worker/settle-tx.ts` -- settlement tx builder + submission (flipyou `settleMatch`, lord `settleLordRound`, closecall ix builders)
  - `backend/src/worker/pda-watcher.ts` -- WebSocket PDA subscription for instant join/lock detection
  - `backend/src/worker/closecall-clock.ts` -- minute-boundary price capture + Close Call settlement
  - `backend/src/worker/retry.ts` -- retry logic for transient settlement failures
  - `packages/fairness/src/commitment.ts` -- `computeCommitment()`, `verifyCommitment()` (SHA-256)
  - `packages/fairness/src/verification.ts` -- `verifyRound()` full fairness verification
  - `backend/migrations/001_init.sql` -- rounds + operator_events tables
  - `backend/migrations/005_closecall_rounds.sql` -- closecall_rounds table
  - `backend/migrations/007_round_entries.sql` -- entries JSONB column on rounds

---

## Key Decisions (from refinement)

- HTTP framework: **Hono** (lightweight, TypeScript-first, modern)
- Postgres dev setup: **Devcontainer feature** (`ghcr.io/devcontainers/features/postgresql:1`)
- Phase model: **Simplified** — `created -> locked -> settling -> settled | expired`. Dropped `tx_sent` and `on_chain` (backend can't observe these; worker discovers matches via polling)
- Entropy: **Single-step settle** against current program. Mock entropy for bankrun tests, SlotHashes sysvar address for production (configurable via `ENTROPY_ACCOUNT` env var). Settlement targets <10s, well within ~200s SlotHashes window
- Timeout: **300s** (spec 005 update required). If backend is down, no new games can start (server co-sign), so timeout refund returns all funds
- Auth switched from per-request Ed25519 signatures to JWT Bearer tokens (see spec 007)
- All 43 acceptance criteria across 7 FRs satisfied with codebase evidence (gap analysis found zero gaps)
- 39 tests total: 11 unit (fairness), 8 unit (auth), 7 unit (rate-limit), 4 integration (full lifecycle), 9 HTTP endpoint tests

## Deferred Items

- **Privileged historical entropy submission**: Allow backend to submit historical slot hash and settle matches that missed the ~200s SlotHashes window. Requires on-chain trusted caller + slot hash verification
- **Multi-game support** (Crash, Pot Shot, Slots): Prove the model on flipyou first; each game has different entropy capture timing
- **Key rotation / split authorities**: Single keypair fine for MVP; add when operational maturity requires it
- **WebSocket push for settlement notifications**: Frontend already polls on-chain state; WS is a UX optimization
- **Redis-backed rate limiting**: In-memory sufficient until horizontal scaling needed
- **Batch settlement** (multiple matches per tx): Premature optimization; single-match settlement simpler to debug
- **Verification page / UI**: Endpoint exists; standalone verification UI is a frontend concern
- **Automated server keypair funding**: Manual top-up for MVP; automate when tx volume justifies it
- **Horizontal scaling / multiple workers**: Single process handles expected MVP load
- **Event-driven settlement** (geyser/websocket): Polling simpler and sufficient; switch if latency budget tightens
- **Metrics endpoint** (Prometheus): Structured logs + operator_events table sufficient for MVP observability
