# Design Reference

Consolidated from `pivot-doc.md` (2026-02-25) and `solutions/trust-model.md`.
Updated 2026-03-30 to reflect current decisions.

---

## Trust Model

| Actor | Trust scope | Risk if compromised |
|-------|------------|---------------------|
| **Backend server** | Commit-reveal secrets, Close Call prices, co-signs creation txs | Selective reveals, false prices, service denial |
| **Config authority** | Pause games, update treasury, force-close rounds | Indefinite pause, fee redirection |
| **Treasury wallet** | Receives all fees (500 bps / 5%) | Fee loss |
| **RPC provider** | Relays transactions and account data | Censorship, delays (mitigated by fallback RPCs) |

### Commit-Reveal Fairness (Coinflip, Jackpot)

```
Server generates: secret (32 random bytes)
Server publishes: commitment = SHA256(secret)
                  ↓ stored on-chain at game creation
Entropy source:   SlotHashes sysvar at target_slot
                  ↓ immutable, unpredictable at commitment time
Result:           SHA256(secret || entropy || PDA || algorithm_ver)
                  ↓ deterministic, reproducible by anyone
```

Key assumptions:
- Server commits BEFORE entropy is known (target_slot set at join, ~12 slots ahead)
- Server cannot predict SlotHashes (no single producer controls 512+ consecutive slots)
- Anyone with the secret can verify and re-derive the result
- Settlement is permissionless — if server goes down, anyone with the secret can settle

### Oracle Pricing (Close Call)

```
Backend fetches:  BTC/USD from Pyth Hermes REST API
Server supplies:  open_price (at creation) + close_price (at settlement)
                  ↓ passed as instruction arguments, NOT read from Pyth on-chain
```

Mainnet consideration: Pyth crosschain verification (VAA signature check) or off-chain price deviation alerting.

---

## On-Chain vs Off-Chain Enforcement

| Concern | On-chain | Off-chain |
|---------|----------|-----------|
| Commitment integrity | SHA256 verification | Secret storage |
| Entropy immutability | SlotHashes sysvar address check | N/A |
| Wager bounds | min/max lamport checks | N/A |
| Phase transitions | State machine in program | N/A |
| Player identity | PDA seeds + account key checks | N/A |
| Price honesty (Close Call) | NOT verified | Server supplies from Pyth Hermes |
| Fee calculation | Computed from `PlatformConfig.fee_bps` | N/A |
| Settlement timing | Timeout deadline enforced | Backend settles promptly (~3-5s) |
| Pause toggle | `set_paused` instruction | Admin decision |

---

## Hard Invariants (Shared Crate)

- **Timeout**: Every round entering RESOLVING gets a `resolve_deadline`. After expiry, anyone can trigger refund. No round hangs forever.
- **Pause**: Global (platform-level) and per-game pause. Paused games reject new rounds; existing rounds can still settle or refund.
- **Fee**: Fee calculation and treasury transfer live exclusively in the shared crate. Games never implement their own fee math.
- **Refund**: Any round not SETTLED before its deadline is refundable. No player funds get stuck.
- **Claim**: Payouts and refunds are pull-based. Double-claim returns error. PDA closes after all claims processed.

---

## Settlement Authorization

All programs use **permissionless settlement** — any signer can call settle/claim if they provide correct data. Safety valve: if backend goes down, players aren't stuck.

Tradeoff: No on-chain enforcement that the server is the settler. Backend must protect secrets and prices operationally.

---

## Operational Requirements (V1)

1. Server keypair must be secured (holds secrets, co-signs game creation)
2. Config authority should be hardware wallet or multi-sig
3. Treasury should be multi-sig wallet
4. Backend must settle promptly — timeout refund is a failure mode for players
5. Close Call price monitoring — alert if supplied prices deviate from Pyth by >0.1%
6. Secrets stored in backend DB, never exposed until settlement

---

## Game Roadmap

Current fairness model: **backend-assisted hybrid** (commit-reveal + SlotHashes entropy) is primary.
VRF (Orao) is optional for future games, not default infrastructure. See `DECISIONS.md` 2026-03-11.

| ID | Game | Resolution | Status | Notes |
|----|------|-----------|--------|-------|
| 001 | Coinflip | Commit-reveal + SlotHashes | **Shipped** | 2-player, winner-takes-all |
| 101 | Jackpot (Lord of RNGs) | Commit-reveal + SlotHashes | **Shipped** | Weighted entries, jackpot pool |
| 100 | Close Call | Pyth oracle (BTC/USD) | **Shipped** | Pari-mutuel, green/red binary |
| 002 | Crash | TBD (commit-reveal + VRF seed?) | **Deferred** | Real-time multiplier, complex sync |
| 102 | Game of Trades | Commit-reveal + Pyth | Planned | PnL-ranked payout |
| 103 | Chart the Course | Commit-reveal | Planned | Score-ranked payout |
| 104 | Slots Utopia | VRF | Planned | 9-player, fixed grid |
| 105 | Tug of Earn | VRF + Commit-reveal | Planned | Team-based, tap aggregation |
