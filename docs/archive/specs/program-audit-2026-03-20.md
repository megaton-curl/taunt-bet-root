# Program Audit — All Three Games (2026-03-20)

Comprehensive audit of flipyou, pot-shot, and close-call Anchor programs.
Each item verified against source code.

**Legend**: CONFIRMED = real issue | FALSE POSITIVE = not an issue | NUANCED = partially true

---

## Critical / High

- [ ] **CF-1**: ~~FlipYou — Loser can force timeout refund~~ **FALSE POSITIVE**
  Server holds secret, not creator. Timeout is a backup for server downtime, not player-exploitable.

- [ ] **CF-2**: ~~FlipYou — Server key not validated in settle~~ **FALSE POSITIVE**
  Permissionless settlement is intentional design. Anyone with secret can settle.

- [ ] **CF-3**: FlipYou — No time window enforcement for secret reveal **CONFIRMED**
  No deadline for when settle must be called. Settlement can happen anytime after join. By design for commit-reveal, but no urgency mechanism.

- [ ] **LORD-1**: ~~Lord — Entropy slot timing mismatch~~ **FALSE POSITIVE**
  150 slots × ~400ms = ~60s. Matches countdown duration. Agent miscalculated at 2.5s/slot.

- [ ] **LORD-2**: ~~Lord — No settlement authorization~~ **FALSE POSITIVE**
  Winner account validated on-chain. Permissionless settlement is intentional.

- [ ] **CC-1**: Close Call — Prices supplied by server, not Pyth on-chain **CONFIRMED**
  Both open_price and close_price are instruction args. `pyth_feed_id` stored in config but never used on-chain. Standard for Pyth push oracle (Hermes) model but relies on server honesty.

---

## Medium

- [ ] **ALL-1**: No `set_paused` instruction in any program **CONFIRMED**
  All 3 programs have `paused` flag in config but no instruction to toggle it. Only set at init (always false). To pause, must redeploy.

- [ ] **ALL-2**: No `update_config` instruction in any program **CONFIRMED**
  Treasury address, authority, pyth feed, max entries — all immutable post-init. No update mechanism.

- [ ] **ALL-3**: ~~Server not enforced in settle~~ **FALSE POSITIVE (by design)**
  Permissionless settlement is the correct design — allows fallback when server is down.

- [ ] **ALL-4**: ~~Fee split off-chain~~ **RESOLVED**
  Fee is now a single flat 500 bps amount transferred to single treasury from PlatformConfig. No split_fee() needed.

- [ ] **CF-4**: FlipYou — 24h timeout is excessive **CONFIRMED**
  `FLIPYOU_RESOLVE_TIMEOUT_SECONDS = 86_400`. Backend settles in seconds. 24h is unnecessarily long.

- [ ] **CF-5**: FlipYou — No commitment format validation **CONFIRMED**
  Any 32 bytes accepted in create_match. Validation only at settle time (SHA256 check). Wastes chain space on invalid commitments.

- [ ] **CF-6**: ~~FlipYou — match_id no uniqueness check~~ **FALSE POSITIVE**
  Anchor's `init` + PDA seeds `["match", creator, match_id]` prevent collision. Same creator+match_id = account exists = init fails.

- [ ] **LORD-3**: Lord — Single-player rounds stall indefinitely **CONFIRMED**
  Countdown only starts when 2nd player joins. Solo player's funds are locked until `force_close` by admin. No self-service timeout.

- [ ] **LORD-4**: Lord — Whale can dominate entries **CONFIRMED**
  MAX_ENTRIES=64 is total, not per-player. One wallet can buy 63 entries. By design (whale-friendly), but worth documenting in game rules.

- [ ] **LORD-5**: Lord — Deprecated Orao code in start_spin **CONFIRMED**
  Handler is a no-op. 6 `UncheckedAccount` fields for deprecated Orao VRF. Dead code, no security impact, but confusing for auditors.

- [ ] **CC-2**: ~~Close Call — Wrong account order griefing~~ **NUANCED (low impact)**
  `require_keys_eq!` validates each account. Wrong order = tx rejected, not exploited. Griefing = wasted tx fee, not stolen funds. Backend always provides correct order.

