# 999 — Enhancements: Open Items

No blockers. This is a rolling backlog — items can be added at any time.

## DevOps / Key Management

- [ ] **Deterministic key derivation from a single seed**: Replace per-key env vars with a single `SOLANA_SEED_PHRASE` in `.env.<network>`. Derive deployer wallet, program keypairs, and E2E player keypairs from BIP44 derivation paths (`m/44'/501'/0'`, etc.) at container startup. Eliminates managing multiple secrets and makes adding new programs/players trivial (just use the next path index).
- [ ] **Program upgrade authority transfer**: After initial devnet deploy, transfer program upgrade authority to a multisig (e.g., Squads) instead of the deployer wallet. Reduces blast radius of a leaked deployer key.
- [ ] **Pre-mainnet key rotation**: Before mainnet launch, generate fresh production keys (never reuse devnet keys). Document the ceremony and store mainnet keys in a secrets manager (Vault, AWS Secrets Manager, etc.) — not in env files.

## On-Chain Contract Hardening

- [x] ~~**Make Coinflip nonce consumption atomic inside `create_match`**~~: **Resolved** — Replaced nonce-based PDA derivation with backend-generated random 8-byte match IDs (`[u8; 8]`). `PlayerProfile` removed entirely; stats moved off-chain. Match PDA seeds are now `["match", creator, match_id]` where `match_id` is generated server-side via `crypto.randomBytes(8)`. No nonce, no profile CPI, no duplicate-PDA footgun.
