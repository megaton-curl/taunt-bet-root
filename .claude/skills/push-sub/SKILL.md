---
name: push-sub
description: Commit changes in the submodule and parent repo, then push the submodule.
argument-hint: [commit message] (optional — auto-generates if omitted)
---

# /push-sub — Commit & Push Submodule

Commit staged/unstaged changes in the `sources/rng-utopia/` submodule, update the
submodule pointer in the parent repo, and push.

## Steps

1. **Submodule commit** (`sources/rng-utopia/`):
   - `cd sources/rng-utopia && git status` — show changes
   - If no changes, stop early with "nothing to commit"
   - Stage all modified/untracked files relevant to the changes
   - Commit with the provided message, or auto-generate one from the diff

2. **Push submodule**:
   - `cd sources/rng-utopia && git push`

3. **Parent repo commit** (`/workspaces/rng-utopia/`):
   - The submodule pointer (`sources/rng-utopia`) will show as modified
   - Stage it: `git add sources/rng-utopia`
   - If there are other changed files in the parent repo, show them and ask
     whether to include them in this commit or leave them unstaged
   - Commit with message: `chore: update submodule ref` (or a more descriptive
     message if other files are included)

4. **Done** — print summary of both commits and the push result.

## Rules

- Use conventional commit style (`feat`, `fix`, `chore`, `docs`, etc.)
- Follow the commit message style from recent git log
- Never force-push
- Never use `git add -A` — stage specific files
- If the submodule push fails (e.g., upstream rejected), report the error and stop
- Do NOT push the parent repo unless explicitly asked
