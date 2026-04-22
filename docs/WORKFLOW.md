# Workflow Defaults

Execution defaults for humans and AI agents. Use this file for day-to-day implementation behavior.

---

## 1) Edit Boundaries (Default)

- Prefer editing only files directly relevant to the task.
- Solana programs: `solana/` submodule
- Backend services + shared TS packages: `backend/` submodule
- Chat service: `chat/` submodule
- Telegram bot: `telegram/` submodule
- Docs, scripts, e2e: root repo
- Dev-only local diagnostics: `test-tools/`
- Do not edit generated/build outputs (`dist/`, compiled artifacts, coverage outputs).
- If a task requires crossing submodule boundaries, state why in the final report.

---

## 2) Build Policy (Default)

- Completion gate: `./scripts/verify` (runs lint + typecheck + test on backend, builds + tests solana programs).
- Backend: `cd backend && pnpm lint && pnpm typecheck && pnpm test`
- Chat: `cd chat && pnpm verify`
- Telegram: `cd telegram && pnpm verify`
- Solana: `cd solana && anchor build && mocha tests`
- Root `./scripts/verify` currently excludes `chat/` and `telegram/` by design while their contracts stabilize. Run their verification commands separately when touching those submodules.

---

## 3) Testing Expectations (Default)

- For behavior changes, add or update tests in the nearest package/app when feasible.
- For bug fixes, first reproduce with a failing test where practical, then fix.
- If tests are not feasible in the same task, record the gap in `docs/TECH_DEBT.md` with concrete follow-up criteria.
- Integration tests either provision their runtime dependencies in CI (database, validator, external service, etc.) or they do not run in the default CI lane.
- Tests must validate the intended behavior path. Do not keep alternate "success" paths in the same test when the primary assertion flow fails.
- If a test flow fails, investigate root cause first. You may temporarily split checks into smaller diagnostic tests, but final committed tests must assert the canonical behavior path.
- Conditional branches in tests are only for explicit preconditions (missing env var, unavailable external service) and must fail/skip with a clear reason.
- Verification must pass before task completion using the command set relevant to the touched surface: `./scripts/verify` for root/backend/solana work, `cd chat && pnpm verify` for chat work, `cd telegram && pnpm verify` for telegram work, or combinations when a task spans boundaries.

---

## 4) Branch / Commit / PR Conventions (Default)

- Use the current branch unless a new branch is explicitly requested.
- Do not create commits unless explicitly requested by the user.
- Keep commits focused and small; avoid mixing unrelated changes.
- Do not push or open PRs unless explicitly requested by the user.
- In submodule work, report root-repo dirt separately before any "commit all" or "push all" move. Do not treat a clean submodule as equivalent to a clean workspace.

---

## 5) Dead Code Cleanup (Default)

- After any refactor, removal, or dependency change: grep for orphaned imports, unused exports, and stale env vars. Don't leave dead references behind.
- Remove files that are no longer imported or referenced — don't comment them out or leave "removed" placeholders.
- Check `package.json` for dependencies that no longer have any import in the package's source files.
- If cleanup scope is too large for the current task, log it in `docs/TECH_DEBT.md` with the specific files/symbols to clean up.

---

## 6) Amount Units (Default)

- Functional money values must use lamports end-to-end. Convert user-entered SOL amounts to lamports at the first real boundary and keep lamports in state, API payloads, signatures, persistence, tests, and on-chain args.
- SOL decimal strings/numbers are for display and input ergonomics only. Do not use floating SOL values for matching, equality checks, payout math, signatures, or database writes.
- Name contract fields explicitly (`amountLamports`, `entryAmountLamports`, etc.) so unit semantics stay obvious at every boundary.

---

## 7) Documentation Update Rules (Default)

- Update `docs/DECISIONS.md` only for durable decisions (not temporary implementation details).
- Update `docs/TECH_DEBT.md` for temporary compromises.
- Update `docs/LESSONS.md` with one compact row when a meaningful mistake is discovered.
- When changing a public backend endpoint, keep runtime contracts, OpenAPI, and endpoint tests in sync in the same change.

---

## 8) Public API Contract Rules (Default)

- Public JSON routes use the shared envelope body:
  - success: `{ ok: true, data }`
  - error: `{ ok: false, error }`
- Explicit `204` responses and framework-generated unmatched-route `404/405` are the only normal exceptions to the envelope body rule.
- Preserve semantic HTTP statuses:
  - `200` / `201` / `202` for success
  - `204` for no-body success
  - `400` / `422` for malformed or invalid requests
  - `401` / `403` for auth and permission failures
  - `404` for missing resources
  - `409` for conflicts and invalid current state
  - `429` for cooldowns and rate limits
  - `5xx` for server faults
- Do not flatten handled domain failures into `200`.
- Use `200` with nullable, empty, or default-valued payloads only when the absence is the documented success answer for the route.
- When changing a public backend contract, audit status/body-sensitive consumers in `waitlist/`, `webapp/`, and `telegram/` in the same task, or log the rollout gap in `docs/TECH_DEBT.md`.

---

## 9) Third-Party Dependency Integration (Default)

When writing code that integrates with any external dependency — SDK, API, on-chain program, library, oracle — follow this checklist:

1. **Start with the latest stable version**: Before adding a dependency, research the current recommended version. Check the project's GitHub releases, migration guides, and changelogs. Don't default to whatever version an old tutorial or example uses — you'll inherit deprecated patterns and eventually pay the upgrade cost anyway.
2. **Pin the version**: Know exactly which version you depend on (`Cargo.toml`, `package.json`, deployed program).
3. **Read the docs for THAT version**: Not blog posts, not old code, not "similar" examples. Check official docs, `docs.rs`, GitHub source, or the IDL for the exact version.
4. **Verify data shapes at the boundary**: For binary layouts, serialization formats, API response shapes, or account structures — write an explicit check (length, discriminant, version byte) before reading data. Silent misreads produce plausible-but-wrong results.
5. **Test with real data early**: Don't defer integration testing. A mock that returns hardcoded values won't catch layout mismatches — hit the real service (devnet, staging, sandbox) as early as feasible.
6. **When upgrading**: Re-verify every raw byte offset, field name, and response shape. Grep the codebase for all usages of the old layout — they ALL need updating, not just the first one you find.

> **Why this matters**: A single wrong byte offset in an Orao VRF account read cost multiple sessions of debugging. The data looked valid (it was a real pubkey byte), produced a valid flip you result (heads/tails), but was the *wrong* result. Every downstream symptom (UI mismatch, profile stats wrong, "both players lost") pointed away from the root cause.

---

## 10) Devnet E2E Verification (Default)

- Run `./scripts/verify --devnet` before PRs that touch chain-facing code (`solana/`, `backend/packages/anchor-client/`, `backend/packages/game-engine/` winner/payout logic).
- NOT required every iteration — IS automated in `spec-loop.sh` for specs that reference flipyou, Pot Shot, or Close Call.
- Requires `VITE_FLIPYOU_PROGRAM_ID` env var to be set; skips gracefully without it.
- Devnet E2E failures are non-blocking (exit 0 with WARN) — they surface regressions without halting the workflow.
- For large UI-impacting changes, run visual/e2e checks through user-facing interactions (click/type/navigate) so the flow is validated as a human would use it.
- Do not add fallback assertion paths that bypass blocked UI behavior; if interaction is blocked by infra/tooling/app issues, mark it as a blocker with evidence and resolve it directly.
- Setup/cleanup helpers are allowed for deterministic test preconditions, but they must not replace the primary user interaction path being validated.

---
