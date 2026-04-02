---
name: push-sub
description: Commit and push changes in submodules (backend/solana/chat/waitlist/webapp), then update root pointers.
argument-hint: [backend|solana|chat|waitlist|webapp|all] [commit message] (optional — auto-generates if omitted)
---

# /push-sub — Commit & Push Submodules

Commit changes in one or more submodules, push them, update the submodule
pointers in the root repo, and commit the root.

Submodules: `backend/`, `solana/`, `chat/`, `waitlist/`, `webapp/`

## Steps

1. **Detect which submodules have changes**:
   - Check `git status` in each: `backend`, `solana`, `chat`, `waitlist`, `webapp`
   - If an argument names a specific submodule, only process that one
   - If `all` or no argument, process all with changes

2. **For each changed submodule** (backend → solana → chat → waitlist → webapp):
   - Stage relevant files (not `git add -A` — be specific)
   - Commit with the provided message, or auto-generate from the diff
   - Push to origin

3. **Root repo commit** (`/workspaces/rng-utopia/`):
   - The submodule pointers will show as modified
   - Stage them: `git add backend solana chat waitlist webapp` (only the ones that changed)
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
