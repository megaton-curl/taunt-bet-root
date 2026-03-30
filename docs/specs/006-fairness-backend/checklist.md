# Spec 006 — Fairness Backend: Open Items

## Blocking

- [ ] **Spec 005 timeout update**: Change on-chain timeout from 120s to 300s. Permissionless refund after 300s with no restrictions. This is the safety net when the backend is down — players can't create new games anyway (server co-sign required), so timeout refund is the complete fallback. **Must be done before spec 006 goes to production** (not required for local dev/testing).

## Design Decisions (Resolved)

- [x] HTTP framework: **Hono** (lightweight, TypeScript-first, modern)
- [x] Postgres dev setup: **Devcontainer feature** (`ghcr.io/devcontainers/features/postgresql:1`)
- [x] Phase model: **Simplified** — `created → locked → settling → settled | expired`. Dropped `tx_sent` and `on_chain` (backend can't observe these; worker discovers matches via polling).
- [x] Entropy: **Single-step settle** against current program. Mock entropy for bankrun tests, SlotHashes sysvar address for production (configurable via `ENTROPY_ACCOUNT` env var). Settlement targets <10s, well within ~200s SlotHashes window.
- [x] Timeout: **300s** (spec 005 update required). If backend is down, no new games can start (server co-sign), so timeout refund returns all funds.

## Deferred (Future Enhancements)

- Privileged historical entropy submission: allow backend to submit historical slot hash + settle matches that missed the ~200s SlotHashes window. Requires on-chain trusted caller + slot hash verification.
