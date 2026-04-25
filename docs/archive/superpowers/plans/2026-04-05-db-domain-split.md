# db.ts Domain Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1870-line `db.ts` monolith into focused domain modules while maintaining a single composed `Db` type with zero consumer changes.

**Architecture:** Each domain gets its own file under `db/` exporting types, a partial interface, a normalizer, and a factory function. `db.ts` becomes a thin composition shell that imports all domain factories, composes them via object spread, and re-exports all types. All 37+ consumer files continue importing from `db.ts` unchanged.

**Tech Stack:** TypeScript, postgres.js (raw SQL), structural typing for interface composition.

**Spec:** `docs/superpowers/specs/2026-04-05-db-domain-split-design.md`

**Verification:** `cd backend && pnpm typecheck` after every task. `cd backend && pnpm lint` at the end. No behavioral changes — existing test suite covers correctness.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/src/db/referrals.ts` | Referral types + 12 methods (codes, links, earnings, claims, rates) |
| Create | `backend/src/db/closecall.ts` | CloseCall round types + 5 methods |
| Create | `backend/src/db/closecall-candles.ts` | Candle types + 3 methods |
| Create | `backend/src/db/transactions.ts` | Transaction types + 4 methods |
| Create | `backend/src/db/game-entries.ts` | GameEntry types + 4 methods |
| Create | `backend/src/db/rounds.ts` | Round types + operator event types + phase guard + 10 methods |
| Create | `backend/src/db/profiles.ts` | PlayerProfile type + 7 methods |
| Create | `backend/src/db/stats.ts` | Stats/leaderboard types + 9 methods |
| Modify | `backend/src/db.ts` | Slim to ~80 lines: imports, Db composition, createDb shell, re-exports |

---

### Task 1: Extract referrals domain

Largest domain (12 methods, ~270 lines), zero cross-domain dependencies. Proves the pattern.

**Files:**
- Create: `backend/src/db/referrals.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/referrals.ts`**

Move from `db.ts` into the new file:
- Types: `ReferralCode`, `ReferralLink`, `ReferralEarning`, `ReferralStats`, `ReferralClaim` (lines 132-187)
- Normalizer: `normalizeReferralEarning` (lines 710-720)
- Interface: Extract a `ReferralsDb` interface containing the 12 referral method signatures from the `Db` interface (lines 430-533)
- Factory: `createReferralsDb(sql: any): ReferralsDb` returning an object with all 12 method implementations moved from `createDb` (lines 1228-1429)

The file structure:

```typescript
import postgres from "postgres";

// --- Types (moved from db.ts) ---
export interface ReferralCode { /* ... */ }
export interface ReferralLink { /* ... */ }
export interface ReferralEarning { /* ... */ }
export interface ReferralStats { /* ... */ }
export interface ReferralClaim { /* ... */ }

// --- Interface ---
export interface ReferralsDb {
  insertReferralCode(userId: string, wallet: string, code: string): Promise<ReferralCode>;
  getReferralCodeByUserId(userId: string): Promise<ReferralCode | undefined>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | undefined>;
  insertReferralLink(params: { referrerUserId: string; refereeUserId: string; referrerWallet: string; refereeWallet: string }): Promise<ReferralLink>;
  getReferralLinkByRefereeUserId(refereeUserId: string): Promise<ReferralLink | undefined>;
  getReferralLinksByReferrerUserId(referrerUserId: string): Promise<ReferralLink[]>;
  insertReferralEarning(params: { /* all fields */ }): Promise<ReferralEarning>;
  getPendingBalanceByUserId(userId: string): Promise<string>;
  getReferralEarningsByUserId(userId: string, page: number, limit: number): Promise<{ items: ReferralEarning[]; totalPages: number }>;
  getReferralStatsByUserId(userId: string): Promise<ReferralStats>;
  insertReferralClaim(userId: string, wallet: string, amountLamports: string): Promise<ReferralClaim>;
  getReferralClaim(claimId: string): Promise<ReferralClaim | undefined>;
  updateClaimStatus(claimId: string, status: ReferralClaim["status"], meta?: { txSignature?: string; error?: string; incrementRetry?: boolean }): Promise<ReferralClaim>;
  getReferrerRate(userId: string, defaultRateBps: number): Promise<number>;
}

// --- Normalizer (moved from db.ts) ---
function normalizeReferralEarning(row: ReferralEarning): ReferralEarning { /* ... */ }

