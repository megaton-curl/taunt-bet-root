# Gap Analysis: 006 — Fairness Backend (Coinflip MVP)

- **Date**: 2026-03-11
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions
| Instruction | Program | File | Line |
|------------|---------|------|------|
| `create_match` | coinflip | `solana/programs/coinflip/src/instructions/create_match.rs` | 41 |
| `join_match` | coinflip | `solana/programs/coinflip/src/instructions/join_match.rs` | 34 |
| `settle` | coinflip | `solana/programs/coinflip/src/instructions/settle.rs` | 65 |
| `request_refund` | coinflip | `solana/programs/coinflip/src/instructions/request_refund.rs` | 32 |
| `timeout_refund` | coinflip | `solana/programs/coinflip/src/instructions/timeout_refund.rs` | 33 |
| `cancel_match` | coinflip | `solana/programs/coinflip/src/instructions/cancel_match.rs` | 24 |
| `initialize_config` | coinflip | `solana/programs/coinflip/src/instructions/initialize_config.rs` | 24 |

### Shared Crate Exports
| Export | Package | File | Line |
|--------|---------|------|------|
| `verify_commitment` | shared | `solana/shared/src/fairness.rs` | 11 |
| `derive_result` | shared | `solana/shared/src/fairness.rs` | 21 |
| `ALGORITHM_VERSION` | shared | `solana/shared/src/fairness.rs` | 5 |
| `calculate_net_payout` | shared | `solana/shared/src/fees.rs` | 25 |

### Backend Service Modules
| Module | File | Line | Purpose |
|--------|------|------|---------|
| Config | `services/backend/src/config.ts` | 35 | Env loader (10 config fields) |
| DB Client | `services/backend/src/db.ts` | 128 | Postgres pool + typed queries |
| Fairness Utils | `services/backend/src/fairness.ts` | 1 | Secret gen, commitment, PDA derivation |
| TX Builder | `services/backend/src/tx-builder.ts` | 82 | Partial-sign create_match tx |
| Create Route | `services/backend/src/routes/create.ts` | 75 | POST /fairness/coinflip/create |
| Rounds Route | `services/backend/src/routes/rounds.ts` | 52 | GET /fairness/rounds/:pda |
| Health Route | `services/backend/src/routes/health.ts` | 21 | GET /health |
| Auth Middleware | `services/backend/src/middleware/auth.ts` | 24 | Ed25519 wallet signature verification |
| Rate Limit | `services/backend/src/middleware/rate-limit.ts` | 43 | Per-wallet + global sliding window |
| Settlement Worker | `services/backend/src/worker/settlement.ts` | 37 | Chain polling for locked matches |
| Settle TX | `services/backend/src/worker/settle-tx.ts` | 129 | Build + submit settle instruction |
| Retry Logic | `services/backend/src/worker/retry.ts` | 57 | Exponential backoff, permanent/transient errors |
| Logger | `services/backend/src/logger.ts` | 30 | Structured JSON logging |
| Migration Runner | `services/backend/src/migrate.ts` | 77 | Versioned, idempotent SQL migrations |

### Database Schema
| Table | File | Line |
|-------|------|------|
| `rounds` | `services/backend/migrations/001_init.sql` | 3 |
| `operator_events` | `services/backend/migrations/001_init.sql` | 24 |
| 4 indexes | `services/backend/migrations/001_init.sql` | 33-36 |

### Tests
| Test | Type | File | Status |
|------|------|------|--------|
| Secret generation (2) | Unit | `services/backend/src/__tests__/fairness.test.ts` | Pass |
| Commitment (4) | Unit | `services/backend/src/__tests__/fairness.test.ts` | Pass |
| PDA derivation (5) | Unit | `services/backend/src/__tests__/fairness.test.ts` | Pass |
| Auth middleware (8) | Unit | `services/backend/src/__tests__/auth.test.ts` | Pass |
| Rate limiting (7) | Unit | `services/backend/src/__tests__/rate-limit.test.ts` | Pass |
| Full lifecycle (1) | Integration | `services/backend/src/__tests__/integration.test.ts` | Pass |
| 404 unknown PDA (1) | Integration | `services/backend/src/__tests__/integration.test.ts` | Pass |
| Secret redaction (1) | Integration | `services/backend/src/__tests__/integration.test.ts` | Pass |
| Duplicate nonce 409 (1) | Integration | `services/backend/src/__tests__/integration.test.ts` | Pass |
| POST create 200 (1) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |
| POST create 401 (2) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |
| POST create 409 (1) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |
| POST create 429 (1) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |
| GET rounds 200/404 (2) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |
| GET health 200 (2) | HTTP | `services/backend/src/__tests__/endpoints.test.ts` | Pass |

