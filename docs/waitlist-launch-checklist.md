# Waitlist Launch Checklist

First production launch for the `waitlist` app at `https://taunt.bet`, using the production backend at `https://api.taunt.bet`.

## Launch Assumptions
- [ ] Launch target is the root domain `https://taunt.bet`.
- [ ] API target is `https://api.taunt.bet`.
- [ ] App deploys may be automated, but DNS/domain cutover and final go-live remain manual gates.
- [ ] `VITE_BASE_PATH=/` is kept for production.
  - The app's referral capture logic matches `/ref/:code` at the root path, so this checklist assumes a root-domain launch.
- [ ] Solana target is confirmed for production.
  - The app defaults to `devnet` unless `VITE_SOLANA_NETWORK` is set to `mainnet` or `mainnet-beta`.

## Preflight
- [ ] Confirm the exact git branch and commit that will back the production deploy.
- [ ] Confirm who owns launch-day decisions for DNS, DigitalOcean App Platform, and backend changes.
- [ ] In `waitlist/.do/app-prod.yaml`, confirm the production app name, branch, and domain values that will be injected from the repo's `prod` GitHub Environment.
  - The repo now owns both `waitlist/.do/app-dev.yaml` and `waitlist/.do/app-prod.yaml`, and both keep `deploy_on_push: false`.
- [ ] Confirm the backend is production-ready at `https://api.taunt.bet`.
  - Required waitlist endpoints: `/auth/challenge`, `/auth/verify`, `/auth/refresh`, `/auth/logout`, `/public-referral/code/:code`, `/referral/code`, `/referral/apply`, `/referral/referrer`, `/referral/stats`, `/referral/referrals`, `/telegram/generate-link`.
- [ ] Confirm backend CORS and auth/session behavior allow requests from `https://taunt.bet`.
- [ ] Confirm wallet auth is intended to run against mainnet production settings.
- [ ] Confirm a production RPC strategy.
  - The app can use `VITE_RPC_URL`; relying on the public default mainnet RPC is risky for launch traffic.
- [ ] Build the waitlist locally from the release commit.
  - Run `cd waitlist && npm ci && npm run build`.

## Production Env Contract
- [ ] Set `VITE_FAIRNESS_BACKEND_URL=https://api.taunt.bet`.
- [ ] Set `VITE_SOLANA_NETWORK=mainnet-beta` for production.
- [ ] Set `VITE_RPC_URL` to the approved production RPC endpoint.
- [ ] Set `VITE_BASE_PATH=/`.
- [ ] Confirm no production build still references `https://api.dev.taunt.bet`.
- [ ] Confirm no empty-string env override is being used for `VITE_FAIRNESS_BACKEND_URL`.
  - The code only falls back when the variable is unset, not when it is set to an empty string.

## DigitalOcean App Platform
- [ ] Confirm the production app name, region, repo, and branch/source settings.
- [ ] Confirm the production app name matches the current naming convention, e.g. `prod-waitlist`.
- [ ] Confirm the production build command is `npm ci --include=dev && npm run build`.
- [ ] Confirm the output directory is `dist`.
- [ ] Confirm SPA routing is preserved.
  - `index_document` and `catchall_document` should resolve to `index.html`.
- [ ] Enter the production GitHub Environment values and secrets that will be injected into `waitlist/.do/app-prod.yaml`.
- [ ] Confirm `deploy_on_push` remains disabled so GitHub Actions stays the only deploy driver.
- [ ] Run a production build/deploy in App Platform and review build logs before any domain cutover.

