# Close Call Audit Findings — Claude Pass

> Internal audit pass over Close Call per `docs/audits/solana-games-audit-prep/closecall.md`.
> Format and status buckets follow `findings.md`. Every finding maps to a row in
> [Threat Model](README.md#threat-model). Severity uses **HIGH / MEDIUM / LOW / INFO**;
> Must Fix entries are sized against funds risk or audit-shippability.
>
> **Run context.** Code reviewed at workspace HEAD on `dev`. Bankrun test suite
> `tests/closecall.ts` was executed: **23 passing / 0 failing**. Closecall has the
> richest invariant surface of the three shipped games — minute alignment, oracle
> boundary, pari-mutuel math, two-sided remaining-accounts, and a settlement
> authority question that the auditor packet README explicitly defers to the
> external auditor.
>
> **Headline.** This pass found one HIGH funds-loss issue
> (CC-1, permissionless `settle_round` with attacker-supplied close price), one
> HIGH UX/fairness issue (CC-2, settlement uses a fresh-fetched Hermes price
> instead of the captured minute-boundary price), one MEDIUM admin footgun
> (CC-3, `max_entries_per_side` can exceed the on-chain account capacity), plus
> nine smaller findings clustered around test coverage, init-config drift,
> and the still-pending on-chain Pyth validation.

## Pass Summary

| Category | Count |
|----------|-------|
| Must Fix Before External Audit | 2 |
| Needs Test Proof | 4 |
| To Do Soon | 2 |
| Document As Trust Assumption | 1 |
| Open Investigation | 1 |
| Ask External Auditor | 2 |

The Must-Fix entries are CC-1 (settle authority + price) and CC-2 (close-price
sourcing). Both are independent of the still-pending on-chain Pyth validation
work — they are not subsumed by it.

---

## Active Findings

### [HIGH] CC-1 — `settle_round` is permissionless and accepts any close_price; an attacker can force the outcome and drain the losing pool

- **Category:** Must Fix Before External Audit
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs:13–47`
  (account struct: `caller: Signer<'info>` with no `==` constraint to
  `round.server`); handler at `:49–105` (no Pyth validation); README §"Threat
  Model" implicitly assumes server-only settlement
- **Game:** Close Call
- **Threat actor:** Any participant in a round (or any motivated stranger
  willing to pay tx gas) — the on-chain code does not require backend
  custody of the settle path
- **Invariant:** Threat-model row "Backend operator (compromised key)" lists
  *"supply arbitrary Close Call prices until on-chain Pyth validation lands"*
  as the price-trust assumption. That assumption is **scoped to the backend
  signer**. The implicit complementary invariant — that the *backend signer
  is the only signer that can call settle* — is not enforced by the program.
- **Issue:** `settle_round` has the account struct
  ```rust
  pub struct SettleRound<'info> {
      #[account(mut)] pub caller: Signer<'info>,
      #[account(mut, close = rent_receiver, …)] pub round: Account<'info, CloseCallRound>,
      pub platform_config: AccountInfo<'info>,
      #[account(mut)] pub treasury: AccountInfo<'info>,
      #[account(mut)] pub rent_receiver: AccountInfo<'info>,
  }
  ```
  with **no `caller == round.server`, no `caller == config.authority`, and no
  Pyth price-update account** anywhere. The handler then computes the outcome
  by literal comparison of the instruction-arg `close_price` to the stored
  `round.open_price`:
  ```rust
  let outcome = if total_count == 0
      || !has_both_sides
      || total_count == 1
      || close_price == open_price { Outcome::Refund }
      else if close_price > open_price { Outcome::Green }
      else { Outcome::Red };
  ```
  Since `close_price` is a free instruction argument, **any signer who is past
  the candle-close timestamp and has the round in `Open` phase can pick the
  outcome**, then submit the matching `remaining_accounts` (winning entries
  are public on-chain, so any caller can enumerate them). The
  `require_keys_eq!(treasury, treasury_key)` and `require_keys_eq!(rent_receiver,
  round.server)` checks pin the fee and rent recipients but do not pin the
  outcome.
- **Exploit Path:** A profit-extracting playthrough:
  1. Adversary wallet `A` places a bet on, say, **Red** during the betting
     window of round `M`.
  2. After `M + 60s` (`candle_close_time`), `A` constructs a `settle_round`
     tx with `caller = A`, `close_price = round.open_price - 1`,
     `close_price_expo = round.open_price_expo`, the validated `treasury` /
     `rent_receiver`, and `remaining_accounts` set to all stored Red entries
     (which are public on-chain).
  3. `A`'s tx lands. The on-chain handler validates phase, `caller` is a
     signer, treasury/rent_receiver match, exponents match, and
     `close_price < open_price` → outcome `Red`.
  4. The Red-side wins **regardless of the actual BTC market**. `A` and any
     other Red bettors split the *total* pool minus 5% fee. The Green side
     loses 100% of their bets. The backend's clock-worker settle never
     lands because the account has been closed.
  In dollar terms at typical pool sizes (one or two participants per side,
  0.005 SOL bets), the per-round payoff is small. As pools grow with
  popularity, so does the per-round payoff. The attacker can run this on
  **every round they bet on** — there is no rate limit, no whitelist, no
  cool-down.

  Key time race: `candle_close_time = round.created_at_minute + 60s`. Backend
  clock fires at minute `M+1 + 1s`, so the attacker has from `M+1 + 0s` to
  `M+1 + ~1s` to land their tx before the backend. Empirically that is
  plenty of headroom on devnet/mainnet via priority fees.
