# 305 — Test Harness Simplification Plan

Spec 305 grew peek's test suite from 21 → 1017 tests across 88 files. Three
parallel survey agents identified ~430 tests as low-signal duplication. This
plan splits the cleanup into 5 tiers, ordered by safety. Each tier is
**self-contained** so a fresh session (after `/clear`) can pick up exactly
one tier without rebuilding context.

## How to use this plan

Between tiers, run `/clear` and start a fresh session. Then:

1. Read this file plus any files listed in the tier's **Read first** section.
2. Apply the tier's **Action** instructions exactly.
3. Run the **Verify** command and confirm the test-count delta is in range.
4. Commit + push per the tier's **Commit** template.
5. Update root pointer + commit.
6. Tick the tier's checkbox in the **Progress** section at the bottom of this
   file (commit the tick alongside the work).

Don't combine tiers in one session — context clarity is the whole point.

## Shared invariants for every tier

- **Don't lose coverage.** If a test guards non-obvious behavior (status-driven
  branching, role gating, a numeric coercion edge case, a SQL projection,
  audit emit ordering, transaction rollback, secret redaction, accessibility
  contract), KEEP it. The patterns this plan targets are mechanical
  duplications, not real guards.
- **Test count alone isn't the goal.** Each drop must have a clear "this is
  already covered elsewhere" or "TS/Zod already enforces this" justification.
- **Run `pnpm verify` at the end of each tier**, not just `pnpm test`.
  Lint/typecheck catch dangling imports left after dropping tests.
- **Commit only the test changes per tier** + the root pointer bump.
  Don't sweep unrelated dirt.
- Use the existing peek test style (vitest + `@testing-library/react` +
  `describe/it`). Match indentation and import conventions of neighbors.

---

## Tier 1 — Cross-cutting domain-table + filter-bar duplication

**Estimated drop**: 50–80 tests. Confidence: **very safe** (mechanical).

### Goal

The same 2-3 tests are copy-pasted across **18 domain tables** and **8 filter
bars**. Keep one canonical test at the primitive level; drop the duplicates.

### Read first

- `peek/src/components/peek-table.tsx` — primitive table.
- `peek/src/components/__tests__/peek-table.test.tsx` — the canonical test
  file. This is where the surviving generic tests should live (or already
  live).
- One representative domain-table source file (e.g.
  `peek/src/components/users-table.tsx`) so you understand what's actually
  rendered.
- One representative filter-bar source (e.g.
  `peek/src/components/audit-events-filter-bar.tsx`).

### Scope

**Domain tables** (18 files in `peek/src/components/__tests__/`):
- `users-table.test.tsx`
- `audit-events-table.test.tsx`
- `bonus-completions-table.test.tsx`
- `campaigns-table.test.tsx`
- `challenge-assignments-table.test.tsx`
- `challenges-table.test.tsx`
- `closecall-rounds-table.test.tsx`
- `completion-bonuses-table.test.tsx`
- `crate-drops-table.test.tsx`
- `dogpile-events-table.test.tsx`
- `event-queue-table.test.tsx`
- `fraud-flags-table.test.tsx`
- `game-rounds-table.test.tsx`
- `games-overview-table.test.tsx`
- `growth-claims-table.test.tsx`
- `growth-kol-table.test.tsx`
- `growth-referrers-table.test.tsx`
- `player-points-table.test.tsx`
- `point-grants-table.test.tsx`
- `progress-events-table.test.tsx`
- `reward-config-table.test.tsx`
- `reward-pool-fundings-table.test.tsx`

**Filter bars** (8 files in `peek/src/components/__tests__/`):
- `audit-events-filter-bar.test.tsx`
- `economy-cates-filter-bar.test.tsx` (or similar naming — grep for
  `*filter-bar.test.tsx`)
- `economy-challenges-filter-bar.test.tsx`
- `event-queue-filter-bar.test.tsx`
- `game-rounds-filter-bar.test.tsx`
- `growth-claims-filter-bar.test.tsx`
- `operations-dogpile-filter-bar.test.tsx`
- `player-points-filter-bar.test.tsx` / `point-grants-filter-bar.test.tsx`

