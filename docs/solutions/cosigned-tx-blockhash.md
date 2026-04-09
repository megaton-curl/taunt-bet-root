---
tags: [solana, wallet-adapter, transaction, frontend]
area: platform
---

# Co-signed transaction blockhash must not be overwritten

## Problem

Close Call betting broke silently — users got `WalletSendTransactionError: Unexpected error` on every bet attempt. No useful error details from the wallet adapter.

## Root cause

The `sendAndConfirm` helper always overwrote `transaction.recentBlockhash` with a fresh one before sending. For backend-cosigned transactions (where the server partially signs the tx), this invalidated the server's signature because the blockhash is part of the signed message.

Pre-flight simulation passed (simulations don't verify signatures), so the error only surfaced when the wallet adapter tried to actually send — it detected the signature mismatch internally and threw a generic "Unexpected error".

## Fix

Detect partial signatures before touching the blockhash:

```typescript
const hasPartialSignatures = transaction.signatures.some(
  (entry) => entry.signature !== null
);
const preservesExternalSignature =
  hasPartialSignatures && typeof transaction.recentBlockhash === "string";

if (!preservesExternalSignature) {
  transaction.recentBlockhash = freshBlockhash;
}
```

For preserved-signature txs: no retry (1 attempt), no blockhash overwrite. If `lastValidBlockHeight` is missing from the tx, fetch a fresh one just for confirmation tracking (doesn't affect the signature).

## Where this applies

Any frontend flow using backend co-signed transactions:
- `/closecall/bet` — Close Call betting
- `/fairness/flipyou/create` — FlipYou match creation
- `/fairness/lord/create` — Pot Shot round creation

Now handled by the shared `useSendAndConfirm` hook in `apps/platform/src/lib/useSendAndConfirm.ts`.

## Commits

- `22c66ef` fix(closecall): preserve backend signature + improve error messages
- `3937c07` refactor(platform): deduplicate sendAndConfirm across all games
