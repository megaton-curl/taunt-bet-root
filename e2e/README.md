# E2E Tests (Devnet)

Extracted from the original monorepo. These tests run Playwright against devnet programs + a running frontend.

## Prerequisites

1. Backend running at `http://localhost:3100`
2. Frontend running at `http://localhost:3003` (or set `PLAYWRIGHT_BASE_URL`)
3. Devnet programs deployed
4. Environment variables set (see `devnet/helpers/env.ts`)

## Run

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test
```

## Status

These tests are a best-effort extraction. They will be finalized when the new frontend repo is ready.
Some imports may need updating as the frontend is rebuilt.