(Use `find peek/src/components/__tests__ -name '*filter-bar*'` to confirm
exact list.)

### Pattern → Action

Three duplicated patterns to drop from domain tables. Keep ONE test of each
pattern in `peek-table.test.tsx`. If a sufficient generic test isn't already
there, add it before dropping the duplicates.

#### 1. "read-only: no buttons / inputs / checkboxes"

Identical DOM check across all 18 domain tables. Look for tests like:
> "read-only: no edit affordances rendered (no buttons, no editable inputs, no checkboxes)"

**Action**: Add (or confirm) one test in `peek-table.test.tsx` that mounts
a `PeekTable` with a populated row set and asserts there are 0
`role="button"`, 0 `<input>` not of type=hidden, and 0 `role="checkbox"`
within the table. Then drop the duplicate test from each of the 18 domain
tables.

**Exception**: Keep the per-table test ONLY when the table has a conditional
mutation column (e.g., `DogpileEventsTable` with `canCancelDogpile`,
`FraudFlagsTable` with `canTransitionFraudFlag`). For those, the test is
guarding an authorization-boundary behavior, not the read-only contract.
Keep both the "denied actor → no affordances" AND "authorized actor → form
rendered" tests in those files.

#### 2. "error state hides the table"

Identical DOM check across the same 18 tables. Look for tests like:
> "error: renders an alert and hides both the table and the empty status"

**Action**: Add (or confirm) one test in `peek-table.test.tsx` that mounts
with `error={"some message"}` and asserts the alert role is present and the
table role is absent. Drop the per-domain duplicates.

#### 3. Filter-bar "form posts to /X by default" + "inputs use prefix"

Identical structure across 8 filter bars. Look for tests like:
> "empty: form posts to /X by default with all inputs blank"
> "inputs use the queueFilter*/auditFilter*/etc prefix so the URL parser binds back"

**Action**: For each filter bar, the prefix-binding contract is genuinely
unique to that filter (different prefix, different field set), so KEEP one
test per filter bar that verifies the prefix and field set. DROP the
"form posts by default" test — that's the same `<form method="get">`
behavior across all 8 and adds no signal beyond what HTML guarantees.

### Verify

```bash
cd peek && pnpm test --reporter=basic 2>&1 | tail -5
```

Expect total to drop by ~50–80 tests. Lint + typecheck must pass:

```bash
cd peek && pnpm verify 2>&1 | tail -10
```

### Commit

```
test(peek): collapse cross-cutting domain-table + filter-bar duplication

The PeekTable primitive enforces the read-only and error-state contracts;
per-domain duplicates of those tests were repeated 18×. Filter-bar
"form posts by default" was repeated 8×.

Keeps one canonical test per pattern in peek-table.test.tsx; per-domain
files keep only the tests that guard table-specific behavior (mutation
columns, status chip variants, drilldown URLs, copy specifics).

Tier 1 of docs/specs/305-peek-operations-admin/test-simplification-plan.md.
```

### Push + root pointer

```bash
git -C peek push origin dev
# back at root:
git add peek docs/specs/305-peek-operations-admin/test-simplification-plan.md
git commit -m "chore: advance peek ref — tier 1 test cleanup"
```

---

## Tier 2 — Search-params shared helper

**Estimated drop**: 55 tests. Confidence: **safe** (single refactor).

### Goal

6 search-params test files (`peek/src/lib/__tests__/*search-params*.test.ts`)
verify the same trim/lowercase/array→first/undefined→null/enum-allowlist
behavior on different field names. ~81 tests across 6 files repeating one
contract.

### Read first

- `peek/src/lib/search-params.ts` — base normalizer pattern.
- `peek/src/lib/audit-search-params.ts` — one representative.
- `peek/src/lib/__tests__/audit-search-params.test.ts` — one representative
  test file.
- `peek/src/lib/__tests__/games-search-params.test.ts` — the largest one
  (21 tests).

### Scope

