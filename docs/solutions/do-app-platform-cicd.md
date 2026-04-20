# DigitalOcean App Platform Operating Model

Single source of truth for how we use DigitalOcean App Platform. This is intentionally short: it describes ownership, deploy flow, and the few infra rules that matter. Detailed repo-specific setup stays in each repo's `.do/README.md`.

## Intention

- Each deployable repo owns its own App Platform spec, GitHub workflows, and env contract.
- Git is the source of truth for deploy config. The DigitalOcean UI is for observing deploys, not hand-maintaining drift.
- GitHub Actions is the only deploy driver. `deploy_on_push` stays disabled in App Platform.
- We run one App Platform app per repo per environment. There is no separate infra repo and no dependency on a shared combined app.

Current deployable repos:

- `backend`
- `chat`
- `telegram`
- `waitlist`
- `webapp`

Each of those repos owns this shape:

```text
.github/workflows/ci.yml
.github/workflows/deploy-dev.yml
.github/workflows/deploy-prod.yml
.do/app-dev.yaml
.do/app-prod.yaml
.do/README.md
```

## Deploy Flow

1. Pull requests run repo-local CI only.
2. Pushes to `dev` deploy that repo's dev app.
3. Production deploys come from release-ready tags.
4. Deploys apply the checked-in app spec, not manual UI changes.
5. New apps are verified on the default App Platform URL before any custom-domain cutover.

Use short environment-first app names such as `dev-api`, `dev-webapp`, `dev-waitlist`, `dev-scream`, and `dev-telegram`. Public hostnames do not need to match the app name.

## Config Boundaries

Each deployable repo stores:

- repository secret: `DIGITALOCEAN_ACCESS_TOKEN`
- GitHub Environment `dev`
- GitHub Environment `prod`

GitHub vars and secrets hold repo-owned inputs such as custom domains, backend URLs, RPC endpoints, tokens, and other application secrets.

The app spec owns values that DigitalOcean can inject itself, such as `APP_URL`, `APP_DOMAIN`, and attached-database bindables. Do not route those through GitHub first. Use neutral GitHub names like `PRIMARY_DOMAIN`, not `APP_DOMAIN`.

When an env contract changes, update the app spec, deploy workflows, and `.do/README.md` in the same task.

Use App Platform scopes deliberately:

- `RUN_TIME` for live-process-only values
- `BUILD_TIME` for static frontend inputs
- `RUN_AND_BUILD_TIME` only when the same value is genuinely needed in both phases

For Vite static sites, keep the build command explicit: `npm ci --include=dev && npm run build`.

## Infra Rules

- Each repo owns its own custom domain attachment, but DNS remains a manual gate outside git.
- Roll traffic one repo and one hostname at a time. Do not assume old combined-app ingress rules are part of the new shape.
- The top-level app-spec `name:` is the App Platform resource identity. Changing it is a migration, not a cosmetic rename.

Service-specific caveats we actually care about:

- `backend` owns the database contract.
- If a database is attached to the same app, bind it from the app spec. If it is external, inject it from GitHub secrets.
- The backend still runs migrations on startup, so database cutovers are startup behavior changes, not just secret swaps.
- Attaching an existing managed database during app creation requires a DO token that can update databases.
- `telegram` may fail first-boot webhook registration until DNS and certificates are ready. Retry on restart or redeploy instead of treating that as a bad app build.

## Cutover And Rollback

Cutover is simple:

1. Deploy the new app.
2. Verify it on the default App Platform URL.
3. Attach the intended custom domain.
4. Flip DNS.
5. Confirm health and only then retire the old app or route.

Rollback is also from git and DNS:

- dev: redeploy the last known-good commit from `dev`
- prod: redeploy the last known-good release tag
- if the problem is domain or certificate related, roll back DNS or domain mapping before changing code

If we move to a new DigitalOcean team, recreate apps, databases, domains/certificates, projects, and the team API token there. Do not assume those resources transfer in place.