- [ ] **CC-3**: Close Call — No max age on settlement **CONFIRMED**
  Only checks `now >= candle_close_time` (60s). No upper bound. Can settle years later. Not exploitable (timeout_refund available at 5min), but untidy.

- [ ] **CC-4**: Close Call — Config immutable post-init **CONFIRMED**
  Same as ALL-2 but Close Call also has immutable pyth_feed_id and betting_window_secs.

---

## Low

- [ ] **CF-7**: ~~Config re-initialization~~ **FALSE POSITIVE**
  Anchor's `init` constraint prevents re-init. Account exists = instruction fails.

- [ ] **CF-8**: ~~Algorithm version enforcement~~ **FALSE POSITIVE**
  `algorithm_ver` is always set to `ALGORITHM_VERSION` (1). No practical risk.

- [ ] **LORD-6**: ~~No match_id collision detection~~ **FALSE POSITIVE**
  Anchor's `init` on PDA prevents collision. Same match_id = account exists = fails.

- [ ] **LORD-7**: Lord — No rate limiting on join/buy **CONFIRMED**
  No cooldown or per-block cap. Bounded by MAX_ENTRIES (64) and Solana compute limits. Acceptable for V1.

- [ ] **LORD-8**: Lord — Pause only blocks new rounds **CONFIRMED**
  Active rounds continue even if paused. By design — existing rounds should settle, not be killed.

- [ ] **CC-5**: ~~Round PDA collision~~ **FALSE POSITIVE**
  `init_if_needed` handles re-entry safely. Same minute_ts = same round = bets added to existing round.

- [ ] **CC-6**: Close Call — No pause toggle **CONFIRMED**
  No `set_paused` instruction. Same as ALL-1.

- [ ] **ALL-5**: Events only on settlement **CONFIRMED (NUANCED)**
  All 3 programs emit events only on settle (`MatchSettled`, `RoundSettled`). No events for create, join, lock, refund, cancel. Limited on-chain observability.

---

## Confirmed Improvements to Implement

Priority order:

| # | Item | Scope | Effort | Impact | Status |
|---|------|-------|--------|--------|--------|
| 1 | **ALL-1/CC-6**: Add `set_paused` to all 3 programs | 3 programs | Low (~30 LOC each) | High — operational safety | **DONE** (`60b8069`) |
| 2 | **ALL-2**: Add `update_config` (treasury at minimum) | 3 programs | Low (~30 LOC each) | High — operational flexibility | **DONE** (`60b8069`) |
| 3 | **CF-4**: Reduce flipyou timeout from 24h to 15min | flipyou | Trivial (1 constant) | Medium — reduces griefing window | **DONE** |
| 4 | **LORD-5**: Remove deprecated Orao code | potshot | Low (~50 LOC deleted) | Low — cleanliness | **DONE** (`60b8069`) |
| 5 | **LORD-3**: ~~Single-player round timeout~~ → `cancel_round` | potshot | Low (~60 LOC) | Medium — creator can withdraw while waiting | **DONE** |
| 6 | **ALL-5**: Add events for all phase transitions | 3 programs | Medium (~20 LOC each) | Medium — observability | **DONE** (`60b8069`) |
| 7 | **IMP-5**: Document trust model | docs | Low | Medium — audit readiness | **DONE** (`docs/solutions/trust-model.md`) |

Items NOT worth implementing for V1:
- CC-1 (on-chain Pyth): Standard push oracle pattern, adds complexity
- ALL-3 (enforce server in settle): Breaks permissionless fallback
- ALL-4 (on-chain fee split): Operational overhead, no user benefit
- CF-5 (commitment validation): Only wastes space on invalid commits, caught at settle
- LORD-4 (whale cap): By design, whale-friendly
- CF-3 (time window): Commit-reveal doesn't need urgency; timeout handles it

---

## False Positives Summary

7 items were FALSE POSITIVE out of 28 total. Most were due to:
1. Agent not understanding Anchor's `init` constraint (prevents re-init/collision)
2. Agent treating permissionless settlement as a bug (it's a feature)
3. Agent miscalculating Solana slot time (400ms, not 2.5s)
