# Implementation History — 100-close-call

Iteration log for the autonomous spec loop. Each entry records what was
attempted and whether it succeeded. The agent reads this file at the start
of every iteration to understand prior context.

---

## Iteration 1 — Verify pyth.rs parser compatibility

**Item**: [on-chain] Verify `pyth.rs` parser works with Pyth push oracle price accounts on devnet

**Result**: PASS — no changes needed.

**Findings**:
- `pyth.rs` Borsh deserialization matches real PriceUpdateV2 account layout (discriminator + write_authority + VerificationLevel enum + PriceFeedMessage + posted_slot)
- Devnet push oracle accounts use `Full` verification level (1-byte variant), matching the test mock's 133-byte buffer
- BTC/USD feed ID confirmed: `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
- **Devnet BTC/USD price account**: `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` (PDA from Pyth Push Oracle program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, shard 0)
- Account owner: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` (Pyth Solana Receiver)
- No mock format changes needed; `anchor build` + all 20 bankrun tests pass

## Iteration 1 — 2026-03-17T18:46:14Z — OK
- **Log**: iteration-001.log

## Iteration 2 — Anchor client + game-engine integration

**Item**: [engine] Copy closecall IDL/types into anchor-client, add barrel exports, add CLOSECALL_PROGRAM_ID

**Result**: PASS

**Changes**:
- Copied `solana/target/idl/closecall.json` → `packages/anchor-client/src/closecall.json`
- Copied `solana/target/types/closecall.ts` → `packages/anchor-client/src/closecall.ts`
- Updated `packages/anchor-client/src/index.ts`: added `ClosecallIDL` JSON import, `Closecall` type export, IDL re-export
- Created `packages/game-engine/src/closecall.ts`: `CLOSECALL_PROGRAM_ID` (from IDL address), `getCloseCallRoundPda()`, `getCloseCallConfigPda()`
- Updated `packages/game-engine/src/index.ts`: added closecall exports

**Notes**:
- Spec said `packages/config/` but that package only has build configs (tsconfig, eslint). Program IDs live in `packages/game-engine/src/` per existing coinflip/lordofrngs pattern. Followed actual codebase pattern.
- `pnpm lint` (18 packages): 0 errors, only pre-existing warnings
- `pnpm typecheck` (18 packages): 0 errors

## Iteration 2 — 2026-03-17T18:51:24Z — OK
- **Log**: iteration-002.log

## Iteration 3 — Backend account decoders

**Item**: [backend] Add `DecodedCloseCallRound` and `DecodedCloseCallConfig` interfaces + decoder functions

**Result**: PASS

**Changes**:
- `services/backend/src/worker/account-decoder.ts`:
  - Added `ClosecallIDL` import from `@rng-utopia/anchor-client`
  - Instantiated `closecallCoder` BorshAccountsCoder
  - Added `closeCallPhaseToNumber()` helper (Open=0, Settled=1, Refunded=2)
  - Added `outcomeToNumber()` helper (Pending=0, Green=1, Red=2, Refund=3)
  - Added `DecodedCloseCallRound` interface (16 fields: roundId, server, phase, greenEntries, redEntries, greenPool, redPool, openPrice, openPriceExpo, closePrice, createdAt, bettingEndsAt, resolveDeadline, outcome, totalFee, bump)
  - Added `DecodedCloseCallConfig` interface (7 fields: authority, treasury, pythFeedId, bettingWindowSecs, maxEntriesPerSide, paused, bump)
  - Added `decodeCloseCallRound()` and `decodeCloseCallConfig()` functions with bnToBigInt conversion and enum mapping
  - Added `closeCallRoundDiscriminatorFilter()` for getProgramAccounts filtering
  - Added `decodeBetEntries()` private helper for Vec<BetEntry> mapping

**Verification**: `pnpm lint` + `pnpm typecheck` on `@rng-utopia/backend` — both pass, 0 errors

## Iteration 3 — 2026-03-17T18:55:37Z — OK
- **Log**: iteration-003.log

## Iteration 4 — Close Call settlement transaction builders

**Item**: [backend] Add closecall settlement functions to `settle-tx.ts`

**Result**: PASS