- **Impact:** **Funds loss for the losing side, every round.** The on-chain
  payout math is itself correct for the chosen outcome, so the losing side
  receives 0; the loss is the price-source manipulation, not a math bug.
  Until this is fixed, Close Call cannot operate against real funds without
  a trivially-exploitable rug.
- **Proof:** Code reading: `settle_round.rs:14–17` is the account; `:49–53`
  is the signature; nothing in the handler checks caller identity or price
  source. Bankrun test `tests/closecall.ts:706, :738, :775` uses arbitrary
  `closePrice` instruction args and the program accepts them. The auditor
  packet README's "Auditor Questions" already lists *"Should settlement
  authority be permissionless, server-only, or current backend-triggered
  with on-chain validation?"* — that question is open in the spec but not
  in the code: the code is permissionless **without** validation, which is
  the worst of the three options.
- **Discovered via:** Manual review of `settle_round.rs` against
  `tests/closecall.ts` and the threat-model row for "Backend operator
  (compromised key)".
- **Confidence:** High. The exploit requires only a participant wallet, the
  ability to read on-chain state (anyone), and a single tx fee. No backend
  compromise required.
- **Fix Direction:** Pick one of the three options the team has already
  named:
  - Option A (smallest, ships now): require `caller == round.server`. Add
    a constraint `#[account(mut, address = round.server)]` or a
    `require_keys_eq!(ctx.accounts.caller.key(), round.server, AccountMismatch)`
    at the top of the handler. Permissionless retry is given up; that role
    is already covered by `timeout_refund` (which has its own deadline gate).
  - Option B (correct end-state): on-chain Pyth validation. The settle
    instruction takes a Pyth `PriceUpdateV2` account; the handler verifies
    the feed ID against `CloseCallConfig.pyth_feed_id`, the publish time
    against the candle close window, and reads `close_price` from the
    account, ignoring any instruction-arg price. With this in place,
    permissionless settle becomes safe.
  - Option C: both. Server-only as the immediate gate, on-chain Pyth as the
    durable solution.
  Add a bankrun test where a non-server signer attempts settle — the test
  should fail with `AccountMismatch` (or the equivalent error code) under
  Option A, and with the Pyth feed/freshness error under Option B.
- **Status:** Open

### [HIGH] CC-2 — Backend settles with a fresh-fetched Hermes price, not the captured minute-boundary price

- **Category:** Must Fix Before External Audit
- **Surface:** `backend/src/worker/closecall-clock.ts:355–358` (separate
  `hermes.fetchLatestBtcPrice()` inside `settleRound` — bypasses
  `cachedBoundaryPrice`); contrast with `:220–253` where the boundary price
  is correctly captured and saved to DB
- **Game:** Close Call
- **Threat actor:** Any market-savvy operator (or a future buggy retry
  schedule); also any user who reads the chart and expects the round to
  resolve at the published candle-close
- **Invariant:** A Close Call round's "candle" runs from minute `M`
  boundary to minute `M+1` boundary. The settlement's `close_price` must be
  the published Pyth price at minute `M+1` boundary (i.e. a price update
  whose `publishTime >= M+1`). The audit packet plan (`closecall.md` Task
  6) calls this out: *"Confirm price cache/fetch logic cannot reuse stale
  open or close prices silently."* The dual concern — fetching a price that
  is **fresher than the boundary** but still wrong because it reflects
  post-candle market action — is the same shape and equally violates the
  invariant.
- **Issue:** The clock-worker's `tick()` correctly calls
  `captureBoundaryPrice(boundaryTs)` to obtain a Pyth price with
  `publishTime >= boundaryTs`, caches it (`cachedBoundaryPrice`), and saves
  the VAA to `closecall_candles` for the chart. **`settleRound` then
  ignores that cached value** and instead does a *separate*
  `hermes.fetchLatestBtcPrice()` (line 357), and uses **whatever Hermes
  returns at that moment** as the on-chain `close_price`. Empirically, that
  price is published 1–10 s after the boundary (Hermes polls + tick offset
  + network latency), so the candle effectively runs from `M` to
  `M+1+delta` rather than `M` to `M+1`.
  This is also reflected in the DB: `db.settleCloseCallRound(...,
  closePrice: Number(hermesPrice.price), ...)` (line 461) records the
  on-chain value, not the boundary value, so the chart on
  `/closecall/candles` (which uses `closeCallCandles` boundary-price rows)
  and the round detail at `/closecall/by-id/:roundId` show **two
  different close prices for the same minute**.
