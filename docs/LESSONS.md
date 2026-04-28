# Lessons Ledger (Compact)

Purpose: keep lessons short, searchable, and easy to maintain.

Rules:
- One lesson = one table row.
- Keep each field concise.
- Max 25 rows (recommended).
- For deeper context on patterns, see `docs/DESIGN_REFERENCE.md` or `docs/FOUNDATIONS.md`.

| ID | Trigger | Bad Pattern | Better Pattern | Rule Tag | Status |
| --- | --- | --- | --- | --- | --- |
| L-001 | Lint cleanup | Silence errors (`_error`, disable rules) | Handle/log the error explicitly | error-handling | active |
| L-002 | Quick test pass | Dummy assertion (`expect(true).toBe(true)`) | Test real behavior or mark debt | testing | active |
| L-003 | Hook dependencies | Ignore `useEffect` deps to stop loops | Stabilize refs (`useMemo`/`useCallback`) or refactor | react-effects | active |
| L-004 | E2E test cleanup | UI-based cleanup (Playwright clicks) for pre-flight state | Programmatic on-chain txs — deterministic, no async mount races | e2e-testing | active |
| L-005 | Devnet RPC writes | Assume all RPC providers handle writes equally | DRPC drops txs, api.devnet 429s aggressively; test with Infura/Helius | infra | active |
| L-006 | Stale test state | Log WARNING and continue when cleanup fails | Throw on cleanup failure — stale state poisons all subsequent steps | e2e-testing | active |
| L-007 | 3rd-party integration | Copy data shapes from old code, examples, or memory | **Read official docs/source for the exact version you depend on** — wrong shapes silently produce plausible-but-wrong data, cascading into sessions of symptom-chasing. See `docs/WORKFLOW.md` §7. | dependencies | active |
| L-007b | Orao VRF V2 layout | Read randomness at offset 40 (V1 layout) | Check `d[8]==1` (Fulfilled variant), read randomness at offset 73 (V2: 137 bytes total) | on-chain | active |
| L-008 | VRF poll strategy | Poll match phase for "resolved" | With real VRF, match stays "locked" until claim_payout — check Orao randomness bytes directly | on-chain | active |
| L-009 | Devcontainer Chromium | Use page.goto/reload to force UI refresh | Chromium crashes on navigation in devcontainer — skip UI checks, verify on-chain state instead | e2e-testing | active |
| L-010 | Test flow failures | Keep fallback pass paths in the same test after primary flow fails | Treat failure as signal: investigate root cause, split diagnostics if needed, then keep one canonical assertion path (human-path for E2E) | testing | active |
| L-011 | Account layout change | Hardcode `dataSize` constant, forget to update after struct change | Use `program.account.<name>.size` (dynamic from IDL). Never hardcode account sizes — wrong dataSize = silent empty results. | on-chain | active |
| L-012 | Amount handling | Pass SOL decimals through app/backend/on-chain logic | Convert to lamports at the first functional boundary and keep lamports everywhere except display/input formatting | money-units | active |
| L-013 | Latency investigation | Build optimization first, measure after | Add `performance.now()` timing logs to the slow path FIRST, collect one real data point, THEN decide what to optimize. Blind optimization wastes hours on the wrong bottleneck. | debugging | active |
| L-014 | React WS subscription churn | Build hook body first, fix lifecycle later (4 fix commits in 2h) | Design subscription lifecycle FIRST: what value triggers re-sub, use primitive/stable keys not object refs, test with StrictMode double-mount. | react-effects | active |
| L-015 | One-off diagnostic scripts | Commit a throwaway diagnostic script to test a hypothesis | Add instrumentation to the actual production code path (timing logs, debug output). Committed diagnostics become maintenance burden with no ongoing value. | debugging | active |
| L-016 | Stale accounts after redeploy | Add client-side decode filters for old account layouts (3+ iterations) | After program redeploys that change layouts, close old accounts immediately via admin instruction. Each legacy account requires a new client-side workaround. | on-chain | active |
| L-017 | Missing auth on /closecall/bet | Assume route-group middleware covers all financial endpoints | Every endpoint that co-signs with server keypair needs **explicit** auth check. Don't rely on path-prefix inheritance — verify each financial endpoint individually. | security | active |
| L-018 | Leaked Pyth exponent in /price response | Ship API responses without schema validation | Validate API responses against OpenAPI spec. Leaked internal fields (exponents, raw oracle data) create client confusion and potential info disclosure. | api-quality | active |
| L-019 | FlipYou rent regression | Update close/refund rent recipient without matching create payer/tests | Assert rent payer and rent recipient symmetry in lifecycle tests; players transfer principal, operator funds rent. | on-chain | active |
