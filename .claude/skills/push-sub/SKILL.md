---
name: push-sub
description: Commit and push changes in submodules (backend/solana), then update root pointers.
argument-hint: [backend|solana|both] [commit message] (optional — auto-generates if omitted)
---

# /push-sub — Commit & Push Submodules

Commit changes in one or both submodules (`backend/`, `solana/`), push them,
update the submodule pointers in the root repo, and commit the root.

## Steps

1. **Detect which submodules have changes**:
   - `cd backend && git status` — check for changes
   - `cd solana && git status` — check for changes
   - If an argument specifies `backend` or `solana`, only process that one
   - If `both` or no argument, process all with changes

2. **For each changed submodule** (backend first, then solana):
   - Stage relevant files (not `git add -A` — be specific)
   - Commit with the provided message, or auto-generate from the diff
   - Push to origin

3. **Root repo commit** (`/workspaces/rng-utopia/`):
   - The submodule pointers will show as modified
   - Stage them: `git add backend solana`
   - If there are other changed files in root (docs/, scripts/), show them
     and ask whether to include
   - Commit with message: `chore: update submodule refs`

4. **Done** — print summary of commits and push results.

## Rules

- Use conventional commit style (`feat`, `fix`, `chore`, `docs`, etc.)
- Follow the commit message style from recent git log
- Never force-push
- Never use `git add -A` — stage specific files
- If a push fails, report the error and stop
- Do NOT push the root repo unless explicitly asked
