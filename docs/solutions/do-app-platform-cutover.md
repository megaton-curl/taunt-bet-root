# Per-Repo App Platform Cutover

Manual cutover runbook for moving from the current combined `dev-taunt-bet` app to standalone App Platform apps owned by each repo.

## Target App Split

- `backend` -> `api.dev.taunt.bet`
- `chat` -> `scream.dev.taunt.bet`
- `telegram` -> `shout.dev.taunt.bet`
- `waitlist` -> `waitlist.dev.taunt.bet`
- `webapp` -> `dev.taunt.bet`

Recommended App Platform names for that split:

- `backend` -> `dev-api` / `prod-api`
- `chat` -> `dev-scream` / `prod-scream`
- `telegram` -> `dev-shout` / `prod-shout`
- `waitlist` -> `dev-waitlist` / `prod-waitlist`
- `webapp` -> `dev-webapp` / `prod-webapp`

`telegram` is intentionally moved off the old shared backend hostname/path shape. Separate App Platform apps should not depend on cross-app path routing from the old combined ingress.

## GitHub Setup

For each repo:

1. Create GitHub Environments:
   - `dev`
   - `prod`
2. Add repository secret:
   - `DIGITALOCEAN_ACCESS_TOKEN`
3. Add the repo-specific variables and secrets documented in that repo's `.do/README.md`.

## New DigitalOcean Team Bootstrap

You created a new empty team, so treat this as a **recreate-and-cut-over** migration, not an in-place move.

What does **not** transfer directly between teams:

- App Platform apps
- Managed databases
- App-attached custom domains and certificates
- Team API tokens
- DigitalOcean Projects

What to do in the new team:

1. Create a new team-scoped API token in DigitalOcean.
2. Replace `DIGITALOCEAN_ACCESS_TOKEN` in each repo's GitHub secrets with the new team token.
3. Create the new App Platform apps in the new team by running the repo-owned deploy workflows or deploying the checked-in specs with `doctl`.
4. Create new managed databases in the new team.
5. If existing database state matters, export/import it instead of assuming the database can be moved.
6. Recreate any DigitalOcean Projects you want to use for grouping.
7. Recreate alerting, access, and any team-local operational settings you relied on in the old team.

## Domains And DNS Across Teams

There are two separate concerns here:

- **App Platform custom domains**: attach these to the new apps in the new team during cutover.
- **DigitalOcean DNS zone hosting**: only relevant if DigitalOcean is also your DNS provider for the zone.

If DigitalOcean hosts the DNS zone:

1. Export/download the zone from the old team.
2. Recreate the domain in the new team.
3. Recreate the DNS records in the new team from the exported zone.
4. Only then start moving traffic record-by-record to the new standalone apps.

If DNS is hosted somewhere else:

- Do **not** try to "transfer the domain" inside DigitalOcean.
- Just update the external DNS records when each new app is ready.

For App Platform custom domains:

1. Keep the old app serving traffic until the new app is healthy on its default App Platform URL.
2. Add the same hostname to the new app in the new team.
3. Update DNS to point at the new app.
4. Wait for certificate issuance/validation in the new team.
5. Smoke test before removing the hostname from the old app.

## Token And Secret Rotation

Because the new team needs a new API token, plan a small secret rotation pass:

1. Generate a new DigitalOcean token in the new team.
2. Update `DIGITALOCEAN_ACCESS_TOKEN` in each repo.
3. Re-run the `deploy-dev.yml` workflow in one low-risk repo first, such as `waitlist`.
4. Only then fan out to `webapp`, `chat`, `telegram`, and `backend`.

Application secrets like JWT keys, bot tokens, webhook secrets, and database URLs do not automatically move through the team migration either. Re-enter them into GitHub Environments deliberately while you set up the new team.

## Database Migration Notes

App Platform apps can be recreated from specs, but the backend database needs separate handling.

- New team: create a fresh managed Postgres cluster for each environment you need.
- If this is just a dev reset, you can start with an empty database and update `DATABASE_URL`.
- If the existing data matters, do a dump/restore into the new cluster before promoting the new backend app.
- Do not delete the old combined app or old database until the new backend app has started cleanly against the new cluster.

## Dev Rollout Order

1. `waitlist`
2. `webapp`
3. `chat`
4. `telegram`
5. `backend`

This keeps the database-bearing backend cutover last.

## Dev Rollout Steps

For each repo:

1. Push the repo changes that add `.do/` and `.github/workflows/`.
2. Populate the repo's `dev` GitHub Environment with the values from `.do/README.md`.
3. Trigger the `Deploy Dev` workflow by pushing to `dev`.
4. Confirm the new app is created in App Platform.
5. Confirm the app is healthy on its default App Platform URL before touching custom domains.

For frontend apps (`waitlist`, `webapp`), make sure the deployed spec uses `npm ci --include=dev && npm run build` so App Platform installs the Vite/TypeScript toolchain from `devDependencies`.

## Custom Domain Cutover

Move domains one repo at a time after the standalone app is healthy:

1. Attach the repo's target custom domain in the standalone app.
2. Update DNS records to point at the standalone app.
3. Wait for certificate issuance to complete.
4. Smoke test the repo-specific flow:
   - `waitlist`: landing page, auth, referral capture
   - `webapp`: homepage and wallet/RPC boot
   - `chat`: health and stream endpoints
   - `telegram`: webhook endpoint and bot command sync
   - `backend`: health plus auth/referral endpoints
5. Only then remove the equivalent traffic from the combined app.

## Backend And Database Notes

- Keep the existing database before deleting the combined app.
- Confirm the backend standalone app uses the intended `DATABASE_URL`.
- Because the backend start command still runs migrations on boot, use an already-validated database target before promoting the new backend app.

## Combined App Retirement

Only remove `dev-taunt-bet` after all standalone apps are healthy and serving the intended custom domains.

Suggested manual sequence with `doctl`:

```bash
doctl apps list
doctl apps get <new-app-id>
doctl apps get <old-combined-app-id>
doctl apps delete <old-combined-app-id>
```

## Proof Checklist

- Every repo has its own App Platform app in DigitalOcean.
- Every repo has its own GitHub Actions deploy workflow.
- Every repo has its own `dev` and `prod` GitHub Environment contract.
- Ingress routes that forward to a component use **Preserve Full Path** in the control panel, which matches `ingress.rules[].component.preserve_path_prefix: true` in the checked-in app spec (not the default trim-prefix behavior).
- The old combined app no longer owns live domains.
- The old combined app is deleted only after the standalone apps are verified healthy.
