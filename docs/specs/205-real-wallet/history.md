# Implementation History — 205-real-wallet

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Build validation in real wallet mode

**Item**: Set `VITE_MOCK_MODE=false`, run `pnpm build`, `pnpm lint`, and `pnpm typecheck`.

**Result**: All three checks passed with zero errors. The pre-existing scaffold code (`RealWalletProvider.tsx`, `TestWalletProvider.tsx`, `WalletProvider.tsx`) compiles cleanly in real wallet mode. No fixes needed.

- `VITE_MOCK_MODE=false pnpm build`: 423 modules transformed, build successful
- `pnpm lint`: 0 errors (10 pre-existing warnings in unrelated files)
- `pnpm typecheck`: 0 errors

**Status**: Complete
## Iteration 1 — 2026-02-19T11:38:50Z — OK
- **Log**: iteration-001.log

---

## Iteration 2 — Shared ConnectionProvider across all wallet modes

**Item**: Move `ConnectionProvider` from `RealWalletProvider.tsx` to `WalletProvider.tsx` level.

**Changes**:
- `packages/wallet/src/WalletProvider.tsx` — Added `ConnectionProvider` import from `@solana/wallet-adapter-react`, added `getRpcUrl()` helper (reads `VITE_RPC_URL`, defaults to `https://api.devnet.solana.com`), wrapped both Mock and Real provider branches with `<ConnectionProvider endpoint={endpoint}>`.
- `packages/wallet/src/real/RealWalletProvider.tsx` — Removed `ConnectionProvider` import and wrapper, removed `getRpcUrl()` and `DEFAULT_RPC_URL` (now handled at `WalletProvider` level). `WalletBridge` still uses `useConnection()` from the shared provider.

**Result**: All checks passed:
- `pnpm lint`: 0 errors
- `pnpm typecheck`: 0 errors
- `pnpm build` (mock mode): successful (423 modules)
- `VITE_MOCK_MODE=false pnpm build` (real mode): successful (423 modules)

**Status**: Complete

## Iteration 2 — 2026-02-19T11:42:57Z — OK
- **Log**: iteration-002.log

---

## Iteration 3 — CoinflipContext + useBalance use shared Connection

**Item**: Update `CoinflipContext.tsx` and `useBalance.ts` to use `useConnection()` from the shared `ConnectionProvider` instead of creating their own `Connection` instances.

**Changes**:
- `apps/platform/src/features/coinflip/context/CoinflipContext.tsx` — Replaced `const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), [])` with `const { connection } = useConnection()`. Deleted the `RPC_URL` constant and removed `useMemo`/`Connection` imports. Import `useConnection` from `@rng-utopia/wallet/hooks`.
- `packages/wallet/src/useBalance.ts` — Replaced internal `connectionRef`, `getConnection()`, `getRpcUrl()`, and `DEFAULT_RPC_URL` with `const { connection } = useConnection()`. Removed `Connection` import and the `rpcUrl` option from `UseBalanceOptions`. Removed the `connectionRef` cleanup effect.
- `packages/wallet/src/hooks.ts` — Re-exported `useConnection` from `@solana/wallet-adapter-react` so consumers (like CoinflipContext) don't need a direct dependency.

**Result**: All checks passed:
- `pnpm lint`: 0 errors (10 pre-existing warnings)
- `pnpm typecheck`: 0 errors
- `pnpm build` (mock mode): successful (423 modules)
- `VITE_MOCK_MODE=false pnpm build` (real mode): successful (423 modules)

**Status**: Complete

## Iteration 3 — 2026-02-19T11:47:30Z — OK
- **Log**: iteration-003.log

---

## Iteration 4 — Mock mode + visual regression preservation

**Item**: Run `pnpm test:visual` — all 17 visual regression baselines pass with zero diff. Verify zero JS console errors in mock mode via Playwright headless.

**Result**: All 17 visual regression tests passed (12 route baselines + 5 state variants). The `stablePage` fixture collects console errors and fails tests on any errors — all tests passed, confirming zero JS console errors. No code changes needed — this iteration validates that iterations 1-3 (wallet refactor) preserved mock mode UI and behavior.

