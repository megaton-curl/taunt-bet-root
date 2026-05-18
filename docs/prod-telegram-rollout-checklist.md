# Prod Rollout Checklist — Backend Migrations 017–034 + Telegram Inbound

Updated 2026-05-18 after env-var audit and the `ec8b16c` config-defaults move (referral tier knobs are no longer env-driven). Prod backend `main` is 18 migrations behind dev (`016 → 034`) and the deploy spec is gaining a new `worker` component for the first time. This is the full dev→main fast-forward, not a small telegram-only change.

Branch state at update time:

- backend: `main` is 123 commits behind `dev` (HEAD `9a666e7`)
- telegram: `main` is 4 commits behind `dev` (HEAD `b00c6a8`)
- root: `main` is 362 commits behind `dev`

## Decisions made

- [x] **Prod stays on the waitlist for this rollout.** `run_command: pnpm start:waitlist` remains in `.do/app-prod.yaml`. Migrations 017–034 and the new worker still need to land for forward-compat, but the public `prod-api` HTTP surface keeps serving the pre-launch landing page only. Full backend cutover deferred (track in `docs/TECH_DEBT.md` when scheduled).
- [x] **Cluster is now part of `BackendAppConfig`** (committed in this prep pass). `solana.cluster` lives in `src/config/app/dev.ts` (`"devnet"`) and `src/config/app/mainnet.ts` (`"mainnet-beta"`). `loadConfig` reads `Config.cluster` from the loaded file, not from the env literal. `SOLANA_CLUSTER` env var stays only as the selector for which file to load.
- [x] **`SOLANA_CLUSTER` hardcoded in the yaml.** `.do/app-prod.yaml` now declares `SOLANA_CLUSTER: mainnet-beta` for both `prod-api` and `worker`; `.do/app-dev.yaml` declares `SOLANA_CLUSTER: devnet` for symmetry. No GH-Environment `var` plumbing needed — the value is checked-in alongside the spec.
- [x] **`chat.baseUrl` and `telegram.communityInviteUrl` moved into `BackendAppConfig`.** Both are per-env-stable non-secrets, same pattern as cluster. Dev points at `https://scream.dev.taunt.bet` + the private invite link; mainnet points at `https://scream.taunt.bet` + `https://t.me/tauntbet`. Removed from `.do/app-{prod,dev}.yaml` and from `deploy-{prod,dev}.yml` env mappings; GH env vars `CHAT_BASE_URL` and `COMMUNITY_INVITE_URL` deleted from backend dev and prod environments.
- [x] **`ADMIN_TOKEN` dropped from prod.** Removed from `.do/app-prod.yaml`, `deploy-prod.yml` (env mapping + `required_vars`), and the GH `prod` env secret was deleted via `gh api`. The `/docs` OpenAPI route stays off in prod. `ADMIN_TOKEN` is retained on dev (`.do/app-dev.yaml` + `deploy-dev.yml`) for OpenAPI access.

## Open gaps

- [ ] **Worker boots immediately and starts RPC traffic.** Confirm `RPC_URL` / `WS_RPC_URL` in GH Environment `prod` point at the intended cluster before deploy. Mismatch here = settlement against the wrong chain. The new `SOLANA_CLUSTER=mainnet-beta` ensures `Config.cluster` and the mainnet defaults registry are loaded, but RPC URL targeting is still env-driven.

## Pre-flight

- [x] **pg_dump backup of `prod-main-db` taken.** Primary rollback path. DO does **not** offer on-demand snapshots or point-in-time recovery for this cluster — only scheduled daily backups (typically retained for ~7 days). The pg_dump is therefore the only snapshot guaranteed to be tight to the pre-rollout moment.
  - Dump file path / storage location: `_____`
  - Taken at (UTC): `_____`
  - Size: `_____`
  - Restore drill performed against a throwaway DB (optional but recommended): `[ ]`