- **Exploit Path:** No external attacker required. The default behavior
  diverges from the spec the user is looking at. Edge cases that materialize
  in production:
  1. BTC moves >1 tick between `M+1 + 0s` and `M+1 + 8s`. The candle on the
     chart says Green won (close > open at boundary), but settlement says
     Red won (price ticked back below open during the Hermes-poll +
     settle-build window). Players whose visible chart says they won lose
     funds.
  2. Settlement tx confirmation fails on attempt 1, retried at
     `M+1 + 4s`, succeeds at `M+1 + 6s`. Each attempt re-fetches Hermes,
     so the close_price drifts further from the boundary on every retry.
  3. Coordinated abuse via tx-priority manipulation — even outside CC-1, a
     compromised backend signer or any operator with knowledge of upcoming
     market moves could *delay* settle to favor a particular outcome.
- **Impact:** Player-visible fairness violation. The chart and the
  settlement disagree about the candle. The DB and on-chain state disagree
  about `close_price`. This is the kind of finding an external auditor
  fixates on because it represents a "spec says X, code does Y" gap that
  is independent of the broader on-chain Pyth migration.
- **Proof:** `closecall-clock.ts:355–358`:
  ```ts
  const [platformConfig, hermesPrice] = await Promise.all([
    readPlatformConfig(),
    hermes.fetchLatestBtcPrice(),  // <-- separate fetch, not cachedBoundaryPrice
  ]);
  ```
  And later, `closePrice: Number(hermesPrice.price)` (line 461) is what the
  DB records. The candle endpoint at `routes/closecall.ts:447–504` builds
  candles from `closeCallCandles` boundary rows — different source.
- **Discovered via:** Manual review of `closecall-clock.ts` against the
  audit plan's "stale price" invariant.
- **Confidence:** High. The two reads are visibly independent in code; the
  divergence is structural, not a bug in one path that "usually" matches.