**Changes**:
- `services/backend/src/tx-builder.ts`:
  - Added `ClosecallIDL` import from `@rng-utopia/anchor-client`
  - Added `CLOSECALL_PROGRAM_ID` export (derived from IDL address)
- `services/backend/src/worker/settle-tx.ts`:
  - Added `ClosecallIDL` import and `CLOSECALL_PROGRAM_ID` import
  - Added 3 closecall instruction discriminators (`create_round`, `settle_round`, `timeout_refund`)
  - Added `deriveCloseCallConfigPda()` and `deriveCloseCallRoundPda()` PDA helpers
  - Added `encodeCcRoundIdData()` for instruction data encoding (discriminator + round_id = 16 bytes)
  - Added `CloseCallTxDeps` interface (connection + serverKeypair)
  - Added `buildCloseCallCreateRoundTx()` — builds signed `create_round` tx (server pays rent, reads Pyth open price)
  - Added `buildCloseCallSettleRoundTx()` — builds signed `settle_round` tx with remaining accounts for winner payouts/refunds
  - Added `buildCloseCallTimeoutRefundTx()` — builds signed `timeout_refund` tx with remaining accounts for all player refunds

**Notes**:
- No commit-reveal (no secret/entropy) — oracle-resolved via Pyth price account
- Server is sole signer for all 3 instructions (no partial-sign pattern unlike coinflip/lord create)
- `rent_receiver` = `serverKeypair.publicKey` (server pays rent on create, gets it back on settle/timeout)
- `treasury` passed explicitly to settle builder (clock worker reads from config)
- `pnpm lint` (18 packages): 0 errors, 128 pre-existing warnings
- `pnpm typecheck` (18 packages): 0 errors

## Iteration 4 — 2026-03-17T19:01:35Z — OK
- **Log**: iteration-004.log

## Iteration 5 — CloseCallClockWorker

**Item**: [backend] Create `closecall-clock.ts` — minute-boundary clock worker

**Result**: PASS

**Changes**:
- `services/backend/src/worker/closecall-clock.ts`:
  - Factory function `createCloseCallClockWorker(deps)` → `CloseCallClockWorker` interface
  - Follows existing settlement worker pattern: setTimeout-based loop, start/stop/isRunning/tick
  - Tick aligns to minute boundaries + 2s offset (ensures candle has closed)
  - Each tick: (1) settle previous round if exists, (2) create new round with random 8-byte ID
  - Settlement logic: reads on-chain round + Pyth price to pre-determine outcome (Green/Red/Refund), passes correct remaining accounts to `buildCloseCallSettleRoundTx`
  - `sendAndConfirm()` helper with MAX_TX_RETRIES=3 and exponential delay (retry pattern)
  - `discoverActiveRound()` on start — scans for existing open rounds via `getProgramAccounts` (crash recovery)
  - Edge cases handled: no previous round, settlement failure (log + clear + continue), account already closed, non-Open phase

**Verification**: `pnpm lint` (0 errors, 128 pre-existing warnings) + `pnpm typecheck` (0 errors)

## Iteration 5 — 2026-03-17T19:07:15Z — OK
- **Log**: iteration-005.log

## Iteration 6 — Backend DB + API routes for Close Call

**Item**: [backend] Extend DB with closecall_rounds table, add API routes, extend rounds/by-id

**Result**: PASS

**Changes**:
- `services/backend/migrations/005_closecall_rounds.sql`: New table `closecall_rounds` (round_id, pda, server_key, phase, open_price, open_price_expo, close_price, outcome, green_pool, red_pool, total_fee, green_entries JSONB, red_entries JSONB, settle_tx, created_at, settled_at). Separate from commit-reveal `rounds` table because closecall has no secret/commitment, is pari-mutuel (multiple players), and stores oracle prices.
- `services/backend/src/db.ts`: Added `CloseCallRound`, `CloseCallPhase`, `CloseCallOutcome` types. Added `InsertCloseCallRoundParams` interface. Added 5 new DB methods: `insertCloseCallRound`, `getCloseCallRound`, `getCloseCallCurrentRound`, `getCloseCallHistory`, `settleCloseCallRound`. Added `normalizeCloseCallRound` helper for BIGINT→number conversion.
- `services/backend/src/routes/closecall.ts`: New route file with `GET /closecall/current-round` (returns active round + pool state) and `GET /closecall/history` (last N settled rounds, default 20, max 100).
- `services/backend/src/routes/rounds.ts`: Extended `GET /fairness/rounds/by-id/:matchId` to fall back to `closecall_rounds` table when not found in commit-reveal `rounds` table. Added `formatCloseCallResponse()` for unified response shape.
- `services/backend/src/index.ts`: Registered closecall routes at `/closecall` prefix. Imported `createCloseCallRoutes`.