- [ ] **Note today's DO daily backup window.** Secondary fallback only. Daily backups are coarser (RPO up to ~24h) and would replay state to the last scheduled snapshot, not to immediately pre-rollout. Confirm in DO console that the most recent daily backup for `prod-main-db` is recent enough that it's still meaningful as a fallback:
  - Most recent DO daily backup taken at: `_____`
- [x] **Data-safety counts.** Confirmed against prod 2026-05-18, all queries returned 0 rows / no rows:
  - `SELECT COUNT(*) FROM player_points;` → 0 ✓ (migration 018 drops this table)
  - `SELECT COUNT(*) FROM dogpile_events;` → 0 ✓ (migration 018 drops this table)
  - `SELECT COUNT(*) FROM referral_earnings WHERE referee_rebate_lamports > 0;` → 0 ✓ (migration 025 drops the column)
  - `SELECT game, phase, COUNT(*) FROM rounds WHERE game='potshot' AND phase IN ('created','locked','settling') GROUP BY 1,2;` → no rows ✓ (migration 031 adds a unique partial index that would fail on multi-row results)

## Env contract — what `.do/app-prod.yaml` needs vs what `dev` looked like

The `ec8b16c` "move backend business defaults into app config" commit removed several env vars from the YAML by promoting them to in-code `BackendAppConfig` defaults. The lists below reflect the **current** dev yaml; prod should match.

### prod-api service (`pnpm start:waitlist`)

| Status | Key | Source / scope | Notes |
|---|---|---|---|
| keep | DATABASE_URL | `${prod-main-db.DATABASE_URL}` (DO secret) | required by code |
| keep | RPC_URL | `vars.RPC_URL` | required |
| keep | WS_RPC_URL | `vars.WS_RPC_URL` | optional but expected |
| keep | SERVER_KEYPAIR | `secrets.SERVER_KEYPAIR` | required |
| keep | JWT_SECRET | `secrets.JWT_SECRET` | required |
| keep | CHAT_FEED_TOKEN | `secrets.CHAT_FEED_TOKEN` | required for chat |
| keep | CHAT_BASE_URL | `vars.CHAT_BASE_URL` | required for chat |
| keep | PUBLIC_APP_URL | `${APP_URL}` (DO built-in) | auto-resolves |
| keep | PUBLIC_APP_DOMAIN | `${APP_DOMAIN}` (DO built-in) | auto-resolves |
| keep | TELEGRAM_BOT_USERNAME | `vars.TELEGRAM_BOT_USERNAME` | optional but recommended |
| keep | TELEGRAM_WEBHOOK_SECRET | `secrets.TELEGRAM_WEBHOOK_SECRET` | required to validate inbound |
| keep | COMMUNITY_INVITE_URL | `vars.COMMUNITY_INVITE_URL` | optional |
| keep | CLOUDFLARE_ACCOUNT_ID | `vars.CLOUDFLARE_ACCOUNT_ID` | **required** (code calls `requireEnv`) |
| keep | CLOUDFLARE_ACCOUNT_HASH | `vars.CLOUDFLARE_ACCOUNT_HASH` | **required** |
| keep | CLOUDFLARE_IMAGES_TOKEN | `secrets.CLOUDFLARE_IMAGES_TOKEN` | **required** |
| keep | SOLANA_CLUSTER | hardcoded `mainnet-beta` | now in `.do/app-prod.yaml`; selects `mainnet.ts` config registry |
| removed | ADMIN_TOKEN | — | dropped from prod yaml + `deploy-prod.yml` (keeps `/docs` off prod) |
| ensure not present | CLOUDFLARE_IMAGES_VARIANT | — | removed; do not re-add |
| ensure not present | REFERRAL_TIER_WINDOW_DAYS | — | now in `BackendAppConfig` defaults |
| ensure not present | REFERRAL_TIER_RECOMPUTE_HOURS | — | now in `BackendAppConfig` defaults |
| ensure not present | AUTH_WHITELIST_ENABLED | — | now in `BackendAppConfig` defaults |
| ensure not present | AUTH_CHALLENGE_TTL_SECONDS | — | now in `BackendAppConfig` defaults |
| ensure not present | AUTH_ACCESS_TOKEN_TTL_SECONDS | — | now in `BackendAppConfig` defaults |
| ensure not present | AUTH_REFRESH_TOKEN_TTL_DAYS | — | now in `BackendAppConfig` defaults |
| ensure not present | RATE_LIMIT_PER_WALLET | — | now in `BackendAppConfig` defaults |
| ensure not present | RATE_LIMIT_GLOBAL | — | now in `BackendAppConfig` defaults |
| ensure not present | WORKER_POLL_INTERVAL_MS | — | now in `BackendAppConfig` defaults |
| ensure not present | EVENT_QUEUE_POLL_MS | — | now in `BackendAppConfig` defaults |
| ensure not present | ENTROPY_ACCOUNT | — | now in `BackendAppConfig` defaults |
| ensure not present | PYTH_BTC_USD_ACCOUNT | — | now in `BackendAppConfig` defaults |
| ensure not present | MIN_SOL_BALANCE | — | now in `BackendAppConfig` defaults |
| ensure not present | REFERRAL_DEFAULT_RATE_BPS | — | now in `BackendAppConfig` defaults |
| ensure not present | REFERRAL_MIN_CLAIM_LAMPORTS | — | now in `BackendAppConfig` defaults |
| ensure not present | TELEGRAM_LINK_TOKEN_TTL_SECONDS | — | now in `BackendAppConfig` defaults |

