# Design: Split db.ts Into Domain Modules

**Date:** 2026-04-05
**Status:** Approved
**Scope:** `backend/services/backend/src/db.ts` (1870 lines) -> domain module split

## Problem

`db.ts` is a single 1870-line file containing all database types, interfaces, normalizers, and query implementations for every domain (rounds, close-call, referrals, profiles, stats, leaderboard, transactions, game entries, candles). Adding new queries means scrolling through unrelated domains. The file has grown organically as features shipped and is now the largest file in the backend.

## Approach: Domain Module Split

Split into domain modules while keeping one composed `Db` interface at `db.ts`. Each domain file exports its types, a partial interface, and a factory that takes `sql` and returns its method implementations. `db.ts` becomes the composition point.

### Alternatives Considered

1. **Class-based with mixins** — Would require rewriting the object-literal factory into a class hierarchy. Higher churn, no real benefit for this codebase's style (functional, raw SQL).
2. **Keep single file, just reorganize sections** — Doesn't solve the core problem (cognitive load, merge conflicts on a single file). Rejected.
3. **Domain module composition (chosen)** — Preserves the existing factory pattern, keeps the `Db` type structurally identical, allows incremental migration.

## Target Structure

```
services/backend/src/
  db.ts                          -- composition: Db type, createDb, re-exports
  db/
    types.ts                     -- shared types (RoundPhase, TransactionType, etc.)
    rounds.ts                    -- Round types + queries (coinflip/jackpot + operator events)
    closecall.ts                 -- CloseCall types + queries (rounds + settlement)
    closecall-candles.ts         -- Candle types + queries
    transactions.ts              -- Transaction types + queries
    game-entries.ts              -- GameEntry types + queries (upsert, getByRound)
    referrals.ts                 -- All referral types + queries (codes, links, earnings, claims, rates)
    profiles.ts                  -- PlayerProfile types + queries (create, get, update)
    stats.ts                     -- Stats/leaderboard types + queries (player stats, breakdown, streaks, leaderboard)
```

## Domain Boundaries

| File | Types | Methods | ~Lines | Dependencies |
|------|-------|---------|--------|-------------|
| `rounds.ts` | Round, InsertRoundParams, OperatorEvent, OperatorEventType | 8 (insert/delete/update/get round + 3 operator event + unsettled stats) | ~200 | types.ts (RoundPhase) |
| `closecall.ts` | CloseCallRound, InsertCloseCallRoundParams, CloseCallPhase, CloseCallOutcome | 5 | ~120 | none |
| `closecall-candles.ts` | CloseCallCandle | 3 | ~50 | none |
| `transactions.ts` | Transaction, InsertTransactionParams, TransactionType | 4 | ~80 | none |
| `game-entries.ts` | GameEntry, GameEntryUpsert, GameEntryInsert | 4 | ~50 | none |
| `referrals.ts` | ReferralCode, ReferralLink, ReferralEarning, ReferralStats, ReferralClaim | 12 | ~270 | none |
| `profiles.ts` | PlayerProfile | 7 | ~170 | username-gen.ts |
| `stats.ts` | PlayerStats, PublicPlayerStats, WinStreaks, GameBreakdownStats, LeaderboardEntry, LeaderboardResult | 9 | ~250 | none |

## Pattern: Domain Module Contract

Each domain file exports:

```typescript
// 1. Types
export interface FooDomain { /* types */ }

// 2. Partial Db interface (methods this domain provides)
export interface FooDb {
  methodA(params: FooParams): Promise<Foo>;
  methodB(id: string): Promise<Foo | undefined>;
}

// 3. Normalizer(s)
function normalizeFoo(row: Foo): Foo { /* ... */ }

// 4. Factory
export function createFooDb(sql: any): FooDb {
  return {
    async methodA(params) { /* sql query */ },
    async methodB(id) { /* sql query */ },
  };
}
```

## Composition in db.ts

```typescript
import { createRoundsDb, type RoundsDb } from "./db/rounds.js";
import { createReferralsDb, type ReferralsDb } from "./db/referrals.js";
// ... etc

// Composed Db type — structurally identical to the current Db interface
export type Db = RoundsDb & ReferralsDb & ProfilesDb & StatsDb
  & TransactionsDb & GameEntriesDb & CloseCallDb & CloseCallCandlesDb
  & CoreDb;

// CoreDb provides: withTransaction, rawSql, close
export interface CoreDb {
  withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  readonly rawSql: any;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string, _txSql?: any): Db {
  const sql = _txSql ?? postgres(databaseUrl);
  const _isOwner = !_txSql;

  return {
    ...createRoundsDb(sql),
    ...createReferralsDb(sql),
    ...createProfilesDb(sql),
    ...createStatsDb(sql),
    ...createTransactionsDb(sql),
    ...createGameEntriesDb(sql),
    ...createCloseCallDb(sql),
    ...createCloseCallCandlesDb(sql),
    rawSql: sql,
    async withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      return sql.begin(async (txSql: any) => fn(createDb(databaseUrl, txSql)));
    },
    async close() {
      if (_isOwner) await sql.end();
    },
  };
}
```

## Consumer Impact

- **37 files** import `Db` type from `db.ts` — no change needed (re-exported from same path)
- **6 test files + index.ts** import `createDb` — no change needed (re-exported from same path)
- **2 files** import named types (`CloseCallRound`, `Round`, `OperatorEvent`) — no change needed (re-exported)
- All existing imports continue to work unchanged via re-exports from `db.ts`

## Migration Strategy

1. Create `db/` directory with domain files, one at a time
2. Start with `referrals.ts` (largest, zero cross-domain deps, self-contained)
3. Move types + normalizers + implementations from `db.ts` to domain file
4. Update `db.ts` to import and spread the domain factory
5. Remove the moved code from `db.ts`
6. Typecheck after each domain extraction
7. Repeat for remaining domains in dependency order
8. `db.ts` shrinks to ~80 lines (imports, type composition, createDb shell, re-exports)

## Constraints

- **Zero consumer changes** — all existing imports from `db.ts` must continue to work
- **Structural type identity** — the composed `Db` type must be structurally identical to the current monolithic interface
- **Phase transition guard** stays in `db.ts` (or `types.ts`) since it's shared logic
- **No behavioral changes** — pure refactor, no query changes
- **Typecheck must pass** after each domain extraction (incremental safety)

## Order of Extraction

1. `referrals.ts` — largest, fully independent (prove the pattern)
2. `closecall.ts` — independent
3. `closecall-candles.ts` — independent
4. `transactions.ts` — independent
5. `game-entries.ts` — independent
6. `rounds.ts` — depends on types.ts for RoundPhase
7. `profiles.ts` — depends on username-gen.ts
8. `stats.ts` — independent (queries only reference game_entries/player_profiles tables)
9. Final: slim `db.ts` to composition shell + re-exports