- **Fix Direction:** Use the captured boundary price for the just-closing
  round, not a fresh fetch. The cleanest shape:
  1. In `tick()`, after `captureBoundaryPrice(boundaryTs)`, the cached
     value's `minuteTs == boundaryTs` is the **close** of round
     `boundaryTs - 60` and the **open** of round `boundaryTs`.
  2. When iterating `discoverOpenRounds()` and `settleRound`-ing the round
     whose `minuteTs == boundaryTs - 60`, pass `cachedBoundaryPrice` (not
     a fresh fetch) as the close price.
  3. Reject settlement if the cached boundary's `minuteTs` does not equal
     the round's expected close minute (`round.minuteTs + 60`); do not
     fall back to a fresh fetch.
  4. Mirror the value into the DB so chart and verify endpoint stay in
     sync. The on-chain `close_price` arg now exactly equals the public
     candle on the chart.
  Add a backend unit/integration test that mocks `hermes.fetchLatestBtcPrice`
  to return a moving price and asserts the settled `close_price` matches
  the **boundary** price, not the latest. (This is the "automated, not
  code-review" assertion the audit packet keeps asking for.)
- **Status:** Open

### [MEDIUM] CC-3 — `max_entries_per_side` config field can exceed the on-chain `#[max_len(32)]` account capacity

- **Category:** To Do Soon (admin-footgun + auditor question)
- **Surface:** `solana/programs/closecall/src/state.rs:71–74`
  (`#[max_len(32)] pub green_entries: Vec<BetEntry>`,
  `#[max_len(32)] pub red_entries: Vec<BetEntry>`); state.rs:51
  (`max_entries_per_side: u8` — capacity 0..=255);
  `instructions/initialize_config.rs:23–43` (writes `max_entries_per_side`
  with no upper-bound check); `instructions/bet.rs:130–144` (reads the
  config value as the limit)
- **Game:** Close Call
- **Threat actor:** Platform admin (well-meaning, mis-configured) — also
  any reader of the audit packet who tries to map "what does this knob
  actually do?" to behavior
- **Invariant:** Config writes that affect round capacity must not be able
  to outpace the on-chain account allocation. If the soft cap exceeds the
  hard cap, behavior at the boundary becomes opaque (serialization error
  vs the documented `MaxEntriesReached` error).
- **Issue:** `CloseCallRound::INIT_SPACE` is computed at compile time from
  `#[max_len(32)]` on each side's vec. The account is allocated once via
  `init_if_needed` at `8 + INIT_SPACE` bytes, so the on-chain hard limit
  is exactly 32 entries per side regardless of config. But `bet.rs:130`
  reads `config.max_entries_per_side as usize` and uses it as the
  rejection threshold. If admin re-runs `initialize_config` with
  `max_entries_per_side = 50`, the require! at `bet.rs:133` allows the
  33rd entry; the `Vec::push` at `bet.rs:166` succeeds in memory; then
  Anchor's `try_serialize_into_slice` at the end of the instruction fails
  with a confusing serialization error (account data too small),
  **not** the documented `MaxEntriesReached`.
- **Exploit Path:** Admin sets `max_entries_per_side = 64` thinking it's
  "double the cap." Rounds work normally up to entry 32, then rounds at
  exactly entry 33 start failing with `AccountSerializationError` instead
  of `MaxEntriesReached`. The **bet itself is rejected** so no
  funds-loss — but operationally this looks like "Close Call broke."
  Worse, players see a generic Anchor error instead of an honest
  full-pool message; UX team will spend hours debugging.
  Inversely: admin sets `max_entries_per_side = 16` to throttle.
  Behavior is fine; require! fires earlier than the buffer cap.
- **Impact:** Operational (admin footgun) and audit-shippability (the
  same constant means two different things at the same time). Not direct
  funds-loss.
- **Proof:** Reading state.rs + bet.rs + initialize_config.rs.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Either:
  - Cap the config write: in `initialize_config`, add
    `require!(max_entries_per_side <= 32, …)`. Cheap, durable.
  - Make the on-chain capacity dynamic: declare both vecs with
    `#[max_len(MAX_HARD)]` where `MAX_HARD` is the hard cap, and have
    the config field be the soft cap that admin can bring lower (never
    higher) than `MAX_HARD`. Slightly more flexible but adds account-size
    headroom permanently.
  Pair with audit plan Task 8 — the compute-budget reality check needs
  to know the worst-case `max_entries_per_side` to test against.
- **Status:** Open

### [MEDIUM] CC-4 — Bet route does not validate that the cached boundary price corresponds to the current minute

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/closecall.ts:587–598` (cache-empty
  check only — no freshness check); `:601` computes `minuteTs` from
  `Date.now()` independently
- **Game:** Close Call
- **Threat actor:** Any player whose `bet` is the **first** bet of a
  minute, when the clock-worker tick has not yet refreshed the cache
- **Invariant:** A round opened at minute `M` must store
  `open_price = Pyth price at minute M`. Pre-condition for the on-chain
  outcome derivation to be meaningful.
- **Issue:** The bet route calls `clockWorker.getLatestBoundaryPrice()`
  and the only check is "cache exists" (line 588). The cache is updated
  by the clock-worker tick at `M + BOUNDARY_OFFSET_MS` (≈1 s after the
  boundary), and the tick polls Hermes for up to
  `HERMES_MAX_RETRIES * HERMES_POLL_INTERVAL_MS = 10 s` before
  giving up.
  - For a bet placed at `M+0s` to `M+~1-10s`, the cache is **still the
    M-1 boundary price**.
  - The bet route writes that stale cached price as the round's open
    price (via `init_if_needed` on the first bet) — see
    `tx-builder.ts/buildCloseCallBetTx` and on-chain `bet.rs:97`
    (`round.open_price = open_price`).
  - The on-chain check at `bet.rs:75` (`minute_ts == current_minute`)
    only validates the *minute_ts*, not the *price's publish_time*.
  Net: a round whose PDA seeds are `(M+1).to_le_bytes()` can carry
  `open_price = Pyth price at M`. Settlement compares to a price
  fetched at `M+2 + delta`, so the candle effectively spans two minutes
  rather than one. Combined with CC-2, the close price is also off, so
  the "candle" can be off on both ends.
- **Exploit Path:** Not adversarial; happens whenever a tick is delayed
  or the first bet of a minute lands before the tick updates the cache.
  Pre-tick bet windows are short (≤ ~2 s typical, up to ~10 s if Hermes
  is slow), but they exist on every minute boundary.
- **Impact:** Round opens with a stale (-60 s or worse) `open_price`.
  The on-chain outcome math is still internally consistent, but the
  *advertised* candle (chart, verify endpoint) does not match. Players
  who place the first bet of a minute are systematically betting on
  a candle that is not the one they see on the chart.
- **Proof:** Read closecall.ts:588, closecall-clock.ts:42–48 (timing
  constants), no `cachedBoundaryPrice.minuteTs == currentMinute` check
  at any caller of `getLatestBoundaryPrice`.
- **Discovered via:** Manual review of the cache lifecycle.
- **Confidence:** High.
- **Fix Direction:** In the bet route, before building the tx, assert
  `boundaryPrice.minuteTs === currentMinute`. If not, return
  `503 PRICE_UNAVAILABLE` with a `retryable: true` flag. The clock-worker
  tick at `currentMinute + 1s` will refresh the cache; the player
  retries the bet a second later. This converts the silent-staleness
  bug into a transient retry. Add a backend test that pins the cache
  to a stale `minuteTs`, calls `/closecall/bet`, and asserts a 503.
- **Status:** Open

### [MEDIUM] CC-5 — `state` writes after lamport transfers in `settle_round` / `timeout_refund` / `force_close`

- **Category:** Needs Test Proof
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs:222–231`
  (state writes after `transfer_lamports_from_pda` calls at :155, :162);
  `timeout_refund.rs:102–104` (state writes after the per-side transfer
  loops at :74–92); `force_close.rs:88–90` (same pattern)
- **Game:** Close Call (cross-pattern: same shape as PS-3 in Pot Shot,
  FY-4 in FlipYou)
- **Threat actor:** None today; defensively, future maintainers
- **Invariant:** README §"Lamport Movement" — *"Confirm state mutations
  occur before external lamport transfers where the program directly
  manipulates `**lamports.borrow_mut()`. Any 'transfer first, mutate state
  after' path is a bug-shape worth flagging even if Anchor's atomicity
  covers it."*
- **Issue:** All three lifecycle-terminal Close Call instructions follow
  the pattern `transfer ...` (per-entry, per-side) → `emit!(...)` →
  `round.phase = Refunded/Settled; round.outcome = …;`. The state writes
  are dead — Anchor's `close = rent_receiver` zeros all data immediately
  after the handler returns. But the *order* still violates the audit
  baseline. A future PR that introduces a CPI between the transfers and
  the close (event-emitter, notifications, fee-allocation) would re-open
  the question.
- **Exploit Path:** None today. The pattern becomes exploitable shape if
  a future PR introduces a CPI between the transfers and the close in any
  of the three instructions.
- **Impact:** Latent. Audit-baseline violation. No immediate funds risk.
- **Proof:** Code reading.
- **Discovered via:** Cross-game diff against PS-3 / FY-4.
- **Confidence:** High (the violation), Low (the runtime risk).
- **Fix Direction:** Drop the phase / outcome writes in all three
  instructions — they precede an Anchor close that zeros the data, so
  the writes are dead. Replace with a comment stating that close itself
  is the lifecycle signal. Apply consistently across Pot Shot and Close
  Call (FlipYou's `cancel_match` / `timeout_refund` already follow this
  shape).
- **Status:** Open

### [MEDIUM] CC-6 — Health endpoint does not expose Hermes / clock / settlement-queue health

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/health.ts:33–39` (returns only
  `status, version, workerRunning`); audit packet `closecall.md` Task 6
  asks for *"stale oracle data, failed settlement queue depth, low signer
  balance, and worker liveness"*
- **Game:** Close Call
- **Threat actor:** None; this is operations
- **Invariant:** Per the audit packet, Close Call's health endpoint
  must expose four signals; today it exposes one (worker liveness via
  `isWorkerRunning()`).
- **Issue:** None of the following are exposed on `/health` or any
  comparable route:
  - Last successful Hermes fetch timestamp / age (CC-2 / CC-4
    motivate this as well)
  - Cached boundary price's `minuteTs` (so on-call can verify it
    matches `currentMinute`)
  - Number of open Close Call rounds whose `candle_close_time` has
    elapsed (i.e., backlog)
  - Server keypair balance (for paying rent + tx fees)
  - Last successful settle tx + age
  Without these, a Hermes outage or a stuck settlement queue is
  invisible until users complain.
- **Exploit Path:** Operational. Silent backlog of unsettled rounds
  goes unnoticed until many rounds flip to `timeout_refund` (which is
  permissionless and refunds users — no funds-loss, but a
  reliability/UX failure).
- **Impact:** No direct funds-loss. Audit-shippability and operational
  observability.
- **Proof:** Reading `health.ts` and grep-ing for any other route or
  metrics endpoint that reports the four signals.
- **Discovered via:** Audit packet Task 6.
- **Confidence:** High.
- **Fix Direction:** Add a `/health/closecall` (or extend `/health`)
  with:
  - `lastBoundaryPriceMinuteTs: number | null`
  - `lastBoundaryPriceAgeSec: number | null` (now − cached.minuteTs)
  - `openRoundBacklog: number` (open rounds past candle close)
  - `serverBalanceLamports: number`
  - `lastSettleTx: { signature: string; ageSec: number } | null`
  Mark each one with a documented threshold and have monitoring/alerts
  fire when crossed.
- **Status:** Open

### [LOW] CC-7 — `pyth_feed_id` is stored on-chain but not validated anywhere

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/closecall/src/state.rs:47`
  (`pub pyth_feed_id: [u8; 32]`); `bet.rs` (no read);
  `settle_round.rs` (no read); `backend/src/worker/pyth-poster.ts:14–15`
  (hardcoded `BTC_USD_FEED_ID` constant, not derived from
  on-chain config)
- **Game:** Close Call
- **Threat actor:** Platform admin (re-init drift) and the external
  auditor (who reads the spec and expects this field to do something)
- **Invariant:** A config field on a deployed program either constrains
  on-chain behavior or is documentation. Mixing both in the same field
  is misleading.
- **Issue:** `CloseCallConfig.pyth_feed_id` is set at `initialize_config`
  time (and silently re-set on every re-init — see CC-8). Nothing
  on-chain reads it. The backend has its own hardcoded
  `BTC_USD_FEED_ID = "0xe62df6c8…"` in `pyth-poster.ts` and uses
  *that* to fetch from Hermes. The two are not enforced to match.
  An admin who changes `pyth_feed_id` on-chain will not change backend
  fetcher behavior; conversely, a backend that's pointed at the wrong
  feed will not be caught by on-chain validation.
- **Exploit Path:** Two ways this manifests once on-chain Pyth lands
  (CC-9):
  - Admin changes `pyth_feed_id` mid-rollout and the backend keeps
    fetching the old feed.
  - Backend is mis-deployed pointing at a non-BTC/USD feed; on-chain
    validation catches it (good!), but **only after** users have
    already placed bets — those bets refund.
  Until on-chain Pyth lands, both fields are pure documentation.
- **Impact:** Documentation drift; latent failure mode once Pyth
  validation lands.
- **Proof:** Reading the three files; grep across the codebase confirms
  no consumer of the on-chain `pyth_feed_id`.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Until on-chain Pyth validation (CC-9) lands,
  document this field's "documentation-only" status in
  `solana/programs/closecall/src/state.rs` and in the spec. Once Pyth
  validation lands, also wire the backend's Hermes fetcher to read the
  feed ID from on-chain config (single source of truth). Add a startup
  check that asserts `BTC_USD_FEED_ID == on-chain pyth_feed_id`; refuse
  to start the clock worker if they diverge.
- **Status:** Open

### [LOW] CC-8 — `initialize_config` uses `init_if_needed` and silently re-unpauses + re-writes feed ID, betting window, and per-side cap

- **Category:** Document As Trust Assumption
- **Surface:** `solana/programs/closecall/src/instructions/initialize_config.rs:11–44`
- **Game:** Close Call (cross-pattern with FY-9 / PS-6, but with more
  knobs that get reset)
- **Threat actor:** Platform admin (CloseCall config authority)
- **Invariant:** `init_if_needed` is an Anchor footgun — it does not
  re-validate existing account state on the "needed not" branch.
- **Issue:** On re-init, the handler authority-checks
  `require_keys_eq!(authority, config.authority)` then **unconditionally**
  writes `pyth_feed_id`, `betting_window_secs`, `max_entries_per_side`,
  and `paused = false`. So a single `initialize_config` call effectively
  becomes "atomic config update + force-unpause." Unlike FY-9 / PS-6
  (which only reset `paused`), Close Call's re-init also resets the
  feed ID and the per-side cap mid-game without a dedicated
  `update_config` instruction.
- **Exploit Path:** Authority compromise is already in the trust
  assumptions, so this surface is contained. The relevant operational
  hazard is admin error: an admin meaning to update one field
  (e.g., raise `max_entries_per_side`) can accidentally clear
  `paused = true`. There is no intermediate `update_config` instruction
  that would have let them update one field without touching
  `paused`.
- **Impact:** Surface-area inflation. A compromised admin has more
  knobs to manipulate in one tx; an honest admin has more ways to
  shoot themselves in the foot. CC-3 (the `max_entries_per_side` >
  32 footgun) is a special case.
- **Proof:** Reading `initialize_config.rs`.
- **Discovered via:** Cross-game diff against FY-9 / PS-6.
- **Confidence:** High.
- **Fix Direction:** Replace `init_if_needed` with `init`, and
  introduce a separate `update_config` instruction with optional
  per-field arguments (mirror `platform/src/instructions/
  update_platform_config.rs`). Keep `set_paused` as the dedicated pause
  toggle. This also resolves CC-3 cleanly: `update_config` rejects
  `max_entries_per_side > 32`, while `init` continues to allow values
  in `0..=32`.
- **Status:** Open

### [LOW] CC-9 — On-chain Pyth validation is still pending

- **Category:** To Do Soon
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs`
  (no Pyth account in the struct); `bet.rs` (no Pyth account either —
  `open_price` is also an instruction arg)
- **Game:** Close Call
- **Threat actor:** Backend operator (compromised key) — and, until
  CC-1 is fixed, any participant
- **Invariant:** Per audit packet README §"Open Questions for External
  Audit": *"Is the planned on-chain Pyth validation model strong enough
  for the production trust boundary…?"* The audit packet repeatedly
  marks this as **To Do Soon**, but the spec's FR-3 is checked off
  ("On-chain program verifies Pyth price account directly"). Either
  the spec is out of date or the implementation regressed.
- **Issue:** No Pyth `PriceUpdateV2` account is loaded by either
  `bet` or `settle_round`. Both instructions take `open_price` /
  `close_price` (and exponents) as plain instruction arguments. This is
  documented in the threat model as a temporary trust assumption; CC-1
  shows that the trust boundary is wider than the model assumes.
- **Exploit Path:** See CC-1 for the participant-as-attacker path. With
  on-chain Pyth in place (and either CC-1 fix), the trust surface
  collapses to "Pyth publisher publishes a wrong BTC/USD update during
  the freshness window" — which is the documented residual.
- **Impact:** Mirrors CC-1 but framed as the durable fix. Without it,
  any settlement-authority gate (Option A in CC-1) is only as strong as
  the backend signer's custody.
- **Proof:** Reading both instructions; cross-checking spec FR-3 vs
  current code.
- **Discovered via:** Audit packet plan Tasks 2 + 7.
- **Confidence:** High.
- **Fix Direction:** Implement on-chain Pyth validation per the audit
  plan: load the Pyth `PriceUpdateV2` account, verify
  `feed_id == config.pyth_feed_id`, verify
  `publish_time` is within the configured freshness window, verify
  exponent compatibility (exact match or normalized), and read the
  price from the account. Refuse settlement on any of those failures
  (refund path becomes the recovery via timeout). Also reconcile the
  spec at `docs/specs/100-close-call/spec.md` FR-3 with the actual
  implementation in the same task.
- **Status:** Open

### [LOW] CC-10 — Bankrun suite under-covers Close Call's adversarial surface

- **Category:** Needs Test Proof
- **Surface:** `solana/tests/closecall.ts` (full file). Audit packet
  `closecall.md` Task 7 lists the missing cases.
- **Game:** Close Call
- **Threat actor:** Platform admin (mis-config), regression risk
- **Invariant:** Funds-handling instructions in audited programs need
  a positive happy-path test, a phase/auth rejection test, and at least
  one adversarial-input test per remaining-account path.
- **Issue:** The bankrun suite covers the happy path well (single-
  winner, multi-winner with proportional payout, single-player refund,
  one-sided refund, equal-price refund, betting-window guards,
  duplicate-bet rejection, timeout, force-close authority). It is
  silent on:
  - **Pause is not test-asserted** for `bet` (the on-chain check at
    `bet.rs:54` exists; nothing in the suite calls `set_paused(true)`
    and tries to bet).
  - **Settle-as-non-server is not test-asserted.** No test passes a
    non-server signer as `caller`. The CC-1 exploit path is not
    refuted by any current test.
  - **`max_entries_per_side` is not boundary-tested.** No test fills a
    side to the cap, the cap-1, or the cap+1 (the on-chain `#[max_len(32)]`
    boundary that CC-3 calls out).
  - **Exponent mismatch on `settle_round`** is not test-asserted.
    `bet.rs:84–86` requires `close_price_expo == round.open_price_expo`;
    no test passes a mismatched expo.
  - **Remaining-account substitution** is not tested. No test passes
    the wrong player as a remaining account on `settle_round`,
    `timeout_refund`, or `force_close` and asserts the
    `AccountMismatch` rejection.
  - **Verify-endpoint-shape** not test-asserted (see CC-11).
