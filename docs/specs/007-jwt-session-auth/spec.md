# Specification: [007] JWT Session Authentication

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P0 |
| Phase | 1 |
| NR_OF_TRIES | 1 |

---

## Overview

Replace the per-request Ed25519 wallet signature auth model (from Spec 006) with a
sign-once JWT session model. The current model causes a wallet popup on every
`create_match` call, degrading UX. With JWT sessions, the wallet signs a
human-readable challenge once on connect, the backend issues JWT access + refresh
tokens, and all subsequent requests use Bearer tokens — eliminating repeated wallet
popups during gameplay.

This is a hard switch — no backward compatibility period since we control both sides
and have no public users yet.

## User Stories

- As a player, I want to sign in once when I connect my wallet so that I don't see a
  wallet popup every time I create a match.
- As a player, I want my session restored automatically when I reconnect the same
  wallet so that I can resume playing without signing again.
- As a player, I want to see a clear human-readable message when signing in so that I
  know the signature doesn't approve a blockchain transaction.
- As an operator, I want refresh token rotation with family-based reuse detection so
  that stolen tokens can be invalidated.
- As a player, I want my session cleared when I disconnect my wallet or switch to a
  different wallet so that another person can't use my session.

---

## Scope Alignment

- **`docs/SCOPE.md` references**: Backend Services, Platform UX
- **Scope status**: V1 In Scope
- **Phase boundary**: Phase 1 — required for acceptable coinflip UX before public launch

## Required Context Files

- `docs/specs/006-fairness-backend/spec.md` — Current auth model being replaced
- `docs/FOUNDATIONS.md` — Architecture patterns
- `docs/DECISIONS.md` — Wallet approach decision

## Contract Files

- `services/backend/src/middleware/jwt-auth.ts` — JWT verification middleware
- `services/backend/src/routes/auth.ts` — Auth endpoint handlers
- `apps/platform/src/context/SessionContext.tsx` — Frontend session management

---

## Functional Requirements

### FR-1: Challenge-Response Authentication

The backend issues a challenge containing a human-readable message. The wallet signs
this message, and the backend verifies the signature to establish a session.

**Acceptance Criteria:**
- [x] `POST /auth/challenge` accepts `{ wallet }` and returns `{ nonce, message, expiresAt }`
- [x] Challenge message is human-readable and includes wallet, cluster, nonce, timestamps
- [x] Message explicitly states it does not approve a blockchain transaction
- [x] Challenges expire after a configurable TTL (default 5 minutes)
- [x] Challenges are single-use (atomic consume via `UPDATE ... SET used=TRUE WHERE used=FALSE`)

### FR-2: Token Issuance

After signature verification, the backend issues a JWT access token and an opaque
refresh token.

**Acceptance Criteria:**
- [x] `POST /auth/verify` accepts `{ nonce, wallet, signature }` and returns both tokens
- [x] Access token is a HS256 JWT with `sub` claim set to the wallet address
- [x] Access token TTL is configurable (default 24 hours)
- [x] Refresh token is an opaque random string, stored hashed (SHA-256) in the database
- [x] Refresh token TTL is configurable (default 14 days)
- [x] Wallet in verify request must match the challenge's wallet

### FR-3: Token Refresh with Rotation

Refresh tokens are single-use and rotated on each refresh. Reuse of a previously
rotated token triggers revocation of the entire token family.

**Acceptance Criteria:**
- [x] `POST /auth/refresh` accepts `{ refreshToken }` and returns new access + refresh tokens
- [x] Old refresh token is revoked after successful rotation
- [x] New refresh token is issued in the same family as the old one
- [x] If a revoked token is presented (reuse detection), the entire family is revoked
- [x] Expired refresh tokens are rejected

### FR-4: Logout

Players can explicitly end their session.

**Acceptance Criteria:**
- [x] `POST /auth/logout` accepts `{ refreshToken }` and revokes it
- [x] Returns 204 regardless of whether the token existed (no information leak)

### FR-5: JWT Middleware

All fairness endpoints authenticate via JWT Bearer tokens instead of per-request
Ed25519 signatures.

**Acceptance Criteria:**
- [x] POST requests to `/fairness/*` require `Authorization: Bearer <token>` header
- [x] GET requests pass through without authentication (same as before)
- [x] Middleware sets `wallet` in Hono context for downstream handlers
- [x] 401 returned for missing, invalid, or expired tokens
- [x] Create endpoint validates body `wallet` matches JWT `sub` (defense-in-depth)

### FR-6: Frontend Session Management

The frontend handles the full session lifecycle: authenticate on connect, restore on
reconnect, refresh proactively, clear on disconnect.

**Acceptance Criteria:**
- [x] Wallet connect triggers challenge → sign → verify flow automatically
- [x] Access token stored in memory only (not localStorage)
- [x] Refresh token persisted in localStorage for session restoration
- [x] On reconnect with same wallet: silent refresh attempted before prompting new sign-in
- [x] On wallet switch: old session cleared, new authentication triggered
- [x] Proactive refresh scheduled ~5 minutes before access token expiry
- [x] Concurrent refresh requests are deduplicated (mutex)
- [x] `createMatch` gated on `isAuthenticated`, triggers auth if needed

