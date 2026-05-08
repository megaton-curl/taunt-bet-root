# 403 — Peek Visual Redesign (Phase 1: Foundation + Anchor Page)

## Background

`peek/` is the internal admin app (Next.js App Router, server components, direct Postgres queries). Today its styling is hand-rolled inline `style={{}}` objects and a tiny `globals.css` — slate-900 dark theme, scattered hex codes, no token system, no design language. It is functional but visually incoherent and difficult to iterate on, because every aesthetic change has to be hunted across dozens of files.

This spec covers **Phase 1** of a multi-phase redesign: install a token-driven styling stack, define a coherent visual language, and prove it end-to-end by redesigning the home/command-center page. Subsequent phases (per-page rollout, polish) get their own specs once Phase 1 lands.

## Goal

Establish a coherent, light-themed visual language for peek — anchored on a Stripe + Notion blend — and prove it works end-to-end on the home/command-center page. Deliver a token system, a small set of shadcn-based primitives, a redesigned `AdminShell`, a redesigned home page, a written design rubric, and a screenshot-based iteration loop that can be reused for subsequent pages.

The intent is not just to ship a redesigned home page, but to leave behind the *machinery* (tokens, primitives, rubric, loop) that makes Phase 2 mostly mechanical.

## Non-Goals

- **No information-architecture changes.** Nav structure, page boundaries, and the set of routes stay as-is. If IA gaps are obvious after the reskin, that is a separate conversation.
- **No client-side conversion.** peek stays server-rendered with co-located DB queries. No new `fetch()` calls from the browser, no React Query, no SPA-style routing. The handful of existing `"use client"` mutation forms keep their boundary.
- **No new interactivity.** URL-as-state via `<form method="get">` stays. No client-side filtering, sorting, or command palette in this phase.
- **No backend changes.** Schemas, queries, and API surfaces are untouched.
- **No other pages.** Only `AdminShell` + the home page (`app/page.tsx`) are redesigned. Other pages remain in their current state until Phase 2.
- **No webapp/waitlist work.** Out of scope per root CLAUDE.md.

## Constraints

- **Architecture:** Next.js App Router, server components first. Client boundary only where truly needed (existing mutation forms; possibly new form-state primitives in shadcn).
- **Verification gate:** `cd peek && pnpm verify` must pass (lint, typecheck, vitest, build).
- **No dependency added without checking the supply-chain age policy in root CLAUDE.md.** Use Tailwind 4.x stable and shadcn components copied in (not installed as a runtime dependency).
- **Visual changes must be screenshot-evidenced** via Playwright before being declared complete.
- **Work runs in a git worktree.** Parallel work is in flight on `dev` (root submodule pointers, waitlist, webapp). The redesign branches from `peek/dev` into an isolated worktree so it does not entangle with that WIP. Submodule pointer updates to root happen as a separate, explicit step after the redesign work merges in `peek/`.

## Design Reference

The target aesthetic is a blend of **Stripe Dashboard** and **Notion**:

- **From Stripe:** structural backbone — formal hierarchy, ruled section dividers, restrained palette, financial-grade table density and alignment, calm informational tone.
- **From Notion:** softness — generous whitespace, subtle borders over heavy lines, document-feeling pages, quiet typography, low chroma.

The combined feel is **calm, scannable, document-like, with strong tabular hierarchy**. Internal admin tools live in long staring sessions; the design must be quiet enough to disappear and let data speak.

**Theme:** light. Dark mode is not a goal in Phase 1. Tokens are structured so a dark theme could be added later by swapping CSS variable values, but no dark variants are produced in this phase.

**Explicitly rejected:** GitHub Primer (too spartan), Vercel/v0 (too ornamented for an admin tool), Linear (too keyboard-heavy and animation-rich for our SSR constraint).

## Stack Additions

