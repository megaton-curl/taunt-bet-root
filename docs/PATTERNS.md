# Patterns & Anti-Patterns

This document captures long-form engineering standards and examples.
Compact lessons belong in `docs/LESSONS.md` (enforced by CI).
**Goal**: Avoid repeating mistakes.

---

## Error Handling

### ❌ Anti-Pattern: Silencing Errors
Do not rename variables to `_unused` or comment out code just to satisfy the linter. This hides bugs.

```typescript
// BAD: Silencing the error
try {
  parse(data);
} catch (_error) {
  // swallowed
}
```

### ✅ Pattern: Fix the Root Cause
Handle the error explicitly. Log it, rethrow it, or handle it gracefully.

```typescript
// GOOD: Logging the error
try {
  parse(data);
} catch (error) {
  console.error("Failed to parse:", error);
  // handle failure
}
```

---

## Testing

### ❌ Anti-Pattern: Dummy Assertions
Do not write tests that just pass `expect(true).toBe(true)` unless it is a temporary scaffold (which must be logged in `TECH_DEBT.md`).

### ✅ Pattern: Test Behavior
Test the actual output or side effect.

---

## State Management

### ❌ Anti-Pattern: Blind `useEffect` Dependencies
Do not exclude dependencies from `useEffect` to avoid loops. This causes stale closures.

### ✅ Pattern: Correct Dependencies
Include all used variables. If it loops, use `useCallback` or `useMemo` to stabilize references, or refactor the logic.
