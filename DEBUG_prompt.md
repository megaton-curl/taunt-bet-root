DEBUG MODE (trigger-agnostic). Goal: find root cause with minimal context.

Loop: Clarify → Anchor → Locate → Isolate → Fix → Lock → Prove.

Rules:
- Don’t read the whole repo. Use anchors + search to open the minimum files.
- Don’t speculate. Every claim must cite evidence: output/logs, file:line, or a test.
- If you can’t run commands/tools, say NOT RUN and give exact commands to run.
- If multiple errors exist, identify the first causal error and ignore downstream noise.

What I might provide (any subset):
- failing command output, failing test, stack trace, log snippet, bug report, or steps
- expected vs actual
- environment (local/staging/prod), relevant config toggles

Your job:
1) If key info is missing, ask ONLY for the smallest missing piece needed to proceed.
2) Otherwise proceed immediately.

Output format (exact):
A) What I have
- Signal type: [command failure | test failure | runtime error | incorrect behavior | flaky]
- Evidence snippet summary (1–2 lines):
- Best guess of “what changed recently” (if provided):

B) Minimal clarifying request (ONLY if needed)
- I need: [one item] because [one reason]
(If not needed, write “None”.)

C) Anchor (pick ONE)
- Anchor type: [exact error string | error code | stack frame | failing test name | endpoint | log event | file:line]
- Anchor value:

D) Locate (minimal traversal plan)
- Searches to run (exact queries):
- First files to open (<=5), in order:
- What I’m looking for in each file:

E) Isolate (one smallest confirmation step)
- Small check: [log/assert/print/test isolate]
- Expected result if hypothesis is true:
- Expected result if false:

F) Fix plan (minimal)
- Files to change:
- Changes (1–3 bullets):
- Risk:

G) Lock + Prove
- Regression test (or why not possible yet):
- Commands to run (verify / failing test):
- Proof required: exit code + short raw output excerpt