- **Exploit Path:** Latent regression risk. CC-1 in particular is
  invisible to the current suite, so a fix could regress without a
  failing CI signal.
- **Impact:** Audit-shippability gap.
- **Proof:** `grep -nE "it.skip|describe|it\(" solana/tests/closecall.ts`
  shows no cases for the above topics; the run captured this pass
  (23/0/0) reflects only what is covered.
- **Discovered via:** Audit packet Task 7.
- **Confidence:** High.
- **Fix Direction:** Add (in priority order):
  1. A test for **CC-1**: a non-server signer attempts settle and is
     rejected. This is the load-bearing test.
  2. A test for **pause**: `set_paused(true)` then `bet` rejected with
     `GamePaused`; settle and timeout still succeed.
  3. A test for **`max_entries_per_side` boundary** at 32 (allowed)
     and 33 (rejected with `MaxEntriesReached`).
  4. A test for **exponent mismatch** on settle (rejected with
     `ExponentMismatch`).
  5. A test for **wrong-player remaining-account** on each of
     `settle_round`, `timeout_refund`, `force_close`.
  6. A test for **CC-3** behaviour at config boundary 32 vs 33.
- **Status:** Open

### [LOW] CC-11 — `/closecall/by-id/:roundId` settled-shape gate is correct but not test-asserted

