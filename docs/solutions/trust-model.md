---
tags: [security, architecture, solana]
area: platform
---

# Trust Model — RNG Utopia V1

## Who is trusted and for what

| Actor | Trust scope | What could go wrong if compromised |
|-------|------------|-----------------------------------|
| **Backend server** | Holds commit-reveal secrets, supplies Close Call prices, co-signs creation txs | Could reveal secrets selectively, supply false prices, or refuse to create games |
| **Config authority** | Can pause games, update treasury, force-close rounds | Could pause games indefinitely, redirect fees |
| **Treasury wallet** | Receives all fees (3% per round) | Fee loss if key is compromised |
| **RPC provider** | Relays transactions and account data | Could censor or delay transactions (mitigated by fallback RPCs) |

## Commit-reveal fairness (Coinflip + Lord of RNGs)

```
Server generates: secret (32 random bytes)
Server publishes: commitment = SHA256(secret)
                  ↓ stored on-chain at game creation
Entropy source:   SlotHashes sysvar at target_slot
                  ↓ immutable, unpredictable at commitment time
Result:           SHA256(secret || entropy || PDA || algorithm_ver)
                  ↓ deterministic, reproducible by anyone
```

**Key assumptions:**
- Server commits to secret BEFORE entropy is known (target_slot set at join time, ~12 slots in the future)
- Server cannot predict SlotHashes (no single block producer controls 512+ consecutive slots)
- Anyone with the secret can verify: `SHA256(secret) == commitment` and re-derive the result
- Settlement is permissionless — if server goes down, anyone with the secret can settle

**Timeout fallback:** If server never settles, players can call `timeout_refund` after the deadline (24h for coinflip, 120s for Lord). All players get full refunds, no fee charged.

## Oracle pricing (Close Call)

```
Backend fetches:  BTC/USD from Pyth Hermes REST API
Server supplies:  open_price (at round creation) + close_price (at settlement)
                  ↓ passed as instruction arguments, NOT read from Pyth on-chain
```

**Key assumptions:**
- Server supplies honest, timely Pyth prices
- No on-chain verification of price data (standard for Pyth push oracle model)
- `pyth_feed_id` stored in config for off-chain audit trail, not used on-chain

**Mainnet consideration:** For mainnet, consider Pyth crosschain verification (VAA signature check) or at minimum off-chain monitoring/alerting on price deviation.

## Fee handling

```
On-chain:   3% fee → single treasury address
Off-chain:  Backend splits treasury balance into:
            - 200 bps (2/3): Platform revenue
            -  70 bps (7/30): Rakeback pool
            -  30 bps (1/10): Chest treasury
```

**Key assumption:** Backend correctly splits fees. On-chain `split_fee()` computes the shares but only transfers the total to one treasury address.

**Mainnet consideration:** Multi-sig treasury wallet. Optionally enforce split on-chain with separate transfer instructions.

## Settlement authorization

All three programs use **permissionless settlement** — any signer can call settle/claim_payout if they provide the correct data (secret for coinflip/lord, close price for close call, correct remaining accounts for payouts).

**Why permissionless:** Safety valve. If the backend goes down, players aren't stuck. Anyone observing the secret (from a successful prior attempt or leaked tx data) can complete settlement.

**Tradeoff:** No on-chain enforcement that the server is the settler. Backend must protect secrets and prices operationally.

## What's enforced on-chain vs off-chain

| Concern | On-chain | Off-chain |
|---------|----------|-----------|
| Commitment integrity | SHA256 verification | Secret storage |
| Entropy immutability | SlotHashes sysvar address check | N/A |
| Wager bounds | min/max lamport checks | N/A |
| Phase transitions | State machine in program | N/A |
| Player identity | PDA seeds + account key checks | N/A |
| Price honesty | NOT verified | Server supplies from Pyth Hermes |
| Fee split | Total computed, not split | Backend splits from treasury |
| Settlement timing | No deadline (except timeout) | Backend settles promptly (~3-5s) |
| Pause toggle | `set_paused` instruction | Admin decision |

## Operational requirements for V1

1. **Server keypair** must be secured (holds secrets, co-signs all game creation)
2. **Config authority** should be a hardware wallet or multi-sig
3. **Treasury** should be a multi-sig wallet
4. **Backend** must settle promptly — players see timeout refund as a failure mode
5. **Price monitoring** for Close Call — alert if supplied prices deviate from Pyth by >0.1%
6. **Secret management** — secrets stored in backend DB, never exposed to players until settlement