**Design decisions**:
- Created separate `closecall_rounds` table rather than stretching the `rounds` table (which has NOT NULL on secret, commitment, side — fields that don't apply to oracle-resolved pari-mutuel games).
- Entries stored as JSONB arrays `[{player, amountLamports}]` — avoids join table complexity for max 64 entries.
- `/closecall` routes are NOT under `/fairness/` prefix (no JWT required for read-only pool state; the clock worker manages round lifecycle, not player-initiated create).

**Verification**: `pnpm lint` (0 errors, 128 pre-existing warnings) + `pnpm typecheck` (0 errors)

## Iteration 6 — 2026-03-17T19:20:00Z — OK
- **Log**: iteration-006.log

## Iteration 6 — 2026-03-17T19:13:19Z — OK
- **Log**: iteration-006.log

## Iteration 7 — Wire CloseCallClockWorker into backend boot

**Item**: [backend] Wire the CloseCallClockWorker into index.ts, add PYTH_BTC_USD_ACCOUNT env var

**Result**: PASS

**Changes**:
- `services/backend/src/config.ts`: Added `pythBtcUsdAccount` field to `Config` interface. Loaded from `PYTH_BTC_USD_ACCOUNT` env var with default `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` (devnet BTC/USD Pyth push oracle price account).
- `services/backend/src/index.ts`: Imported `createCloseCallClockWorker`. Instantiated with `{ connection, serverKeypair, pythPriceAccount }` deps. Called `closeCallClock.start()` after settlement worker, before routes.
- `services/backend/.env`: Added `PYTH_BTC_USD_ACCOUNT=4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo`.

**Verification**: `pnpm lint` (0 errors, 128 pre-existing warnings) + `pnpm typecheck` (0 errors)

## Iteration 7 — 2026-03-17T19:17:15Z — OK
- **Log**: iteration-007.log

## Iteration 8 — Deploy closecall program to devnet

**Item**: [deploy] Deploy closecall program to devnet, initialize config, verify all instructions

**Result**: PASS

**Changes**:
- Deployed closecall program to devnet: `8TXq2XyHsk5AAMkoyk5QtG25xyyY7rTMHXrJRHRwjUpA`
  - Deploy method: `solana program deploy --use-rpc` (TPU DNS fails in container; used RPC-only mode)
  - Deploy tx: `45Dk3MNWshs4ZNrtPcAB6Rq6wHwSGskq2h66vwXc4uDzwEstutiT6UGPPWtfhhRBgZEFTGXKc2NST8PWdh8AGeoR`
- Initialized CloseCallConfig PDA (`6HkFfk5jWP4Qa9DPVoxRNEnU64qu7QnGQCBfs2y6Yadk`):
  - Treasury: `AXjQcFUUs2rs6tWqN7ykNWtXesjaGCu3JoGvU2STNUP6` (deployer)
  - Pyth feed ID: `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` (BTC/USD)
  - Betting window: 30s, max entries per side: 32
  - Init tx: `21dASWJL96mMokF4B4ugpa2TguptDScnD4f49V1o2qFgPpuPq7jXasdShFir7uzkqnfGefVAaqmVoZaGuco1cyQ1`
- `.env.devnet`: Added `VITE_CLOSECALL_PROGRAM_ID=8TXq2XyHsk5AAMkoyk5QtG25xyyY7rTMHXrJRHRwjUpA`
- `solana/scripts/init-devnet-config.ts`: Added closecall IDL load + `initializeConfig` call (idempotent)
- `solana/scripts/deploy-devnet.sh`: Added closecall keypair print line

**Devnet verification** (all 3 instructions tested with real Pyth prices):
- `create_round`: tx `3JHRnj6fS3h1ZXS4gHCzcTm41EDiFMjkwbRqGn8WEKKr35P8NRQFqtMT115D1E4P5hXXyWXzTPDJchFaf5NKDzuM`
  - Captured open price: 7458452823070 × 10^-8 ($74,584.53 BTC/USD)
- `place_bet`: Included in same tx (GREEN side, 0.001 SOL)
- `settle_round`: tx `HKaBNbqUn4T6KsZEFgveQSm85aMVg51wFVW35E6dutU1DYGBYzasdjTuSGKvUsjrz4NXW7GzQPSNHvCs4NotiGY`
  - Single-sided pool → Refund outcome, round PDA closed, rent returned

**Notes**:
- Container DNS doesn't resolve for Node.js (only via HTTP proxy). Used `NODE_OPTIONS="--use-env-proxy"` for all TS scripts. Solana CLI uses curl which respects `https_proxy`.
- Devnet Pyth push oracle updates every ~5 minutes (not every second like mainnet). `MAX_OPEN_PRICE_AGE_SECS=60` means create_round often fails with PriceTooStale. The production clock worker will need Pyth Hermes to push fresh prices before creating rounds.
- dRPC was temporarily down during this iteration; used default `api.devnet.solana.com` instead.

**Verification**: `pnpm lint` (18 packages, 0 errors) + `pnpm typecheck` (18 packages, 0 errors)

## Iteration 8 — 2026-03-17T19:50:00Z — OK
- **Log**: iteration-008.log

## Iteration 8 — 2026-03-17T19:36:47Z — OK
- **Log**: iteration-008.log

## Iteration 9 — 2026-03-17T19:37:36Z — OK
- **Log**: iteration-009.log

## Iteration 10 — 2026-03-17T19:40:10Z — OK
- **Log**: iteration-010.log

## Iteration 11 — 2026-03-17T19:40:57Z — OK
- **Log**: iteration-011.log

## Iteration 12 — 2026-03-17T19:41:40Z — OK
- **Log**: iteration-012.log

## Iteration 13 — 2026-03-17T19:42:27Z — OK
- **Log**: iteration-013.log

## Iteration 14 — 2026-03-17T19:43:14Z — OK
- **Log**: iteration-014.log

## Iteration 15 — 2026-03-17T19:44:04Z — OK
- **Log**: iteration-015.log

## Iteration 16 — 2026-03-17T19:44:56Z — OK
- **Log**: iteration-016.log

## Iteration 17 — 2026-03-17T19:45:49Z — OK
- **Log**: iteration-017.log

## Iteration 18 — 2026-03-17T19:46:45Z — OK
- **Log**: iteration-018.log

## Iteration 19 — 2026-03-17T19:47:35Z — OK
- **Log**: iteration-019.log

## Iteration 20 — 2026-03-17T19:48:22Z — OK
- **Log**: iteration-020.log

## Iteration 21 — 2026-03-17T19:49:11Z — OK
- **Log**: iteration-021.log

## Iteration 22 — 2026-03-17T19:50:01Z — OK
- **Log**: iteration-022.log

## Iteration 23 — 2026-03-17T19:50:48Z — OK
- **Log**: iteration-023.log

## Iteration 24 — 2026-03-17T19:51:34Z — OK
- **Log**: iteration-024.log

## Iteration 25 — 2026-03-17T19:52:22Z — OK
- **Log**: iteration-025.log

## Iteration 26 — 2026-03-17T19:53:29Z — OK
- **Log**: iteration-026.log

## Iteration 27 — 2026-03-17T19:54:16Z — OK
- **Log**: iteration-027.log

## Iteration 28 — 2026-03-17T19:55:09Z — OK
- **Log**: iteration-028.log

## Iteration 29 — 2026-03-17T19:58:37Z — OK
- **Log**: iteration-029.log

## Iteration 30 — Frontend types alignment with on-chain

**Item**: [frontend] Update `features/close-call/types.ts` — remove DOJI/carryover/commit-reveal, align with on-chain types

**Result**: PASS

**Changes**:
- `types.ts`: `RoundPhase` → `"open" | "settled" | "refunded"` (was betting/locked/resolving/complete). `CandleOutcome` → `"green" | "red" | "refund"` (removed doji). Removed `carryoverAmount`, `seedHash`, `serverSeed`, `blockHash` from Round. Added `openPrice`, `openPriceExpo`, `closePrice`, `settleTx`. Removed `claimPayout`, `claiming`, `carryoverJackpot` from context. Fixed constants: `MIN_BET_AMOUNT=0.001`, `MAX_BET_AMOUNT=100`, `BETTING_WINDOW_MS=30000`. Removed `DOJI_THRESHOLD_BPS`. `SIDE_COLORS.doji` → `.refund`.
- `payout-calculator.ts`: Removed DOJI threshold logic (strict equality → refund). Removed carryover params from all functions. Refund/one-sided pools → no fee (aligned with on-chain).
- `mock-simulation.ts`: Removed carryover store, server seeds, fairness data generation. Phases: `"open"` → `"settled"/"refunded"`. Betting window enforced by time check.
- `CloseCallContext.tsx`: Removed `claimPayout`, `claiming`, `carryoverJackpot` state. Removed `getCarryoverAmount` import. Updated `calculatePotentialPayout` calls (no carryover param).
- `ActiveBetView.tsx`: Phase display uses time-based betting/locked detection within `"open"` phase. Removed carryover from pool calc. SOL amounts.
- `RoundResultOverlay.tsx`: Doji → refund. Removed serverSeed display, replaced with settleTx.
- `PoolDistribution.tsx`: Removed `carryoverAmount` prop. Doji → refund. SOL amounts.
- `CloseCallPage.tsx`: Removed carryover jackpot banner, seedHash display. Updated phase checks. Doji → refund. SOL amounts. Oracle info replaces commit-reveal fairness section.

**Verification**: `pnpm lint` (0 errors, 128 pre-existing warnings) + `pnpm typecheck` (0 errors)

## Iteration 30 — 2026-03-17T20:08:18Z — OK
- **Log**: iteration-030.log

## Iteration 31 — 2026-03-17T20:09:20Z — OK
- **Log**: iteration-031.log

## Iteration 32 — 2026-03-17T20:10:07Z — OK
- **Log**: iteration-032.log

## Iteration 33 — 2026-03-17T20:10:54Z — OK
- **Log**: iteration-033.log

## Iteration 34 — 2026-03-17T20:11:44Z — OK
- **Log**: iteration-034.log

## Iteration 35 — 2026-03-17T20:12:50Z — OK
- **Log**: iteration-035.log

## Iteration 36 — 2026-03-17T20:13:55Z — OK
- **Log**: iteration-036.log

## Iteration 37 — 2026-03-17T20:17:49Z — OK
- **Log**: iteration-037.log

## Iteration 39 — Rewrite CloseCallContext with real backend + Pyth price

**Item**: [frontend] Rewrite CloseCallContext.tsx — replace mock-simulation with backend API + price-feeds

**Result**: PASS

**Changes**:
- `apps/platform/package.json`: Added `@rng-utopia/price-feeds` workspace dependency
- `apps/platform/src/App.tsx`: Added `PriceFeedProvider` wrapper from `@rng-utopia/price-feeds` at app root level (enables `usePriceSubscription` for all features)
- `apps/platform/src/features/close-call/context/CloseCallContext.tsx`: Full rewrite:
  - Removed all `mock-simulation.ts` imports (initializeGame, subscribeToRound, subscribeToCompletedRound, getCurrentRound, getUserHistory, getRecentCandles, getCurrentCandle, getCandleProgress, isGameInitialized, clearCompletedRound)
  - Added `usePriceSubscription("BTC")` from `@rng-utopia/price-feeds` for live BTC/USD price
  - Added backend API integration: `fetchCurrentRound()` (GET /closecall/current-round), `fetchRoundHistory()` (GET /closecall/history)
  - Backend URL follows coinflip/lord pattern: `VITE_FAIRNESS_BACKEND_URL` env var
  - `backendToRound()` converter: maps backend JSON → frontend `Round` type (lamports→SOL conversion, entry arrays→PlayerBet arrays)
  - 2-second polling interval for current round data
  - Round transition detection via `prevRoundIdRef` — auto-fetches completed round for result overlay
  - Local candle builder from Pyth price ticks (accumulates 1-min OHLC, keeps 15 completed + current forming candle)
  - `candleProgress` computed from real clock time (ms into current minute / 60000)
  - User history loaded from backend settled rounds, filtered by wallet address
  - `placeBet()` kept as validation-only stub with TODO for next iteration (wallet tx)

**Notes**:
- `mock-simulation.ts` and `candle-replay.ts` are no longer imported by the context but NOT deleted yet (spec says "Remove mock-simulation.ts if fully replaced" is deferred to the place_bet wiring iteration)
- `payout-calculator.ts` still used for `calculatePotentialPayout` and user history payout estimation
- PriceFeedProvider placed at app root (not inside CloseCallProvider) to avoid WebSocket reconnection on navigation and to support future features needing Pyth data

**Verification**: `pnpm lint` (0 errors, 128 pre-existing warnings) + `pnpm typecheck` (0 errors) + `pnpm build` (success)

## Iteration 39 — 2026-03-18T04:53:15Z — OK
- **Log**: iteration-039.log

## Iteration 40 — Wire wallet integration for place_bet

**Item**: [frontend] Wire wallet integration for `place_bet` in CloseCallContext.tsx

**Result**: PASS

**Changes**:
- `apps/platform/src/features/close-call/context/CloseCallContext.tsx`:
  - Added imports: `useConnection`, `useBalance` from wallet hooks; `Program`, `AnchorProvider`, `BN` from `@coral-xyz/anchor`; `PublicKey`, `SystemProgram`, `Transaction` from `@solana/web3.js`; `ClosecallIDL` + `Closecall` type from anchor-client
  - Added local PDA helpers: `getCloseCallConfigPda()`, `getCloseCallRoundPda()` (defined locally to avoid Buffer polyfill issues from game-engine import in browser build)
  - Added `getClosecallProgram(connection)` — read-only Anchor program instance
  - Added `buildPlaceBetTx(connection, player, roundId, side, amountSol)` — builds `place_bet` instruction via Anchor, sets feePayer + blockhash
  - Added `parseTransactionError(err)` — maps Solana/Anchor errors to user-friendly messages (insufficient balance, betting closed, already bet, max entries, paused, user rejected, network error, simulation failure, blockhash expiry)
  - Added `sendAndConfirm(transaction)` in provider — pre-flight simulation, 3 retry attempts on blockhash expiry, fallback signature status check, balance refresh on success (exact coinflip pattern)
  - Replaced `placeBet()` stub with real implementation: validates wallet connection, bet side, amount, balance, round phase, betting window; builds + sends on-chain tx; clears pending side on success; refreshes round on betting-closed race condition
  - Moved `refreshRound` and `clearCompletedRound` before `sendAndConfirm`/`placeBet` to avoid temporal dead zone
  - Destructured `publicKey`, `sendTransaction` from `useWallet()`; `connection` from `useConnection()`; `refreshBalance` from `useBalance()`
- Deleted `utils/mock-simulation.ts` — no longer imported by anything (context uses real backend API)
- Deleted `utils/candle-replay.ts` — only imported by mock-simulation.ts
- Kept `utils/payout-calculator.ts` — still used by context for `calculatePotentialPayout`

**Notes**:
- Could not import PDA helpers from `@rng-utopia/game-engine` because that module uses `Buffer.from()` which triggers a missing polyfill error in Vite's browser build (`Rollup failed to resolve import "vite-plugin-node-polyfills/shims/buffer"`). Defined helpers locally, matching the coinflip pattern in `chain.ts`.
- `payout-calculator.ts` NOT deleted (still used for potential payout display). Spec says "Remove if fully replaced" — it's not fully replaced.

**Verification**: `pnpm lint` (0 errors, 130 pre-existing warnings) + `pnpm typecheck` (0 errors) + `pnpm build` (success)

## Iteration 40 — 2026-03-18T05:03:28Z — OK
- **Log**: iteration-040.log

## Iteration 41 — Close Call deep-link round page

**Item**: [frontend] Add `/close-call/:roundId` deep-link page

**Result**: PASS

**Changes**:
- `apps/platform/src/pages/CloseCallRoundPage.tsx`: New page component fetching from `GET /fairness/rounds/by-id/:roundId`. Displays: oracle prices (open/close from Pyth BTC/USD), outcome (Green/Red/Refund with color), pool breakdown (green/red pool amounts + entry counts), total pool, fee collected, entries list (player addresses + amounts per side), settlement tx (links to Solana Explorer), settled timestamp, verification info (price source + resolution logic). Loading/error states with back-link to `/close-call`. Row component supports ReactNode labels, copy-to-clipboard with optional copyValue override.
- `apps/platform/src/App.tsx`: Added import for `CloseCallRoundPage`, added route `<Route path="/close-call/:roundId" element={<CloseCallRoundPage />} />`.
- `apps/platform/src/pages/CloseCallPage.tsx`: Added `Link` import from react-router-dom. Changed history modal "Verify on Fairness Page" link to `Link` pointing to `/close-call/${round.id}` ("View Round Details").

**Notes**:
- Follows LordRoundPage pattern but adapted for oracle-based (no commit-reveal) data
- Route is `/close-call/:roundId` (not `/proof` suffix) since oracle rounds don't have commit-reveal proof — it's a round details page
- Entries displayed with side color labels (GREEN/RED), truncated addresses, and SOL amounts
- Price formatting uses `openPriceExpo` for both open and close prices

**Verification**: `pnpm lint` (0 errors, 130 pre-existing warnings) + `pnpm typecheck` (0 errors)

## Iteration 41 — 2026-03-18T05:08:08Z — OK
- **Log**: iteration-041.log

## Iteration 42 — Update visual baselines for close-call pages

**Item**: [test] Update visual baselines for close-call pages

**Result**: PASS

**Changes**:
- `apps/platform/e2e/__snapshots__/visual/routes.spec.ts/close-call.png`: Regenerated baseline. Old baseline showed mock-era UI (TradingView chart with mock candles, "Round Fairness" section with "Seed Hash", "PRIZE POOL $0.13", "BETTING OPEN • 10s to bet", Min 0.1). New baseline shows real backend-integrated UI in mock mode (no backend = loading state): "Loading chart...", "Min: 0.001", no Round Fairness/Seed Hash sections, no Prize Pool, no timer. Changes are intentional and match spec (oracle-based, no commit-reveal, mock-simulation deleted).

**Notes**:
- Had to delete old baseline and regenerate fresh — Playwright `--update-snapshots` was not overwriting the file when it already existed (binary comparison showed the old file had timestamp 2026-03-10, unchanged by `--update-snapshots` runs)
- All 22 visual tests (12 routes + 10 states) pass with updated baseline
- No other baselines affected by close-call changes
- The close-call page in visual test mode (VITE_MOCK_MODE=true, no backend) shows a loading/empty state since mock-simulation.ts was deleted in iteration 40. This is expected — the visual test captures the real behavior when no backend is available.

**Evaluation**: PASS — changes clearly match spec intent (removed commit-reveal mock data, page shows loading state without backend)

**Verification**: `pnpm test:visual` — 22/22 tests pass

## Iteration 42 — 2026-03-18T05:26:37Z — OK
- **Log**: iteration-042.log

## Iteration 43 — Local E2E coverage: N/A

**Item**: [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**`

**Result**: N/A — marked with justification

**Reason**: Close Call cannot run local E2E tests because:
1. **Pyth oracle dependency**: The `create_round` instruction requires valid `PriceUpdateV2` accounts owned by the Pyth Solana Receiver program. No Pyth program stack is deployed on localnet.
2. **Backend clock worker dependency**: Rounds are created by the backend clock worker (not player-initiated like coinflip/lord). The clock worker reads Pyth prices to store `open_price` in round PDAs.
3. **No frontend mock mode**: `CloseCallContext.tsx` always fetches from real backend API (`GET /closecall/current-round`). Without a running backend + Pyth data, the page shows only "Loading chart..." with no testable interactions.

Coinflip and Lord work on localnet because their flows are player-initiated (create match/round on-chain), and the backend only handles settlement. Close Call's round lifecycle is entirely backend-managed with oracle data.

**Coverage gap filled by**: Devnet E2E tests (next checklist item) which run against real Pyth oracle data and a real backend.

## Iteration 43 — 2026-03-18T06:00:00Z — OK
- **Log**: iteration-043.log

## Iteration 43 — 2026-03-18T05:30:08Z — OK
- **Log**: iteration-043.log

## Iteration 44 — Add visual route/state coverage for Close Call

**Item**: [test] Add visual route/state coverage in `e2e/visual/**`

**Result**: PASS

**Changes**:
- `apps/platform/e2e/visual/routes.spec.ts`: Added `/close-call/:roundId` route test (captures error/loading state when no backend available — shows "Error 400" + "Back to Close Call" link)
- `apps/platform/e2e/visual/states.spec.ts`: Added "Close Call page" describe block with 2 state variants:
  - **wallet disconnected**: Shows "CONNECT WALLET" button in sidebar, bet amount input, "Loading chart...", "No rounds yet"
  - **wallet connected**: Shows connected wallet address, GREEN/RED bet buttons enabled, bet amount input ready
- `apps/platform/e2e/__snapshots__/visual/routes.spec.ts/close-call-round.png`: New baseline (89KB)
- `apps/platform/e2e/__snapshots__/visual/states.spec.ts/closecall-disconnected.png`: New baseline (109KB)
- `apps/platform/e2e/__snapshots__/visual/states.spec.ts/closecall-connected.png`: New baseline (112KB)

**Coverage summary** (Close Call now matches Coinflip/Lord pattern):
| Game | routes.spec.ts | states.spec.ts | Total Snapshots |
|------|---|---|---|
| Coinflip | 1 | 3 | 4 |
| Lord of RNGs | 1 | 4 | 5 |
| Close Call | 2 (main + round page) | 2 (disconnected + connected) | 4 |

**Verification**: `pnpm test:visual` — 25/25 tests pass (was 22, now 25 with 3 new close-call tests)

## Iteration 44 — 2026-03-18T05:43:58Z — OK
- **Log**: iteration-044.log

## Iteration 45 — Devnet E2E coverage for Pyth oracle integration

**Item**: [test] Add devnet real-provider E2E coverage for Close Call oracle integration

**Result**: PASS

**Changes**:
- `apps/platform/e2e/devnet/helpers/env.ts`:
  - Added `closecallProgramId: PublicKey | null` to `DevnetConfig` interface
  - Added `VITE_CLOSECALL_PROGRAM_ID` optional env var parsing (same pattern as lordofrngs)
  - Added closecall program deployment verification in `verifyDevnetDeployments()`
- `apps/platform/e2e/devnet/closecall-lifecycle.spec.ts`: New test file with two tiers:
  - **Infra test** (always runs): Validates closecall program deployed + executable, Pyth BTC/USD price account readable on devnet (4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo), backend closecall API endpoints respond (GET /closecall/current-round, GET /closecall/history), settled round data has real oracle prices
  - **Lifecycle test** (conditional): Waits for clock worker to create a bettable round (≥12s betting window remaining), Player A bets GREEN via UI, Player B bets RED via UI, waits for oracle settlement, verifies outcome/fee/close price/settle tx, checks round details page. Skips gracefully if no round available (Pyth devnet prices update ~every 5 min and may be stale)
  - Includes: env validation, retry/backoff via `withRetry()`, console error tracking + noise filtering, wallet funding checks

**Notes**:
- Pyth devnet push oracle updates every ~5 minutes (vs real-time on mainnet). The clock worker's `MAX_OPEN_PRICE_AGE_SECS=60` means `create_round` often fails with PriceTooStale. The lifecycle test handles this by skipping with a clear message when no round is available within 90s.
- Infra test is the reliable oracle integration validation (program, Pyth account, API, settled round shape). Lifecycle test is best-effort when devnet conditions permit.
- Pre-existing backend test failure: `integration.test.ts` `connection.getBlockTime is not a function` (mock missing method) — confirmed pre-existing on clean commit, unrelated to closecall changes.

**Verification**: `pnpm lint` (0 errors, 156 pre-existing warnings) + `pnpm typecheck` (0 errors) + `./scripts/verify` lint/typecheck/build all pass. Test step has pre-existing backend mock failure (not caused by this change).

## Iteration 45 — ALL CHECKLIST ITEMS COMPLETE

All 18 Implementation Checklist items are checked. Spec status updated to Done.

## Iteration 45 — 2026-03-18T08:21:07Z — COMPLETE
- **Result**: All checklist items done, verification passed
- **Log**: iteration-045.log

## Devnet E2E — 2026-03-18T08:21:07Z
- **Result**: PASS

## Gap Analysis — 2026-03-18T08:30:24Z
- **Result**: Gap analysis report generated
- **Report**: gap-analysis.md
- **Log**: gap-analysis.log