- **Category:** Needs Test Proof
- **Surface:** `backend/src/routes/closecall.ts:416–433` (settled fields
  only included `if (isSettled)`; verification block also gated)
- **Game:** Close Call (cross-pattern with FY-7 / PS-5)
- **Threat actor:** Any consumer of `/closecall/by-id/:roundId` and
  `/closecall/current-round`
- **Invariant:** README §"Backend Trust Boundary" — assertion of
  shape gating must be automated, not code-review-only.
- **Issue:** `formatCloseCallRound` always includes the round's
  `open_price`, `green_pool`, `red_pool`, but only includes
  `closePrice`, `outcome`, `totalFee`, `settleTx`, `settledAt`,
  `verification.priceSource` inside `if (isSettled)`. The gating is
  correct in code; no integration test asserts it. CC-2 means the
  `closePrice` field, when present, can disagree with the chart, so
  the assertion needs both gating *and* equality checks against
  `closeCallCandles`.
- **Exploit Path:** None today. CI gap → future regression risk.
- **Impact:** Latent; audit-shippability gap.
- **Proof:** Reading `closecall.ts:399–433`; no integration test
  exercises the shape across `phase = open` vs
  `phase = settled/refunded`.
- **Discovered via:** Cross-check against README's "automated, not
  code-review" requirement.