## Domain And DNS Cutover
- [ ] Point `api.taunt.bet` to the production backend and verify it serves healthy HTTPS responses.
- [ ] Attach `taunt.bet` as a custom domain on the production App Platform app.
- [ ] Create or update the DNS records needed for the `taunt.bet` root domain cutover.
- [ ] Wait for certificate issuance to complete for `taunt.bet`.
- [ ] Confirm `https://taunt.bet` resolves to the production waitlist build before announcing launch.
- [ ] Confirm `https://api.taunt.bet` is reachable from a browser and from the waitlist origin.
- [ ] Confirm the root-domain deploy serves `/` correctly.
- [ ] Confirm a direct visit to `/ref/test-code` lands on the site and rewrites cleanly back to `/`.

## Smoke Test
### Anonymous Homepage
- [ ] Load `https://taunt.bet` in a clean browser session.
- [ ] Confirm the page renders hero content, waitlist join card, FAQ, footer, and branding assets.
- [ ] Confirm header social links open the expected destinations for X, Telegram, and Discord.
- [ ] Confirm there are no obvious browser console errors and no broken static assets.

### Wallet Connect And Authentication
- [ ] Click `CONNECT SOLANA WALLET` and connect a supported wallet.
- [ ] Complete the wallet message-sign flow successfully.
- [ ] Confirm the connected state appears and the session authenticates against `https://api.taunt.bet`.
- [ ] Refresh the page and confirm the session restores correctly.
- [ ] Disconnect and confirm the session clears cleanly.

### Referral Flows
- [ ] Visit `https://taunt.bet/ref/<known-code>` while logged out.
- [ ] Confirm the app captures the code, returns the browser to `/`, and keeps the referral pending until auth.
- [ ] Connect a wallet after landing from a referral link and confirm the referral modal appears.
- [ ] Confirm `APPLY` links the referral successfully.
- [ ] Confirm `NOT NOW` behavior is acceptable for launch-day UX.
  - Dismissing the modal hides it, but the stored referral code may still exist locally.
- [ ] From the logged-in view, set or confirm a referral code for the current user.
- [ ] Copy the generated referral link and verify it uses `taunt.bet/ref/<code>`.
- [ ] Open the copied link in a fresh session and confirm it behaves correctly.
- [ ] Manually enter an invalid referral code and confirm the error UX is acceptable.

### Telegram And Community Links
- [ ] From the logged-in view, trigger `JOIN TELEGRAM`.
- [ ] Confirm the API call to `/telegram/generate-link` succeeds.
- [ ] Confirm the Telegram deep link opens successfully.
- [ ] If the wallet is already linked, confirm the `Open Bot` and `Join Community` links are correct.

## Launch Monitoring
- [ ] Watch DigitalOcean deploy logs during and immediately after release.
- [ ] Watch backend logs and metrics for auth, referral, and Telegram endpoint failures.
- [ ] Watch browser-network failures from `taunt.bet` to `api.taunt.bet`.
- [ ] Monitor for RPC failures, wallet-signing failures, and CORS issues.
- [ ] Re-run the smoke test after DNS propagation completes.
- [ ] Keep a short post-launch observation window before declaring the launch stable.

## Rollback
- [ ] Define the rollback owner before launch starts.
- [ ] Keep the previous DNS target or staging target documented so it can be restored quickly.
- [ ] Keep the previous App Platform env values documented, especially the pre-cutover backend host and branch/app settings.
- [ ] If smoke tests fail after cutover, remove or revert the `taunt.bet` custom-domain/DNS mapping first.
- [ ] If backend-origin issues are the problem, revert the production frontend env or backend allowlist changes before retrying.
- [ ] If the production app itself is bad, roll back to the last known-good deploy or disable automatic redeploys while fixing the issue.
- [ ] After rollback, re-test the fallback destination and note exactly which check failed.

## Final Sign-Off
- [ ] Production app build is green.
- [ ] `taunt.bet` serves the intended production waitlist.
- [ ] `api.taunt.bet` serves the production backend needed by the waitlist.
- [ ] Wallet connect, auth, referral, and Telegram flows all passed on production.
- [ ] Monitoring is active and the rollback owner is on standby.
- [ ] Launch owner gives the final go/no-go.
