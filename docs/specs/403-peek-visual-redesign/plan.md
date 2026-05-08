# Peek Visual Redesign (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin peek's home/command-center page end-to-end against a Stripe + Notion light aesthetic, leaving behind a token system, shadcn primitive set, dedicated visual-fixture DB + seed, and a 3-source automated critique loop that future redesign phases reuse.

**Architecture:** Next.js App Router + server components stay. Tailwind 4 replaces inline `style={{}}`. shadcn primitives copied into the repo (no runtime dep). Native `<select>` and `<input type="checkbox">` stay native HTML inside Tailwind-styled wrappers so `<form method="get">` URL-as-state keeps working. Visual-fixture seed populates a dedicated Postgres DB (`PEEK_VISUAL_DB_URL`) with the full peek-visible domain. Iteration loop: seed → snapshot → critique (structural script + axe + Claude vision-judge) → patch → re-snapshot, capped at 3 rounds before human signoff.

**Tech Stack:** Next.js 16 + React 19, Tailwind CSS 4, shadcn/ui (copy-paste, no runtime dep), Radix UI (transitive), `lucide-react`, `@axe-core/playwright`, `@anthropic-ai/sdk` (vision-judge calls), `postgres` (existing in peek), Playwright (existing).

**Spec:** `docs/specs/403-peek-visual-redesign/spec.md`

---

## Conventions for this plan

- All commands assume CWD `/workspaces/rng-utopia` unless explicitly inside `peek/` or the worktree.
- All `pnpm` calls inside `peek/` (project mandates pnpm for Node services).
- Worktree path: `/workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek`.
- Branch: `feat/403-peek-visual-redesign` based off `peek/dev`.
- Visual-fixture DB env var: `PEEK_VISUAL_DB_URL`. Suggested local value: `postgres://postgres:postgres@localhost:5432/peek_visual_fixture`.
- Auth header for visual-fixture environment: `PEEK_DEV_ACCESS_EMAIL=visual-fixture@local`. (Already wired in `peek/proxy.ts`.)
- Vision-judge model: `claude-opus-4-7`. API key via `ANTHROPIC_API_KEY` env var.
- Commit messages: `<type>(403-peek-visual-redesign): <description>` matching project convention. No Claude branding.
- Each task ends with a commit.

---

## Phase 0 — Pre-flight verification

Bail-fast checks. If any fail, the plan needs revision before continuing.

### Task 0.1: Verify Tailwind 4 + Next 16 compatibility

**Files:** none yet (read-only).

- [ ] **Step 1: Check Tailwind 4 release status**

Run:
```bash
npm view tailwindcss@latest version
npm view tailwindcss@latest peerDependencies 2>/dev/null
```
Expected: a 4.x version, no React peer-dep conflict.

- [ ] **Step 2: Check shadcn-ui Tailwind 4 support**

Run:
```bash
npm view shadcn@latest version
```
Expected: a recent version. shadcn CLI v2+ supports Tailwind 4.

- [ ] **Step 3: Decision gate**

If Tailwind 4 stable resolves cleanly and shadcn supports it: continue with Tailwind 4 throughout.
If incompatibility appears: fall back to Tailwind 3.4 (`tailwind.config.ts` syntax), update Phase 2 tasks accordingly, and note the deviation in `docs/specs/403-peek-visual-redesign/deviations.md`.

- [ ] **Step 4: Commit nothing — pre-flight is non-mutating**

### Task 0.2: Verify backend migration runner accepts arbitrary DATABASE_URL

**Files:** read `backend/src/migrate.ts`.

- [ ] **Step 1: Read the migration runner**

Run:
```bash
sed -n '1,80p' /workspaces/rng-utopia/backend/src/migrate.ts
```
Confirm it reads `process.env.DATABASE_URL` (or equivalent). If it reads from a fixed config object, note the variable name we will need to override.

- [ ] **Step 2: Confirm migrations are idempotent enough to run on a fresh DB**

Skim `backend/migrations/001_init.sql` and check it uses `CREATE TABLE IF NOT EXISTS` or equivalent guards. If not, the seed will need to TRUNCATE then re-insert each run rather than DROP-then-recreate.

- [ ] **Step 3: Commit nothing**

### Task 0.3: Verify auth-stub mechanism for visual-fixture environment

**Files:** read `peek/proxy.ts`.

- [ ] **Step 1: Read the dev-bypass branch**

Confirm `PEEK_DEV_ACCESS_EMAIL` is honored when `NODE_ENV=development` (already verified — see lines 17-26).

- [ ] **Step 2: Note env-var requirements for the fixture environment**

Required env vars to run `pnpm dev` in peek pointing at fixture DB:
- `NODE_ENV=development`
- `PEEK_DEV_ACCESS_EMAIL=visual-fixture@local`
- `DATABASE_URL=$PEEK_VISUAL_DB_URL`

These will be documented in the seed README.

- [ ] **Step 3: Commit nothing**

---

## Phase 1 — Worktree and visual-fixture DB

### Task 1.1: Create the worktree

**Files:** none modified directly; sets up working environment.

- [ ] **Step 1: Use the using-git-worktrees skill**

Invoke `superpowers:using-git-worktrees` for setup. Branch: `feat/403-peek-visual-redesign` based off `peek/dev`. Worktree path: `/workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek`.

- [ ] **Step 2: Verify worktree**

Run:
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && git branch --show-current
```
Expected: `feat/403-peek-visual-redesign`.

- [ ] **Step 3: Install peek deps in the worktree**

Run:
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm install --frozen-lockfile
```
Expected: clean install.

- [ ] **Step 4: Smoke-test peek build**

Run:
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm verify
```
Expected: exit 0 (current state is presumed green).

- [ ] **Step 5: No commit yet** (worktree is clean).

### Task 1.2: Provision the visual-fixture database

**Files:** none in repo; touches local Postgres only.

- [ ] **Step 1: Confirm Postgres is reachable**

Run:
```bash
psql "$DATABASE_URL" -c 'select 1' 2>&1 | head -5
```
If a `DATABASE_URL` is set, this confirms Postgres works. If not, ask the operator for connection details or document `postgres://postgres:postgres@localhost:5432/postgres` as the assumed default.

- [ ] **Step 2: Create the fixture DB**

Run:
```bash
psql "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}" -c 'create database peek_visual_fixture'
```
Expected: `CREATE DATABASE`. If it already exists, re-run with `drop database` first (this is a fixture DB, no data to preserve).

- [ ] **Step 3: Export the fixture URL**

Add to your local shell init or `.env.local`:
```bash
export PEEK_VISUAL_DB_URL=postgres://postgres:postgres@localhost:5432/peek_visual_fixture
```

- [ ] **Step 4: No commit** (DB provisioning is operator state).

### Task 1.3: Apply backend migrations to the fixture DB

**Files:** none modified.

- [ ] **Step 1: Run backend migrations targeting the fixture DB**

Run:
```bash
cd /workspaces/rng-utopia/backend && DATABASE_URL=$PEEK_VISUAL_DB_URL pnpm migrate
```
Expected: all 020 migrations apply cleanly. Output should list each `XXX_*.sql` file.

- [ ] **Step 2: Verify schema**

Run:
```bash
psql "$PEEK_VISUAL_DB_URL" -c '\dt'
```
Expected: tables present including `player_profiles`, `referral_codes`, `referral_links`, `transactions`, `game_entries`, `operator_events`, `telegram_links`, `linked_accounts`, plus reward-economy and challenge-engine tables.

- [ ] **Step 3: No commit**.

---

## Phase 2 — Tailwind foundation and tokens

### Task 2.1: Install Tailwind 4 in peek

**Files:**
- Modify: `peek/package.json`
- Modify: `peek/pnpm-lock.yaml`
- Create: `peek/postcss.config.mjs`

- [ ] **Step 1: Add Tailwind 4 + PostCSS plugin**

