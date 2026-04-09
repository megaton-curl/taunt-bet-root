# Full Code Audit

Date: 2026-04-06

Scope:
- superproject wiring and docs
- `backend`
- `chat`
- `solana`
- `waitlist`
- `webapp`

Method:
- manual review of module entry points, auth/session flows, worker paths, Solana program instructions, and representative tests
- pattern search for trust-boundary, auth, storage, and maintainability risks
- no full automated test matrix was executed as part of this audit

## Executive Summary

Highest-risk issues are concentrated in the Solana `closecall` program and config initialization paths:

1. `closecall` settlement is not trustless. The on-chain program accepts a caller-supplied close price and does not verify an oracle proof or even restrict the caller to the server. This means the outcome is actor-controlled.
2. Three game config PDAs are re-initializable because `initialize_config` uses `init_if_needed` and then overwrites authority/config fields unconditionally. Any signer can seize admin control after deployment.
3. The backend can derive its JWT secret directly from the server signing key when `JWT_SECRET` is unset, coupling web auth and on-chain signing trust domains.

The remaining issues are mostly backend authz inconsistencies, deployment footguns, and architectural shortcuts that will become operational problems under scale.

## Findings

### 1. Critical: `closecall` settlement trusts an unverified caller-supplied price

Files:
- `solana/programs/closecall/src/instructions/settle_round.rs:13`
- `solana/programs/closecall/src/instructions/settle_round.rs:46`
- `solana/programs/closecall/src/instructions/settle_round.rs:83`
- `solana/programs/closecall/src/instructions/settle_round.rs:95`

Details:
- `SettleRound` accepts `caller: Signer<'info>` but never checks that the caller is the server.
- The handler takes `close_price` and `close_price_expo` as raw instruction args.
- The only price validation is `close_price_expo == round.open_price_expo`.
- Outcome selection is then computed directly from that unverified `close_price`.

Impact:
- Any actor who can build the transaction with the expected winner/refund account list can force `Green`, `Red`, or `Refund`.
- This breaks game fairness completely and makes funds distribution manipulable.

Recommendation:
- Require a cryptographically verifiable oracle update on-chain, or verify a signed VAA/update account in-program.
- If temporary centralized settlement is acceptable, also require `caller == round.server`, but that alone is not enough without price authenticity.
- Add adversarial tests for forged `close_price` values and unauthorized callers.

### 2. Critical: game config PDAs can be re-initialized and authority can be stolen

Files:
- `solana/programs/flipyou/src/instructions/initialize_config.rs:12`
- `solana/programs/flipyou/src/instructions/initialize_config.rs:24`
- `solana/programs/potshot/src/instructions/initialize_config.rs:9`
- `solana/programs/potshot/src/instructions/initialize_config.rs:21`
- `solana/programs/closecall/src/instructions/initialize_config.rs:10`
- `solana/programs/closecall/src/instructions/initialize_config.rs:22`

Details:
- All three programs use `init_if_needed` for singleton config PDAs.
- Each handler then overwrites `authority` and other config fields unconditionally.
- There is no `if initialized then require(has_one = authority)` branch and no one-time initialization guard.

Impact:
- Any signer can call `initialize_config` again after deployment.
- Attackers can take over pause authority.
- In `closecall`, attackers can also rewrite runtime configuration such as feed id, betting window, and max entries.

Recommendation:
- Replace `init_if_needed` with `init` for one-time config creation, or split into `initialize_*` and `update_*` instructions.
- Add an `initialized` invariant or guard against authority changes unless current authority signs.
- Add negative tests proving re-initialization fails.

### 3. High: backend JWT signing can silently fall back to server private key material

Files:
- `backend/services/backend/src/config.ts:57`
- `backend/services/backend/src/config.ts:58`
- `backend/services/backend/src/config.ts:63`
- `backend/services/backend/src/config.ts:65`

Details:
- If `JWT_SECRET` is absent, the backend derives the JWT HMAC secret from `SERVER_KEYPAIR`.
- That couples browser session auth to the same root secret used for server-side Solana signing.

Impact:
- One secret compromise crosses two trust domains.
- Operational rotation becomes dangerous and harder to reason about.
- A deployment mistake can silently ship with a much weaker separation model than intended.

Recommendation:
- Fail hard at startup when `JWT_SECRET` is missing outside explicit local-dev mode.
- Keep JWT and signing keys fully separate.

### 4. High: `/closecall/bet` skips the session-to-wallet binding used by other game routes

Files:
- `backend/services/backend/src/routes/closecall.ts:256`
- `backend/services/backend/src/routes/closecall.ts:291`
- `backend/services/backend/src/routes/closecall.ts:341`
- `backend/services/backend/src/routes/create.ts:94`
- `backend/services/backend/src/routes/lord-create.ts:164`

Details:
- `flipyou/create` and `lord/create` both verify that the request wallet matches the authenticated user profile.
- `closecall/bet` only validates `playerPubkey` syntactically.
- The route then writes DB-side round/game-entry state using that arbitrary wallet if a profile exists.