### worker component (`pnpm worker` — runs migrations then settlement workers)

| Status | Key | Source / scope | Notes |
|---|---|---|---|
| keep | DATABASE_URL | `${prod-main-db.DATABASE_URL}` | shares db with API |
| keep | RPC_URL, WS_RPC_URL | `vars.*` | settlement RPC |
| keep | SERVER_KEYPAIR | `secrets.SERVER_KEYPAIR` | for on-chain settlement signing |
| keep | JWT_SECRET | `secrets.JWT_SECRET` | shared signing key |
| keep | CHAT_FEED_TOKEN, CHAT_BASE_URL | mixed | chat event publishing |
| keep | CLOUDFLARE_* (3 keys) | mixed | required by code at boot |
| keep | SOLANA_CLUSTER | hardcoded `mainnet-beta` | now in `.do/app-prod.yaml` worker block |

Worker does **not** need PUBLIC_APP_URL / PUBLIC_APP_DOMAIN / TELEGRAM_* / COMMUNITY_INVITE_URL / ADMIN_TOKEN — those are HTTP-handler concerns.

### GH Environment `prod` — required `vars` and `secrets`

Audited via `gh api` on 2026-05-18. The `deploy-prod.yml` workflow's "Validate deploy inputs" step will fail early if a `required_vars=` member is empty, so missing values are caught pre-apply.

`vars` (non-secret):

- [x] PRIMARY_DOMAIN — `api.taunt.bet`
- [x] RPC_URL — dRPC mainnet (`lb.drpc.live/solana/...`, confirmed not devnet)
- [x] WS_RPC_URL — dRPC mainnet WebSocket
- [x] TELEGRAM_BOT_USERNAME — `taunt_bet_bot`
- [x] CLOUDFLARE_ACCOUNT_ID
- [x] CLOUDFLARE_ACCOUNT_HASH

`secrets`:

- [x] SERVER_KEYPAIR
- [x] JWT_SECRET
- [x] CHAT_FEED_TOKEN
- [x] TELEGRAM_WEBHOOK_SECRET
- [x] DIGITALOCEAN_ACCESS_TOKEN (at repo level, not env-scoped — fine)
- [ ] **CLOUDFLARE_IMAGES_TOKEN — MISSING. Add before deploy.** Required by code (`requireEnv` throws on boot) and by workflow `required_vars=` gate. Recommended: copy the value from dev unless you want a separate prod token for blast-radius isolation.

