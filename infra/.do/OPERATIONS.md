# Operations

## GitHub Environments

Use GitHub Environments to separate dev and prod deployment inputs.

### `dev`

Repository secret:

- `DIGITALOCEAN_ACCESS_TOKEN`

Environment secrets:

- `BACKEND_SERVER_KEYPAIR`
- `BACKEND_DATABASE_URL`
- `BACKEND_ADMIN_TOKEN`
- `BACKEND_JWT_SECRET`
- `CHAT_FEED_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `CHAT_JWT_SECRET`
- `CHAT_ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN`

Stable non-secret dev values are committed in `.do/app-dev.yaml`.

### `prod`

Repository secret:

- `DIGITALOCEAN_ACCESS_TOKEN`

Environment variables:

- `PROD_PRIMARY_DOMAIN`
- `PROD_WAITLIST_DOMAIN`
- `PROD_API_DOMAIN`
- `PROD_CHAT_DOMAIN`
- `BACKEND_RPC_URL`
- `TELEGRAM_BOT_USERNAME`
- `COMMUNITY_INVITE_URL`
- `PLATFORM_API_BASE_URL`
- `BACKEND_URL`
- `PUBLIC_APP_URL`
- `REFERRAL_PATH_PREFIX`
- `VITE_SOLANA_NETWORK`
- `VITE_FAIRNESS_BACKEND_URL`
- `VITE_RPC_URL`
- `VITE_BASE_PATH`
- `WEBAPP_VITE_SOLANA_NETWORK`
- `WEBAPP_VITE_FAIRNESS_BACKEND_URL`
- `WEBAPP_VITE_RPC_URL`
- `WEBAPP_VITE_WS_RPC_URL`

Environment secrets:

- `BACKEND_SERVER_KEYPAIR`
- `BACKEND_DATABASE_URL`
- `BACKEND_ADMIN_TOKEN`
- `BACKEND_JWT_SECRET`
- `CHAT_FEED_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `CHAT_JWT_SECRET`
- `CHAT_ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN`

## Database Pattern

- Preferred target: standalone managed database per environment
- Runtime connection only: inject `BACKEND_DATABASE_URL` from GitHub Environment secrets
- Migration execution stays outside App Platform build and deploy

## Migration Workflow Shape

For now, use a manual migration run before first infra-controlled cutover:

```bash
cd backend
pnpm install --frozen-lockfile
cd services/backend
DATABASE_URL="$BACKEND_DATABASE_URL" pnpm migrate:status
DATABASE_URL="$BACKEND_DATABASE_URL" pnpm migrate
```

If you later automate this from the infra repo, create a dedicated `workflow_dispatch` workflow that checks out `taunt-bet/backend`, injects `BACKEND_DATABASE_URL`, runs `pnpm migrate:status`, then `pnpm migrate`.

The backend run command in the infra app specs intentionally bypasses the backend `start` script so App Platform does not auto-run migrations on boot.

## Rollback

### Dev

- Revert or redeploy the last known-good commit from the infra repo `dev` branch
- If the problem is only DNS or domain routing, revert that before rolling back app config

### Prod

- Re-deploy the previous release tag from infra repo `main`
- Keep migrations backward-compatible when possible so app rollback stays safe

## First Rebuild Sequence

1. Confirm what will happen to `dev-taunt-db-pg` if `dev-taunt-bet` is destroyed.
2. Create GitHub Environment `dev` in the infra repo and populate the required secrets.
3. Push the infra repo so GitHub Actions exists.
4. Decide whether the first cutover will reuse current dev domains or use temporary test domains while `dev-taunt-bet` still exists.
5. Disable `deploy_on_push` on the current live app if it still exists.
6. Run backend migrations separately against the target dev database.
7. Deploy `.do/app-dev.yaml` from the infra repo.
8. Smoke test `api.dev.taunt.bet`, `waitlist.dev.taunt.bet`, `dev.taunt.bet`, and `scream.dev.taunt.bet`.
9. Re-run the same deploy with no spec changes to confirm the workflow is repeatable.
