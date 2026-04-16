# Taunt Bet Infra

Authoritative infrastructure repo for the combined DigitalOcean App Platform deployment.

## Ownership

This repo owns:

- the combined App Platform app spec
- GitHub Actions deployment workflows
- local-only live-state capture instructions

This repo does not own application source code. Each App Platform component still builds from its own source repository:

- `taunt-bet/backend`
- `taunt-bet/chat`
- `taunt-bet/telegram`
- `taunt-bet/waitlist`
- `taunt-bet/webapp`

## Deployment Model

- Pull requests run CI only.
- Pushes to `dev` deploy the combined dev app using `.do/app-dev.yaml`.
- Production stays documented but disabled for now; `.do/app-prod.yaml` is a template until component release pinning is defined.
- `deploy_on_push` must stay disabled in App Platform so GitHub Actions is the only deploy driver.

## Critical Safety Note

The current live `dev-taunt-bet` app includes a managed database component named `dev-taunt-db-pg`.

The new dev spec creates a separate app named `dev-taunt-bet-infra` so the first infra-controlled deploy does not silently mutate the current live app.

Do not destroy the existing app until you have explicitly decided how to handle that database:

- preserve and reconnect it as an external managed database, or
- accept that deleting the app may also delete the attached database component

## GitHub Environment Inputs

Repository secret:

- `DIGITALOCEAN_ACCESS_TOKEN`

`dev` environment secrets:

- `BACKEND_SERVER_KEYPAIR`
- `BACKEND_DATABASE_URL`
- `BACKEND_ADMIN_TOKEN`
- `BACKEND_JWT_SECRET`
- `CHAT_FEED_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `CHAT_JWT_SECRET`
- `CHAT_ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN`

`prod` environment secrets later:

- same logical names, but scoped to the `prod` environment

## Manual Migration Pattern

Backend migrations must stay outside App Platform build time.

Current backend commands:

```bash
cd backend
pnpm install --frozen-lockfile
cd services/backend
DATABASE_URL=... pnpm migrate
```

Use the live backend repo and a runtime database URL. Do not embed migration execution inside the App Platform app spec.