- **Confidence:** High.
- **Fix Direction:** Add a vitest case that creates a closecall round
  via the bet route, asserts `/closecall/by-id/:roundId` lacks the
  settled-only fields. Settle (mock or real on-chain), assert the
  fields appear with values that match the cached boundary price (this
  also pins CC-2 behavior). Test once for `outcome = green`, once for
  `outcome = refund`.
- **Status:** Open

### [INFO] CC-12 — Outcome-determination dead code: `total_count == 1`

- **Category:** To Do Soon (cleanup)
- **Surface:** `solana/programs/closecall/src/instructions/settle_round.rs:99`
- **Game:** Close Call
- **Threat actor:** None
- **Invariant:** Documented refund cases should be expressed in
  minimal, non-overlapping form so an external auditor can read them
  in isolation.
- **Issue:** The refund branch is
  ```rust
  } else if !has_both_sides || total_count == 1 || close_price == open_price {
      Outcome::Refund
  }
  ```
  But `total_count == 1` implies one player on one side, which means
  `!has_both_sides` (the other side is empty). The middle clause is
  subsumed by the first. The current code is correct, just redundant.
- **Exploit Path:** None.
- **Impact:** Audit-packet legibility.
- **Proof:** Code reading.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Drop `total_count == 1`. Re-run bankrun suite
  to confirm no behavior change.
- **Status:** Open