Impact:
- Any authenticated user can create backend-side intent records for someone else’s wallet.
- Even though final submission still needs the player signature, the backend’s own bookkeeping can be polluted and future assumptions about authenticated ownership become false.
- This is an authz inconsistency across otherwise similar endpoints.

Recommendation:
- Mirror the `flipyou`/`lord` wallet match check before building the partially signed tx or writing DB rows.
- Avoid DB side effects until the wallet/session binding is established.

### 5. Medium: destructive internal admin route is enabled by token presence, not by hard environment separation

Files:
- `backend/services/backend/src/index.ts:348`
- `backend/services/backend/src/routes/internal.ts:30`
- `backend/services/backend/src/routes/internal.ts:42`
- `backend/services/backend/src/routes/internal.ts:55`

Details:
- Setting `ADMIN_TOKEN` exposes `/internal/reset-db`.
- That endpoint can drop the active schema, rerun migrations, and terminate the process.
- The code relies on “do not set in production” comments and log warnings rather than a hard runtime environment gate.

Impact:
- A deployment/config mistake turns into a production self-destruct endpoint.
- Header token schemes are also easier to misuse in ad hoc tooling than isolated admin channels.

Recommendation:
- Require an explicit non-production environment check before registering these routes.
- Prefer separate admin binaries/jobs or network-isolated ops endpoints instead of multiplexing them into the main API server.

### 6. Medium: mock wallet persists the full signing secret in `localStorage`

Files:
- `webapp/src/lib/wallet/mock-wallet.tsx:26`
- `webapp/src/lib/wallet/mock-wallet.tsx:41`
- `webapp/src/lib/wallet/mock-wallet.tsx:58`
- `webapp/src/lib/wallet/mock-wallet.tsx:107`
- `webapp/src/lib/wallet/mock-wallet.tsx:123`

Details:
- The mock wallet stores a base64-encoded Ed25519 secret key in browser `localStorage` and restores it on load.
- This is intentional for dev convenience, but the implementation is one environment flag away from shipping.

Impact:
- If mock mode is accidentally exposed outside local development, browser storage compromise becomes private key compromise.
- It also normalizes a dangerous storage pattern inside the production client codebase.

Recommendation:
- Gate mock wallet code out of production builds entirely, not just at runtime.
- Do not persist signing keys in browser storage; if persistence is needed for dev, use an explicitly dev-only path with loud labeling.

### 7. Medium: chat durability and rate limiting are single-process only

Files:
- `chat/src/index.ts:24`
- `chat/src/messages/message-store.ts:38`
- `chat/src/moderation/rate-limiter.ts:17`

Details:
- Chat messages, feed events, and moderation limits are all in-memory data structures.
- A restart drops all state.
- Multi-instance deployments will fragment history and make per-user rate limits inconsistent.

Impact:
- Operational behavior changes materially once the service is restarted or horizontally scaled.
- Abuse controls are weaker than they appear.
- The current implementation is acceptable for a prototype, but it is not production-shape.

Recommendation:
- Move message/feed persistence and rate limiting to shared infrastructure before relying on this service for real traffic.
- At minimum, document the single-instance assumption clearly.

### 8. Medium: auth/session logic is duplicated across `webapp` and `waitlist`

Files:
- `webapp/src/context/session.tsx:119`
- `waitlist/src/context/SessionContext.tsx:109`
- `webapp/src/lib/auth/store.ts:1`
- `waitlist/src/lib/auth-store.ts:1`

Details:
- Both frontends implement nearly the same session lifecycle, refresh scheduling, token persistence, and wallet-auth flow independently.
- Both also persist refresh tokens in `localStorage`.

Impact:
- Security fixes and auth behavior changes are likely to land in one client and not the other.
- Drift will accumulate around expiry handling, refresh races, logout behavior, and storage semantics.

Recommendation:
- Extract shared auth/session code into a common package or shared module.
- Treat refresh-token storage as an explicit risk tradeoff and document it centrally.

## Testing Gaps

- `solana/tests/closecall.ts` exercises happy-path settlement but does not appear to test forged close prices or unauthorized settlement callers.
- `solana/tests/flipyou.ts`, `solana/tests/potshot.ts`, and `solana/tests/closecall.ts` include `initialize_config` coverage, but there is no negative coverage proving re-initialization is rejected.
- `solana/tests/potshot.ts` explicitly skips `claim_payout` settlement coverage for the real entropy path.
- I did not find coverage that asserts `/closecall/bet` rejects mismatched authenticated users and target wallets.

## Recommended Remediation Order

1. Fix `closecall` settlement authenticity on-chain before any further rollout.
2. Fix all config re-initialization paths in `flipyou`, `potshot`, and `closecall`.
3. Remove JWT-secret fallback to `SERVER_KEYPAIR`.
4. Add wallet/session binding to `/closecall/bet`.
5. Hard-disable destructive internal routes outside explicitly non-production environments.
6. Decide whether chat is a prototype-only service or needs real persistence/shared rate limiting.
7. Consolidate frontend auth/session code.
