---
name: push-sub
description: Commit and push owned submodule changes in this workspace, then update root submodule pointers and related root docs without sweeping unrelated dirt. Root, backend, and chat are authoritative; waitlist and webapp are consult-only unless explicitly requested.
argument-hint: [backend|solana|chat|telegram|peek|waitlist|webapp|all] [commit message] (optional — auto-generate if omitted)
---

# /push-sub — Commit & Push Submodules

Commit changes in one or more submodules, push them, then update the root repo
with the matching submodule refs and any intentionally-related root docs.

Current workspace defaults:

- Authoritative repos: root, `backend/`, `chat/`
- Owned service repos usually advanced by this command: `backend/`, `solana/`, `chat/`, `telegram/`, `peek/`
- Consult-only repos by default: `waitlist/`, `webapp/`
- Branch tracking from `.gitmodules`: `dev` for `backend`, `chat`, `telegram`, `peek`, `waitlist`, `webapp`; `main` for `solana`
- Production data safety is paramount: do not bundle risky migration/data changes casually

## Steps

1. **Snapshot workspace state first**:
   - Check root `git status --short`
   - Check submodule `git status --short` for `backend`, `solana`, `chat`, `telegram`, `peek`, `waitlist`, `webapp`
   - Identify unrelated root dirt before staging anything

2. **Select the target set**:
   - If the user names a specific submodule, only process that one
   - If the user says `all`, process all changed owned submodules: `backend`, `solana`, `chat`, `telegram`, `peek`
   - Only include `waitlist` or `webapp` when the user explicitly names them or explicitly asks to include consult-only repos
   - Root-only pointer updates for already-updated `waitlist` / `webapp` refs are fine when they are part of the intended root commit

3. **For each changed target submodule** in this order:
   - `backend` → `solana` → `chat` → `telegram` → `peek` → `waitlist` → `webapp`
   - Inspect `git status -sb`, `git diff --stat`, and recent commit style
   - Stage relevant files only; never `git add -A`
   - If a file mixes intended changes with unrelated dirt, stop and call it out instead of silently bundling it
   - Commit with the provided message, or auto-generate a conventional-commit message from the diff
   - Run the relevant verification when code changed:
     - `backend`: targeted `pnpm` checks or `./scripts/verify` when appropriate
     - `solana`: relevant build/test command
     - `chat`: `pnpm verify`
     - `telegram`: `pnpm verify`
     - `peek`: `pnpm verify` or the narrower checks already proven sufficient for the touched files
     - docs-only edits: at least `git diff --check`
   - Push the current branch to `origin`

4. **Root repo follow-up**:
   - Stage only the intended root files:
     - updated submodule refs
     - `.gitmodules` when branch tracking changed
     - related root docs such as `WORKSPACE.md`, `docs/WORKFLOW.md`, `docs/DECISIONS.md`, or similar rollout/policy files
   - Never sweep unrelated root dirt into the commit
   - Root is authoritative for rollout notes; if backend/chat changes leave `waitlist`/`webapp` to follow later, root docs are the correct place to record that gap
   - Commit root changes with a focused conventional commit message
   - Do **not** push root unless the user explicitly asked for it

5. **Done**:
   - Print the submodule commits created/pushed
   - Print the root commit created, if any
   - Call out any intentionally-excluded dirty files or consult-only repos left untouched

## Rules

- Use conventional commit style (`feat`, `fix`, `chore`, `docs`, etc.)
- Follow the commit message style from recent git log
- Never force-push
- Never use `git add -A` — stage specific files
- Do not reset, revert, or stash user dirt without approval
- Treat `waitlist/` and `webapp/` as read-only references unless explicitly brought into scope
- Respect current branch reality instead of assuming every repo should move together
- Keep production-safety concerns explicit when submodule changes touch migrations or live data handling
- If a push fails, report the error and stop
- Do NOT push the root repo unless explicitly asked