```
peek/src/lib/__tests__/
├── search-params.test.ts            (3 tests — already lean, leave alone)
├── audit-search-params.test.ts      (~12 tests → ~3)
├── economy-challenges-search-params.test.ts (~15 → ~3)
├── games-search-params.test.ts      (~21 → ~4)
├── growth-search-params.test.ts     (~7 → ~2)
├── operations-dogpile-search-params.test.ts (~? → ~3)
├── operations-queue-search-params.test.ts   (~14 → ~3)
```

### Pattern → Action

Each file currently has tests like:
- "empty input → all nulls"
- "whitespace-only → null"
- "trim populated input"
- "unknown enum → null"
- "every enum value passes through"
- "array param → take first"
- "undefined → null"

These verify the base coercion behavior, which is already a one-time concern.

**Action**: Create a shared test helper at
`peek/src/lib/__tests__/_helpers/test-search-params-normalizer.ts`
(prefix `_` so it's not picked up as a test file):

```ts
export type FieldSpec<T> = {
  name: keyof T;
  paramKey: string;
  enumValues?: ReadonlyArray<string>;
};

export function runSharedNormalizerTests<T>(args: {
  normalize: (input: Record<string, string | string[] | undefined>) => T;
  fields: ReadonlyArray<FieldSpec<T>>;
  describeName: string;
}): void {
  // describe(...) block that runs the shared cases for each field
}
```

Then each search-params test file imports the helper and invokes it with
the field list, replacing 12-21 tests with one call. Keep test cases that
verify file-specific schema (e.g., FR-8 stuck-state composite filters in
games-search-params, the `dateRange` `..` split in audit-search-params)
that aren't part of the shared contract.

### Verify

```bash
cd peek && pnpm test src/lib --reporter=basic 2>&1 | tail -5
```

Expect ~55 tests dropped from this directory. Then full verify:

```bash
cd peek && pnpm verify 2>&1 | tail -10
```

### Commit

```
test(lib): consolidate search-params normalizers behind a shared helper

7 search-params files re-tested the same trim/lowercase/array→first/
unknown-enum→null contract on different field names. Extracts that into
test-search-params-normalizer.ts; per-file tests now cover only the file-
specific schema (composite stuck-state filters, dateRange split, etc.).

Tier 2 of docs/specs/305-peek-operations-admin/test-simplification-plan.md.
```

### Push + root pointer

Same pattern as Tier 1.

---

## Tier 3 — Query-test duplication

**Estimated drop**: 130–170 tests. Confidence: **mostly safe** (per-file judgment calls).

### Goal

17 query test files have repetitive limit-clamping, empty-result, and
per-game/per-status duplication. Worst offenders:
- `get-challenges.test.ts` (55 → 28)
- `get-event-queue.test.ts` (38 → 18)
- `get-growth-referrals.test.ts` (32 → 14)
- `get-dogpile-and-fraud.test.ts` (32 → 13)
- `get-audit-events.test.ts` (30 → 14)

### Read first

- `peek/src/server/db/queries/get-challenges.ts` — biggest target source.
- `peek/src/server/db/queries/__tests__/get-challenges.test.ts` — biggest target test.
- `peek/src/server/db/queries/get-game-rounds.ts` (per-game duplication target).

### Scope

```
peek/src/server/db/queries/__tests__/*.test.ts
```

(17 files total. Skip `list-peek-users.test.ts` and `get-peek-summary.test.ts`
— already lean.)

### Pattern → Action

Process **one file at a time**, in this order (largest first):

1. `get-challenges.test.ts`
2. `get-event-queue.test.ts`
3. `get-growth-referrals.test.ts`
4. `get-dogpile-and-fraud.test.ts`
5. `get-audit-events.test.ts`
6. `get-game-rounds.test.ts`
7. `universal-search.test.ts`
8. `get-rewards.test.ts`
9. `get-points-and-crates.test.ts`
10. `get-peek-user-detail.test.ts`
11. `get-round-detail.test.ts`
12. `get-recent-operator-events.test.ts`
13. `get-games-overview.test.ts`
14. `get-command-center-attention.test.ts`
15. `telegram-linked-queries.test.ts`

For each file, look for these reduction patterns:

- **Limit clamping** (4 variants per query function — fold to 1 parametric):
  - "default limit X", "respects override Y", "clamps to MAX", "non-positive → 1"
  - Replace with a single test that walks `[{ given, expected }]` tuples.
- **Empty result** (often duplicated per query function in a multi-function file):
  - "empty rows → []", "null → 0 default" — keep one per function-family,
    drop per-function variants.
- **Per-game variations** (FlipYou / Pot Shot / Close Call running identical
  assertions): replace with a parametric loop over `PEEK_GAME_IDS`.
- **Per-status enum loops**: when 4-6 tests verify each status renders the
  right chip/coercion, fold to one parametric loop.
- **FR-4 metric bookkeeping snapshots** repeated for each metric in an
  overview: fold the 8-metric duplication into one structured assertion
  using `toEqual` over an array.

**Always keep**:
- SQL projection / WHERE-clause shape verification (proves schema match).
- Numeric coercion edge cases (string-from-pg → number, u64-as-text
  preservation, null → 0 fallback).
- Filter binding for non-trivial transforms (search wildcards, age-bucket
  windows, case-insensitive matching).
- FR-11 audit emit assertions (proves sensitive read fires the write).

### Verify

After each file, run:

```bash
cd peek && pnpm test src/server/db/queries --reporter=basic 2>&1 | tail -5
```

Confirm test count moved monotonically downward. After all 15 files:

```bash
cd peek && pnpm verify
```

### Commit

ONE commit per file (so a regression is easy to bisect):

```
test(query): tighten <query-name> tests

- Fold N limit-clamping cases into one parametric test
- Drop M empty-result duplicates (one per function-family kept)
- <other tier-3 patterns>

Tier 3 of test-simplification-plan.md (file P of 15).
```

### Push + root pointer

Push all 15 commits at the end of the tier (one push), then bump root
pointer once.

---

## Tier 4 — Mutation-schema boilerplate

**Estimated drop**: 60–70 tests. Confidence: **medium** (judgment calls).

### Goal

4 mutation test files (kol-rate, fraud-flag, dogpile, reward-config) have
~80 tests total; ~30 of them are Zod schema boilerplate (negative bounds,
trim, unknown fields, undefined values) that re-verify Zod itself. Keep the
mutation-specific business logic and let `runner.test.ts` cover the
transactional + audit contract.

### Read first

- `peek/src/server/mutations/runner.ts`
- `peek/src/server/mutations/__tests__/runner.test.ts` — keep all.
- `peek/src/server/mutations/kol-rate.ts`
- One representative, e.g. `peek/src/server/mutations/__tests__/kol-rate.test.ts`.

### Scope

```
peek/src/server/mutations/__tests__/
├── runner.test.ts          (KEEP ALL — 11 tests, foundational)
├── kol-rate.test.ts        (~15 → ~3-4)
├── fraud-flag.test.ts      (~18 → ~4-5)
├── dogpile.test.ts         (~17 → ~4-6)
└── reward-config.test.ts   (~32 → ~4-6)
```

### Pattern → Action

For each mutation test file, KEEP:
- One create-vs-update behavior test (e.g., kol-rate's SELECT FOR UPDATE
  → INSERT-or-UPDATE branching).
- The before/after diff filtering test (proves metadata fields like
  `set_by`, `updated_at` are excluded from the audit diff).
- The role-gating test (admin vs business denial).
- The mutation-specific business logic (e.g., fraud-flag's allowed-
  transition matrix; dogpile's state guard for past `starts_at`;
  reward-config's key allowlist + time-range validation).

DROP:
- Zod schema boilerplate ("rejects negative", "rejects empty after trim",
  "rejects unknown fields", "accepts boundary values 0 and N", "trims
  whitespace") — Zod's own tests cover these. The mutation's contract is
  what payload it persists, not how Zod parses input.
- Audit-payload shape tests that duplicate what runner.test.ts already
  verifies (every applied/rejected emit goes through the runner).

**Don't drop** action-id / resource-type wiring tests — those verify the
mutation registers correctly with `PEEK_ACTION_RULES` and the audit
writer. That's mutation-specific.

### Verify

```bash
cd peek && pnpm test src/server/mutations --reporter=basic 2>&1 | tail -5
```

Expect ~60-70 tests dropped. Full verify:

```bash
cd peek && pnpm verify
```

### Commit

ONE commit per mutation file:

```
test(mutations): drop Zod schema boilerplate from <mutation> tests

runner.test.ts already covers the transactional + audit contract for every
mutation. Per-mutation tests now focus on the business logic that's unique
to this mutation: <list specifics — state matrix / create-vs-update / key
allowlist / etc.>.

Tier 4 of test-simplification-plan.md (file P of 4).
```

### Push + root pointer

Push the 4 mutation commits together at the end, then bump root pointer.

---

## Tier 5 — Access-policy parsing duplication

**Estimated drop**: 18–22 tests. Confidence: **safe** (single file).

### Goal

`access-policy.test.ts` has 44 tests; ~20 are parsing-validator boilerplate
("drops invalid roles", "handles unicode by replacing it with dashes",
"de-duplicates exact pairs", "drops non-object items"). Keep the tests that
verify role resolution + wildcard matching + action/route lookup logic.

### Read first

- `peek/src/server/access-policy.ts`
- `peek/src/server/__tests__/access-policy.test.ts`

### Scope

Single file: `peek/src/server/__tests__/access-policy.test.ts`.

### Pattern → Action

KEEP:
- `parsePeekRolePolicy` — keep ONE happy-path test + ONE comprehensive
  "rejects invalid entry" test that walks through all rejection conditions
  (missing role, invalid role, missing match, malformed wildcard, dup) in
  one parametric loop.
- `resolveRoleForEmail` — keep all branching tests: exact match, wildcard
  match, admin precedence, case-insensitive, no-match.
- `getRequiredRolesForRoute` + `isRouteAllowedForRole` — keep all (route
  prefix specificity is non-trivial).
- `getRequiredRolesForAction` + `isActionAllowedForRole` — keep all (fail-
  closed is a security boundary).

DROP:
- Per-rejection-reason tests in `parsePeekRolePolicy` if they're
  one-test-per-cause — fold into one parametric loop.
- "trim whitespace" / "lowercase" tests on individual fields — keep one
  representative.
- Tests that verify `parsePeekRolePolicy(null) === []` and `parsePeekRolePolicy("string") === []` — these are
  trivial type guards. Keep one "rejects non-array".

### Verify

```bash
cd peek && pnpm test src/server/__tests__/access-policy --reporter=basic 2>&1 | tail -5
```

Expect ~20 tests dropped. Full verify:

```bash
cd peek && pnpm verify
```

### Commit

```
test(access-policy): consolidate parser-validation boilerplate

parsePeekRolePolicy validation tests collapsed into a parametric "rejects
invalid entries" loop. Role resolution, wildcard matching, route
specificity, and action fail-closed tests stay full-fat — those are real
security-boundary guards.

Tier 5 of test-simplification-plan.md.
```

### Push + root pointer

Same pattern as previous tiers.

---

## Progress

Tick the box and commit it as part of each tier's work.

- [ ] Tier 1 — cross-cutting duplication (~50–80 tests)
- [ ] Tier 2 — search-params helper (~55 tests)
- [ ] Tier 3 — query-test duplication (~130–170 tests)
- [ ] Tier 4 — mutation schema boilerplate (~60–70 tests)
- [ ] Tier 5 — access-policy parsing (~18–22 tests)

**Cumulative target**: ~1017 → ~600 tests. Coverage unchanged for every
non-obvious contract; type-system + Zod guarantees absorb the boilerplate
that's being dropped.

## Notes for the executor

- If `pnpm verify` fails after a tier, fix forward — don't pretend the
  failure was pre-existing. Even a typecheck failure from a stale import
  must be cleaned up.
- If a tier's drop count comes in materially lower than estimated (e.g.,
  Tier 1 drops only 20 instead of 50–80), STOP and write a note in this
  file's Progress section explaining why. Don't paper over discrepancies.
- The agents that produced these estimates didn't read every test body in
  full — your job in each tier is to confirm the agent's call is correct
  for that specific test before dropping it. When in doubt, keep.
- Do not change `peek/vitest.config.mts` or `peek/vitest.setup.ts`. Test
  infrastructure is out of scope for this cleanup.