**Total: 39 tests, all passing**

## Acceptance Criteria Audit

### FR-1: Secret Generation & Transaction Signing

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Secret is 32 bytes via `crypto.randomBytes(32)` (CSPRNG) | SATISFIED | `fairness.ts:10` — `return randomBytes(32)` using `import { randomBytes } from "node:crypto"` |
| 2 | Commitment is `sha256(secret)` matching `packages/fairness/src/commitment.ts` | SATISFIED | `fairness.ts:18` — `createHash("sha256").update(secret).digest()`. Unit test `fairness.test.ts` cross-checks. |
| 3 | Transaction built using coinflip IDL (`create_match`) with correct accounts and args | SATISFIED | `tx-builder.ts:82-127` — Borsh-encoded discriminator+commitment+tier+side+nonce, 5 accounts in IDL order |
| 4 | Server keypair partially signs (server as `Signer`) | SATISFIED | `tx-builder.ts:96` — `isSigner: true` for server; `tx-builder.ts:120` — `tx.partialSign(serverKeypair)` |
| 5 | User's wallet is fee payer (server pays zero) | SATISFIED | `tx-builder.ts:113` — `feePayer: creator` |
| 6 | Secret stored in `rounds` table before response returned | SATISFIED | `routes/create.ts:140-151` — `db.insertRound({...secret...})` before response at line 172 |
| 7 | `operator_events` entry of type `secret_generated` written | SATISFIED | `routes/create.ts:164` — `db.insertOperatorEvent(matchPdaStr, "secret_generated", {...})` |
| 8 | Match PDA seeds `["match", creator, nonce.to_le_bytes()]` | SATISFIED | `fairness.ts:31-33` — `[Buffer.from("match"), creator.toBuffer(), nonceBuf]` with LE u64 |
| 9 | Duplicate PDA returns 409 Conflict | SATISFIED | `routes/create.ts:110-116` (pre-check) + `routes/create.ts:152-159` (DB constraint catch). Tests: `endpoints.test.ts`, `integration.test.ts` |
| 10 | Recent blockhash fetched at request time | SATISFIED | `tx-builder.ts:109-110` — `await connection.getLatestBlockhash()` |

### FR-2: Settlement Worker

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Polls chain via `getProgramAccounts` for PHASE_LOCKED matches with server key | SATISFIED | `worker/settlement.ts:49-65` — `getProgramAccounts` with memcmp filters: phase=1 at offset 114, server key at offset 72 |
| 2 | Checks if `target_slot` reached (current slot >= target_slot) | SATISFIED | `worker/settlement.ts:95` — `BigInt(currentSlot) >= targetSlot` |
| 3 | Retrieves secret from `rounds` table by PDA | SATISFIED | `worker/settle-tx.ts:137` — `db.getRoundByPda(pda)`, `settle-tx.ts:147` — `Buffer.from(round.secret)` |
| 4 | Builds + submits `settle` with all required accounts + server as caller | SATISFIED | `worker/settle-tx.ts:209-233` — 11 accounts (caller, match, config, entropy, treasury, creator, opponent, creator_profile, opponent_profile, platform_program, system_program) |
| 5 | On success: updates DB to `settled`, stores settle_tx/result_hash/result_side/winner | SATISFIED | `worker/settle-tx.ts:258-264` — `db.updateRoundPhase(pda, "settled", {settle_tx, result_hash, result_side, winner})` |
| 6 | Transient failure: retries up to 5× with exponential backoff (base 2s, max 30s) | SATISFIED | `worker/retry.ts:19-21` — `MAX_RETRIES=5, BASE_DELAY_MS=2000, MAX_DELAY_MS=30000`; `retry.ts:156-175` — backoff logic |
| 7 | Permanent failure: marks failed, logs to operator_events, no retry | SATISFIED | `worker/retry.ts:143-154` — `PermanentSettleError` → `failedPdas.add(pda)`, logs `settle_failed` |
| 8 | Poll interval configurable (default 2s) | SATISFIED | `config.ts:53-55` — `WORKER_POLL_INTERVAL_MS` default 2000; `settlement.ts:112` — `setTimeout(loop, pollIntervalMs)` |
| 9 | Logs each attempt as settle_submitted/confirmed/failed/retried | SATISFIED | settle_submitted: `settle-tx.ts:155`; settle_confirmed: `settle-tx.ts:267`; settle_failed: `retry.ts:106,147`; settle_retried: `retry.ts:165` |
| 10 | Logs `timeout_detected` if resolve_deadline passed | SATISFIED | `worker/retry.ts:118-128` — `isResolveDeadlinePassed(pda)` checks offset 156, logs `timeout_detected` |

