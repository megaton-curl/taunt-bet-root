# DigitalOcean App Platform CI/CD Standard

Reference pattern for **per-repo** DigitalOcean App Platform ownership using GitHub Actions and checked-in app specs.

## Standard Repo Layout

Each deployable repo owns:

```text
.github/workflows/ci.yml
.github/workflows/deploy-dev.yml
.github/workflows/deploy-prod.yml
.do/app-dev.yaml
.do/app-prod.yaml
.do/README.md
```

Current scope:

- `backend/`
- `chat/`
- `telegram/`
- `waitlist/`
- `webapp/`

The `infra/` repo can still exist for shared notes or templates, but it is no longer the deployment owner.

## Recommended App Names

Use short environment-first names in App Platform:

- `dev-waitlist`
- `dev-webapp`
- `dev-api`
- `dev-scream`
- `dev-shout`
- `prod-waitlist`
- `prod-webapp`
- `prod-api`
- `prod-scream`
- `prod-shout`

## Deployment Rules

- Pull requests run repo-local CI only.
- Pushes to `dev` deploy the repo's dev app.
- Production deploys are reserved for version tags created from release-ready commits.
- `deploy_on_push` must stay disabled in App Platform so GitHub Actions is the only deploy driver.
- App specs are authoritative. If an env var is required, it must be represented in the checked-in spec.

## GitHub Storage

Each repo stores:

- repository secret: `DIGITALOCEAN_ACCESS_TOKEN`
- GitHub Environment `dev`
- GitHub Environment `prod`

Use environment variables for non-secret deploy inputs like hostnames, backend URLs, and RPC endpoints.

Use environment secrets for sensitive values like database URLs, JWT secrets, bot tokens, and webhook secrets.

## DigitalOcean Storage

- one App Platform app per repo per environment
- app objects and deployment history
- managed databases
- encrypted copies of spec-provided secret values after deployment
- domain attachments and certificates

## Team Migration Notes

When moving this setup to a new DigitalOcean team, do not assume resources transfer in place.

- Recreate App Platform apps in the new team from the checked-in specs.
- Create new team-scoped API tokens and replace `DIGITALOCEAN_ACCESS_TOKEN` in GitHub.
- Recreate managed databases in the new team and migrate data separately if needed.
- Recreate DigitalOcean Projects if you use them.
- Reattach custom domains in the new team and let certificates reissue there.
- If DigitalOcean hosts the DNS zone, export the zone from the old team and recreate it in the new one.

## Git Storage

- repo-local app specs
- repo-local workflow definitions
- non-secret defaults only when safe to commit
- root-level docs and rollout notes

## Domain Strategy

- Each repo owns its own custom domain attachment in its own app spec.
- Keep DNS records in the DNS provider, not in git.
- Treat DNS cutover as a manual gate even when app deployment is automated.
- Do not depend on cross-app path routing from the old combined app. If a service becomes its own app, it should also get its own hostname or an explicitly planned ingress strategy.

## Ingress (`ingress.rules`)

- Prefer host-scoped rules using `match.authority.exact` (or `prefix` when appropriate) so each app only accepts traffic for its own hostname.
- **Preserve Full Path** (label in the App Platform UI for each ingress route) is the same as **`preserve_path_prefix: true`** on `ingress.rules[].component` in the app spec. The default UI/spec behavior is effectively **trim the matched path prefix** before the request hits your component; turn **Preserve Full Path** on unless you depend on that stripping.
- For every rule that forwards to a **service** or **static site** component, set `preserve_path_prefix: true` so behavior matches **Preserve Full Path** in the dashboard. That matters most for subpath mounts (for example `/chat`, `/wg/tg`) and keeps the path the component sees aligned with the browser URL.
- `preserve_path_prefix` is mutually exclusive with `component.rewrite`; pick one behavior per rule.

## Frontend Build Notes

For Vite static sites like `waitlist/` and `webapp/`, do not rely on `BUILD_TIME NODE_ENV=production` in App Platform specs.

- `vite build` already produces a production build.
- App Platform builds still need frontend toolchain packages from `devDependencies`.
- Prefer an explicit build command such as `npm ci --include=dev && npm run build` so the App Platform build shape matches the repo validation path.

## Database Strategy

- `backend` owns the runtime database contract.
- Prefer a standalone managed database per environment.
- Inject the connection string at runtime from GitHub Environment secrets.
- Do not run migrations in App Platform build commands.
- The current backend service still auto-runs migrations during startup, so database cutover should be staged carefully until that behavior is intentionally changed.

## Rollback Strategy

- Roll back from git, not by editing live values in the App Platform UI.
- Dev: redeploy the last known-good commit from `dev`.
- Prod: redeploy the last known-good release tag.
- Caveat: source-based App Platform deploys are tag-gated, not fully immutable, because the spec still points at a branch.
- If the failure is domain-related, roll back DNS or custom-domain mapping before changing app code.

## Cutover Sequence

1. Capture the current live app spec and runtime data with `doctl`.
2. Stand up the new per-repo apps in dev first.
3. Configure the GitHub environment variables and secrets for each repo.
4. Move custom domains one repo at a time.
5. Confirm backend/database handling before deleting the old combined app.
6. Remove the old combined app only after all standalone apps are healthy.