Not in this list — already handled:
- `SOLANA_CLUSTER`, `CHAT_BASE_URL`, `COMMUNITY_INVITE_URL` — values now checked into `src/config/app/{dev,mainnet}.ts`.
- `ADMIN_TOKEN` — dropped (workflow + GH secret).

### Telegram service `prod-telegram` (`pnpm start`)

Telegram's env contract is unchanged by recent commits. Current `.do/app-prod.yaml` matches `src/config.ts` zod schema. No add/remove needed unless the support flow grows.

| Status | Key | Source | Notes |
|---|---|---|---|
| keep | TELEGRAM_BOT_TOKEN | `secrets.TELEGRAM_BOT_TOKEN` | required |
| keep | TELEGRAM_WEBHOOK_SECRET | `secrets.TELEGRAM_WEBHOOK_SECRET` | required, shared with backend |
| keep | BACKEND_URL | `vars.BACKEND_URL` | required |
| keep | PUBLIC_APP_URL | `vars.PUBLIC_APP_URL` | required |
| keep | PUBLIC_BOT_URL | `${APP_URL}` (DO built-in) | auto-resolves |
| keep | WELCOME_VIDEO_FILE_ID | hardcoded | prod-only video id |
| keep | TELEGRAM_MEDIA_DEBUG_CHAT_ID | empty | optional debug |
| keep | TELEGRAM_MEDIA_DEBUG_USER_ID | hardcoded | optional debug |
| keep | REFERRAL_PATH_PREFIX | `vars.REFERRAL_PATH_PREFIX` | defaults to `/ref` if unset |
| keep | COMMUNITY_INVITE_URL | `vars.COMMUNITY_INVITE_URL` | optional |
| not set (falls to default) | TELEGRAM_RATE_LIMIT_WINDOW_MS / MAX | — | 60s / 10 |
| not set (falls to default) | TELEGRAM_BACKEND_TIMEOUT_MS | — | 5s |

GH Environment `prod` for telegram — audited via `gh api`, **all required vars/secrets present**:

- vars ✓: PRIMARY_DOMAIN (`shout.taunt.bet`), BACKEND_URL (`https://api.taunt.bet`), PUBLIC_APP_URL (`https://taunt.bet`), REFERRAL_PATH_PREFIX (`/ref`), COMMUNITY_INVITE_URL (`https://t.me/tauntbet`)
- secrets ✓: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, DIGITALOCEAN_ACCESS_TOKEN (repo-level)

## Backend deploy

- [ ] **FF backend `main` from `dev`.** In `backend/` submodule:
  - [ ] `git fetch origin && git checkout main && git merge --ff-only origin/dev` (or PR-based FF)
  - [ ] `git push origin main`
- [ ] **Tag prod release.** `git tag v0.X.Y` and push. `deploy-prod.yml` triggers on `v*.*.*` tag push, with a guard that the tagged commit must be reachable from `main`.
- [ ] **Apply updated `.do/app-prod.yaml`.** This deploy adds the `worker` component for the first time and (if the cutover decision is "go") flips `run_command`. The workflow's deploy step runs `doctl apps update` via the App Platform GitHub Action. Manual apply also works (`doctl apps update <app-id> --spec .do/app-prod.yaml`) if the workflow is bypassed.
- [ ] **Trigger manual deploy** of `prod-api` and the new `worker` component if `deploy_on_push: false` left them at the prior commit.
- [ ] **Watch worker logs for migrations.** Expect to see 18 lines:
  ```
  Applying migration 017_drop_telegram_link_token_identity_columns.sql...
    ✓ 017_... applied.
  ...
  Applying migration 034_telegram_inbound_chats.sql...
    ✓ 034_... applied.
  18 migration(s) applied successfully.
  ```
  - [ ] All 18 ✓
  - [ ] No transaction rollback / errors