- `pnpm test:visual`: 17 passed (1m 36s)
- Console errors: 0 (verified by `stablePage` fixture)

**Status**: Complete

## Iteration 4 — 2026-02-19T11:50:54Z — OK
- **Log**: iteration-004.log

---

## Iteration 5 — Real mode app startup validation

**Item**: Start dev server with `VITE_MOCK_MODE=false` and `VITE_RPC_URL=https://api.devnet.solana.com`. Load app in Playwright headless — verify no JS console errors, wallet icon renders disconnected, clicking wallet icon calls `connect()` without crashing.

**Changes**:
- `apps/platform/playwright.real.config.ts` — New Playwright config for real-mode tests. Starts Vite dev server on port 3001 with `VITE_MOCK_MODE=false` and `VITE_RPC_URL=https://api.devnet.solana.com` via webServer `env` property. Only matches `real/**/*.spec.ts`.
- `apps/platform/e2e/real/startup.spec.ts` — New test file with `realPage` fixture (console error collection, no frozen time/randomness). Two tests: (1) app loads without console errors, wallet icon visible in disconnected state with "—" text; (2) clicking wallet icon triggers connect() without crashing, app remains functional.
- `apps/platform/package.json` — Added `test:real` script (`playwright test --config playwright.real.config.ts`).

**Result**: Both tests passed:
- `pnpm test:real`: 2 passed (17.2s)
- Console errors: 0 (verified by `realPage` fixture)
- `pnpm lint`: 0 errors (10 pre-existing warnings)
- `pnpm typecheck`: 0 errors

**Status**: Complete

## Iteration 5 — 2026-02-19T11:57:24Z — OK
- **Log**: iteration-005.log

---

## Iteration 6 — TestWalletProvider unit test

**Item**: Write vitest tests for `TestWalletProvider` and `MockWalletProvider`.

**Changes**:
- `packages/wallet/vitest.config.ts` — New vitest config with jsdom environment.
- `packages/wallet/src/test/TestWalletProvider.test.tsx` — Two tests: (1) TestWalletProvider auto-connects, exposes `connected: true` and `publicKey` matching the injected keypair; (2) MockWalletProvider starts disconnected with `connected: false` and `isMock: true`.
- `packages/wallet/package.json` — Added `test` script (`vitest run`), added devDependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `react-dom`, `@types/react-dom`.

**Approach**: Mocked `@solana/web3.js`'s `Connection` class to stub `getBalance()` (called by `TestWalletProvider.connect()` during auto-connect). Used `@testing-library/react`'s `renderHook` + `waitFor` for async state assertions.

**Result**: All checks passed:
- `pnpm --filter @rng-utopia/wallet test`: 2 passed (4.5s)
- `pnpm lint`: 0 errors (10 pre-existing warnings)
- `pnpm typecheck`: 0 errors

**Status**: Complete

## Iteration 6 — 2026-02-19T12:01:31Z — OK
- **Log**: iteration-006.log

---

## Iteration 7 — Final verification

**Item**: Run all validation checks — visual tests, lint, typecheck, mock/real mode startup, and full `./scripts/verify`.

**Result**: All checks passed with no code changes needed:
- `pnpm test:visual`: 19 passed (17 visual baselines + 2 real-mode startup tests)
- `pnpm lint`: 0 errors (10 pre-existing warnings in unrelated files)
- `pnpm typecheck`: 0 errors across all 17 packages
- Mock mode: 0 console errors (verified by visual test `stablePage` fixture)
- Real mode: 0 console errors (verified by `realPage` fixture in startup tests)
- `./scripts/verify`: PASSED (exit 0) — 30 Anchor tests passing, lint, typecheck, build, visual tests all green

**Status**: Complete — all 15 checklist items done. Spec status updated to Done.

## Iteration 7 — 2026-02-19T12:08:45Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-007.log

## Gap Analysis — 2026-02-19T12:14:41Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