// --- Factory ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createReferralsDb(sql: any): ReferralsDb {
  return {
    // all 12 method implementations moved verbatim from createDb
  };
}
```

Copy the full method implementations verbatim — no behavioral changes.

- [ ] **Step 2: Update `db.ts` — import and compose referrals**

In `db.ts`:
1. Add import: `import { createReferralsDb, type ReferralsDb } from "./db/referrals.js";`
2. Re-export types: `export type { ReferralCode, ReferralLink, ReferralEarning, ReferralStats, ReferralClaim } from "./db/referrals.js";`
3. Remove the moved type definitions, normalizer, interface methods, and implementations from `db.ts`
4. In the `Db` interface, replace the referral method signatures with: extend from `ReferralsDb` (or use intersection in the final composition — for now, just remove the methods since the `Db` interface will be composed at the end)
5. In `createDb`, spread the factory: `...createReferralsDb(sql),` — and remove the 12 method implementations

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: All packages pass with zero errors.

- [ ] **Step 4: Commit**

```
git add backend/src/db/ backend/src/db.ts
git commit -m "refactor(db): extract referrals domain to db/referrals.ts"
```

---

### Task 2: Extract closecall domain

**Files:**
- Create: `backend/src/db/closecall.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/closecall.ts`**

Move from `db.ts`:
- Types: `CloseCallPhase`, `CloseCallOutcome`, `CloseCallRound`, `InsertCloseCallRoundParams` (lines 17-45)
- Normalizer: `normalizeCloseCallRound` (lines 684-701)
- Interface: `CloseCallDb` with 5 method signatures (lines 374-398)
- Factory: `createCloseCallDb(sql: any): CloseCallDb` with 5 implementations (lines 941-1028)

Import `postgres` for `sql.json()`.

- [ ] **Step 2: Update `db.ts`**

1. Import and re-export types from `./db/closecall.js`
2. Remove moved types, normalizer, interface methods, implementations
3. Spread `...createCloseCallDb(sql)` in `createDb`

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract closecall domain to db/closecall.ts"
```

---

### Task 3: Extract closecall-candles domain

**Files:**
- Create: `backend/src/db/closecall-candles.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/closecall-candles.ts`**

Move from `db.ts`:
- Types: `CloseCallCandle` (lines 268-273)
- Interface: `CloseCallCandlesDb` with 3 method signatures (lines 633-646)
- Factory: `createCloseCallCandlesDb(sql: any): CloseCallCandlesDb` with 3 implementations (lines 1114-1152)

No normalizer — inline conversion in implementations.

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract closecall-candles domain to db/closecall-candles.ts"
```

---

### Task 4: Extract transactions domain

**Files:**
- Create: `backend/src/db/transactions.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/transactions.ts`**

Move from `db.ts`:
- Types: `TransactionType`, `Transaction`, `InsertTransactionParams` (lines 105-126)
- Normalizer: `normalizeTransaction` (lines 703-708)
- Interface: `TransactionsDb` with 4 method signatures (lines 404-424)
- Factory: `createTransactionsDb(sql: any): TransactionsDb` with implementations for `insertTransaction`, `insertTransactions`, `getTransactions`, `getTransactionsByUserId` (lines 1034-1222)

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract transactions domain to db/transactions.ts"
```

---

### Task 5: Extract game-entries domain

**Files:**
- Create: `backend/src/db/game-entries.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/game-entries.ts`**

Move from `db.ts`:
- Types: `GameEntryUpsert`, `GameEntryInsert` (deprecated alias), `GameEntry` (lines 237-266)
- Normalizer: `normalizeGameEntry` (lines 748-763)
- Interface: `GameEntriesDb` with 4 method signatures (lines 607-627)
- Factory: `createGameEntriesDb(sql: any): GameEntriesDb` with implementations (lines 1067-1108)

Note: `upsertGameEntries` and `insertGameEntries` use `this.upsertGameEntry(entry)` internally. Since `this` binds to the call-site object (the composed Db), this works after spreading. But to be safe and self-contained, change these to call `upsertGameEntry(entry)` directly within the factory's closure — i.e., reference the local function, not `this`:

```typescript
export function createGameEntriesDb(sql: any): GameEntriesDb {
  const db: GameEntriesDb = {
    async upsertGameEntry(entry) { /* sql query */ },
    async upsertGameEntries(entries) {
      if (entries.length === 0) return;
      for (const entry of entries) {
        await db.upsertGameEntry(entry);  // local reference, not this
      }
    },
    async getEntriesByRound(roundPda) { /* ... */ },
    async insertGameEntries(entries) {
      if (entries.length === 0) return;
      await db.upsertGameEntries(entries);  // local reference
    },
  };
  return db;
}
```

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract game-entries domain to db/game-entries.ts"
```

---

### Task 6: Extract rounds domain

**Files:**
- Create: `backend/src/db/rounds.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/rounds.ts`**

Move from `db.ts`:
- Types: `RoundPhase`, `Round`, `InsertRoundParams`, `OperatorEventType`, `OperatorEvent` (lines 15, 47-99)
- Phase transition guard: `VALID_TRANSITIONS` + `assertPhaseTransition` (lines 297-313)
- Normalizer: `normalizeRound` (lines 731-746)
- Interface: `RoundsDb` with 10 method signatures (lines 320-368)
- Factory: `createRoundsDb(sql: any): RoundsDb` with implementations (lines 774-935)

Import `postgres` for `sql.json()`.

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code. `RoundPhase` must be re-exported since `rounds.ts` route file imports it indirectly via types.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract rounds domain to db/rounds.ts"
```

