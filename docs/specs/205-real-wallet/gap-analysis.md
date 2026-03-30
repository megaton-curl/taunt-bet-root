# Gap Analysis: 205 — Real Wallet Integration

- **Date**: 2026-02-19
- **Spec status**: Done
- **Previous analysis**: First run

## Implementation Inventory

### On-Chain Instructions

N/A — spec 205 is a frontend-only spec (wallet adapter integration). On-chain programs are covered by spec 001-coinflip.

### Game Engine Exports

N/A — no game engine changes required for this spec.

### Frontend Components

| Component | File | Line |
|-----------|------|------|
| WalletProvider (mode switch) | packages/wallet/src/WalletProvider.tsx | 42 |
| RealWalletProvider | packages/wallet/src/real/RealWalletProvider.tsx | 99 |
| WalletBridge (adapter→context mapping) | packages/wallet/src/real/RealWalletProvider.tsx | 27 |
| MockWalletProvider | packages/wallet/src/mock/MockWalletProvider.tsx | 31 |
| TestWalletProvider | packages/wallet/src/test/TestWalletProvider.tsx | 27 |
| WalletContext | packages/wallet/src/context.ts | 1 |
| WalletContextValue interface | packages/wallet/src/types.ts | 10 |
| useWallet hook | packages/wallet/src/useWallet.ts | 5 |
| useBalance hook | packages/wallet/src/useBalance.ts | 33 |
| hooks re-exports (useConnection) | packages/wallet/src/hooks.ts | 4 |
| ConnectionProvider wrapping | packages/wallet/src/WalletProvider.tsx | 53 |
| getRpcUrl helper | packages/wallet/src/WalletProvider.tsx | 17 |
| isMockMode helper | packages/wallet/src/WalletProvider.tsx | 29 |
| RPG wallet icon (App.tsx) | apps/platform/src/App.tsx | 413-422 |
| parseTransactionError | apps/platform/src/features/coinflip/context/CoinflipContext.tsx | 24 |
| CoinflipProvider (sendTransaction calls) | apps/platform/src/features/coinflip/context/CoinflipContext.tsx | 96 |
| buildCreateMatchTx | apps/platform/src/features/coinflip/utils/chain.ts | 222 |
| buildJoinMatchTx | apps/platform/src/features/coinflip/utils/chain.ts | 250 |
| buildCancelMatchTx | apps/platform/src/features/coinflip/utils/chain.ts | 280 |
| buildClaimPayoutTx | apps/platform/src/features/coinflip/utils/chain.ts | 303 |

### Tests

| Test | Type | File | Status |
|------|------|------|--------|
| TestWalletProvider auto-connects | vitest | packages/wallet/src/test/TestWalletProvider.test.tsx:27 | Pass |
| MockWalletProvider starts disconnected | vitest | packages/wallet/src/test/TestWalletProvider.test.tsx:53 | Pass |
| App loads disconnected (real mode) | playwright | apps/platform/e2e/real/startup.spec.ts:28 | Pass |
| Click wallet icon without crash (real mode) | playwright | apps/platform/e2e/real/startup.spec.ts:46 | Pass |
| Home wallet disconnected (visual) | playwright | apps/platform/e2e/visual/states.spec.ts:5 | Pass |
| Home wallet connected (visual) | playwright | apps/platform/e2e/visual/states.spec.ts:14 | Pass |
| Profile wallet connected (visual) | playwright | apps/platform/e2e/visual/states.spec.ts:50 | Pass |
| Coinflip wallet disconnected (visual) | playwright | apps/platform/e2e/visual/states.spec.ts:87 | Pass |
| Coinflip wallet connected (visual) | playwright | apps/platform/e2e/visual/states.spec.ts:97 | Pass |
| Route baselines (11 routes) | playwright | apps/platform/e2e/visual/routes.spec.ts:3-63 | Pass |

## Acceptance Criteria Audit