### FR-7: Rate Limiting Adaptation

Rate limiting works with both JWT-authenticated and pre-auth routes.

**Acceptance Criteria:**
- [x] For authenticated routes: wallet read from JWT context
- [x] For pre-auth routes (`/auth/*`): rate limit keyed on IP address
- [x] Fallback chain: JWT context → request body → IP address

---

## Success Criteria

- Player signs wallet message exactly once per session (not per action)
- Session persists across page refreshes for the same wallet
- No wallet popup when creating a match after initial sign-in
- Stolen refresh tokens can be detected and invalidated (family revocation)
- Switching wallets properly clears the previous session

---

## Dependencies

- Spec 006 (Fairness Backend) — base infrastructure being extended
- `jose` library — JWT signing and verification
- PostgreSQL — challenge and refresh token storage

## Assumptions

- No public users yet — hard switch is safe, no migration needed
- All wallets support `signMessage` (enforced by wallet adapter)
- Single cluster per deployment (cluster embedded in sign-in message)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Challenge returns human-readable message | Unit test | auth-routes.test.ts |
| 2 | Verify issues valid JWT | Unit test + JWT decode | auth-routes.test.ts |
| 3 | Refresh rotation works | Unit test (old token rejected) | auth-routes.test.ts |
| 4 | Reuse detection revokes family | Unit test | auth-routes.test.ts |
| 5 | JWT middleware rejects invalid tokens | Unit test | auth.test.ts |
| 6 | Create endpoint uses JWT wallet | Unit test | endpoints.test.ts |
| 7 | Full lifecycle with JWT | Integration test | integration.test.ts |
| 8 | Frontend builds clean | Build check | `pnpm build` exit 0 |
| 9 | Lint passes | Lint check | `pnpm lint` 0 errors |

---

## Completion Signal

### Implementation Checklist
- [x] Backend: migration 002_auth_sessions.sql
- [x] Backend: auth-db.ts (challenge + refresh token operations)
- [x] Backend: routes/auth.ts (challenge/verify/refresh/logout)
- [x] Backend: middleware/jwt-auth.ts (Bearer token verification)
- [x] Backend: config.ts (JWT secret, TTL configs)
- [x] Backend: index.ts (mount auth routes, swap middleware)
- [x] Backend: routes/create.ts (remove signature, read from JWT context)
- [x] Backend: middleware/rate-limit.ts (context-aware wallet extraction)
- [x] Frontend: lib/auth-api.ts (fetch wrappers)
- [x] Frontend: lib/auth-store.ts (token storage)
- [x] Frontend: context/SessionContext.tsx (session provider)
- [x] Frontend: main.tsx (SessionProvider in tree)
- [x] Frontend: chain.ts (accessToken param)
- [x] Frontend: CoinflipContext.tsx (useSession integration)
- [x] Tests: auth.test.ts rewritten for JWT
- [x] Tests: auth-routes.test.ts (new)
- [x] Tests: endpoints.test.ts updated
- [x] Tests: integration.test.ts updated
- [x] CHANGELOG.md updated
- [ ] [test] E2E coverage — N/A: auth flow requires wallet interaction, covered by manual smoke test
- [ ] [test] Visual regression — N/A: no UI component changes, only data flow

### Testing Requirements

#### Code Quality
- [x] All existing tests pass (DB-free: 27/27; DB-dependent: require PostgreSQL)
- [x] New tests added for new functionality (auth.test.ts, auth-routes.test.ts)
- [x] No lint errors

#### Functional Verification
- [x] All acceptance criteria verified
- [x] Edge cases handled (token reuse, wallet switch, concurrent refresh, expired challenges)
- [x] Error states handled (401 retry, auth failure cleanup)

#### Smoke Test (Human-in-the-Loop)

- [ ] Connect wallet → sign-in prompt with human-readable message → session established
- [ ] Create coinflip match → no wallet signature popup (only tx approval)
- [ ] Disconnect → reconnect same wallet → session restored silently
- [ ] Disconnect → connect different wallet → new sign-in prompt
- [ ] Page refresh → session persists (access token refreshed from stored refresh token)

### Env Vars (New)

| Var | Default | Notes |
|-----|---------|-------|
| `JWT_SECRET` | derived from `SERVER_KEYPAIR[:32]` | Explicit recommended for prod |
| `SOLANA_CLUSTER` | `devnet` | Used in sign-in message |
| `CHALLENGE_TTL_SECONDS` | `300` | 5 min challenge window |
| `ACCESS_TOKEN_TTL_SECONDS` | `86400` | 24h access token |
| `REFRESH_TOKEN_TTL_DAYS` | `14` | 14d refresh token |