- **Tailwind CSS 4.x** — utility classes, replaces inline `style={{}}` objects. Configured to consume the CSS-variable token system, not to embed colors directly.
- **shadcn/ui** — components copied into `peek/src/components/ui/`, owned by the repo, not a runtime dependency. Phase 1 uses: `Card`, `Table`, `Input`, `Button`, `Badge`, `Separator`, `Skeleton`, `Label`. Additional primitives added only as needed.
- **Native form controls, Tailwind-styled** — `<select>` and `<input type="checkbox">` stay native HTML elements styled via Tailwind utility classes (extracted as `peek/src/components/ui/native-select.tsx` and `native-checkbox.tsx` wrappers for consistency). Rationale: shadcn's `Select` and `Checkbox` are Radix client components and do not submit native values through standard form submission; peek relies on `<form method="get">` for URL-as-state filtering, so native controls are required.
- **Radix UI primitives** — pulled in transitively by shadcn for accessibility on interactive components. No direct authoring against Radix in Phase 1.
- **`class-variance-authority`** and **`tailwind-merge`** — shadcn dependencies, standard.
- **`lucide-react`** — icon set used by shadcn defaults. Adopted for consistency.

No CSS-in-JS library. No design-system framework beyond shadcn. No animation library.

## Token System

Tokens live as CSS variables on `:root` in `app/globals.css`, consumed via Tailwind's `@theme` directive (Tailwind 4 syntax) so utility classes like `bg-surface`, `text-muted-foreground`, etc. resolve to the variables.

**Color tokens** (light theme, OKLCH or hex, neutral-leaning, low chroma):

| Token | Purpose |
|---|---|
| `--background` | Page background |
| `--foreground` | Primary text |
| `--muted` | Subtle background (cards, table headers) |
| `--muted-foreground` | Secondary text, captions |
| `--border` | Default border, divider |
| `--input` | Input border |
| `--ring` | Focus ring |
| `--accent` | Hover surface, subtle highlight |
| `--accent-foreground` | Text on accent |
| `--primary` | Primary action (button, link) |
| `--primary-foreground` | Text on primary |
| `--destructive` | Error / dangerous action |
| `--destructive-foreground` | Text on destructive |
| `--success` | Success state, positive metric |
| `--warning` | Caution state |
| `--card` | Card surface |
| `--card-foreground` | Text on card |

**Spacing scale:** Tailwind default 4-based scale, no overrides. Page-level rhythm uses `gap-6` / `gap-8` consistently.

**Type scale:** Tailwind defaults with one explicit override — admin pages get a tighter line-height for table density. Headings use `font-semibold` not `font-bold` (Notion-flavored quietness). Section headings use small-caps tracking (already a pattern in the existing code; preserved as a class).

**Radii:** `--radius: 0.5rem` as the base, with `--radius-sm` (`0.25rem`) for inline controls and `--radius-lg` (`0.75rem`) for cards. No fully-rounded surfaces.

**Borders:** 1px hairline only. No drop shadows on resting cards (Notion-flavored). Subtle shadow on focus and on hover-elevated controls.

## Components Delivered

### `AdminShell` (redesigned)

Currently in `peek/src/components/admin-shell.tsx`. Reskinned to:

- Light surface, full-bleed top bar with brand on the left, identity on the right.
- Side navigation as a quiet vertical list, no chrome — Notion-flavored.
- Content frame with consistent `max-w` and padding rhythm.
- Access-denied and access-issue states preserved verbatim, restyled.

### Home page (`app/page.tsx`, redesigned)

The full screen refactored against the new primitives:

- **Page header** — title + dek, no decorative chrome.
- **Global search** — `Input` + `Button`, full-width, prominent but not noisy. Submitted state (with results) renders results in a `Card` below.
- **Attention queue** — replaces the current `MetricStrip` with a horizontally-scrolling row of `Card`s, each with a metric value, label, and severity `Badge`.
- **Platform summary** — quiet stat strip, four metrics, ruled section.
- **Recent activity** — vertical list inside a `Card`, monospace timestamps, muted-foreground meta text, restrained.
- **Users** — filter form rendered as a row of `Input`/`Select`/`Checkbox` controls with proper `Label`s; data rendered via `Table` primitive with zebra-free, hairline-bordered rows; pagination controls below table.

All interaction patterns preserved: `<form method="get">` for filter submission, URL-as-state, server-rendered data.

### shadcn primitives

Standard shadcn implementations of: `Card`, `Table`, `Input`, `Select`, `Button`, `Badge`, `Separator`, `Skeleton`, `Label`. Located at `peek/src/components/ui/<name>.tsx`. No bespoke modifications in Phase 1; we adopt the defaults to establish a baseline, then revise via the iteration loop if the rubric demands it.

## Seed Data (Visual Fixture)

