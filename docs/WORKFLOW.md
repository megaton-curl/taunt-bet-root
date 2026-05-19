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
- Root workspace, `backend/`, and `chat/` are the authoritative repos for default implementation work.
- `waitlist/` and `webapp/` are consult-only by default. Review them for impact when contracts move, but do not proactively patch them unless explicitly asked.
- Do not edit generated/build outputs (`dist/`, compiled artifacts, coverage outputs).
- If a task requires crossing submodule boundaries, state why in the final report.

---

## 2) Build Policy (Default)

- Completion gate: `./scripts/verify` (runs lint + typecheck + test on backend, builds + tests solana programs).
- Backend: `cd backend && pnpm lint && pnpm typecheck && pnpm test`
- Chat: `cd chat && pnpm verify`
- Telegram: `cd telegram && pnpm verify`
- Solana: `cd solana && sfw anchor build && mocha tests`
- Root `./scripts/verify` currently excludes `chat/` and `telegram/` by design while their contracts stabilize. Run their verification commands separately when touching those submodules.
- **All dependency installs and fetches must be wrapped with `sfw`** (Socket Firewall) — e.g. `sfw pnpm install`, `sfw anchor build`, `sfw cargo fetch`. Applies to local dev and CI alike. See root `CLAUDE.md` → "Supply-chain guard" for the full table and rationale.

---

## 3) Testing Expectations (Default)

- For behavior changes, add or update tests in the nearest package/app when feasible.
- For bug fixes, first reproduce with a failing test where practical, then fix.
- If tests are not feasible in the same task, record the gap in `docs/TECH_DEBT.md` with concrete follow-up criteria.
- **Assert against role/structure, not literal user-facing copy.** Use `getByRole` / `getByLabelText` / columnheader names + semantic markers (e.g., `<code>` containing the source table name). Reserve literal-text assertions for the rare case where the copy is the documented contract. Text changes shouldn't ripple through tests. See LESSONS L-022.
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

## 5) Production Safety (Default)

- Migrations must preserve live data unless there is an explicit, documented deletion or transformation plan.
- Never discard, truncate, reset, or backfill-overwrite production data without approval, rollback steps, and operator-facing verification notes.
- If a contract change lands in an authoritative repo before consumers adopt it, document the rollout gap in root docs rather than silently patching consult-only repos.

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
- When changing an authoritative backend or chat contract, note consult-only consumer impact in root docs if `waitlist/` or `webapp/` will follow later.

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

When integrating with any external dependency — SDK, API, on-chain program, library, oracle — **verify data shapes at the boundary**. For binary layouts, serialization formats, API response shapes, or account structures, write an explicit check (length, discriminant, version byte) before reading data. Silent misreads produce plausible-but-wrong results.

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