- [ ] **Verify migration state.** Either:
  - [ ] `pnpm migrate:status` from a one-off shell with prod `DATABASE_URL`, or
  - [ ] `SELECT version, name, applied_at FROM _migrations ORDER BY version;` against prod-main-db — confirm rows 017–034 present
- [ ] **API health check.** `GET ${PRIMARY_DOMAIN}/health` returns ok.
- [ ] **Tail API logs.** Confirm no schema-mismatch errors (e.g. `column "referee_rebate_lamports" does not exist`) in the first 5 minutes.
- [ ] **Confirm cluster.** Tail worker logs for the boot banner — log line should mention cluster=`mainnet-beta` (or whatever you set `SOLANA_CLUSTER` to). If it says `devnet`, **stop and roll back the spec** before the watcher subscribes to PDAs on the wrong chain.

## Telegram deploy

- [ ] **FF telegram `main` from `dev`.** In `telegram/` submodule:
  - [ ] `git fetch origin && git checkout main && git merge --ff-only origin/dev`
  - [ ] `git push origin main`
- [ ] **Tag + push.** Telegram also gates prod on a `v*.*.*` tag reachable from main.
- [ ] **Trigger manual deploy** of `prod-telegram` app.
- [ ] **Telegram health check.** Bot service boots, webhook endpoint responds.

## Smoke test

- [ ] **`/start` deep-link** flow end-to-end from a fresh test Telegram account.
- [ ] **Inbound recording.** Send any message to the bot, then:
  ```sql
  SELECT telegram_user_id, telegram_username, message_count, first_seen_at, last_seen_at
  FROM telegram_inbound_chats
  ORDER BY last_seen_at DESC
  LIMIT 5;
  ```
  Expect a row for the test account, `message_count >= 1`.
- [ ] **No backend 5xx** on `/telegram/inbound` in API logs.
- [ ] **Peek sanity** (if peek prod is connected to prod-main-db): the new "TG-linked" / "signup bursts" columns render without errors.

## Root submodule pointer bump

- [ ] In root repo: `git add backend telegram && git commit -m "chore(submodule): bump backend + telegram for prod migration rollout (017→034)"`
- [ ] `git push origin main` (root) — only after both submodule deploys verified green.

## Rollback plan (if migrations fail mid-run)

Each migration runs inside its own transaction (`sql.begin` in `src/migrate.ts`), so a single migration is atomic. If the worker crashes during the run:

1. Inspect `_migrations` table — last applied row is the safe restart point.
2. Identify failing migration from worker logs.
3. If migration is reversible (column drop with empty data): no action, fix migration on dev, ship hotfix.
4. If migration corrupted state, restore from one of (preference order):
   - **pg_dump** taken in pre-flight (primary, tight RPO): stop the `prod-api` and `worker` components first; `pg_restore --clean --if-exists -d <prod-main-db-url> <dump-file>`; resume components.
   - **DO daily backup** (last resort — RPO up to ~24h): restore from the most recent daily backup in the DO console (creates a new database cluster), then swap `${prod-main-db.DATABASE_URL}` to the recovered cluster in `.do/app-prod.yaml` and redeploy. Expect to lose changes between the daily backup and the rollout.

**Do not** manually `INSERT INTO _migrations` to skip a failed migration without first restoring the schema it expected.

## Known cosmetic tech debt (not blocking)

- 5 pre-existing migration files (001, 006, 010, 011, 013) were edited on dev. The runner is version-keyed, so these edits will silently never re-apply on prod. Same effect is achieved via 018/019/025/031 anyway. Files diverge between branches forever — fine but worth noting.
- `src/config/app/dev.ts` and `src/config/app/mainnet.ts` are still near-identical apart from `solana.cluster`. When real per-env divergence lands (auth whitelist, rate limits, treasury accounts, etc.), the loader is already wired to pick the right file.
- Backend `prod-api` still runs `pnpm start:waitlist`, not the full API. Cutover to `pnpm start` is deferred — schedule and log in `docs/TECH_DEBT.md` when the real launch is ready.