Iterating on aesthetics requires reaching every visual state deterministically, with realistic data shape. The home page alone has six states (loading, error-per-section, empty-search, populated-search, no-users, paginated-users); subsequent peek pages have many more. A test-flavored fixture isn't enough — we need a populated, *realistic* dataset that covers the full peek-visible domain.

We introduce a **dedicated visual-fixture seed**, separate from existing test fixtures and from prod, that:

- Lives at `peek/scripts/seed-visual-fixture.ts` and writes to a dedicated database (env: `PEEK_VISUAL_DB_URL`, separate from prod and from CI test DB).
- Is **idempotent** — running it twice resets the dataset cleanly, no migration drift.
- Is **deterministic** — fixed RNG seed, so screenshots are reproducible across machines.
- Uses **realistic-but-fake data** — generated wallet addresses (valid base58, no provenance), generated usernames, fake transaction signatures, fabricated referral codes. Nothing from prod, nothing from real users.
- Is **not wired into CI** — it is an operator tool for visual iteration. Existing test fixtures (vitest, Playwright unit specs) are untouched.
- Has a README at `peek/scripts/README-visual-fixture.md` documenting how to provision the fixture DB, run migrations, and point a local peek dev server at it.

### Scope of the seed

Although Phase 1 only redesigns the home page, the seed is built to populate the **full peek-visible domain** so it serves Phase 2 unchanged. The seed populates:

- **Users (~120)** — realistic skew on referral counts (most have 0, a long tail with 1-50, a few with hundreds). Mix of with/without referrer, with/without referees, with/without referral code, with/without Telegram. Edge cases: very long username, missing wallet, bidi/RTL text, emoji.
- **Referral graph** — multi-level chains, cycles excluded, includes a few "high-value referrer" examples for the attention queue.
- **Matches** across all three games (flip-you, close-call, pot-shot) — mix of completed, in-flight, refunded, settled with payout, settled without payout. Varied wager amounts.
- **Transactions** — deposits, withdrawals, payouts, fee transfers. Mix of confirmed, pending, failed.
- **Attention queue items** — populated mix of severities (info / warning / urgent) so the strip renders all states.
- **Operator/audit events** — recent activity feed populated with a varied mix of operator actions, access denials, mutation events.
- **Reward economy** — challenges, claims (approved, pending, rejected), reward configs, rate overrides.
- **Growth overrides** — a small set of active and expired overrides for the `/growth/overrides` page.
- **Operations data** — payout queue items in various states (queued, paused, in-review, dispatched), fraud flags, dogpile cancellations.

The seed is a single TypeScript module exposing one entrypoint (`seed()`) that runs migrations against `PEEK_VISUAL_DB_URL`, truncates all tables, and inserts the full dataset. ~30s expected runtime.

Phase 1 uses this as the sole source for all baseline and target screenshots; Phase 2 reuses it without modification.

## Design Rubric

Committed as `peek/DESIGN_RUBRIC.md`. Concrete pass/fail checks applied during iteration on each page. Phase 1 establishes the rubric; subsequent phases reuse it.

1. **Hierarchy** — page has one primary heading, sections have visually distinct headings, no two headings at the same level look the same weight.
2. **Spacing rhythm** — vertical gaps between sections all come from one of `gap-6` / `gap-8` / `gap-10`. No arbitrary `mt-*` or inline margins.
3. **Alignment grid** — all left edges within a section share an x-coordinate. Right-aligned numeric columns share a right edge.
4. **Type scale** — the page uses no more than 4 distinct font sizes. No mixed weights within a single visual group.
5. **Color restraint** — color is used to mean something (primary action, status, severity). No decorative color. Saturated color appears at most twice per visible viewport.
6. **Density consistency** — table row height, card padding, and form-field height each have one canonical value, used everywhere on the page.
7. **State coverage** — every data-bearing element has explicit empty, loading, and error treatments. No silent blank states.
8. **Affordance clarity** — every interactive element looks interactive (hover state, cursor, focus ring). Nothing non-interactive looks interactive.
9. **Scannability** — the page can be parsed in 5 seconds: what is this, what's important right now, what can I do.
10. **Quietness** — no element draws attention without earning it. Decorative dividers, ornamental icons, and decorative gradients are absent.

A page is "rubric-green" only when all 10 items pass. The rubric is a checklist, not a score.

## Iteration Methodology