### FR-3: Round State Storage

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `rounds` table schema matches Core Design (all columns, types, constraints) | SATISFIED | `migrations/001_init.sql:3-22` — all 18 columns match spec (pda TEXT PK, game TEXT NOT NULL, ... updated_at TIMESTAMPTZ DEFAULT now()) |
| 2 | `operator_events` table schema matches Core Design | SATISFIED | `migrations/001_init.sql:24-30` — id BIGSERIAL PK, pda TEXT, event_type TEXT NOT NULL, payload JSONB, created_at TIMESTAMPTZ |
| 3 | Phase transitions: created→locked→settling→settled; or created→expired | SATISFIED | `db.ts:73-79` — `VALID_TRANSITIONS` defines exactly this state machine |
| 4 | Phase transitions are unidirectional | SATISFIED | `db.ts:81-88` — `assertPhaseTransition()` throws on invalid transitions; `settled` and `expired` have empty allowed lists |
| 5 | `secret` stored as raw bytes, never logged or exposed in errors | SATISFIED | `migrations/001_init.sql:8` — BYTEA type; no log call across codebase outputs secret value |
| 6 | `updated_at` set on every phase transition | SATISFIED | `db.ts:169` — `updated_at = now()` in every `updateRoundPhase` query |
| 7 | Migrations versioned and idempotent | SATISFIED | `migrate.ts:60-102` — `_migrations` tracking table, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` |
| 8 | Indexes on rounds(phase), rounds(creator), operator_events(pda,created_at), operator_events(event_type,created_at) | SATISFIED | `migrations/001_init.sql:33-36` — all four indexes present |

### FR-4: Round Verification Endpoint

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Returns round data for any known PDA | SATISFIED | `routes/rounds.ts:57-65` — queries DB, returns formatted response |
| 2 | Unsettled rounds: `secret` field omitted | SATISFIED | `routes/rounds.ts:17,36` — `isSettled = round.phase === "settled"`, secret only included in `if (isSettled)` block |
| 3 | Settled rounds: includes secret, resultHash, resultSide, winner, settleTx | SATISFIED | `routes/rounds.ts:37-41` — all five fields present in settled response |
| 4 | Verification object with human-readable descriptions | SATISFIED | `routes/rounds.ts:42-46` — `{commitmentCheck, resultFormula, entropySource}` |
| 5 | 404 for unknown PDAs | SATISFIED | `routes/rounds.ts:61-63` — `return c.json({ error: "Round not found" }, 404)` |
| 6 | JSON with camelCase field naming | SATISFIED | `routes/rounds.ts:16-50` — pda, game, phase, commitment, createdAt, updatedAt, targetSlot, resultHash, etc. |
| 7 | No sensitive operational data exposed | SATISFIED | `routes/rounds.ts:16-50` — server_key, internal IDs omitted from response |

### FR-5: Request Authentication

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | POST /create requires Ed25519 signature over canonical payload | SATISFIED | `middleware/auth.ts:24-82` wired at `index.ts:32-35` on `/fairness/*` |
| 2 | Canonical payload: `JSON.stringify({wallet, tier, side, nonce, timestamp})` exact key order | SATISFIED | `middleware/auth.ts:56` — `JSON.stringify({ wallet, tier, side, nonce, timestamp })` |
| 3 | Signature verified with `tweetnacl` | SATISFIED | `middleware/auth.ts:9` — `import nacl from "tweetnacl"`; `auth.ts:75` — `nacl.sign.detached.verify()` |
| 4 | Timestamp > 60s from server time rejected (replay protection) | SATISFIED | `middleware/auth.ts:50-53` — `Math.abs(nowSeconds - timestamp) > config.clockSkewSeconds` |
| 5 | Invalid/missing signature returns 401 | SATISFIED | `middleware/auth.ts:41-47` (missing fields), `auth.ts:76-78` (invalid sig). Tests: `auth.test.ts` |
| 6 | GET endpoints require no auth | SATISFIED | `middleware/auth.ts:27-29` — `if (c.req.method !== "POST") return next()` |
| 7 | Clock skew tolerance configurable (default 60s) | SATISFIED | `config.ts:41-44` — `AUTH_CLOCK_SKEW_SECONDS` env var, default 60 |

### FR-6: Health & Observability

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GET /health returns: version, server key, SOL balance, DB connected, worker running, unsettled count, oldest unsettled age | SATISFIED | `routes/health.ts:58-67` — all fields: status, version, serverKey, solBalance, dbConnected, workerRunning, unsettledCount, oldestUnsettledAge |
| 2 | Health endpoint requires no auth | SATISFIED | `index.ts:67-76` — `/health` mounted outside `/fairness/*` middleware chain |
| 3 | All log output is structured JSON (timestamp, level, message, fields) | SATISFIED | `logger.ts:15-28` — JSON with timestamp, level, message + spread fields |
| 4 | Logs include round PDA context where applicable | SATISFIED | `worker/retry.ts:110,125,136,151,170` — all log calls include `pda` field |
| 5 | No secrets or private keys in logs | SATISFIED | Verified all log calls across all source files — none output secret or keypair data |
| 6 | SOL balance < threshold triggers warning log | SATISFIED | `routes/health.ts:50-56` — `logger.warn("Server SOL balance below threshold", {...})`; `config.ts:58` — `MIN_SOL_BALANCE` default 0.1 |
| 7 | operator_events queryable for monitoring | SATISFIED | `migrations/001_init.sql:24-30,35-36` — table with indexes on (pda,created_at) and (event_type,created_at) |

### FR-7: Rate Limiting

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Per-wallet limit (default 10/min) | SATISFIED | `middleware/rate-limit.ts:74-86` — per-wallet window; `config.ts:45-48` — `RATE_LIMIT_PER_WALLET` default 10 |
| 2 | Global limit (default 100/min) | SATISFIED | `middleware/rate-limit.ts:56-60` — global window; `config.ts:49-52` — `RATE_LIMIT_GLOBAL` default 100 |
| 3 | In-memory (no Redis) | SATISFIED | `middleware/rate-limit.ts:44-45` — `Map` + `SlidingWindow` object, no external deps |
| 4 | 429 with Retry-After header | SATISFIED | `middleware/rate-limit.ts:58-59` (global) and `82-83` (per-wallet) — `c.header("Retry-After", ...)`, returns 429 |
| 5 | GET endpoints not rate-limited | SATISFIED | `middleware/rate-limit.ts:48-50` — `if (c.req.method !== "POST") return next()` |
| 6 | Configurable via environment variables | SATISFIED | `config.ts:45-52` — `RATE_LIMIT_PER_WALLET` and `RATE_LIMIT_GLOBAL` env vars |

## Gap Summary

No gaps found. All 43 acceptance criteria across 7 FRs are satisfied with codebase evidence.

| # | FR | Criterion | Severity | Category | Blocked By | Next Step |
|---|-----|-----------|----------|----------|------------|-----------|
| — | — | — | — | — | — | No gaps identified |

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Multi-game support (Crash, Lord of RNGs, Slots) | Post-coinflip stability | 002-crash (crash), 101-lord-of-the-rngs (lord) | Draft / Ready | No — TRACKED |
| Key rotation / split authorities | Post-MVP ops maturity | None (operational concern) | N/A | No — UNTRACKED (acceptable: operational, not functional) |
| WebSocket push for settlement notifications | UX optimization | None | N/A | No — UNTRACKED (acceptable: frontend concern) |
| Redis-backed rate limiting | Horizontal scaling | None | N/A | No — UNTRACKED (acceptable: scaling concern) |
| Batch settlement (multiple per tx) | Performance optimization | None | N/A | No — UNTRACKED (acceptable: premature for MVP) |
| Verification page / UI | Frontend concern | None | N/A | No — UNTRACKED (acceptable: frontend spec) |
| Automated server keypair funding | Operational automation | None | N/A | No — UNTRACKED (acceptable: operational) |
| Horizontal scaling / multiple workers | Scaling need | None | N/A | No — UNTRACKED (acceptable: scaling) |
| Event-driven settlement (geyser/websocket) | Latency optimization | None | N/A | No — UNTRACKED (acceptable: optimization) |
| Metrics endpoint (Prometheus) | Observability depth | None | N/A | No — UNTRACKED (acceptable: structured logs sufficient for MVP) |
| Privileged historical entropy submission | Extended outage recovery | None | N/A | No — UNTRACKED (acceptable: requires on-chain changes) |

All deferred items are intentional MVP scoping decisions. No stale deferrals found.

## Recommendations

1. **No action required** — all 43 acceptance criteria are fully satisfied with file:line evidence.
2. **Multi-game extension** — when Crash (002) or Lord of RNGs (101) specs reach implementation, the signing module and settlement worker will need game-specific adapters. The current architecture (Hono routes + worker callbacks) is well-positioned for this.
3. **Key rotation** — consider adding to an operational readiness spec before production launch. Single keypair is acceptable for devnet/staging but carries operational risk for mainnet.
4. **Frontend integration** — spec 006 delivers the backend; the frontend must still be updated to call `POST /fairness/coinflip/create` instead of generating secrets client-side. This is likely covered by spec 005 (Hybrid Fairness) or a dedicated frontend integration task.
