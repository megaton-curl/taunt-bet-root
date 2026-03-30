---
tags: [solana, anchor, error-handling, frontend]
area: platform
---

# Anchor error codes in frontend simulation errors

## Problem

When a transaction fails in pre-flight simulation, the error message contains the raw Anchor error code as JSON — e.g., `Transaction will fail: {"InstructionError":[0,{"Custom":6102}]}`. The `parseTransactionError` function only matched on string names like `"BettingClosed"` which appear in program logs, not in the error object. So program errors fell through to the generic handler, showing raw JSON to users.

## Error code ranges

| Range | Source |
|-------|--------|
| 0–99 | Solana runtime |
| 100–299 | Anchor account errors |
| 2000–2099 | Anchor constraint errors (e.g., 2012 = ConstraintAddress) |
| 3000–3099 | Anchor account state errors (e.g., 3012 = AccountNotInitialized) |
| 6000+ | Custom program errors (`#[error_code]` base offset = 6000) |

## Known game error codes

| Code | Program | Meaning |
|------|---------|---------|
| 6100 | closecall | InvalidPhase |
| 6101 | closecall | AlreadyBet |
| 6102 | closecall | BettingClosed (BettingWindowClosed) |
| 3012 | any | AccountNotInitialized (round PDA gone after settlement) |

## Fix

Match on both the string name AND the numeric code in the error message:

```typescript
if (msg.includes("BettingClosed") || msg.includes("Custom\":6102") || msg.includes("Custom:6102")) {
  return "Betting window has closed for this round.";
}
```

Also catch the `"Transaction will fail"` pattern as a generic simulation failure fallback.

Now handled by `createTransactionErrorParser` in `apps/platform/src/lib/parse-transaction-error.ts`.