The point of this spec is not just to ship a redesigned page — it is to set up a loop that makes future visual work tractable. The loop is designed to **minimize human-in-loop iterations** by stacking automated and machine-judgable checks ahead of the human gate, so the user only sees the work when it has plausibly converged.

### Loop steps

1. **Seed.** Reset the visual-fixture DB via `peek/scripts/seed-visual-fixture.ts`. All snapshots draw from this dataset — deterministic.
2. **Capture baseline.** Playwright captures full-page screenshots of the home page (viewport widths: 1280, 1440, 1920) and each of the six home-page states (loading, error, empty-search, populated-search, no-users, paginated-users) into `peek/e2e/visual/baseline/`.
3. **Critique baseline against rubric.** Written critique committed to `docs/specs/403-peek-visual-redesign/critique-baseline.md`. Each rubric item gets a pass/fail and a one-line rationale. Critique combines three sources (see "Automated critique stack" below).
4. **Implement changes.** Foundation (Tailwind + shadcn + tokens), `AdminShell` port, then home page port.
5. **Capture target.** Same Playwright snapshot run, output to `peek/e2e/visual/target/`.
6. **Critique target against rubric.** Same combined-source format. If any rubric item is still failing, **iterate**: identify the highest-impact failure, patch, recapture, recritique. **Cap: 3 iteration rounds before checking in with the user.** If we hit the cap with rubric items still failing, stop and ask.
7. **User signoff (sole human gate).** Final target screenshots presented to the user for explicit approval. No "looks good to me" unilateral declarations.
8. **Commit + verify.** `cd peek && pnpm verify` returns exit 0. Screenshots committed alongside the spec.

This loop is documented in `peek/DESIGN_RUBRIC.md` so it can be reused for Phase 2.

### Automated critique stack

Each critique combines three machine-judgable sources, in increasing order of subjectivity. A rubric item passes only if all applicable sources agree.

- **Structural rubric checks** (deterministic, scriptable). A small Node script (`peek/scripts/critique-structural.ts`) parses the rendered DOM (via Playwright) and reports concrete violations of the mechanically-checkable rubric items: number of distinct font sizes per page, number of distinct color values, number of distinct spacing values used vertically, presence of inline `style=` attributes, count of empty/loading/error states present, focus-ring presence on every interactive element, alignment-grid violations (left-edge x-coordinates that fall within 4px tolerance bins).
- **General-quality lint via `@axe-core/playwright`** (deterministic, augmenting only). Run on each captured state. Used to catch *usability* bugs that overlap with accessibility-violation categories — missing form labels, focus management gaps, hard-to-read contrast, missing button accessible names. **Not** treated as a WCAG compliance gate; peek is an internal tool used by able operators, and we do not pass/fail rubric items on conformance to AA. Axe results are advisory: surfaced in the critique report so we can fix obvious quality bugs, but they do not block iteration. If contrast is 4.3 instead of 4.5, that is fine.
- **LLM-as-judge vision pass** (subjective but deterministic per model+prompt). Each captured screenshot is sent through a Claude vision pass with the rubric in the prompt and asked to render a structured pass/fail per item with one-line rationale. The prompt is kept versioned at `peek/scripts/critique-vision-prompt.md`. The judge is an *advisory* signal on items 1, 2, 5, 9, 10 (where structural checks cannot reach taste-flavored properties); for items 3, 4, 6, 7, 8 the structural checks are authoritative.

A rubric item is "passing" only when every applicable source reports pass. Disagreements are recorded; the structural source wins on its authoritative items (3, 4, 6, 7, 8), the vision pass wins on its authoritative items (1, 2, 5, 9, 10), and the axe lint never blocks an item but its findings are listed in the critique report for separate action.

This stack means typical iteration rounds happen entirely without human input. The human gate (step 7) is reached only when the stacked critique reports all rubric items green — and the human's job is then a single taste judgment, not a critique pass.

### Adjusting the vision-judge

The vision-judge prompt is versioned at `peek/scripts/critique-vision-prompt.md` and committed alongside spec artifacts. There is no formal calibration round in Phase 1; the vision pass is treated as advisory from the first round. If at the human-signoff gate the user disagrees with the judge (the judge passed something the user fails, or vice versa), the prompt is revised in-place and the affected rubric item gets re-evaluated. The judge improves through human-gate feedback rather than upfront calibration — cheaper to start, accepts that the first few human gates may surface judge-prompt issues.

## Acceptance Criteria