### FR-1: Real Wallet Connection

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1.1 | Player can connect Phantom, Solflare, or Backpack via the existing wallet UI | SATISFIED | RealWalletProvider.tsx:103-116 uses `UnifiedWalletProvider` with `wallets: []` (Wallet Standard auto-detection). WalletBridge.connect():32-40 opens modal via `setShowModal(true)`. Real-mode Playwright test confirms connect() callable without crash (startup.spec.ts:46). |
| 1.2 | Player can disconnect and reconnect without page reload | SATISFIED | WalletBridge.disconnect():42-44 calls `adapter.disconnect()`. WalletBridge.connect():32-40 reconnects via `adapter.connect()` or modal. SPA state managed by React context (no reload). autoConnect:true in config (RealWalletProvider.tsx:106). |
| 1.3 | Wallet connection state persists across page navigation (SPA) | SATISFIED | WalletProvider.tsx:42-54 wraps at root level in main.tsx:13-19 (above Router). React context survives SPA navigation. autoConnect:true (RealWalletProvider.tsx:106) restores wallet on remount. |
| 1.4 | useWallet() hook returns the same shape (connected, connecting, address, publicKey, connect, disconnect, sendTransaction, signMessage) | SATISFIED | types.ts:3-23 defines WalletContextValue with all listed fields. WalletBridge:67-88 maps adapter to this shape. useWallet.ts:5-11 returns from WalletContext. |
| 1.5 | No wallet-adapter UI chrome leaks into the medieval theme | SATISFIED | RealWalletProvider.tsx:114 sets `theme: "dark"`. Visual regression tests pass with zero diff (17 baselines — iteration 4 history). App.tsx:413-422 uses custom RPG wallet icon, not adapter default button. |

### FR-2: Real Balance Display

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 2.1 | Balance displayed matches the connected wallet's on-chain lamport balance | SATISFIED | useBalance.ts:64-67 calls `connection.getBalance(publicKey)` in real mode. App.tsx:419 displays `formatted` from useBalance(). |
| 2.2 | Balance updates after transactions (create match, join, claim, cancel) | SATISFIED | CoinflipContext.tsx:99 uses `useBalance()` to get `refreshBalance`. `sendAndConfirm` helper (CoinflipContext.tsx:122-135) calls `refreshBalance()` after every confirmed transaction. All four actions (create/join/cancel/claim) use `sendAndConfirm`. |
| 2.3 | Balance polls or subscribes at a reasonable interval (no stale values after 10s) | SATISFIED | useBalance.ts:31 sets DEFAULT_POLL_INTERVAL = 10_000 (10s). useBalance.ts:99-100 sets up setInterval(fetchBalance, pollInterval). |
| 2.4 | useBalance() hook returns the same shape (balance, formatted, formattedCompact, loading, error, refresh) | SATISFIED | useBalance.ts:7-24 defines BalanceResult with all listed fields plus `balanceLamports` and `lastUpdated` (superset). useBalance.ts:124-133 returns all fields. |

### FR-3: Real Transaction Signing

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 3.1 | Create match builds a transaction via chain.ts and sends it through wallet adapter's sendTransaction | SATISFIED | CoinflipContext.tsx:179-186 calls `buildCreateMatchTx(connection, publicKey, selectedTier, selectedSide)` then `await sendTransaction(transaction)`. chain.ts:222-248 builds the transaction. |
| 3.2 | Join match, cancel match, and claim payout work the same way | SATISFIED | CoinflipContext.tsx: joinMatch:223-229, cancelMatch:256-257, claimPayout:279-286 all follow the same pattern: build tx via chain.ts, send via `sendTransaction`. |
| 3.3 | Transaction confirmation is awaited before updating UI state | SATISFIED | CoinflipContext.tsx:122-135 `sendAndConfirm` helper fetches `getLatestBlockhash`, sends transaction, then `await connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, "confirmed")` before returning. All four actions (create/join/cancel/claim) use `sendAndConfirm`, ensuring on-chain confirmation before any UI state update or match fetch. |
| 3.4 | Wallet rejection (user clicks "Cancel" in Phantom) surfaces a user-friendly error | SATISFIED | CoinflipContext.tsx:33-35 catches "User rejected" / "Transaction cancelled" → "Transaction cancelled by user." All four actions catch errors via parseTransactionError (lines 197, 239, 261, 291). |
| 3.5 | RPC errors (insufficient balance, account not found) surface user-friendly messages | SATISFIED | CoinflipContext.tsx:38-40 catches insufficient lamports/funds/0x1. CoinflipContext.tsx:48-50 catches network errors (Failed to fetch, NetworkError, ECONNREFUSED). CoinflipContext.tsx:61 provides generic fallback. |

