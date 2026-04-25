# Refinement Checklist — 305 Peek Operations Admin

- [x] Spec status reviewed: `Ready`.
- [x] Existing code baseline inspected: `peek` is a working Next.js internal admin with Cloudflare Access middleware (`peek/src/server/cloudflare-access.ts`, `peek/proxy.ts`), server-only DB queries, home/user-detail routes, component tests, and E2E scaffolding.
- [x] Existing test state checked: `cd peek && pnpm test` passes with 21 tests.
- [x] Blocking items: none found during refinement.
- [x] Implementation source of truth remains `spec.md` under `### Implementation Checklist`.

## Refinement decisions (2026-04-25)

- **View-model contracts** split into 2 foundational chunks (metric/filter/table primitives + audit/export contracts); per-feature view models defined inline within their feature iterations.
- **UI primitives** split into 2 chunks: layout/data (table, metric strip, filter bar) + state (chip, empty state, detail panel).
- **Games (FR-8)** split by route, not by game: `/games` overview + `/games/[game]` (handles all 3 games via param) + `/games/[game]/rounds/[roundId]`.
- **Economy (FR-9)** split into 4 feature pairs: rewards (config + pool + fundings), points + crates, challenges, dogpile + fraud.
- **Devnet provider E2E** marked N/A in the canonical line: peek has no on-chain/oracle/VRF integration; devnet E2E provides no signal.
- **Authorization context** (verified email + resolved role threading) merged into the access-policy iteration to avoid a near-empty wiring iteration.
- **Access-denied / missing-config states** merged into the admin-shell iteration (same surface).
- Each feature engine + frontend + test stays as a 3-iteration triplet to fit the spec-loop session size.