---

### Task 7: Extract profiles domain

**Files:**
- Create: `backend/src/db/profiles.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/profiles.ts`**

Move from `db.ts`:
- Types: `PlayerProfile` (lines 193-203)
- Normalizer: `normalizePlayerProfile` (lines 722-729)
- Import: `generateUserId`, `generateUsername` from `../utils/username-gen.js` (relative path from `db/`)
- Interface: `ProfilesDb` with 7 method signatures (lines 538-564)
- Factory: `createProfilesDb(sql: any): ProfilesDb` with implementations (lines 1435-1562)

Note: `getOrCreateProfile` uses `this.createPlayerProfile(wallet)`. Handle with local reference pattern (same as game-entries):

```typescript
export function createProfilesDb(sql: any): ProfilesDb {
  const db: ProfilesDb = {
    async createPlayerProfile(wallet) { /* ... */ },
    async getOrCreateProfile(wallet) {
      const existing = await sql<PlayerProfile[]>`...`;
      if (existing[0]) return normalizePlayerProfile(existing[0]);
      return db.createPlayerProfile(wallet);  // local reference
    },
    // ... other methods
  };
  return db;
}
```

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code. Remove `import { generateUserId, generateUsername }` from `db.ts` since it's no longer needed there.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract profiles domain to db/profiles.ts"
```

---

### Task 8: Extract stats domain

**Files:**
- Create: `backend/src/db/stats.ts`
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create `db/stats.ts`**

Move from `db.ts`:
- Types: `PlayerStats`, `PublicPlayerStats`, `WinStreaks`, `GameBreakdownStats`, `LeaderboardEntry`, `LeaderboardResult` (lines 205-291)
- Interface: `StatsDb` with 9 method signatures (lines 570-601 + 652-667)
- Factory: `createStatsDb(sql: any): StatsDb` with implementations (lines 1564-1859)

Note: `getPublicPlayerStats` calls `this.getPlayerStats()` and `getPublicPlayerStatsByUserId` calls `this.getPlayerStatsByUserId()`. Use local reference pattern:

```typescript
export function createStatsDb(sql: any): StatsDb {
  const db: StatsDb = {
    async getPlayerStats(wallet) { /* ... */ },
    async getPlayerStatsByUserId(userId) { /* ... */ },
    async getPublicPlayerStats(wallet) {
      const full = await db.getPlayerStats(wallet);  // local reference
      return { gamesPlayed: full.gamesPlayed, totalWins: full.totalWins, winRate: full.winRate };
    },
    async getPublicPlayerStatsByUserId(userId) {
      const full = await db.getPlayerStatsByUserId(userId);  // local reference
      return { gamesPlayed: full.gamesPlayed, totalWins: full.totalWins, winRate: full.winRate };
    },
    // ... remaining methods
  };
  return db;
}
```

- [ ] **Step 2: Update `db.ts`**

Import, re-export, spread, remove moved code.

- [ ] **Step 3: Typecheck**

Run: `cd backend && pnpm typecheck`

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): extract stats domain to db/stats.ts"
```

---

### Task 9: Finalize db.ts composition shell

After all 8 domains are extracted, `db.ts` should be ~80 lines: imports, composed `Db` type, `createDb`, re-exports.

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Clean up db.ts**

The file should now contain only:
1. `import postgres from "postgres"`
2. Imports from all 8 domain modules
3. Re-exports of all types (so consumers don't need to change imports)
4. `CoreDb` interface (`withTransaction`, `rawSql`, `close`)
5. Composed `Db` type: `export type Db = RoundsDb & CloseCallDb & CloseCallCandlesDb & TransactionsDb & GameEntriesDb & ReferralsDb & ProfilesDb & StatsDb & CoreDb`
6. `createDb` function that spreads all domain factories + core methods

Verify no leftover types, normalizers, or implementations remain.

- [ ] **Step 2: Full verification**

Run: `cd backend && pnpm typecheck && pnpm lint`
Expected: Zero errors. Warnings should be identical to pre-refactor (all pre-existing `no-explicit-any` in test files).

- [ ] **Step 3: Run tests**

Run: `cd backend && pnpm test`
Expected: All existing tests pass (no behavioral changes).

- [ ] **Step 4: Commit**

```
git commit -m "refactor(db): finalize domain split — db.ts is now composition shell"
```

---

## Verification Summary

- **After each task (1-8):** `pnpm typecheck` must pass
- **After task 9:** `pnpm typecheck && pnpm lint && pnpm test` must all pass
- **Consumer check:** zero import changes in any file outside `db.ts` and `db/`
- **Line count target:** `db.ts` drops from 1870 to ~80 lines
