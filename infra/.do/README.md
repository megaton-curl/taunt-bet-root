# App Platform Specs

This directory contains the authoritative DigitalOcean App Platform specs for the combined Taunt Bet app.

## Files

- `app-dev.yaml`: combined dev app
- `app-prod.yaml`: combined prod app template
- `live/`: local-only exports and notes from `doctl`

## Ingress

In the App Platform UI, set each component route to **Preserve Full Path**. In YAML that is `ingress.rules[].component.preserve_path_prefix: true` (not the default trim-prefix behavior). The checked-in `app-*.yaml` files use this; keep it when you change routes.

## Rules

- The spec is the source of truth.
- Do not rely on App Platform UI env vars surviving a spec deploy.
- Keep `deploy_on_push: false` for every component.
- Only secret values should come from GitHub Environment secrets during deploy.
- Non-secret values that are stable and safe to commit can stay in the spec.

## Current Dev Shape

The live app currently combines:

- `backend`
- `chat`
- `telegram`
- `waitlist`
- `webapp`

The dev spec in this repo preserves that combined shape while moving deployment control into GitHub Actions.