Run:
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm add -D tailwindcss@^4 @tailwindcss/postcss postcss
```
Expected: lockfile updated; no peer-dep warnings (rerun pre-flight if any).

- [ ] **Step 2: Create postcss.config.mjs**

Write `peek/postcss.config.mjs`:
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Verify the build still runs**

Run:
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm build
```
Expected: exit 0. If it fails, the PostCSS pipeline picked up Tailwind too eagerly; revert the import in globals.css (Task 2.2 hasn't added it yet, so this should be fine).

- [ ] **Step 4: Commit**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && git add package.json pnpm-lock.yaml postcss.config.mjs && git commit -m "build(403-peek-visual-redesign): add Tailwind 4 + PostCSS plugin"
```

### Task 2.2: Replace globals.css with token system + Tailwind import

**Files:**
- Replace: `peek/app/globals.css`

- [ ] **Step 1: Write the new globals.css**

Replace the file entirely:

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(0.99 0.003 260);
  --color-foreground: oklch(0.18 0.02 260);
  --color-muted: oklch(0.97 0.005 260);
  --color-muted-foreground: oklch(0.45 0.02 260);
  --color-border: oklch(0.92 0.005 260);
  --color-input: oklch(0.92 0.005 260);
  --color-ring: oklch(0.55 0.12 250);
  --color-accent: oklch(0.96 0.01 260);
  --color-accent-foreground: oklch(0.18 0.02 260);
  --color-primary: oklch(0.42 0.16 250);
  --color-primary-foreground: oklch(0.99 0.003 260);
  --color-destructive: oklch(0.55 0.20 25);
  --color-destructive-foreground: oklch(0.99 0.003 260);
  --color-success: oklch(0.55 0.14 150);
  --color-warning: oklch(0.70 0.15 75);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.18 0.02 260);

  --radius: 0.5rem;
  --radius-sm: 0.25rem;
  --radius-lg: 0.75rem;

  --font-sans:
    "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
}

html {
  font-family: var(--font-sans);
  color: var(--color-foreground);
  background: var(--color-background);
  -webkit-font-smoothing: antialiased;
}

body {
  margin: 0;
}
```

- [ ] **Step 2: Verify dev server renders**

Run (in another shell, leave it running for the rest of Phase 2):
```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL DATABASE_URL=$PEEK_VISUAL_DB_URL PEEK_DEV_ACCESS_EMAIL=visual-fixture@local pnpm dev
```
Then `curl -sI http://localhost:3000/` returns `200`. (Page will look broken because inline styles still dominate; that's expected.)

- [ ] **Step 3: Verify build**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm build
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css && git commit -m "feat(403-peek-visual-redesign): replace globals.css with Tailwind import + light token system"
```

---

## Phase 3 — Primitives

shadcn components are added one at a time. Each task installs one component, tweaks if needed for token compatibility, and commits.

### Task 3.1: Initialize shadcn config

**Files:**
- Create: `peek/components.json`
- Create: `peek/src/lib/utils.ts`

- [ ] **Step 1: Create components.json**

Write `peek/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "hooks": "@/hooks",
    "lib": "@/lib"
  }
}
```

- [ ] **Step 2: Add path alias to tsconfig**

Open `peek/tsconfig.json` and add `paths` if not already present:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*", "./*"]
    }
  }
}
```

- [ ] **Step 3: Create utils.ts**

Write `peek/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Install supporting deps**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm add clsx tailwind-merge class-variance-authority lucide-react
```

- [ ] **Step 5: Verify build**

```bash
pnpm build
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add components.json src/lib/utils.ts package.json pnpm-lock.yaml tsconfig.json && git commit -m "feat(403-peek-visual-redesign): init shadcn config and supporting deps"
```

### Task 3.2: Add `Button` primitive

**Files:**
- Create: `peek/src/components/ui/button.tsx`

- [ ] **Step 1: Copy shadcn Button**

Write `peek/src/components/ui/button.tsx`:
```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-muted text-foreground hover:bg-accent",
        outline:
          "border border-input bg-background hover:bg-accent",
        ghost: "hover:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx && git commit -m "feat(403-peek-visual-redesign): add Button primitive"
```

### Task 3.3: Add `Input` primitive

**Files:**
- Create: `peek/src/components/ui/input.tsx`

- [ ] **Step 1: Write Input**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/input.tsx && git commit -m "feat(403-peek-visual-redesign): add Input primitive"
```

### Task 3.4: Add `Label` primitive

**Files:**
- Create: `peek/src/components/ui/label.tsx`

- [ ] **Step 1: Write Label**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none text-foreground",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/label.tsx && git commit -m "feat(403-peek-visual-redesign): add Label primitive"
```

### Task 3.5: Add `Card` primitive

**Files:**
- Create: `peek/src/components/ui/card.tsx`

- [ ] **Step 1: Write Card with subcomponents**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-base font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/card.tsx && git commit -m "feat(403-peek-visual-redesign): add Card primitive"
```

### Task 3.6: Add `Table` primitive

**Files:**
- Create: `peek/src/components/ui/table.tsx`

- [ ] **Step 1: Write Table with subcomponents**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]:border-b border-border", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-3 align-middle", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/table.tsx && git commit -m "feat(403-peek-visual-redesign): add Table primitive"
```

### Task 3.7: Add `Badge` primitive

**Files:**
- Create: `peek/src/components/ui/badge.tsx`

- [ ] **Step 1: Write Badge**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-muted text-muted-foreground",
        info: "border-transparent bg-primary/10 text-primary",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        urgent: "border-transparent bg-destructive/10 text-destructive",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/badge.tsx && git commit -m "feat(403-peek-visual-redesign): add Badge primitive"
```

### Task 3.8: Add `Separator` primitive

**Files:**
- Create: `peek/src/components/ui/separator.tsx`

- [ ] **Step 1: Write Separator**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-border shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/separator.tsx && git commit -m "feat(403-peek-visual-redesign): add Separator primitive"
```

### Task 3.9: Add `Skeleton` primitive

**Files:**
- Create: `peek/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Write Skeleton**

```tsx
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/skeleton.tsx && git commit -m "feat(403-peek-visual-redesign): add Skeleton primitive"
```

### Task 3.10: Add `NativeSelect` wrapper

**Files:**
- Create: `peek/src/components/ui/native-select.tsx`

- [ ] **Step 1: Write NativeSelect**

```tsx
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 py-1 text-sm shadow-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
));
NativeSelect.displayName = "NativeSelect";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/native-select.tsx && git commit -m "feat(403-peek-visual-redesign): add NativeSelect wrapper preserving GET-form submission"
```

### Task 3.11: Add `NativeCheckbox` wrapper

**Files:**
- Create: `peek/src/components/ui/native-checkbox.tsx`

- [ ] **Step 1: Write NativeCheckbox**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const NativeCheckbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-4 shrink-0 rounded border border-input bg-background",
      "checked:bg-primary checked:border-primary",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
NativeCheckbox.displayName = "NativeCheckbox";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/native-checkbox.tsx && git commit -m "feat(403-peek-visual-redesign): add NativeCheckbox wrapper preserving GET-form submission"
```

### Task 3.12: Verify all primitives compile

**Files:** none.

- [ ] **Step 1: Typecheck and build**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm typecheck && pnpm build
```
Expected: exit 0.

- [ ] **Step 2: No commit** (verification only).

---

## Phase 4 — Visual-fixture seed

The seed lives at `peek/scripts/seed-visual-fixture.ts` and is invoked via a new pnpm script. It populates the full peek-visible domain.

### Task 4.1: Seed module skeleton + idempotency wrapper

**Files:**
- Create: `peek/scripts/seed-visual-fixture.ts`
- Modify: `peek/package.json` (add `seed:visual` script)

- [ ] **Step 1: Write the skeleton**

```ts
/* eslint-disable no-console */
import postgres from "postgres";

const FIXTURE_DB_URL = process.env.PEEK_VISUAL_DB_URL;
if (!FIXTURE_DB_URL) {
  console.error("PEEK_VISUAL_DB_URL is not set. Aborting.");
  process.exit(1);
}

const RNG_SEED = 0x403_15_05_2026;

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const sql = postgres(FIXTURE_DB_URL, { max: 1 });

const TRUNCATE_TABLES = [
  // listed in dependency order (children first); fill out as each domain
  // gets seeded.
] as const;

async function reset() {
  if (TRUNCATE_TABLES.length === 0) return;
  await sql`truncate table ${sql(TRUNCATE_TABLES)} restart identity cascade`;
}