### FR-4: RPC Configuration

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 4.1 | RPC URL is read from VITE_RPC_URL environment variable | SATISFIED | WalletProvider.tsx:18-22 reads `import.meta.env?.VITE_RPC_URL`. |
| 4.2 | Defaults to devnet when no variable is set | SATISFIED | WalletProvider.tsx:15 `DEFAULT_RPC_URL = "https://api.devnet.solana.com"`. WalletProvider.tsx:22 `return envUrl \|\| DEFAULT_RPC_URL`. |
| 4.3 | Localhost (test-validator) works when VITE_RPC_URL=http://127.0.0.1:8899 | SATISFIED | WalletProvider.tsx:22 returns any non-empty envUrl. ConnectionProvider accepts any URL. No URL validation/restriction logic. |
| 4.4 | .env.example updated to use VITE_RPC_URL (fixing mismatch) | SATISFIED | .env.example:6 `VITE_RPC_URL=https://api.devnet.solana.com`. No `VITE_SOLANA_RPC_URL` present. Mismatch resolved. |

### FR-5: TestWalletProvider for CI

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 5.1 | TestWalletProvider accepts a Keypair and RPC URL | SATISFIED | TestWalletProvider.tsx:16-18 props: `keypair: Keypair`, `rpcUrl?: string` (defaults to localhost:8899). |
| 5.2 | It implements the same WalletContextValue interface as the real provider | SATISFIED | TestWalletProvider.tsx:92-113 provides WalletContextValue with connected, connecting, address, publicKey, connect, disconnect, sendTransaction, signMessage. |
| 5.3 | It can sign and send transactions to a local test-validator | SATISFIED | TestWalletProvider.tsx:56-70 uses `sendAndConfirmTransaction(connection, transaction, [keypair])`. Creates `Connection(rpcUrl, "confirmed")` on line 36-39. |
| 5.4 | MockWalletProvider is preserved for visual-only testing (no chain dependency) | SATISFIED | MockWalletProvider.tsx:31-186 fully preserved. Visual tests use mock mode (default VITE_MOCK_MODE unset = true). TestWalletProvider.test.tsx:53-68 verifies MockWalletProvider still works. |

### FR-6: Visual Preservation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 6.1 | Wallet icon in bottom-right corner remains identical | SATISFIED | App.tsx:413-422 unchanged RPG wallet icon (`rpg-wallet-icon` class). Visual regression baselines pass (iteration 4, 7 history). |
| 6.2 | Balance display format unchanged | SATISFIED | App.tsx:419 `$${formatted ?? "0"}` — same format. useBalance returns same shape (BalanceResult). |
| 6.3 | Connect/disconnect flow uses the same UI elements (no wallet-adapter default modal unless styled) | SATISFIED | App.tsx:415 `onClick={() => connected ? disconnect() : connect()}` — custom RPG icon triggers connect/disconnect. RealWalletProvider opens UnifiedWallet modal (styled, theme:dark) on first connect. |
| 6.4 | All non-wallet pages render identically before and after the swap | SATISFIED | 11 route visual baselines pass (routes.spec.ts). Iteration 4 history confirms 17/17 visual tests pass with zero diff. |
| 6.5 | Visual regression screenshots (spec 200) pass with zero diff on non-wallet elements | SATISFIED | Iteration 4 and 7 confirm `pnpm test:visual`: all baselines pass. stablePage fixture catches console errors (none found). |

## Gap Summary

No gaps remaining. All acceptance criteria are SATISFIED.

## Deferred Items

| Item | Deferred To | Target Spec | Target Status | Stale? |
|------|-------------|-------------|---------------|--------|
| Full coinflip lifecycle (create → join → resolve → claim) E2E test | 001-coinflip | 001-coinflip | Done | Requires investigation — 001-coinflip may not include full E2E wallet test |
| Privy/embedded wallets | V1.5 | N/A (DECISIONS.md) | Deferred | No — valid V1.5 deferral |

## Recommendations

1. ~~**Fix FR-3.3 (transaction confirmation)**~~: RESOLVED — `sendAndConfirm` helper in CoinflipContext.tsx:122-135 now uses `connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, "confirmed")` before any UI state update.

2. ~~**Fix FR-2.2 (balance refresh)**~~: RESOLVED — `sendAndConfirm` calls `refreshBalance()` (from `useBalance()`) after every confirmed transaction. Balance updates immediately after each action.

3. **Verify 001-coinflip deferral**: The full coinflip E2E lifecycle was deferred to 001-coinflip. Confirm that spec covers wallet integration testing with real transactions against a validator.