### [INFO] CC-13 — `currentRoundRoute` returns previous-minute round if still open, with no signal to the consumer

- **Category:** Ask External Auditor (UX-level question)
- **Surface:** `backend/src/routes/closecall.ts:319–366`
- **Game:** Close Call
- **Threat actor:** None — UX legibility
- **Invariant:** A "current round" endpoint should give the caller
  enough state to decide what minute they are in.
- **Issue:** The route checks the on-chain account for the current
  minute, then falls back to the previous minute if that account is
  still in `Open` phase (i.e. backend hasn't settled it yet because
  the candle just closed). It returns the round shape without an
  explicit field telling the caller "this is the previous minute, the
  betting window is closed." The phase, `bettingEndsAt`, and
  `minuteTs` are all in the payload, so a careful caller can
  reconstruct, but the route is not self-documenting on this point.
- **Exploit Path:** None — UX issue.
- **Impact:** UI risk: a frontend that does not check `bettingEndsAt`
  before showing a bet button could let users place bets on the prior
  minute. The on-chain `bet.rs:75` will reject with `InvalidMinuteTs`,
  so funds cannot be lost — but UX is degraded.
- **Proof:** Read `closecall.ts:319–366`.
- **Discovered via:** Manual review.
- **Confidence:** High.
- **Fix Direction:** Either always return the *current minute* (even
  if no round exists yet), or add an explicit `isCurrentMinute: boolean`
  to the response so consumers don't have to derive it. The latter is
  back-compat with existing callers.
- **Status:** Open

### [OPEN] CC-14 — Compute and account-load reality check at `max_entries_per_side` not yet performed

- **Category:** Open Investigation (must close before external packet
  ships)
- **Surface:** Per audit packet `closecall.md` Task 8
- **Game:** Close Call
- **Threat actor:** Permissionless caller (timeout_refund) and the
  backend (settle)
- **Invariant:** README §"Compute And Account-Load Limits" — *"Confirm
  headroom is at least 20% under both 1.4M CU and the runtime
  account-loading limit."*
- **Issue:** With `max_entries_per_side = 32`, a worst-case settle
  iterates up to 32 winners (decisive) or 64 refund entries (one-side
  + one-side via timeout/force-close). No devnet measurement of the
  CU or account-load count exists. If the runtime cap is hit, the
  round is permanently stuck — including the `timeout_refund` recovery
  path.
- **Exploit Path:** Funds-stuck scenario if the worst-case settle
  exceeds 1.4M CU or the address-loading limit.
- **Impact:** Funds-stuck if hit; the audit packet must ship with
  measured CU numbers.
- **Proof:** Bankrun does not measure the runtime caps.
- **Discovered via:** Audit packet plan Task 8.
- **Confidence:** Medium (likely fine; needs measurement).
- **Fix Direction:** Per audit plan Task 8:
  - Build a devnet round filled to `max_entries_per_side` (32) on
    both sides with distinct players. Settle decisive. Capture: CU,
    accounts loaded, V0+LUT yes/no.
  - Build a devnet round filled to 32 on each side. Trigger
    `timeout_refund` (or `force_close`). Capture CU.
  - Confirm ≥ 20 % headroom under both 1.4M CU and the account-load
    limit.
  - If headroom is insufficient, this becomes a Must-Fix with a
    remediation plan (lower the cap on mainnet, paged settlement).
  Bonus: also test at the boundary value (33) to demonstrate the CC-3
  failure mode.
- **Status:** Open

---

## Out-of-Scope Observations (recorded for the cross-game pass)

- The **transfer-then-mutate** pattern (CC-5) is the same as PS-3 in Pot
  Shot and FY-4 in FlipYou. Resolving them together is preferable.
- The **`init_if_needed` re-init** pattern (CC-8) repeats FY-9 / PS-6 with
  more knobs reset. The cross-game decision is whether to keep
  `init_if_needed` and document, or split into `init` + `update_*`.
- The **outcome dead clause** (CC-12, `total_count == 1`) is a code-clarity
  issue; if the cross-game cleanup pass touches `settle_round`, this is
  cheap to drop in the same PR.
- **FY-2 carry-over (FlipYou pause-on-join)** is now resolved on this
  commit — `flipyou/src/instructions/join_match.rs:39` calls
  `check_not_paused`. Close Call's `bet` does the same.
  Pot Shot already had it.
- **No platform-wide pause.** All three games hardcode `false` as the
  `global_paused` argument to `check_not_paused`. `PlatformConfig` does
  not have a `paused` field. This is consistent across games but means
  there is no single kill-switch — admin must pause each game
  individually. Accept and document, or add `PlatformConfig.paused` and
  read it everywhere; either way, the cross-game pass should record the
  decision.
- The **Close Call BPF program upgrade authority** is still TBD in
  `docs/audits/solana-games-audit-prep/README.md` Deployment Posture
  custody table. Carries over from FY-10 — the table needs to be filled
  before the external packet ships.
- The Close Call **spec FR-3** at `docs/specs/100-close-call/spec.md`
  marks "On-chain program verifies Pyth price account directly" as
  satisfied. The current code does **not** match this claim (CC-9). The
  spec or the code must move before the external packet ships.
