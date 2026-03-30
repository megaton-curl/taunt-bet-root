# Solutions (solved problems)

Short writeups for **non-trivial fixes and debugging**: repro, what worked, links, commands—so the next session does not relearn from chat history.

## When to use this folder vs `docs/LESSONS.md`

| Use | When |
|-----|------|
| **`docs/LESSONS.md`** | One compact line—a recurring rule or principle. |
| **`docs/solutions/`** | More than a slogan: steps, context, or anything you would grep for next time. |

You can do both: a line in `LESSONS.md` *and* a solution doc for the full recipe.

## Optional frontmatter (helps search and agents)

```yaml
---
tags: [solana, rpc]
area: platform
---
```

## Files

- Name with `kebab-case-topic.md` (e.g. `rpc-timeouts-devnet.md`).
- Keep them short; link to PRs, specs, or code paths instead of pasting huge logs.