- [ ] Tailwind 4.x installed and configured in `peek/` with `@theme` consuming CSS-variable tokens.
- [ ] `peek/app/globals.css` defines the full token set listed above (light theme).
- [ ] shadcn primitives `Card`, `Table`, `Input`, `Button`, `Badge`, `Separator`, `Skeleton`, `Label` exist at `peek/src/components/ui/`.
- [ ] Native-control wrappers `native-select.tsx` and `native-checkbox.tsx` exist at `peek/src/components/ui/`, applying token-driven Tailwind styling without breaking GET-form submission.
- [ ] `AdminShell` redesigned against the new aesthetic, all existing access-issue states preserved.
- [ ] `app/page.tsx` (home/command-center) fully redesigned against the new primitives. All current functionality preserved (search, attention, summary, activity, users table, filters, pagination).
- [ ] All inline `style={{}}` objects in the home page and `AdminShell` removed; styling expressed via Tailwind classes.
- [ ] `peek/DESIGN_RUBRIC.md` committed with the 10-item rubric and the iteration loop documentation.
- [ ] Visual-fixture seed script `peek/scripts/seed-visual-fixture.ts` and its README committed; produces deterministic dataset covering all six home-page states.
- [ ] Structural critique script `peek/scripts/critique-structural.ts` and vision-judge prompt `peek/scripts/critique-vision-prompt.md` committed.
- [ ] `@axe-core/playwright` integrated into the critique runner as an advisory quality lint (no WCAG-conformance gate).
- [ ] Playwright visual snapshots captured at three widths × six states, baseline + target, committed to `peek/e2e/visual/`.
- [ ] Written rubric critique of baseline AND target (combined structural + a11y + vision-judge) committed under `docs/specs/403-peek-visual-redesign/`.
- [ ] All 10 rubric items pass on the target home page (or, if not, the gap is documented and explicitly accepted by the user).
- [ ] `cd peek && pnpm verify` returns exit 0.
- [ ] User has reviewed final target screenshots and signed off.
- [ ] Work is on its own branch in a worktree; `peek/dev` and root `dev` pointer updates happen as a separate, explicit merge step at the end.

## Risks and Open Questions

- **shadcn defaults may not match the Stripe/Notion blend out of the box.** They lean Linear-ish. Mitigation: the iteration loop is the answer — adopt defaults, critique, revise. Do not pre-emptively fork shadcn primitives.
- **Tailwind 4 is recent.** Verify the version resolves cleanly with Next 16 in the lockfile before committing the foundation. If incompatible, fall back to Tailwind 3.x with `tailwind.config.ts`.
- **Playwright visual snapshots may be flaky** under font rendering or viewport differences. Mitigation: full-page screenshots only, fixed viewport, deterministic data via existing test fixtures.
- **The home page has many states** (loading, error per section, empty search, populated search, no users, paginated users). The visual-fixture seed addresses this — each state must have at least one captured screenshot per width.
- **Icon adoption (`lucide-react`)** introduces a new visible idiom. Use icons sparingly in Phase 1 — only where they materially aid scannability (e.g., severity on attention-queue cards). Do not decorate.
- **LLM-as-judge reliability.** A vision-pass judge can be over-charitable, sycophantic, or systematically wrong on certain rubric dimensions. There is no upfront calibration in Phase 1 — we trust the judge advisorily and revise the prompt at the human gate when its output disagrees with operator taste. If after a few iterations the judge is consistently unreliable on a given rubric item, that item falls back to "human-only" until the prompt is revised. The judge is advisory by design and never blocks the human.
- **Visual-fixture DB drift.** Schema changes in backend migrations could break the seed script. The seed lives in `peek/`, but it queries Postgres with the current schema; mitigation is to run the seed on every iteration loop (idempotent) and treat seed failure as a hard stop.
- **Worktree merge friction.** If `peek/dev` advances significantly during the redesign window, integration may require a non-trivial merge. Mitigation: keep iteration cycles short, rebase the worktree branch onto `peek/dev` before each significant push.

## Out-of-Scope Items (For Phase 2 or Later)

- Redesign of `/users`, `/games`, `/access`, `/audit`, `/growth/overrides`, and operations pages.
- Command palette / global keyboard shortcuts.
- Dark theme.
- Information-architecture changes.
- Client-side interactivity beyond what already exists.
- Webapp or waitlist visual changes.