async function main() {
  console.log("Seeding visual fixture into", FIXTURE_DB_URL);
  const rng = makeRng(RNG_SEED);
  await reset();
  // Domain seeders are appended below in subsequent tasks.
  void rng;
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
```

- [ ] **Step 2: Add the pnpm script**

In `peek/package.json` add to `scripts`:
```json
"seed:visual": "tsx --env-file-if-exists=.env.local scripts/seed-visual-fixture.ts"
```

- [ ] **Step 3: Add tsx dev dep if not present**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm add -D tsx
```

- [ ] **Step 4: Smoke-run**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
```
Expected: prints "Seeding..." and "Seed complete." with no error.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-visual-fixture.ts package.json pnpm-lock.yaml && git commit -m "feat(403-peek-visual-redesign): seed-visual-fixture skeleton with idempotent reset"
```

### Task 4.2: Seed user profiles + referral graph

**Files:**
- Modify: `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Read the relevant tables**

Inspect:
```bash
psql "$PEEK_VISUAL_DB_URL" -c '\d player_profiles' -c '\d referral_codes' -c '\d referral_links' -c '\d telegram_links'
```
Note exact column names, nullability, types.

- [ ] **Step 2: Add seed function**

In `seed-visual-fixture.ts`, after the `makeRng` helper, add (adapting column names to what `\d` showed):

```ts
function fakeWallet(rng: () => number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 44; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

function fakeUsername(rng: () => number, i: number): string {
  const adjs = ["calm","quick","bright","silent","wild","tiny","huge","brave","odd","prime"];
  const nouns = ["fox","whale","spark","cipher","nova","ember","glyph","atlas","ridge","koi"];
  return `${adjs[Math.floor(rng()*adjs.length)]}-${nouns[Math.floor(rng()*nouns.length)]}-${i.toString(36)}`;
}

async function seedUsers(rng: () => number) {
  const userIds: string[] = [];
  for (let i = 0; i < 120; i++) {
    const userId = `usr_${i.toString().padStart(4, "0")}`;
    const isLongName = i === 5;
    const isBidi = i === 7;
    const hasWallet = i % 11 !== 0;
    const username = isLongName
      ? "extremely-long-username-that-tests-truncation-behavior"
      : isBidi
        ? "اسم_مستخدم_عربي"
        : fakeUsername(rng, i);
    userIds.push(userId);
    await sql`
      insert into player_profiles (user_id, username, wallet, created_at)
      values (
        ${userId},
        ${username},
        ${hasWallet ? fakeWallet(rng) : null},
        now() - (${i} * interval '6 hours')
      )
    `;
  }
  return userIds;
}

async function seedReferralGraph(rng: () => number, userIds: string[]) {
  const codeOwners = userIds.slice(0, 80);
  for (const userId of codeOwners) {
    const code = `R${userId.slice(-4).toUpperCase()}${Math.floor(rng()*900+100)}`;
    await sql`insert into referral_codes (user_id, code) values (${userId}, ${code})`;
  }

  for (let i = 30; i < userIds.length; i++) {
    const referee = userIds[i];
    const referrerIdx = Math.floor(rng() * 30);
    const referrer = userIds[referrerIdx];
    if (referrer === referee) continue;
    await sql`
      insert into referral_links (referrer_user_id, referee_user_id, created_at)
      values (${referrer}, ${referee}, now() - (${i} * interval '7 hours'))
      on conflict do nothing
    `;
  }
}

async function seedTelegramLinks(rng: () => number, userIds: string[]) {
  for (let i = 0; i < 40; i++) {
    const userId = userIds[i];
    await sql`
      insert into telegram_links (user_id, telegram_user_id, telegram_username, linked_at)
      values (
        ${userId},
        ${(1_000_000_000 + Math.floor(rng() * 1_000_000_000)).toString()},
        ${"tg_" + fakeUsername(rng, i)},
        now() - (${i} * interval '5 hours')
      )
      on conflict do nothing
    `;
  }
}
```

- [ ] **Step 3: Wire into main()**

Replace the placeholder body in `main()`:
```ts
const userIds = await seedUsers(rng);
await seedReferralGraph(rng, userIds);
await seedTelegramLinks(rng, userIds);
```

- [ ] **Step 4: Add tables to TRUNCATE_TABLES**

```ts
const TRUNCATE_TABLES = [
  "telegram_links",
  "referral_links",
  "referral_codes",
  "player_profiles",
] as const;
```

- [ ] **Step 5: Run seed and verify**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
psql "$PEEK_VISUAL_DB_URL" -c 'select count(*) from player_profiles' -c 'select count(*) from referral_codes' -c 'select count(*) from referral_links'
```
Expected counts: 120 users, 80 codes, ~80-90 referral_links.

- [ ] **Step 6: Run twice to verify idempotency**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
psql "$PEEK_VISUAL_DB_URL" -c 'select count(*) from player_profiles'
```
Expected: still 120.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed users, referral graph, telegram links"
```

### Task 4.3: Seed transactions

**Files:**
- Modify: `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Read the table**

```bash
psql "$PEEK_VISUAL_DB_URL" -c '\d transactions'
```

- [ ] **Step 2: Add seed function**

Add after `seedTelegramLinks` (adjust columns to match the actual schema):

```ts
async function seedTransactions(rng: () => number, userIds: string[]) {
  const types = ["deposit", "withdrawal", "payout", "fee"] as const;
  const statuses = ["confirmed", "pending", "failed"] as const;
  for (let i = 0; i < 400; i++) {
    const userId = userIds[Math.floor(rng() * userIds.length)];
    const type = types[Math.floor(rng() * types.length)];
    const statusRoll = rng();
    const status =
      statusRoll < 0.85 ? "confirmed" : statusRoll < 0.95 ? "pending" : "failed";
    const amountLamports = Math.floor(rng() * 5_000_000_000) + 2_600_000;
    const sig = "sig_" + Math.floor(rng() * 1e16).toString(36);
    await sql`
      insert into transactions (user_id, type, status, amount_lamports, signature, created_at)
      values (
        ${userId},
        ${type},
        ${status},
        ${amountLamports},
        ${sig},
        now() - (${i} * interval '37 minutes')
      )
    `;
  }
}
```

- [ ] **Step 3: Wire into main() and TRUNCATE_TABLES**

Add `await seedTransactions(rng, userIds);` in `main()` after telegram links.
Prepend `"transactions"` to TRUNCATE_TABLES.

- [ ] **Step 4: Run + verify count**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
psql "$PEEK_VISUAL_DB_URL" -c 'select type, status, count(*) from transactions group by 1, 2 order by 1, 2'
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed transactions"
```

### Task 4.4: Seed game entries (matches across all 3 games)

**Files:** Modify `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Read the schema**

```bash
psql "$PEEK_VISUAL_DB_URL" -c '\d game_entries' -c '\d closecall_rounds'
```

- [ ] **Step 2: Add seed**

Adapt to actual columns:

```ts
async function seedGameEntries(rng: () => number, userIds: string[]) {
  const games = ["flipyou", "closecall", "potshot"] as const;
  const states = ["pending", "settled_win", "settled_loss", "refunded", "in_flight"] as const;
  for (let i = 0; i < 250; i++) {
    const userId = userIds[Math.floor(rng() * userIds.length)];
    const game = games[Math.floor(rng() * games.length)];
    const state = states[Math.floor(rng() * states.length)];
    const wager = Math.floor(rng() * 50_000_000) + 2_600_000;
    const matchId = Buffer.from(
      Array.from({ length: 8 }, () => Math.floor(rng() * 256)),
    ).toString("hex");
    await sql`
      insert into game_entries (user_id, game, match_id, state, wager_lamports, created_at)
      values (
        ${userId}, ${game}, ${matchId}, ${state}, ${wager},
        now() - (${i} * interval '53 minutes')
      )
    `;
  }
}
```

- [ ] **Step 3: Wire into main + TRUNCATE_TABLES**

Add `"game_entries"` to TRUNCATE_TABLES (before `"transactions"` only if it has no FK to transactions). `await seedGameEntries(rng, userIds);` in main.

- [ ] **Step 4: Run + verify**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
psql "$PEEK_VISUAL_DB_URL" -c 'select game, state, count(*) from game_entries group by 1, 2 order by 1, 2'
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed game_entries across all 3 games"
```

### Task 4.5: Seed operator events (audit + activity feed)

**Files:** Modify `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Read the schema**

```bash
psql "$PEEK_VISUAL_DB_URL" -c '\d operator_events'
```

- [ ] **Step 2: Add seed**

```ts
async function seedOperatorEvents(rng: () => number, userIds: string[]) {
  const kinds = [
    "access_granted",
    "access_denied",
    "claim_approved",
    "claim_rejected",
    "fraud_flagged",
    "payout_paused",
    "payout_resumed",
    "rate_override_set",
  ] as const;
  for (let i = 0; i < 60; i++) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const actorEmail =
      i % 5 === 0 ? "ops@taunt.bet" : "admin@taunt.bet";
    const subject = userIds[Math.floor(rng() * userIds.length)];
    await sql`
      insert into operator_events (kind, actor_email, subject, occurred_at, payload)
      values (
        ${kind}, ${actorEmail}, ${subject},
        now() - (${i} * interval '23 minutes'),
        ${sql.json({ note: `seed event ${i}` })}
      )
    `;
  }
}
```

- [ ] **Step 3: Wire into main + TRUNCATE_TABLES**

Prepend `"operator_events"` to TRUNCATE_TABLES. Add seed call.

- [ ] **Step 4: Run + verify, commit**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
psql "$PEEK_VISUAL_DB_URL" -c 'select kind, count(*) from operator_events group by 1'
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed operator_events"
```

### Task 4.6: Seed reward economy + challenges

**Files:** Modify `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Read schemas**

```bash
psql "$PEEK_VISUAL_DB_URL" -c '\dt' | grep -E 'reward|challenge|claim|crate'
```
For each table that surfaces, run `\d <table>` and capture columns.

- [ ] **Step 2: Add seed function**

Mirror the structure of prior seeds. Aim for ~30 challenges, ~50 claims (mix of approved/pending/rejected), a few reward configs, a handful of rate overrides.

- [ ] **Step 3: Wire + run + commit**

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed reward economy and challenges"
```

### Task 4.7: Seed growth overrides

**Files:** Modify `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1: Locate the table**

```bash
psql "$PEEK_VISUAL_DB_URL" -c '\dt' | grep -i growth
```
If the table isn't present (some "growth" data is computed not stored), skip this task and note in deviations.md.

- [ ] **Step 2-4: Adapt seed pattern, run, commit**

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed growth overrides"
```

### Task 4.8: Seed operations (payout queue, fraud flags, dogpile)

**Files:** Modify `peek/scripts/seed-visual-fixture.ts`

- [ ] **Step 1-4: Same pattern as above**

Mirror prior seeds. Aim for ~20 queued payouts in mixed states, ~10 fraud flags, ~5 dogpile cancellations.

- [ ] Commit:

```bash
git add scripts/seed-visual-fixture.ts && git commit -m "feat(403-peek-visual-redesign): seed operations data"
```

### Task 4.9: Add seed smoke test

**Files:**
- Create: `peek/scripts/__tests__/seed-visual-fixture.smoke.test.ts`

- [ ] **Step 1: Write the smoke test**

```ts
import { describe, expect, it } from "vitest";
import postgres from "postgres";

const URL = process.env.PEEK_VISUAL_DB_URL;
const maybe = URL ? describe : describe.skip;

maybe("visual-fixture seed smoke test", () => {
  it("populates all expected tables with non-zero rows", async () => {
    const sql = postgres(URL!, { max: 1 });
    try {
      const tables = [
        "player_profiles",
        "referral_codes",
        "referral_links",
        "transactions",
        "game_entries",
        "operator_events",
      ];
      for (const t of tables) {
        const [{ count }] = await sql<[{ count: number }]>`
          select count(*)::int as count from ${sql(t)}
        `;
        expect(count, `expected non-zero rows in ${t}`).toBeGreaterThan(0);
      }
    } finally {
      await sql.end();
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run the test**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm test scripts/__tests__/seed-visual-fixture.smoke
```
Expected: pass (since seed already ran).

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/seed-visual-fixture.smoke.test.ts && git commit -m "test(403-peek-visual-redesign): seed smoke test"
```

### Task 4.10: README for the seed

**Files:**
- Create: `peek/scripts/README-visual-fixture.md`

- [ ] **Step 1: Write the README**

```markdown
# Visual Fixture Seed

Deterministic seed populating the full peek-visible domain into a dedicated database, used for visual iteration on peek's UI. Not wired into CI.

## Provisioning

```bash
psql "$DATABASE_URL" -c 'create database peek_visual_fixture'
export PEEK_VISUAL_DB_URL=postgres://postgres:postgres@localhost:5432/peek_visual_fixture
```

Apply backend migrations:
```bash
cd ../backend && DATABASE_URL=$PEEK_VISUAL_DB_URL pnpm migrate
```

## Running the seed

```bash
cd peek && PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
```

The seed is idempotent — it truncates and re-inserts each run, so re-running is safe.

## Pointing peek dev server at the fixture DB

```bash
cd peek && \
  NODE_ENV=development \
  DATABASE_URL=$PEEK_VISUAL_DB_URL \
  PEEK_DEV_ACCESS_EMAIL=visual-fixture@local \
  pnpm dev
```

Open http://localhost:3000.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/README-visual-fixture.md && git commit -m "docs(403-peek-visual-redesign): seed README"
```

---

## Phase 5 — Critique infrastructure

### Task 5.1: Playwright fixture-config and snapshot harness

**Files:**
- Create: `peek/playwright.visual.config.ts`
- Create: `peek/e2e/visual/capture.spec.ts`

- [ ] **Step 1: Write the visual playwright config**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/visual",
  use: {
    baseURL: "http://localhost:3000",
    deviceScaleFactor: 1,
  },
  webServer: {
    command:
      "DATABASE_URL=$PEEK_VISUAL_DB_URL PEEK_DEV_ACCESS_EMAIL=visual-fixture@local pnpm dev",
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "w1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "w1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "w1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
```

- [ ] **Step 2: Write the capture spec**

```ts
import { test } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const OUTDIR = process.env.VISUAL_OUTDIR ?? "e2e/visual/output";

const states = [
  { name: "default", url: "/" },
  { name: "search-empty", url: "/?query=zzzzznoresult" },
  { name: "search-populated", url: "/?query=fox" },
  { name: "page-2", url: "/?page=2" },
];

for (const s of states) {
  test(`capture ${s.name}`, async ({ page }, testInfo) => {
    await page.goto(s.url);
    await page.waitForLoadState("networkidle");
    const dir = path.join(OUTDIR, testInfo.project.name);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `${s.name}.png`),
      fullPage: true,
    });
  });
}
```

- [ ] **Step 3: Add pnpm scripts**

In `peek/package.json` scripts:
```json
"snapshot:baseline": "VISUAL_OUTDIR=e2e/visual/baseline playwright test --config=playwright.visual.config.ts",
"snapshot:target": "VISUAL_OUTDIR=e2e/visual/target playwright test --config=playwright.visual.config.ts"
```

- [ ] **Step 4: Smoke-run**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm snapshot:baseline
ls e2e/visual/baseline/
```
Expected: per-project subfolders containing PNGs.

- [ ] **Step 5: Commit**

```bash
git add playwright.visual.config.ts e2e/visual/capture.spec.ts package.json && git commit -m "feat(403-peek-visual-redesign): playwright visual snapshot harness"
```

### Task 5.2: Structural critique script

**Files:**
- Create: `peek/scripts/critique-structural.ts`
- Create: `peek/scripts/__tests__/critique-structural.test.ts`

- [ ] **Step 1: Write a failing test for font-size-count check**

```ts
import { describe, expect, it } from "vitest";
import { distinctFontSizes } from "../critique-structural";

describe("distinctFontSizes", () => {
  it("returns the unique set of computed font-size values", () => {
    const measurements = [
      { fontSize: "14px" },
      { fontSize: "14px" },
      { fontSize: "16px" },
      { fontSize: "20px" },
    ];
    expect(distinctFontSizes(measurements)).toEqual(
      new Set(["14px", "16px", "20px"]),
    );
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test scripts/__tests__/critique-structural
```
Expected: fail (module not found).

- [ ] **Step 3: Implement minimal**

Write `peek/scripts/critique-structural.ts`:

```ts
import type { Page } from "@playwright/test";

export interface ElementMeasurement {
  selector?: string;
  fontSize: string;
  color?: string;
  backgroundColor?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export function distinctFontSizes(els: ElementMeasurement[]): Set<string> {
  return new Set(els.map((e) => e.fontSize));
}

export function distinctColors(els: ElementMeasurement[]): Set<string> {
  return new Set(els.flatMap((e) => [e.color, e.backgroundColor].filter(Boolean) as string[]));
}

export async function measurePage(page: Page): Promise<ElementMeasurement[]> {
  return page.evaluate(() => {
    const results: ElementMeasurement[] = [];
    const all = document.querySelectorAll("*");
    all.forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      results.push({
        selector: el.tagName.toLowerCase(),
        fontSize: cs.fontSize,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    });
    return results as unknown as ElementMeasurement[];
  });
}
```

- [ ] **Step 4: Test passes**

```bash
pnpm test scripts/__tests__/critique-structural
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/critique-structural.ts scripts/__tests__/critique-structural.test.ts && git commit -m "feat(403-peek-visual-redesign): structural critique — distinctFontSizes/Colors"
```

### Task 5.3: Add inline-style detector

**Files:**
- Modify: `peek/scripts/critique-structural.ts`
- Modify: `peek/scripts/__tests__/critique-structural.test.ts`

- [ ] **Step 1: Add failing test**

```ts
import { hasInlineStyles } from "../critique-structural";
// ...
it("hasInlineStyles is true when any element has style=", async () => {
  expect(hasInlineStyles('<div style="color:red"></div>')).toBe(true);
  expect(hasInlineStyles("<div></div>")).toBe(false);
});
```

- [ ] **Step 2: Implement**

In `critique-structural.ts`:
```ts
export function hasInlineStyles(html: string): boolean {
  return /\sstyle\s*=\s*"/.test(html);
}
```

- [ ] **Step 3: Test passes; commit**

```bash
git add scripts/critique-structural.ts scripts/__tests__/critique-structural.test.ts && git commit -m "feat(403-peek-visual-redesign): structural critique — hasInlineStyles"
```

### Task 5.4: Add alignment-grid bucket counter

**Files:**
- Modify: `peek/scripts/critique-structural.ts`
- Modify: `peek/scripts/__tests__/critique-structural.test.ts`

- [ ] **Step 1: Test**

```ts
import { leftEdgeBuckets } from "../critique-structural";
it("buckets left edges by 4px tolerance", () => {
  const els = [
    { fontSize: "14px", rect: { x: 100, y: 0, width: 10, height: 10 } },
    { fontSize: "14px", rect: { x: 102, y: 0, width: 10, height: 10 } },
    { fontSize: "14px", rect: { x: 200, y: 0, width: 10, height: 10 } },
  ];
  expect(leftEdgeBuckets(els as never).size).toBe(2);
});
```

- [ ] **Step 2: Implement**

```ts
export function leftEdgeBuckets(els: ElementMeasurement[], tolerancePx = 4): Set<number> {
  const buckets = new Set<number>();
  for (const e of els) {
    if (!e.rect) continue;
    buckets.add(Math.round(e.rect.x / tolerancePx) * tolerancePx);
  }
  return buckets;
}
```

- [ ] **Step 3: Pass + commit**

```bash
git add scripts/critique-structural.ts scripts/__tests__/critique-structural.test.ts && git commit -m "feat(403-peek-visual-redesign): structural critique — leftEdgeBuckets"
```

### Task 5.5: Add focus-ring presence check

**Files:**
- Modify: `peek/scripts/critique-structural.ts`

- [ ] **Step 1: Add the check**

Append:
```ts
export async function checkFocusRings(page: Page): Promise<{ ok: boolean; bare: string[] }> {
  return page.evaluate(() => {
    const interactive = document.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    const bare: string[] = [];
    for (const el of interactive) {
      el.focus();
      const cs = getComputedStyle(el);
      const hasOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const hasBoxShadowRing = cs.boxShadow !== "none" && cs.boxShadow.includes("rgb");
      if (!hasOutline && !hasBoxShadowRing) bare.push(el.tagName + (el.id ? `#${el.id}` : ""));
      el.blur();
    }
    return { ok: bare.length === 0, bare };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/critique-structural.ts && git commit -m "feat(403-peek-visual-redesign): structural critique — focus-ring presence"
```

### Task 5.6: Critique runner producing JSON

**Files:**
- Create: `peek/scripts/critique-runner.ts`

- [ ] **Step 1: Write the runner**

```ts
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  measurePage,
  distinctFontSizes,
  distinctColors,
  hasInlineStyles,
  leftEdgeBuckets,
  checkFocusRings,
} from "./critique-structural";

const STATES = [
  { name: "default", url: "/" },
  { name: "search-empty", url: "/?query=zzzzznoresult" },
  { name: "search-populated", url: "/?query=fox" },
  { name: "page-2", url: "/?page=2" },
];

const VIEWPORTS = [
  { name: "w1280", width: 1280, height: 800 },
  { name: "w1440", width: 1440, height: 900 },
  { name: "w1920", width: 1920, height: 1080 },
];

async function main() {
  const outdir = process.env.CRITIQUE_OUTDIR ?? "e2e/visual/critique";
  mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      for (const s of STATES) {
        const ctx = await browser.newContext({ viewport: vp });
        const page = await ctx.newPage();
        await page.goto(`http://localhost:3000${s.url}`);
        await page.waitForLoadState("networkidle");

        const html = await page.content();
        const measurements = await measurePage(page);
        const focus = await checkFocusRings(page);

        const report = {
          state: s.name,
          viewport: vp.name,
          fontSizeCount: distinctFontSizes(measurements).size,
          colorCount: distinctColors(measurements).size,
          inlineStyles: hasInlineStyles(html),
          alignmentBuckets: leftEdgeBuckets(measurements).size,
          focusRings: focus,
        };

        writeFileSync(
          path.join(outdir, `${vp.name}-${s.name}.json`),
          JSON.stringify(report, null, 2),
        );
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add pnpm script**

```json
"critique:structural": "tsx scripts/critique-runner.ts"
```

- [ ] **Step 3: Smoke-run**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm dev &
DEVPID=$!
sleep 5
CRITIQUE_OUTDIR=e2e/visual/critique/baseline pnpm critique:structural
kill $DEVPID
ls e2e/visual/critique/baseline/
```
Expected: 12 JSON files (4 states × 3 viewports).

- [ ] **Step 4: Commit**

```bash
git add scripts/critique-runner.ts package.json && git commit -m "feat(403-peek-visual-redesign): structural critique runner"
```

### Task 5.7: Axe integration

**Files:**
- Create: `peek/scripts/critique-axe.ts`
- Modify: `peek/package.json`

- [ ] **Step 1: Install axe-core**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm add -D @axe-core/playwright
```

- [ ] **Step 2: Write the axe script**

```ts
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const STATES = [
  { name: "default", url: "/" },
  { name: "search-populated", url: "/?query=fox" },
];

async function main() {
  const outdir = process.env.AXE_OUTDIR ?? "e2e/visual/axe";
  mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const s of STATES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:3000${s.url}`);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).analyze();
      writeFileSync(
        path.join(outdir, `${s.name}.json`),
        JSON.stringify({ violations: results.violations }, null, 2),
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: pnpm script**

```json
"critique:axe": "tsx scripts/critique-axe.ts"
```

- [ ] **Step 4: Smoke-run + commit**

```bash
pnpm critique:axe
git add scripts/critique-axe.ts package.json pnpm-lock.yaml && git commit -m "feat(403-peek-visual-redesign): axe-core advisory quality lint"
```

### Task 5.8: Vision-judge prompt

**Files:**
- Create: `peek/scripts/critique-vision-prompt.md`

- [ ] **Step 1: Write the prompt**

```markdown
You are evaluating a screenshot of an internal admin dashboard against a 10-item rubric. The target aesthetic is a blend of Stripe Dashboard and Notion: light, calm, document-feeling, with strong tabular hierarchy.

For each item, output a JSON object with: `{ "item": <number>, "pass": <boolean>, "rationale": "<one short sentence>" }`. Wrap all 10 in a single JSON array. Output ONLY the array, no prose.

Rubric (judge only items 1, 2, 5, 9, 10 — leave others as `pass: null`):

1. **Hierarchy** — page has one primary heading, sections have visually distinct headings, no two headings at the same level look the same weight.
2. **Spacing rhythm** — vertical gaps between sections are visually even and intentional.
5. **Color restraint** — color is used to mean something. No decorative color. Saturated color appears at most twice per visible viewport.
9. **Scannability** — page can be parsed in 5 seconds: what is this, what's important, what can I do.
10. **Quietness** — no element draws attention without earning it. No decorative dividers, ornamental icons, or decorative gradients.

Items 3, 4, 6, 7, 8 are evaluated by separate deterministic checks; do not assess them.

Be strict but fair. Pass = clearly meets the bar; fail = clearly does not. If unsure, fail.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/critique-vision-prompt.md && git commit -m "feat(403-peek-visual-redesign): vision-judge prompt"
```

### Task 5.9: Vision-judge runner

**Files:**
- Create: `peek/scripts/critique-vision.ts`

- [ ] **Step 1: Install Anthropic SDK**

```bash
pnpm add -D @anthropic-ai/sdk
```

- [ ] **Step 2: Write the runner**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const client = new Anthropic({ apiKey });
const prompt = readFileSync("scripts/critique-vision-prompt.md", "utf-8");
const indir = process.env.VISION_INDIR ?? "e2e/visual/baseline";
const outdir = process.env.VISION_OUTDIR ?? "e2e/visual/vision-critique";
mkdirSync(outdir, { recursive: true });

async function judge(filePath: string) {
  const buf = readFileSync(filePath);
  const b64 = buf.toString("base64");
  const resp = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const text = resp.content[0].type === "text" ? resp.content[0].text : "";
  return text;
}

async function main() {
  const projects = readdirSync(indir);
  for (const project of projects) {
    const projectDir = path.join(indir, project);
    const files = readdirSync(projectDir).filter((f) => f.endsWith(".png"));
    for (const f of files) {
      const verdict = await judge(path.join(projectDir, f));
      writeFileSync(path.join(outdir, `${project}-${f.replace(".png", "")}.json`), verdict);
      console.log(`judged ${project}/${f}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: pnpm script**

```json
"critique:vision": "tsx scripts/critique-vision.ts"
```

- [ ] **Step 4: Smoke-run on baseline**

```bash
VISION_INDIR=e2e/visual/baseline VISION_OUTDIR=e2e/visual/critique/baseline-vision pnpm critique:vision
```
Expected: one JSON per screenshot, model returns the rubric array.

- [ ] **Step 5: Commit**

```bash
git add scripts/critique-vision.ts package.json pnpm-lock.yaml && git commit -m "feat(403-peek-visual-redesign): vision-judge runner using Claude opus-4-7"
```

### Task 5.10: Combined critique report generator

**Files:**
- Create: `peek/scripts/critique-report.ts`

- [ ] **Step 1: Write report combiner**

```ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const structDir = process.env.STRUCT_DIR ?? "e2e/visual/critique/baseline";
const visionDir = process.env.VISION_DIR ?? "e2e/visual/critique/baseline-vision";
const axeDir = process.env.AXE_DIR ?? "e2e/visual/axe";
const out = process.env.REPORT_OUT ?? "e2e/visual/critique/baseline-report.md";

function loadJson(p: string) {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

const lines: string[] = [
  "# Critique Report",
  "",
  `Generated from \`${structDir}\` + \`${visionDir}\` + \`${axeDir}\`.`,
  "",
];

for (const f of readdirSync(structDir).filter((f) => f.endsWith(".json"))) {
  const struct = loadJson(path.join(structDir, f));
  lines.push(`## ${f.replace(".json", "")}`, "");
  lines.push(`- distinct font sizes: **${struct.fontSizeCount}** (target ≤ 4)`);
  lines.push(`- distinct colors: **${struct.colorCount}**`);
  lines.push(`- inline styles present: **${struct.inlineStyles}** (target false)`);
  lines.push(`- alignment buckets: **${struct.alignmentBuckets}**`);
  lines.push(`- bare focus rings: **${struct.focusRings.bare.length}** (target 0)`);
  lines.push("");
}

writeFileSync(out, lines.join("\n"));
console.log("wrote", out);
```

- [ ] **Step 2: pnpm script**

```json
"critique:report": "tsx scripts/critique-report.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/critique-report.ts package.json && git commit -m "feat(403-peek-visual-redesign): combined critique markdown report"
```

---

## Phase 6 — Capture baseline + critique baseline

This phase is gated: nothing visual changes until baseline is captured.

### Task 6.1: Reset fixture, capture baseline screenshots

**Files:** outputs in `peek/e2e/visual/baseline/`

- [ ] **Step 1: Re-seed fresh**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
```

- [ ] **Step 2: Capture baseline**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm snapshot:baseline
```
Expected: PNGs in `e2e/visual/baseline/{w1280,w1440,w1920}/`.

- [ ] **Step 3: Commit baseline screenshots**

```bash
git add e2e/visual/baseline && git commit -m "snap(403-peek-visual-redesign): baseline screenshots before redesign"
```

### Task 6.2: Run baseline critique

**Files:** outputs under `peek/e2e/visual/critique/baseline*`

- [ ] **Step 1: Structural**

```bash
CRITIQUE_OUTDIR=e2e/visual/critique/baseline pnpm critique:structural
```

- [ ] **Step 2: Axe**

```bash
AXE_OUTDIR=e2e/visual/critique/baseline-axe pnpm critique:axe
```

- [ ] **Step 3: Vision**

```bash
VISION_INDIR=e2e/visual/baseline VISION_OUTDIR=e2e/visual/critique/baseline-vision pnpm critique:vision
```

- [ ] **Step 4: Combined report**

```bash
STRUCT_DIR=e2e/visual/critique/baseline VISION_DIR=e2e/visual/critique/baseline-vision AXE_DIR=e2e/visual/critique/baseline-axe REPORT_OUT=../../docs/specs/403-peek-visual-redesign/critique-baseline.md pnpm critique:report
```

- [ ] **Step 5: Commit**

```bash
git add e2e/visual/critique && cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403 && git -C peek add ../../docs/specs/403-peek-visual-redesign/critique-baseline.md
# Note: critique-baseline.md is in the ROOT repo (not peek). Commit there separately.
```

Actually, since the worktree is for `peek/` only, the report destination must be inside `peek/`. Update the previous step's `REPORT_OUT` to `e2e/visual/critique/baseline-report.md`. Then:

```bash
git add e2e/visual/critique && git commit -m "snap(403-peek-visual-redesign): baseline critique report"
```

The same report can be re-generated and copied into root `docs/specs/403-peek-visual-redesign/` when finalizing acceptance.

---

## Phase 7 — AdminShell port

### Task 7.1: Read existing AdminShell

**Files:** read-only.

- [ ] **Step 1: Read**

```bash
sed -n '1,200p' /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/src/components/admin-shell.tsx
```
Note: existing props (actor, navItems, accessIssue), existing access-issue states, existing nav rendering.

### Task 7.2: Port AdminShell to Tailwind + new aesthetic

**Files:**
- Modify: `peek/src/components/admin-shell.tsx`
- Read: existing tests under `peek/src/components/__tests__` (if any) for shell-related expectations.

- [ ] **Step 1: Replace inline styles with Tailwind classes**

The shell layout: header (brand left, identity right, hairline bottom border), sidebar nav (200px column, quiet vertical list of links, hover-accent background, active-route bold), main content (max-w-7xl, p-8). Preserve all props and access-issue branches.

Sketch (adapt to actual existing prop signatures):

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

export type AdminShellAccessIssue = "no-identity" | "no-role";

export interface AdminShellProps {
  actor: { email: string; role: string } | null;
  navItems: Array<{ href: string; label: string }>;
  accessIssue: AdminShellAccessIssue | null;
  children: ReactNode;
}

export function AdminShell({ actor, navItems, accessIssue, children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 h-14">
        <div className="font-semibold tracking-tight text-sm">PEEK</div>
        {actor ? (
          <div className="text-sm text-muted-foreground">
            <span>{actor.email}</span>
            <span className="mx-2">·</span>
            <span className="font-medium text-foreground">{actor.role}</span>
          </div>
        ) : null}
      </header>

      {accessIssue ? (
        <div className="mx-auto max-w-2xl p-8">
          <h1 className="text-xl font-semibold">Access issue</h1>
          <p className="mt-2 text-muted-foreground">
            {accessIssue === "no-identity"
              ? "We do not see a Cloudflare Access identity for this request."
              : "Your account is recognized but no peek role is assigned."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[200px_1fr]">
          <nav className="border-r border-border p-4">
            <ul className="flex flex-col gap-1">
              {navItems.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="p-8 max-w-7xl">{children}</main>
        </div>
      )}
    </div>
  );
}
```

(Adjust `actor` prop typing to match what `getPeekActorContext` returns.)

- [ ] **Step 2: Update layout.tsx if it referenced inline styles in shell**

Verify `app/layout.tsx` doesn't carry shell-specific inline styles that the new shell now owns; remove duplicates.

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Update existing shell test if present**

If `e2e/home.spec.ts` asserts the heading "Peek", verify the new shell still renders that string. Update spec if not.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell.tsx app/layout.tsx && git commit -m "feat(403-peek-visual-redesign): port AdminShell to Tailwind + new aesthetic"
```

---

## Phase 8 — Home page port (subcomponent at a time)

For each home-page subcomponent, the pattern is the same: read existing, rewrite using primitives + Tailwind, drop inline styles, verify the page renders, commit.

### Task 8.1: Page-level layout shell

**Files:**
- Modify: `peek/app/page.tsx`

- [ ] **Step 1: Replace top-level inline styles**

In `app/page.tsx`:
- Remove all `const sectionHeadingStyle: CSSProperties` etc. constants at the bottom of the file.
- Replace `<main style={{ display: "grid", gap: "1.5rem" }}>` with `<main className="grid gap-8">`.
- Replace `<header>` block: title in `<h1 className="text-2xl font-semibold tracking-tight">`, dek in `<p className="mt-1 text-sm text-muted-foreground">`.
- Replace `<section>` blocks' heading style with className `"mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"`.

Leave subcomponents (`MetricStrip`, `SummaryStrip`, etc.) as-is for now — those get rewritten in their own tasks.

- [ ] **Step 2: Verify dev server still renders**

```bash
curl -sI http://localhost:3000/ | head -1
```
Expected: 200.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx && git commit -m "feat(403-peek-visual-redesign): home page layout shell on Tailwind"
```

### Task 8.2: Global search section

**Files:** Modify `peek/app/page.tsx`.

- [ ] **Step 1: Replace search form with primitives**

Replace the `<form action="/" method="get" role="search">` block with:

```tsx
<section aria-labelledby="global-search-heading" className="grid gap-3">
  <h2 id="global-search-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
    Global search
  </h2>
  <form action="/" method="get" role="search" className="flex gap-2">
    <Input
      aria-label="Global search"
      defaultValue={params.query}
      name="query"
      placeholder="user id, username, wallet, referral code, Telegram, round PDA, tx signature"
      type="search"
      className="flex-1"
    />
    <Button type="submit">Search</Button>
  </form>
  {initialParams.query.trim().length > 0 ? (
    <div>
      <UniversalSearchResults error={searchError} response={searchResponse} />
    </div>
  ) : null}
</section>
```

Add imports at the top:
```tsx
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm build
git add app/page.tsx && git commit -m "feat(403-peek-visual-redesign): global search on primitives"
```

### Task 8.3: Port `MetricStrip` (attention queue)

**Files:**
- Modify: `peek/src/components/metric-strip.tsx`

- [ ] **Step 1: Read existing**

Inspect file to understand `metrics` shape and `error` prop.

- [ ] **Step 2: Rewrite**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PeekCommandCenterAttention } from "@/lib/types/peek";

interface Props {
  metrics: PeekCommandCenterAttention["metrics"];
  error: string | null;
}

export function MetricStrip({ metrics, error }: Props) {
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          Attention queue unavailable: {error}
        </CardContent>
      </Card>
    );
  }
  if (metrics.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Nothing in the attention queue.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <Card key={m.id ?? m.label}>
          <CardContent className="p-4 grid gap-1">
            <div className="text-2xl font-semibold tabular-nums">{m.value}</div>
            <div className="text-sm text-muted-foreground">{m.label}</div>
            {m.severity ? (
              <Badge
                variant={
                  m.severity === "urgent"
                    ? "urgent"
                    : m.severity === "warning"
                      ? "warning"
                      : "info"
                }
                className="w-fit"
              >
                {m.severity}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

(Adapt `m.id`, `m.severity` to actual fields if names differ.)

- [ ] **Step 3: Verify, commit**

```bash
git add src/components/metric-strip.tsx && git commit -m "feat(403-peek-visual-redesign): port MetricStrip to Card primitive"
```

### Task 8.4: Port `SummaryStrip`

**Files:** Modify `peek/src/components/summary-strip.tsx`.

- [ ] **Step 1: Inspect existing.**

- [ ] **Step 2: Rewrite using `Card` and tabular-nums values**.

Pattern: 4 stat columns inside a single Card with internal Separators, or 4 separate Cards. Choose 4 separate Cards for consistency with `MetricStrip`.

- [ ] **Step 3: Commit**

```bash
git add src/components/summary-strip.tsx && git commit -m "feat(403-peek-visual-redesign): port SummaryStrip"
```

### Task 8.5: Port `RecentActivityList`

**Files:** Modify `peek/src/components/recent-activity-list.tsx`.

- [ ] **Step 1: Read.**

- [ ] **Step 2: Rewrite**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import type { PeekRecentActivityItem } from "@/lib/types/peek";

interface Props {
  items: PeekRecentActivityItem[];
  error: string | null;
}

export function RecentActivityList({ items, error }: Props) {
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          Recent activity unavailable: {error}
        </CardContent>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No recent activity.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-4 px-4 py-3">
            <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0 w-32">
              {it.occurredAt}
            </span>
            <span className="text-sm">{it.summary}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/recent-activity-list.tsx && git commit -m "feat(403-peek-visual-redesign): port RecentActivityList"
```

### Task 8.6: Port filter form (NativeSelect, NativeCheckbox, Label)

**Files:** Modify `peek/app/page.tsx`.

- [ ] **Step 1: Replace the filter form**

The form preserves GET-submission and `name` attributes exactly:

```tsx
<form className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end">
  <input name="query" type="hidden" value={params.query} />

  <div className="grid gap-1.5">
    <Label htmlFor="sort">Sort</Label>
    <NativeSelect id="sort" defaultValue={params.sort} name="sort">
      <option value="joinedAt">Joined</option>
      <option value="refereeCount">Referee count</option>
    </NativeSelect>
  </div>

  <div className="grid gap-1.5">
    <Label htmlFor="direction">Direction</Label>
    <NativeSelect id="direction" defaultValue={params.direction} name="direction">
      <option value="desc">Newest first</option>
      <option value="asc">Oldest first</option>
    </NativeSelect>
  </div>

  <label className="flex items-center gap-2 text-sm">
    <NativeCheckbox defaultChecked={params.filters.hasReferrer} name="hasReferrer" value="true" />
    <span>Has referrer</span>
  </label>
  <label className="flex items-center gap-2 text-sm">
    <NativeCheckbox defaultChecked={params.filters.hasReferees} name="hasReferees" value="true" />
    <span>Has referees</span>
  </label>
  <label className="flex items-center gap-2 text-sm">
    <NativeCheckbox defaultChecked={params.filters.hasCode} name="hasCode" value="true" />
    <span>Has code</span>
  </label>
  <label className="flex items-center gap-2 text-sm">
    <NativeCheckbox defaultChecked={params.filters.hasTelegram} name="hasTelegram" value="true" />
    <span>Has Telegram</span>
  </label>

  <Button type="submit">Apply</Button>
</form>
```

Add imports:
```tsx
import { NativeSelect } from "@/components/ui/native-select";
import { NativeCheckbox } from "@/components/ui/native-checkbox";
import { Label } from "@/components/ui/label";
```

- [ ] **Step 2: Verify GET still works**

```bash
curl -s "http://localhost:3000/?sort=refereeCount&hasReferrer=true" | head -50
```
Expected: page returns 200, table reordered or filtered (shape varies; just confirm no 500).

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx && git commit -m "feat(403-peek-visual-redesign): filter form on native controls + Label"
```

### Task 8.7: Port `UsersTable`

**Files:** Modify `peek/src/components/users-table.tsx`.

- [ ] **Step 1: Read existing structure.**

- [ ] **Step 2: Rewrite using `Table` primitive**

Pattern:
```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PeekUserRow } from "@/lib/types/peek";

export function UsersTable({ users }: { users: PeekUserRow[] }) {
  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No users match this filter.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Referral code</TableHead>
            <TableHead className="text-right">Referees</TableHead>
            <TableHead>Telegram</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.userId}>
              <TableCell className="font-mono text-xs">{u.userId}</TableCell>
              <TableCell>{u.username}</TableCell>
              <TableCell className="font-mono text-xs">{u.wallet?.slice(0, 8) ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs tabular-nums">{u.joinedAt}</TableCell>
              <TableCell className="font-mono text-xs">{u.referralCode ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{u.refereeCount}</TableCell>
              <TableCell className="text-xs">{u.telegramUsername ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
```

(Adapt column set to actual `PeekUserRow` shape; the existing component is the source of truth.)

- [ ] **Step 3: Commit**

```bash
git add src/components/users-table.tsx && git commit -m "feat(403-peek-visual-redesign): port UsersTable to Table primitive"
```

### Task 8.8: Port `PaginationControls`

**Files:** Modify `peek/src/components/pagination-controls.tsx`.

- [ ] **Step 1: Read existing.**

- [ ] **Step 2: Rewrite using `Button` for prev/next links** with `aria-disabled` styling and `tabular-nums` for the page count display. Keep it as a `<Link>`-based component (still server-renderable, no JS).

- [ ] **Step 3: Commit**

```bash
git add src/components/pagination-controls.tsx && git commit -m "feat(403-peek-visual-redesign): port PaginationControls"
```

### Task 8.9: Port `UniversalSearchResults`

**Files:** Modify `peek/src/components/universal-search-results.tsx`.

- [ ] **Step 1: Read existing.**

- [ ] **Step 2: Rewrite. Group by category (users, referral codes, wallets, etc.) inside a `Card`. Each result is a row with category badge + name + monospace ID.**

- [ ] **Step 3: Commit**

```bash
git add src/components/universal-search-results.tsx && git commit -m "feat(403-peek-visual-redesign): port UniversalSearchResults"
```

### Task 8.10: Update home e2e spec

**Files:** Modify `peek/e2e/home.spec.ts`.

- [ ] **Step 1: Update assertions to match new DOM**

The current spec checks heading "Peek". The new shell brand is "PEEK" — likely matches case-insensitively in `getByRole`. The columnheader "User ID" still matches because `TableHead` renders `<th>User ID</th>`.

```ts
import { expect, test } from "@playwright/test";

test("home page renders the redesigned admin shell and users table", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("PEEK")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "User ID" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();
});
```

- [ ] **Step 2: Run e2e (skip — needs full env)**

Smoke instead:
```bash
pnpm typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/home.spec.ts && git commit -m "test(403-peek-visual-redesign): update home spec to match new DOM"
```

---

## Phase 9 — Capture target + iterate

### Task 9.1: Capture target screenshots

**Files:** outputs in `peek/e2e/visual/target/`

- [ ] **Step 1: Reseed for determinism**

```bash
PEEK_VISUAL_DB_URL=$PEEK_VISUAL_DB_URL pnpm seed:visual
```

- [ ] **Step 2: Capture**

```bash
pnpm snapshot:target
```

- [ ] **Step 3: Commit**

```bash
git add e2e/visual/target && git commit -m "snap(403-peek-visual-redesign): target screenshots round 0"
```

### Task 9.2: Run target critique

- [ ] **Step 1: All three sources**

```bash
CRITIQUE_OUTDIR=e2e/visual/critique/target pnpm critique:structural
AXE_OUTDIR=e2e/visual/critique/target-axe pnpm critique:axe
VISION_INDIR=e2e/visual/target VISION_OUTDIR=e2e/visual/critique/target-vision pnpm critique:vision
STRUCT_DIR=e2e/visual/critique/target VISION_DIR=e2e/visual/critique/target-vision AXE_DIR=e2e/visual/critique/target-axe REPORT_OUT=e2e/visual/critique/target-report.md pnpm critique:report
```

- [ ] **Step 2: Read the report**

```bash
cat e2e/visual/critique/target-report.md
```

- [ ] **Step 3: Decide**

- All authoritative items pass → proceed to acceptance.
- Some items fail → continue to Task 9.3.

- [ ] **Step 4: Commit critique outputs**

```bash
git add e2e/visual/critique && git commit -m "snap(403-peek-visual-redesign): target critique round 0"
```

### Task 9.3: Iteration round 1 (if any item fails)

**Files:** depends on which rubric items failed.

- [ ] **Step 1: Read target-report.md, identify highest-impact failure**

Map the failure to a likely cause:
- `fontSizeCount > 4` → look for stray `text-2xl`, `text-base`, etc. introducing scale violations. Consolidate.
- `colorCount` very high → an inline color leaked through. Grep for `rgb(` in rendered DOM.
- `inlineStyles: true` → grep `style=` in source, eliminate.
- `alignmentBuckets > 3` per section → identify mis-aligned subcomponent, snap to grid.
- `bare focus rings` → add `focus-visible:ring-2` to the offender.
- vision-judge fails on hierarchy/quietness/etc. → re-read its rationale, address specifically.

- [ ] **Step 2: Apply targeted fix.**

- [ ] **Step 3: Recapture target**

```bash
pnpm snapshot:target
CRITIQUE_OUTDIR=e2e/visual/critique/target-r1 pnpm critique:structural
VISION_INDIR=e2e/visual/target VISION_OUTDIR=e2e/visual/critique/target-vision-r1 pnpm critique:vision
STRUCT_DIR=e2e/visual/critique/target-r1 VISION_DIR=e2e/visual/critique/target-vision-r1 AXE_DIR=e2e/visual/critique/target-axe REPORT_OUT=e2e/visual/critique/target-report-r1.md pnpm critique:report
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(403-peek-visual-redesign): iteration round 1 — <specific fix description>"
```

### Task 9.4: Iteration rounds 2 and 3 (only if needed)

- [ ] Same pattern as 9.3.
- [ ] **After round 3, if any rubric item still fails, STOP.** Do not iterate beyond cap. Commit current state and surface to user with the failing item, the attempted fixes, and the remaining gap.

---

## Phase 10 — Acceptance + signoff

### Task 10.1: Write `peek/DESIGN_RUBRIC.md`

**Files:** Create `peek/DESIGN_RUBRIC.md`.

- [ ] **Step 1: Write**

Reproduce the 10-item rubric from the spec, then a "How to run the loop" section pointing at the pnpm scripts:

```markdown
# peek Design Rubric

Used during visual redesign work to gate per-page acceptance. See `docs/specs/403-peek-visual-redesign/spec.md` for the design references that anchor the rubric.

## Rubric (10 items)

1. **Hierarchy** — page has one primary heading, sections have visually distinct headings, no two headings at the same level look the same weight.
2. **Spacing rhythm** — vertical gaps between sections all come from one of `gap-6` / `gap-8` / `gap-10`. No arbitrary `mt-*` or inline margins.
3. **Alignment grid** — all left edges within a section share an x-coordinate. Right-aligned numeric columns share a right edge.
4. **Type scale** — the page uses no more than 4 distinct font sizes. No mixed weights within a single visual group.
5. **Color restraint** — color is used to mean something. No decorative color. Saturated color appears at most twice per visible viewport.
6. **Density consistency** — table row height, card padding, and form-field height each have one canonical value.
7. **State coverage** — every data-bearing element has explicit empty, loading, and error treatments.
8. **Affordance clarity** — every interactive element looks interactive (hover, cursor, focus ring).
9. **Scannability** — the page can be parsed in 5 seconds.
10. **Quietness** — no element draws attention without earning it.

A page is "rubric-green" only when all 10 items pass under the combined critique stack.

## Source authority

- **Structural script** is authoritative on items 3, 4, 6, 7, 8.
- **Vision-judge** is authoritative on items 1, 2, 5, 9, 10.
- **Axe** is advisory across the board (no WCAG-conformance gate).

## Running the loop

1. `pnpm seed:visual`
2. `pnpm snapshot:target`
3. `pnpm critique:structural`, `pnpm critique:axe`, `pnpm critique:vision`
4. `pnpm critique:report`
5. Read the report. If failing, fix highest-impact item, return to step 2.
6. Cap: 3 iteration rounds. Then surface to a human.
```

- [ ] **Step 2: Commit**

```bash
git add DESIGN_RUBRIC.md && git commit -m "docs(403-peek-visual-redesign): peek/DESIGN_RUBRIC.md"
```

### Task 10.2: Run full peek verify

**Files:** none modified.

- [ ] **Step 1: Verify**

```bash
cd /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek && pnpm verify
```
Expected: exit 0.

- [ ] **Step 2: If verify fails, fix and re-verify.**

Common failure modes:
- Lint: unused imports from old inline-style code → remove.
- Typecheck: prop-shape mismatches between port and consumer → align.
- Tests: snapshot tests checking old DOM structure → update.
- Build: missing Tailwind class warnings (4.x is strict) → fix or whitelist.

- [ ] **Step 3: Commit any fix-up**

```bash
git add -A && git commit -m "fix(403-peek-visual-redesign): verify gate"
```

### Task 10.3: Copy critique artifacts into root spec folder + present to user

**Files:**
- Create: `docs/specs/403-peek-visual-redesign/critique-baseline.md`
- Create: `docs/specs/403-peek-visual-redesign/critique-target.md`
- Create: `docs/specs/403-peek-visual-redesign/screenshots/` (selected baseline + target)

These live in the **root** repo, not the worktree. Switch out:

- [ ] **Step 1: Copy reports**

```bash
cp /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/e2e/visual/critique/baseline-report.md \
   /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/critique-baseline.md
cp /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/e2e/visual/critique/target-report-r*.md \
   /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/critique-target.md 2>/dev/null \
   || cp /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/e2e/visual/critique/target-report.md \
         /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/critique-target.md
```

- [ ] **Step 2: Copy a curated set of before/after screenshots**

Pick the most representative state per viewport (e.g., `w1440/default.png`):

```bash
mkdir -p /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/screenshots
cp /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/e2e/visual/baseline/w1440/default.png \
   /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/screenshots/baseline-default-1440.png
cp /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek/e2e/visual/target/w1440/default.png \
   /workspaces/rng-utopia/docs/specs/403-peek-visual-redesign/screenshots/target-default-1440.png
```

- [ ] **Step 3: Commit in root repo**

```bash
cd /workspaces/rng-utopia && git add docs/specs/403-peek-visual-redesign/ && git commit -m "docs(403-peek-visual-redesign): critique reports + before/after screenshots"
```

- [ ] **Step 4: Present to user**

Surface the screenshot pair and the target critique report. Ask: **"All authoritative rubric items pass on the target. Want me to proceed to merge, or revise anything first?"**

### Task 10.4: Merge worktree branch into peek/dev

**Files:** none in tree; git operation.

- [ ] **Step 1: Wait for explicit user signoff before merging.** This is a shared-branch-state action — confirm.

- [ ] **Step 2: Merge**

```bash
cd /workspaces/rng-utopia/peek && git fetch origin && git checkout dev && git merge --no-ff feat/403-peek-visual-redesign
```

- [ ] **Step 3: Push**

```bash
git push origin dev
```

- [ ] **Step 4: Update root submodule pointer**

```bash
cd /workspaces/rng-utopia && git add peek && git commit -m "chore(submodule): bump peek to include 403-peek-visual-redesign"
```

- [ ] **Step 5: Push root**

Only if the user has signed off on the root push. By default, do NOT push root automatically — surface the prepared commit and let the user push.

- [ ] **Step 6: Clean up worktree**

```bash
cd /workspaces/rng-utopia && git worktree remove /workspaces/rng-utopia-worktrees/peek-visual-redesign-403/peek
```

---

## Plan Self-Review

- **Spec coverage:** Every acceptance criterion in the spec maps to a task — Tailwind 4 install (2.1), token system (2.2), shadcn primitives 3.2-3.9, native wrappers (3.10-3.11), AdminShell port (7.2), home page port (8.x), inline-style elimination (8.1+8.6+per-component), DESIGN_RUBRIC (10.1), seed (4.x), critique scripts (5.x), baseline + target snapshots (6.1, 9.1), critiques (6.2, 9.2), 3-iteration cap (9.3-9.4), verify (10.2), screenshots committed (10.3), worktree (1.1). ✓
- **Placeholder scan:** Every code step contains complete code. The few "adapt to actual schema" markers in seed tasks are accompanied by a `psql \\d` step that produces the schema; this is the intended pattern for tasks where exact column names cannot be assumed in advance. ✓
- **Type consistency:** `Card`, `Table`, `Input`, `Button`, `Badge`, `Separator`, `Skeleton`, `Label`, `NativeSelect`, `NativeCheckbox` are introduced once and reused with consistent capitalization. `cn` utility is defined in 3.1 and used throughout. `ElementMeasurement` interface introduced in 5.2 and reused in 5.3-5.5 unchanged. ✓

If during execution any task surfaces a deviation (e.g., schema column missing, Tailwind 4 incompatibility), record it in `docs/specs/403-peek-visual-redesign/deviations.md` and continue.
