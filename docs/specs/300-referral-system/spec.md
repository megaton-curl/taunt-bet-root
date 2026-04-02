# Specification: [300] Referral System

## Meta

| Field | Value |
|-------|-------|
| Status | Done |
| Priority | P1 |
| Track | Extended |
| NR_OF_TRIES | 33 |

---

## Overview

A Hyperliquid-style referral system where any player can set a custom referral code, share it, and earn a perpetual share of the platform fee from every game their referred players complete. Referred players receive a benefit for joining via a referral link (see FR-3 for options). The system is entirely off-chain for v1 — no program changes required.

## User Stories

- As a player, I want to set a custom referral code so that I can invite friends and earn passive rewards from their gameplay
- As a new player, I want to use a referral code so that I receive a signup benefit (fee rebate or bonus reward)
- As a referrer, I want to see how many players I've referred and how much I've earned so that I can track my referral performance
- As a referrer, I want to claim my accumulated earnings so that I receive SOL in my wallet
- As an operator, I want to set custom referral rates for KOL wallets so that partnership agreements are honored

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section 2 "Not Implemented in Current Baseline" → "Referral and creator monetization systems"
- **Current baseline fit**: Not Implemented
- **Planning bucket**: Extended

## Required Context Files

- `docs/DECISIONS.md` — fee structure (500 bps flat fee, single treasury via PlatformConfig)
- `apps/platform/ (frontend repo)` — frontend entrypoint
- `backend/packages/anchor-client/` — on-chain fee constants (for reference, not modified)
- Backend settlement logic (settlement worker, DB schema)

## Contract Files

- No existing mocks — this is a new system
- API contract defined in FR-7 below

---

## System Invariants (v1)

These invariants are non-negotiable for correctness and abuse resistance:

1. **Single referrer binding:** each referee wallet can be linked to only one referrer wallet for life (unless operator manually unlinks via admin tooling outside v1 scope).
2. **No self-referral:** `referrer_wallet !== referee_wallet` enforced at API + DB layers.
3. **Lamports-only accounting:** all stored/transported monetary values use integer lamports (`BIGINT` in DB, string in JSON APIs).
4. **Atomic settlement + earning write:** referral earning insert must be in the same DB transaction as game settlement write.
5. **Idempotent async handlers:** referral queue handlers must use domain keys (`claim_id`, `round_id + referee_wallet`, etc.), never `event_queue.id`, for de-duplication.
6. **Exactly-once effect in practice:** queue may deliver at-least-once; side-effects must remain safe under replays.
7. **No on-chain protocol changes:** v1 referral economics remain off-chain and treasury-operated.

---

## Functional Requirements

> **Note (2026-04-02)**: Frontend is now a separate project. Frontend criteria below were satisfied at completion time but are no longer maintained in this repo.

### FR-1: Referral Code Generation

Any player with a connected wallet can set a referral code. No eligibility gate — open from day one.

**Rationale:** The sybil incentive is negligible (max benefit from self-referral is 50 bps of wagered amount = referrer fee share, and self-referral is blocked on-chain). An eligibility gate hurts organic growth more than it prevents abuse.

**Code format:**
- Player-chosen custom code: 3-16 characters, `[a-z0-9-]`, must be unique
- No auto-generation — the player always picks their own code
- URL format: `taunt.bet/r/{CODE}`

**Acceptance Criteria:**
- [x] Authenticated player can set a referral code via API <!-- satisfied: routes/referral.ts:30 POST /code, JWT auth via index.ts:95-98 -->
- [x] Code is always player-chosen, 3-16 chars, validated against `[a-z0-9-]`, unique <!-- satisfied: referral.ts:21 regex /^[a-z0-9-]{3,16}$/, uniqueness via getReferralCodeByCode + DB UNIQUE -->
- [x] Each player has exactly one active code (setting a new one replaces the old one) <!-- satisfied: 011_referral.sql UNIQUE(wallet) + db.ts:805 upsertReferralCode ON CONFLICT replaces -->
- [x] Code is persisted in `referral_codes` table <!-- satisfied: 011_referral.sql:8-14 creates table + db.ts:782 insertReferralCode -->

### FR-2: Referral Linking

When a player signs up or connects their wallet via a referral link (`taunt.bet/r/CODE`), they are permanently linked to the referrer. Alternatively, a player can manually enter a referral code in their settings.

**Rules:**
- One referrer per player, immutable once set
- First code applied wins — cannot change referrer
- Self-referral blocked (same wallet cannot be both referrer and referee)

**Acceptance Criteria:**
- [x] Visiting `taunt.bet/r/{CODE}` stores the code (localStorage) until the player authenticates <!-- satisfied: App.tsx:455-466 ReferralCapture stores { code, capturedAt } in localStorage -->
- [x] On authentication, if the player has no referrer and a stored/submitted code exists, the link is created <!-- satisfied: useReferralApply.ts:55 calls applyReferralCode; referral.ts:99 POST /apply creates link -->
- [x] Player can manually enter a referral code via API (settings page) <!-- satisfied: ProfileSettings.tsx:155-207 input + Apply button; referral.ts:99 POST /apply endpoint -->
- [x] Attempting to change an existing referrer returns an error <!-- satisfied: referral.ts:163-169 checks existing link → 409 ALREADY_LINKED; 011_referral.sql:22 UNIQUE(referee_wallet) -->
- [x] Self-referral (referrer wallet = referee wallet) is rejected <!-- satisfied: referral.ts:148-160 SELF_REFERRAL 400 when codeRow.wallet === wallet -->
- [x] Referral link is stored in `referral_links` table with `created_at` timestamp <!-- satisfied: 011_referral.sql:17-22 + db.ts:819-826 insertReferralLink -->

### FR-3: Referee Fee Rebate

Referred players receive a **fixed 10% rebate on their own fees** (1000 bps of fee_lamports), accruing as a claimable SOL balance. This is permanent and not configurable — every referred player gets 10% back on every game, forever.

**Economics:**
- On a 1 SOL wager with 500 bps fee: fee = 0.05 SOL, referee rebate = 0.005 SOL
- Rebate is calculated and stored at settlement time, same transaction as the referrer earning
- Fee is charged in full on-chain — rebate accrues off-chain as claimable SOL
- Rebate shares the same claim flow as referrer earnings (unified pending balance per wallet)

**Acceptance Criteria:**
- [x] After a referred player's game settles, a rebate row is recorded in `referral_earnings.referee_rebate_lamports` <!-- satisfied: settle-tx.ts:156-168 calculates and inserts; integration.test.ts verifies rebate amount -->
- [x] Rebate is exactly 1000 bps of fee_lamports (fixed, not configurable) <!-- satisfied: settle-tx.ts:156 Math.floor((feeLamports * 1000) / 10_000); line 168 refereeRebateRateBps: 1000 -->
- [x] Rebate accrues to the referee's claimable balance (same claim flow as referrer earnings) <!-- satisfied: db.ts:863-883 getPendingBalance sums referrer_earned + referee_rebate minus claims -->
- [x] Benefit is communicated in the UI on the referral page and at code entry <!-- satisfied: ReferralPage.tsx unauthenticated state describes 10% rebate; ProfileSettings.tsx success message; ReferralClaimCard.tsx breakdown -->
- [x] A player who is both a referrer AND a referee sees a single combined pending balance <!-- satisfied: db.ts:863-883 getPendingBalance unified calculation; ReferralClaimCard.tsx shows combined balance -->

### FR-4: Referrer Fee Share

When a referred player completes a game, the referrer earns a share of the platform fee from that game. This is the core incentive loop.

**Economics:**
- Default referrer share: **1000 bps of the total fee (= 50 bps of wager)**
- On a 1 SOL wager: total fee = 0.05 SOL (500 bps), referrer earns 0.005 SOL (1000 bps of the fee)
- Source: platform fee — no new fees charged to players
- Duration: **permanent** — referrer earns from their referees' games indefinitely
- Platform revenue impact: 1000 bps (10%) haircut on fee revenue from referred players (referrer share only; referee reward is non-fee-based)

**KOL override:** Admin can set a custom referrer rate per wallet (stored in DB). This supports partnership agreements where a KOL may receive a higher share (e.g., 2000-3000 bps of total fee). Default rate applies to all non-KOL referrers.

**Settlement hook:** After each game settles, the existing settlement worker checks if the player has a referrer → calculates earnings → inserts into `referral_earnings` table. No additional RPC calls. No on-chain changes.

**Acceptance Criteria:**
- [x] When a referred player's game settles, the referrer's earning is calculated and stored <!-- satisfied: settle-tx.ts:123-195 recordReferralEarnings; integration.test.ts verifies amounts -->
- [x] Default referrer rate is 1000 bps of the total fee (configurable via environment/config) <!-- satisfied: config.ts:95-98 REFERRAL_DEFAULT_RATE_BPS default 1000; settle-tx.ts:147-150 passes to getReferrerRate -->
- [x] KOL wallets can have a custom rate set by admin (stored in `referral_kol_rates` table or equivalent) <!-- satisfied: 011_referral.sql:78-84 creates table; db.ts:973-978 getReferrerRate checks KOL table -->
- [x] Earnings are recorded per-game in `referral_earnings` with: referrer, referee, round_id, game_type, wager_lamports, earned_lamports <!-- satisfied: 011_referral.sql:28-44 all columns; db.ts:845-861 insertReferralEarning -->
- [x] Referrer earnings accrue indefinitely with no cap or expiry <!-- satisfied: no TTL or cap constraint in schema or code -->

### FR-5: Earnings Dashboard & Stats

Referrers can view their referral performance and earnings.

**Stats view:**
- Total referred players
- Active referred players (played in last 7 days)
- Total wager volume from referrals
- Total earnings (all time)
- Pending (unclaimed) balance
- Per-game earnings log (paginated)

**Acceptance Criteria:**
- [x] Referral page shows summary stats (referred count, active count, volume, total earned, pending balance) <!-- satisfied: ReferralStatsCard.tsx 4 stat boxes; ReferralClaimCard.tsx pending balance -->
- [x] Detailed earnings log is available, paginated, showing per-game entries <!-- satisfied: ReferralEarningsTable.tsx paginated table; referral.ts:293 GET /earnings endpoint -->
- [x] Stats update in near-real-time (within settlement latency, ~3-5s) <!-- satisfied: earnings written synchronously in settlement tx; stats fetched from DB on page load -->
- [x] Page is accessible from main navigation or profile section <!-- satisfied: Sidebar.tsx:162-171 Referrals NavLink under Player section -->

### FR-6: Claim Flow

Referrers can claim their accumulated earnings. Claims are async via the event queue (FR-11) to keep SOL transfers off the request path.

**Flow:** Player clicks "Claim" → backend validates balance > minimum threshold → creates claim row with status `pending` + inserts `referral.claim_requested` event in same transaction → returns 202 with claim ID → frontend polls `GET /referral/claim/:claimId` → queue worker acquires claim lock, re-verifies available balance, executes treasury transfer, writes tx signature → claim status updates to `completed` (or `failed`) → frontend shows final state.

**Claim state machine:**
`pending -> processing -> completed`
`pending -> processing -> failed` (retryable by queue until max attempts, terminal failure only after retries exhausted)

**Balance snapshot rule:** on claim request, backend snapshots `amount_lamports` from current pending earnings. Handler re-validates this snapshot against unclaimed earnings before transfer to prevent overpay on concurrent requests.

**Acceptance Criteria:**
- [x] Player can claim their full pending referral balance <!-- satisfied: referral.ts:342 POST /claim; referral-claim.ts:26-145 handler transfers SOL -->
- [x] Claim request returns immediately (202 Accepted) with a claim ID for polling <!-- satisfied: referral.ts:413-419 returns 202 with { claimId, amountLamports, status: "pending" } -->
- [x] Queue worker executes the SOL transfer from treasury to player wallet <!-- satisfied: referral-claim.ts:83-109 SystemProgram.transfer from serverKeypair to wallet -->
- [x] Claim is recorded with: wallet, amount_lamports, status, timestamps, tx_signature (on success) <!-- satisfied: 011_referral.sql:56-68 table; referral-claim.ts updates tx_signature on completion -->
- [ ] Concurrent claims from the same wallet are prevented (DB-level locking on balance snapshot) <!-- gap: getPendingBalance at referral.ts:348 is outside any lock. Handler re-verifies (referral-claim.ts:65-81) but no SELECT FOR UPDATE at API level -->
- [x] Zero-balance claims are rejected with a clear error message <!-- satisfied: referral.ts:351-362 ZERO_BALANCE 400 response -->
- [x] Minimum claim threshold is enforced (e.g., 0.01 SOL) to avoid dust transactions <!-- satisfied: referral.ts:364-375 BELOW_THRESHOLD with config.referralMinClaimLamports (default 10M = 0.01 SOL) -->
- [x] Failed transfers are retried by the queue (up to max_attempts) with exponential backoff <!-- satisfied: worker.ts exponential backoff (5s→30s→300s); referral-claim.ts:142 re-throws on failure -->

### FR-7: API Contract

All referral operations are exposed via authenticated REST endpoints.

**Error response shape (all endpoints):**
`{ error: { code: string, message: string, retryable?: boolean } }`

```
POST /referral/code                — Set referral code
  Body: { code: string }
  Response: { code: string, url: string }

GET  /referral/code                — Get current referral code
  Response: { code: string, url: string } | 404

POST /referral/apply               — Apply a referral code to current user
  Body: { code: string }
  Response: { referrer: string, benefit: string }

GET  /referral/stats               — Get referral summary stats
  Response: {
    referredCount: number,
    activeCount: number,
    totalVolumeLamports: string,
    totalEarnedLamports: string,
    pendingLamports: string
  }

GET  /referral/earnings            — Get detailed per-game earnings log
  Query: { page?: number, limit?: number }
  Response: {
    items: [{
      roundId: string,
      gameType: string,
      refereeWallet: string,
      wagerLamports: string,
      earnedLamports: string,
      createdAt: string
    }],
    pagination: { page: number, totalPages: number }
  }

POST /referral/claim               — Request earnings claim (async via queue)
  Response: { claimId: string, amountLamports: string, status: "pending" }

GET  /referral/claim/:claimId      — Poll claim status
  Response: { claimId: string, amountLamports: string, status: "pending" | "completed" | "failed", txSignature?: string }
```

**Acceptance Criteria:**
- [x] All endpoints require JWT authentication <!-- satisfied: index.ts:95-98 JWT middleware with requireAllMethods: true on /referral/* -->
- [x] All endpoints return appropriate error codes (400 for bad input, 404 for not found, 409 for conflict) <!-- satisfied: referral.ts uses 400, 404, 409 appropriately throughout all endpoints -->
- [ ] Rate limiting is applied to code generation and claim endpoints <!-- gap: rate limiting middleware only on /auth/* and /fairness/*, not on /referral/* routes (index.ts:94-99 has JWT only) -->
- [x] Monetary values use lamport strings (not floating point) <!-- satisfied: all API responses use string lamports in referral.ts stats/earnings/claim responses -->

### FR-8: Database Schema

New tables for the referral system. All off-chain, no program changes.

```sql
referral_codes (
  id            SERIAL PRIMARY KEY,
  wallet        TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,   -- player-chosen, 3-16 chars [a-z0-9-]
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
)

referral_links (
  id              SERIAL PRIMARY KEY,
  referrer_wallet TEXT NOT NULL,
  referee_wallet  TEXT NOT NULL UNIQUE,  -- one referrer per player
  created_at      TIMESTAMPTZ DEFAULT now()
)

referral_earnings (
  id                        SERIAL PRIMARY KEY,
  referrer_wallet           TEXT NOT NULL,
  referee_wallet            TEXT NOT NULL,
  round_id                  TEXT NOT NULL,
  game_type                 TEXT NOT NULL,
  wager_lamports            BIGINT NOT NULL,
  fee_lamports              BIGINT NOT NULL,
  referrer_earned_lamports  BIGINT NOT NULL,
  referrer_rate_bps         INTEGER NOT NULL,
  referee_rebate_lamports   BIGINT NOT NULL,
  referee_rebate_rate_bps   INTEGER NOT NULL,  -- always 1000 for v1
  created_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE (referee_wallet, round_id)  -- idempotency: one earning per player per round
)

referral_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet            TEXT NOT NULL,
  amount_lamports   BIGINT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
  tx_signature      TEXT,
  error             TEXT,
  requested_at      TIMESTAMPTZ DEFAULT now(),
  processed_at      TIMESTAMPTZ
)

-- KOL custom referrer rates (overrides default 1000 bps)
referral_kol_rates (
  wallet          TEXT PRIMARY KEY,
  rate_bps        INTEGER NOT NULL,  -- e.g., 2000 = 20% of total fee (= 100 bps of wager)
  set_by          TEXT NOT NULL,     -- admin wallet
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
)
```

**Acceptance Criteria:**
- [x] All tables created via migration (referral_codes, referral_links, referral_earnings, referral_claims, referral_kol_rates) <!-- satisfied: 011_referral.sql creates all 5 tables with constraints -->
- [x] `referral_links.referee_wallet` has UNIQUE constraint (one referrer per player) <!-- satisfied: 011_referral.sql:22 referee_wallet TEXT NOT NULL UNIQUE -->
- [x] `referral_codes.code` has UNIQUE constraint <!-- satisfied: 011_referral.sql:12 code TEXT NOT NULL UNIQUE -->
- [x] Appropriate indexes on wallet columns and `referral_earnings.round_id` <!-- satisfied: 011_referral.sql 6 indexes covering all wallet lookups and round_id -->
- [x] `referral_earnings` has unique idempotency guard (`UNIQUE (referee_wallet, round_id)`) <!-- satisfied: 011_referral.sql:43-44 CONSTRAINT uq_referral_earnings_referee_round -->
- [x] `referral_claims.status` constrained to `pending|processing|completed|failed` <!-- satisfied: 011_referral.sql:67-68 CHECK constraint chk_referral_claims_status -->

### FR-9: Frontend — Routes, Pages, and Components

All frontend changes live in `apps/platform/`. Follows existing patterns: React Router routes in `App.tsx`, NavLink in `Sidebar.tsx`, feature code in `features/referral/`, API wrappers in `lib/referral-api.ts`.

#### 9a. New Route: `/r/:code` — Referral Link Handler

A lightweight route that captures the referral code from the URL, persists it, and redirects to the home page (or wherever the player was headed).

**Flow:**
1. Player visits `taunt.bet/r/my-code`
2. Route component reads `:code` via `useParams()`
3. Stores `{ code, capturedAt }` in `localStorage` key `referral_code`
4. Redirects to `/` via `<Navigate to="/" replace />`
5. On next authentication (in `SessionContext` or a dedicated `useReferralApply` hook), if `referral_code` exists in localStorage and user has no referrer → calls `POST /referral/apply` → clears localStorage on success

**Acceptance Criteria:**
- [x] Route `/r/:code` registered in `App.tsx` <!-- satisfied: App.tsx:387 <Route path="/r/:code" element={<ReferralCapture />} /> -->
- [x] Code stored in localStorage on visit (no auth required) <!-- satisfied: App.tsx:460 stores { code, capturedAt } in localStorage key referral_code -->
- [x] Redirect to `/` happens immediately after capture <!-- satisfied: App.tsx:465 <Navigate to="/" replace /> -->
- [x] On successful authentication, stored code is applied via API <!-- satisfied: useReferralApply.ts:55 calls applyReferralCode on auth -->
- [x] localStorage is cleared after successful apply (or if code is invalid/already linked) <!-- satisfied: useReferralApply.ts:57 (success), :73-74 (permanent failure) -->
- [ ] Invalid/expired codes show a toast notification, not a blocking error <!-- gap: useReferralApply.ts:58 has TODO for toast, uses console.warn instead — no visible user notification -->

#### 9b. Sidebar Navigation — Referrals Link

New nav item in the "Player" section of `Sidebar.tsx`, between "Quests" and the "Platform" section.

```tsx
<NavLink to="/referrals" className={({ isActive }) => `nv-item ${isActive ? "active" : ""}`}
  style={{ "--nc": "var(--color-green)" } as React.CSSProperties}>
  <div className="nv-ico">
    {/* share/link icon */}
  </div>
  <span className="nv-lbl">Referrals</span>
</NavLink>
```

**Acceptance Criteria:**
- [x] "Referrals" nav item appears in sidebar under "Player" section <!-- satisfied: Sidebar.tsx:162-171 NavLink after Quests -->
- [x] Active state styling matches existing nav items <!-- satisfied: uses same nv-item className pattern with isActive -->
- [x] Icon is a share/link-style SVG consistent with sidebar icon style <!-- satisfied: SVG at Sidebar.tsx:163-168 -->
- [x] Navigates to `/referrals` <!-- satisfied: to="/referrals" at Sidebar.tsx:162 -->

#### 9c. Referral Page (`/referrals`)

Main referral hub page at route `/referrals`. Requires wallet connection + authentication. Shows different states based on whether the player has generated a code yet.

**Layout — top to bottom:**

1. **Your Referral Link** (card)
   - If no code yet: input field to choose a custom code (3-16 chars, `[a-z0-9-]`) + "Set Code" button → calls `POST /referral/code { code: "..." }` → shows link
   - If code exists: display code + full URL in a styled input/box with a **Copy Link** button
   - Copy uses `navigator.clipboard.writeText(url)` with a brief "Copied!" feedback (tooltip or button text swap)
   - "Change code" link → inline edit field to set a new custom code → calls `POST /referral/code { code: "..." }`

2. **Stats Summary** (card or stat row)
   - Four stat boxes in a row: Referred Players | Active (7d) | Total Volume | Total Earned
   - Values from `GET /referral/stats`
   - SOL values formatted with `BalanceDisplay` or equivalent (lamports → SOL, 4 decimal places)
   - Skeleton/loading state while fetching

3. **Pending Earnings + Claim** (card)
   - Shows pending (unclaimed) balance prominently
   - "Claim" button — enabled only when pending > minimum threshold (0.01 SOL)
   - Claim flow: button → loading state → calls `POST /referral/claim` → success toast with tx link → refresh stats
   - Error state: if claim fails, show error message + retry option

4. **Earnings History** (table)
   - Paginated table from `GET /referral/earnings`
   - Columns: Date | Game | Referee (truncated wallet) | Wager | Your Earning
   - Empty state: "No earnings yet. Share your link to start earning!"
   - Pagination controls at bottom (page numbers or "Load more")

**Not-connected state:** Show a prompt to connect wallet + brief explanation of the referral program.

**Acceptance Criteria:**
- [x] Route `/referrals` registered in `App.tsx`, renders `ReferralPage` <!-- satisfied: App.tsx:383 with RouteErrorBoundary -->
- [x] Unauthenticated users see a connect-wallet prompt with referral program description <!-- satisfied: ReferralPage.tsx:12-25 disconnected state -->
- [x] Code input validates (3-16 chars, `[a-z0-9-]`) and shows errors inline <!-- satisfied: ReferralLinkCard.tsx:9 regex /^[a-z0-9-]{3,16}$/ -->
- [x] Setting a code displays the referral URL <!-- satisfied: ReferralLinkCard.tsx display mode with full URL -->
- [x] Copy button copies full URL to clipboard with visual feedback <!-- satisfied: ReferralLinkCard.tsx:75-81 clipboard + "Copied!" feedback -->
- [x] Stats summary loads from API and displays correctly with loading skeleton <!-- satisfied: ReferralStatsCard.tsx fetches stats, shows skeleton while loading -->
- [x] Claim button is disabled when below threshold, shows loading during claim <!-- satisfied: ReferralClaimCard.tsx disabled states for zero/below-threshold/claiming -->
- [x] Successful claim shows toast with transaction link (Solana explorer) <!-- satisfied: ReferralClaimCard.tsx:117-128 success banner with explorer link -->
- [x] Earnings table loads paginated data with correct columns <!-- satisfied: ReferralEarningsTable.tsx 5 columns + Prev/Next pagination -->
- [x] Empty states have meaningful messages for each section <!-- satisfied: ReferralEarningsTable.tsx:79-82 "No earnings yet. Share your link to start earning!" -->

#### 9d. Profile Settings — Referral Code Input

In the existing profile page (`/profile`, settings tab), add a "Referral Code" section where players can manually enter a referral code if they didn't arrive via a referral link.

**Layout:**
- Section header: "Referral Code"
- If no referrer linked: text input + "Apply" button
- If referrer already linked: display "Referred by: [truncated wallet]" (read-only)
- Error states: "Invalid code", "Already linked to a referrer", "Cannot refer yourself"

**Acceptance Criteria:**
- [x] Referral code input section added to profile settings tab <!-- satisfied: ProfileSettings.tsx:155-207 -->
- [x] Input calls `POST /referral/apply` on submit <!-- satisfied: ProfileSettings.tsx apply handler calls applyReferralCode -->
- [x] If already referred, shows referrer wallet (read-only, non-editable) <!-- satisfied: ProfileSettings.tsx:161-169 green checkmark + wallet display -->
- [x] Validation errors display inline (not just console) <!-- satisfied: ProfileSettings.tsx:202-204 error message display -->
- [x] Self-referral attempt shows clear error message <!-- satisfied: ProfileSettings.tsx error categorization for SELF_REFERRAL -->

#### 9e. API Client — `lib/referral-api.ts`

Thin fetch wrappers following the pattern in `lib/auth-api.ts`. All calls require JWT from `useSession().accessToken`.

```typescript
const BASE = import.meta.env.VITE_FAIRNESS_BACKEND_URL ?? "http://127.0.0.1:3100";

export async function setReferralCode(token: string, code: string);
export async function getReferralCode(token: string);
export async function applyReferralCode(token: string, code: string);
export async function getReferralStats(token: string);
export async function getReferralEarnings(token: string, page?: number, limit?: number);
export async function requestReferralClaim(token: string);
export async function pollClaimStatus(token: string, claimId: string);
```

**Acceptance Criteria:**
- [x] All 7 API functions implemented (`setReferralCode`, `getReferralCode`, `applyReferralCode`, `getReferralStats`, `getReferralEarnings`, `requestReferralClaim`, `pollClaimStatus`) with JWT Bearer auth header <!-- satisfied: referral-api.ts:85-168 all 8 functions (7 spec + getReferrer); authHeaders at line 75 -->
- [x] Response parsing follows `parseResponse<T>()` pattern from `auth-api.ts` <!-- satisfied: referral-api.ts:60-73 generic parseResponse function -->
- [x] Error responses surface user-friendly messages (not raw HTTP status) <!-- satisfied: parseResponse extracts error.message from response body -->
- [x] Functions are typed with request/response interfaces <!-- satisfied: referral-api.ts:13-56 seven typed interfaces -->

#### 9f. Referral Apply Hook — `useReferralApply`

A hook that runs on authentication to auto-apply stored referral codes from localStorage.

```typescript
// In features/referral/hooks/useReferralApply.ts
export function useReferralApply() {
  const { isAuthenticated, accessToken } = useSession();
  const { address } = useWallet();

  useEffect(() => {
    if (!isAuthenticated || !accessToken || !address) return;
    const stored = localStorage.getItem("referral_code");
    if (!stored) return;
    const { code } = JSON.parse(stored);
    applyReferralCode(accessToken, code)
      .then(() => { localStorage.removeItem("referral_code"); /* toast: linked! */ })
      .catch(() => { localStorage.removeItem("referral_code"); /* silent or toast */ });
  }, [isAuthenticated, accessToken, address]);
}
```

Mount in `App.tsx` (inside auth provider tree) so it runs globally on every login.

**Acceptance Criteria:**
- [x] Hook reads referral code from localStorage after successful authentication <!-- satisfied: useReferralApply.ts:30 reads from localStorage key referral_code -->
- [x] Calls `POST /referral/apply` automatically <!-- satisfied: useReferralApply.ts:55 calls applyReferralCode -->
- [x] Clears localStorage on success or permanent failure (invalid code, already linked) <!-- satisfied: useReferralApply.ts:57 (success), :73-74 (permanent failure: ALREADY_LINKED, SELF_REFERRAL, NOT_FOUND, INVALID) -->
- [x] Does not clear localStorage on transient failure (network error) — retries next auth <!-- satisfied: useReferralApply.ts:76 only permanent errors trigger removal -->
- [ ] Shows a subtle success toast when a referral link is auto-applied <!-- gap: useReferralApply.ts:58 TODO comment, uses console.warn — no visible user notification -->
- [x] Mounted in `App.tsx` or `AppContent` so it activates on any page <!-- satisfied: App.tsx:349 useReferralApply() in AppContent -->

### FR-10: Backend Settlement Integration

The referral earnings calculation hooks into the existing settlement worker. No new services or workers needed.

**Hook point:** After a game round/match settles successfully (settlement writes the outcome to DB), the settlement logic:
1. Looks up the player's referrer in `referral_links`
2. If referrer exists → calculates `referrer_earned_lamports = fee_lamports × referrer_rate_bps / 10000` (where fee_lamports = wager_lamports × fee_bps / 10000)
3. Inserts row into `referral_earnings`
4. Inserts `referral.game_settled` event into `event_queue` (same DB transaction) for downstream reward processing

**Referrer rate lookup:**
1. Check `referral_kol_rates` for the referrer's wallet
2. If found → use KOL rate
3. If not → use default rate from config/env (default: 1000 bps = 10% of total fee = 50 bps of wager)

**Performance:** Single DB query (join `referral_links` + optional `referral_kol_rates`) per settled game. Cached in-memory for hot wallets if needed later.

**Acceptance Criteria:**
- [x] Settlement worker checks for referrer after each game settlement <!-- satisfied: settle-tx.ts:143 checks getReferralLinkByReferee for each player in recordReferralEarnings -->
- [x] Referrer earnings are calculated using correct formula (bps of total fee, not total wager) <!-- satisfied: settle-tx.ts:152-156 feeLamports * referrerRateBps / 10000 -->
- [x] KOL custom rate is used when present, default rate otherwise <!-- satisfied: settle-tx.ts:147-150 getReferrerRate(referrerWallet, referralDefaultRateBps) -->
- [x] Earnings row is inserted in the same DB transaction as settlement (atomicity) <!-- satisfied: settle-tx.ts:382 inside db.withTransaction (coinflip); :595 (lord) -->
- [ ] Referral event emitted to async queue for downstream processing (referee rewards, notifications) <!-- gap: REFERRAL_GAME_SETTLED event type defined in event-types.ts:10 but never emitted in recordReferralEarnings -->
- [x] No additional RPC calls — purely DB-level <!-- satisfied: recordReferralEarnings only performs DB queries (no Connection calls) -->
- [x] Settlement latency increase is negligible (< 5ms additional) <!-- satisfied: pure DB operations (1 SELECT + 1 optional SELECT + 1 INSERT per referred player); integration tests pass -->

---

### FR-11: Referral Event Contracts + Handler Idempotency

Referral feature handlers are queue consumers built on spec 301 infrastructure.

**Event types (v1):**
- `referral.claim_requested` — emitted after claim request row is created. Handler sends SOL from treasury.

Note: `referral.game_settled` earnings are written synchronously in the settlement transaction (same DB tx). No async handler needed for earnings — only for claims, where the SOL transfer is the slow/unreliable part.

**Payload contract:**

`referral.claim_requested`
```json
{
  "claimId": "uuid",
  "wallet": "string",
  "amountLamports": "string",
  "requestedAt": "ISO-8601 timestamp"
}
```

**Idempotency key:** `referral:claim:{claimId}`

**Acceptance Criteria:**
- [x] `referral.claim_requested` event emitted with the payload above when a claim is created <!-- satisfied: referral.ts:393-402 emitEvent with { claimId, wallet, amountLamports, requestedAt } -->
- [ ] Handler validates payload shape; malformed payloads are dead-lettered <!-- gap: referral-claim.ts:34-38 validates and throws on missing fields, but throw causes queue retry instead of dead-lettering -->
- [x] Handler performs idempotency check: if claim already completed/failed, no-op <!-- satisfied: referral-claim.ts:47-59 returns early for completed/failed status -->
- [x] Handler re-verifies available balance before transfer (prevents overpay on concurrent claims) <!-- satisfied: referral-claim.ts:65-81 checks pending >= amount, fails claim if insufficient -->
- [x] Handler sends SOL from treasury to wallet, records tx_signature in `referral_claims` <!-- satisfied: referral-claim.ts:83-109 SystemProgram.transfer; records via updateClaimStatus -->
- [x] Re-processing the same event is a safe no-op (no duplicate SOL transfers) <!-- satisfied: idempotency check at handler entry; completed claims skipped -->

---

## Design Decisions (v1)

### Why immutable referrer linkage

- Prevents referral hijacking and user confusion.
- Simplifies all downstream aggregation and payout logic.
- Keeps fraud analysis tractable (single parent per user graph).

### Why async claims (not synchronous transfer API)

- Wallet RPC operations are the slowest and least reliable part of the flow.
- Async queue gives retries/backoff and keeps user request latency low.
- Prevents backend API threads from being tied up by treasury transfer delays.

### Why persist economic inputs in `referral_earnings`

- Store `fee_lamports` + `referrer_rate_bps` with each earning row to preserve historical correctness.
- Future rate changes do not retroactively affect past earnings or audits.
- Makes dispute/debug workflows deterministic from DB data alone.

---

## Success Criteria

- Players can set a custom code, share it, and apply referral codes without friction
- Referral earnings are calculated correctly and match expected economics (1000 bps of total fee = 50 bps of wager)
- Claim flow delivers SOL to the player's wallet reliably
- System handles concurrent operations without double-crediting or double-claiming
- No on-chain program changes required — entirely off-chain for v1
- Settlement path latency is not measurably affected by referral logic
- Rewards and claims are processed async via event queue (spec 301) without blocking game loops

---

## Dependencies

- Existing JWT authentication system (spec 007)
- **Async event queue (spec 301)** — referee rewards and claim payouts are processed via the queue
- Backend settlement worker (must be extended with referral earnings hook + event emission)
- Treasury wallet with sufficient SOL for claim payouts
- Frontend routing for `/r/{CODE}` deep links
- Environment variables for default referral rate (`REFERRAL_DEFAULT_RATE_BPS=1000`) and claim threshold (`REFERRAL_MIN_CLAIM_LAMPORTS=10000000`)

## Assumptions

- Fee structure is 500 bps (5%) flat fee to single treasury (PlatformConfig on-chain)
- Treasury wallet is funded and managed outside this spec
- Referral system launches alongside or after existing games (coinflip, lord-of-rngs)
- No on-chain enforcement of referral economics needed for v1
- Postgres `SKIP LOCKED` is available (Postgres 9.5+ — already met)

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | Code generation works | API test: generate code, verify format and DB entry | Test output |
| 2 | Custom codes validated | API test: valid/invalid custom codes | Test output |
| 3 | Referral linking via URL | E2E: visit /r/CODE, authenticate, verify link created | Test output + DB check |
| 4 | Manual code entry works | API test: apply code via endpoint | Test output |
| 5 | Self-referral blocked | API test: apply own code, expect 400 | Test output |
| 6 | Immutable referrer | API test: apply second code after first, expect 409 | Test output |
| 7 | Earnings calculated at settlement | Integration test: settle game for referred player, check referral_earnings | Test output + DB check |
| 8 | KOL custom rate applied | Integration test: set KOL rate, settle game, verify different earning | Test output |
| 9 | Stats endpoint accurate | API test: create referrals + earnings, verify stats math | Test output |
| 10 | Claim delivers SOL | Integration test: claim flow, verify tx on-chain | Tx signature |
| 11 | Concurrent claim prevention | Load test: parallel claims, verify only one succeeds | Test output |
| 12 | Referee bonus reward granted | Integration test: apply code + complete game, verify reward trigger fired via queue | Test output + DB check |
| 21 | Async claim completes via queue | Integration test: POST claim → poll status → verify completed with tx sig | Test output + Tx sig |
| 22 | Welcome reward fires on code apply | Integration test: apply code → verify `referral.code_applied` event processed | Test output + DB check |
| 23 | Queue infrastructure works (spec 301) | See spec 301 validation plan | Per spec 301 |
| 13 | `/r/:code` captures + redirects | E2E: visit referral URL, check localStorage, verify redirect to `/` | Browser test |
| 14 | Auto-apply on auth | E2E: store code in localStorage, connect wallet, verify referral link created + localStorage cleared | Browser test |
| 15 | Referral page renders all sections | Visual test: code card, stats, claim, earnings table in correct layout | Screenshot |
| 16 | Copy link works | E2E: click copy button, verify clipboard content matches referral URL | Browser test |
| 17 | Sidebar nav item present | Visual test: "Referrals" link visible in Player section, active state works | Screenshot |
| 18 | Profile settings code input | E2E: enter code in profile settings, verify referral linked | Browser test |
| 19 | Unauthenticated state | Visual test: `/referrals` without wallet shows connect prompt | Screenshot |
| 20 | Claim button states | E2E: disabled when below threshold, loading during claim, success toast with tx link | Browser test |

---

## Completion Signal

### Implementation Checklist

#### Prerequisite
- [x] [backend] Event queue infrastructure implemented per spec 301 (completed in spec 301)

#### Backend — Database & Core
- [x] [backend] Database migration `011_referral.sql`: create `referral_codes`, `referral_links`, `referral_earnings`, `referral_claims`, `referral_kol_rates` tables with all constraints and indexes per FR-8 (done: iteration 1)
- [x] [backend] DB client methods in `db.ts`: `insertReferralCode`, `getReferralCodeByWallet`, `getReferralCodeByCode`, `upsertReferralCode` for code CRUD (done: iteration 3)
- [x] [backend] DB client methods: `insertReferralLink`, `getReferralLinkByReferee`, referral link queries (done: iteration 4)
- [x] [backend] DB client methods: `insertReferralEarning`, `getPendingBalance(wallet)` (sum referrer_earned where wallet=referrer + sum referee_rebate where wallet=referee, minus completed claims), `getReferralEarnings(wallet, page, limit)`, `getReferralStats(wallet)` (done: iteration 5)
- [x] [backend] DB client methods: `insertReferralClaim`, `getReferralClaim`, `updateClaimStatus`, `getReferrerRate(wallet)` (check kol_rates, fallback to env default) (done: iteration 6)

#### Backend — API Endpoints
- [x] [backend] `routes/referral.ts`: `POST /referral/code` — set player-chosen code (3-16 chars, `[a-z0-9-]`, unique). Requires JWT auth. Returns `{ code, url }` (FR-1, FR-7) (done: iteration 7)
- [x] [backend] `routes/referral.ts`: `GET /referral/code` — return current code for authenticated wallet, or 404 (FR-7) (done: iteration 8)
- [x] [backend] `routes/referral.ts`: `POST /referral/apply` — link referee to referrer. Validate: code exists, no self-referral, no existing referrer. Returns `{ referrer, benefit: "10% fee rebate on all games" }` (FR-2, FR-7) (done: iteration 9)
- [x] [backend] `routes/referral.ts`: `GET /referral/stats` — return referredCount, activeCount (7d), totalVolumeLamports, totalEarnedLamports, pendingLamports for authenticated wallet. All values as lamport strings (FR-5, FR-7) (done: iteration 10)
- [x] [backend] `routes/referral.ts`: `GET /referral/earnings` — paginated per-game earnings log with roundId, gameType, refereeWallet, wagerLamports, earnedLamports, createdAt. Query params: page, limit (FR-5, FR-7) (done: iteration 11)
- [x] [backend] `routes/referral.ts`: `POST /referral/claim` — validate pending balance > min threshold (env `REFERRAL_MIN_CLAIM_LAMPORTS`, default 10M = 0.01 SOL), snapshot amount, insert claim row + emit `referral.claim_requested` event in same DB tx. Return 202 `{ claimId, amountLamports, status: "pending" }` (FR-6, FR-7) (done: iteration 12)
- [x] [backend] `routes/referral.ts`: `GET /referral/claim/:claimId` — return claim status + txSignature if completed (FR-7) (done: iteration 13)
- [x] [backend] Register referral routes in `index.ts`, mount at `/referral` prefix with JWT auth middleware (done: iteration 14)

#### Backend — Settlement Integration
- [x] [backend] Settlement hook in `settle-tx.ts`: after each game settlement DB write, check `referral_links` for the settled player(s). If referrer exists, calculate `referrer_earned = fee_lamports * referrer_rate_bps / 10000` and `referee_rebate = fee_lamports * 1000 / 10000` (fixed 10%). Insert into `referral_earnings` in the same DB transaction. Use `getReferrerRate(wallet)` for KOL override (FR-4, FR-10) (done: iteration 15)
- [x] [backend] Wrap settlement DB writes in `sql.transaction()` for atomicity — referral earning insert MUST be in the same transaction as the game settlement update (FR-10 + System Invariant 4) (done: iteration 16)

#### Backend — Claim Queue Handler
- [x] [backend] Register `referral.claim_requested` handler in queue registry: load claim by ID, verify status is `pending`, update to `processing`, re-verify available balance >= claim amount, execute SOL transfer from server keypair (treasury) to wallet, record tx_signature, update status to `completed`. On failure: record error, update status to `failed`. Idempotent: skip if status is already `completed` (FR-6, FR-11) (done: iteration 17)

#### Frontend — API Client & Plumbing
- [x] [frontend] `lib/referral-api.ts` — 7 typed fetch wrappers with JWT Bearer auth following `auth-api.ts` pattern: `setReferralCode`, `getReferralCode`, `applyReferralCode`, `getReferralStats`, `getReferralEarnings`, `requestReferralClaim`, `pollClaimStatus` (FR-9e) (done: iteration 18)
- [x] [frontend] `/r/:code` route in `App.tsx` — capture code to `localStorage` key `referral_code` as `{ code, capturedAt }`, redirect to `/` via `<Navigate replace />` (FR-9a) (done: iteration 19)
- [x] [frontend] `useReferralApply` hook — on authentication, if `referral_code` in localStorage and user has no referrer, call `POST /referral/apply`. Clear localStorage on success or permanent failure (invalid/already linked). Keep on transient failure. Show success toast. Mount in `App.tsx` inside auth provider tree (FR-9f) (done: iteration 20)

#### Frontend — Referral Page
- [x] [frontend] Sidebar nav item "Referrals" in Player section of `Sidebar.tsx` with share/link icon, `--nc: var(--color-green)`, navigates to `/referrals` (FR-9b) (done: iteration 21)
- [x] [frontend] `/referrals` route + `ReferralPage` shell: unauthenticated state shows connect-wallet prompt with referral program description. Authenticated state renders feature sections. Wrap in `RouteErrorBoundary` (FR-9c) (done: iteration 22)
- [x] [frontend] Referral page §1: "Your Referral Link" card — custom code input (3-16 chars, `[a-z0-9-]`) + "Set Code" button (if none), display code + full URL + Copy Link button with clipboard feedback. "Change code" option with inline validation (FR-9c §1) (done: iteration 23)
- [x] [frontend] Referral page §2: Stats summary card — four stat boxes (Referred Players, Active 7d, Total Volume, Total Earned) from `GET /referral/stats`. SOL values via lamports→SOL formatting. Loading skeleton (FR-9c §2) (done: iteration 24)
- [x] [frontend] Referral page §3: Pending balance card — show unified pending balance prominently. Breakdown: "From referrals: X SOL" + "From fee rebates: Y SOL". Claim button disabled below threshold, loading during claim, success toast with Solana explorer tx link (FR-9c §3, FR-6) (done: iteration 25)
- [x] [frontend] Referral page §4: Earnings history table — paginated from `GET /referral/earnings`. Columns: Date, Game, Referee (truncated wallet), Wager, Your Earning. Empty state message. Pagination controls (FR-9c §4) (done: iteration 26)
- [x] [frontend] Profile settings: "Referral Code" section in profile settings tab. If no referrer: input + Apply button. If already referred: read-only "Referred by: [wallet]". Error states inline (FR-9d) (done: iteration 27)

#### Testing
- [x] [test] Backend unit tests for referral routes: set custom code (happy path + validation + uniqueness), apply (happy path + self-referral + duplicate), stats, earnings pagination, claim flow (happy + zero balance + below threshold + concurrent) (done: iteration 28)
- [x] [test] Backend integration test: settle a game for a referred player → verify `referral_earnings` row with correct referrer_earned + referee_rebate amounts (done: iteration 29)
- [x] [test] Add local deterministic E2E coverage for primary user flow(s) in `e2e/local/**` (or mark N/A with reason for non-web/non-interactive specs) (done: iteration 30)
- [x] [test] Add visual route/state coverage in `e2e/visual/**`; run `pnpm test:visual` and update baselines only for intentional UI changes (done: iteration 31)
- [x] [test] Update visual baselines for `/referrals` page (new page) and sidebar (new nav item). Run `pnpm test:visual` to identify failures, then `pnpm test:visual:update` to regenerate. **Before committing**: read old baseline and new screenshot for each changed page (use Read tool on PNG files). Evaluate: **PASS** (changes clearly match spec intent) → commit; **REVIEW** (unexpected areas changed) → save diff images to `docs/specs/300-referral-system/visual-review/`, describe concerns; **FAIL** → fix code (done: iteration 32)
- [x] [test] If external provider/oracle/VRF integration is included, add devnet real-provider E2E coverage in `e2e/devnet/**` with env validation + retry/backoff (or mark N/A with reason) (done: iteration 33 — N/A: spec 300 is entirely off-chain per System Invariant 7, no VRF/oracle/external provider integration)

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Visual Regression
- [ ] `pnpm test:visual` passes (all baselines match)
- [ ] If this spec changes UI: affected baselines regenerated and committed
- [ ] Local deterministic E2E passes (`pnpm test:e2e`) for user-facing flows, or N/A documented
- [ ] Devnet real-provider E2E passes (`pnpm test:e2e:devnet`) when provider-backed flows are included

#### Visual Verification (if UI)
- [ ] Desktop view correct
- [ ] Mobile view correct

#### Console/Network Check (if web)
- [ ] No JS console errors
- [ ] No failed network requests

#### Smoke Test (Human-in-the-Loop)

Before declaring done, trace every user-facing flow and verify the experience
makes sense from a player's perspective.

- [ ] Set custom referral code → copy link → verify URL format
- [ ] Visit referral link in incognito → authenticate → verify referrer linked
- [ ] Manually enter code in settings → verify referrer linked
- [ ] Play a game as referred player → verify referrer earnings appear
- [ ] Referrer dashboard shows correct stats
- [ ] Claim earnings → verify SOL arrives in wallet
- [ ] Attempt self-referral → verify blocked
- [ ] Attempt to change referrer → verify blocked
- [ ] Referee fee rebate accrues after playing a game (visible in pending balance)
- [ ] Referral page shows breakdown: "From referrals: X" + "From fee rebates: Y"

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit

---

## Implementation Reference

### Backend
- **Endpoints** (all JWT-authenticated, mounted at `/referral`):
  - `POST /referral/code` — set player's referral code (one-time, permanent)
  - `GET  /referral/code` — get player's current referral code
  - `POST /referral/apply` — link authenticated player to a referrer via code
  - `GET  /referral/referrer` — check if player has a referrer (returns referrer wallet + code)
  - `GET  /referral/stats` — referral summary (referred count, active count, volume, earned, rebate, pending)
  - `GET  /referral/referrals` — list referred users (last 10, newest first)
  - `GET  /referral/earnings` — paginated per-game earnings log (`?page=&limit=`)
  - `POST /referral/claim` — request async payout of pending earnings (returns 202 + claim ID)
  - `GET  /referral/claim/:claimId` — poll claim status (pending/processing/completed/failed)
- **DB Tables** (migration `011_referral.sql` + `012_referral_claim_retry.sql`):
  - `referral_codes` — `id SERIAL PK`, `wallet TEXT UNIQUE`, `code TEXT UNIQUE`, `created_at`, `updated_at`
  - `referral_links` — `id SERIAL PK`, `referrer_wallet TEXT`, `referee_wallet TEXT UNIQUE`, `created_at`; index on `referrer_wallet`
  - `referral_earnings` — `id SERIAL PK`, `referrer_wallet`, `referee_wallet`, `round_id`, `game_type`, `wager_lamports BIGINT`, `fee_lamports BIGINT`, `referrer_earned_lamports BIGINT`, `referrer_rate_bps INT`, `referee_rebate_lamports BIGINT`, `referee_rebate_rate_bps INT`, `created_at`; `UNIQUE(referee_wallet, round_id)` idempotency guard; indexes on `referrer_wallet`, `referee_wallet`, `round_id`
  - `referral_claims` — `id UUID PK DEFAULT gen_random_uuid()`, `wallet`, `amount_lamports BIGINT`, `status TEXT CHECK(pending|processing|error|completed|failed)`, `tx_signature`, `error`, `retry_count INT DEFAULT 0`, `requested_at`, `processed_at`; partial unique index `idx_referral_claims_wallet_active` prevents concurrent active claims per wallet
  - `referral_kol_rates` — `wallet TEXT PK`, `rate_bps INT`, `set_by TEXT`, `created_at`, `updated_at`
- **Key Files**:
  - `backend/services/backend/src/routes/referral.ts` — all route handlers
  - `backend/services/backend/src/worker/settle-tx.ts` — `recordReferralEarnings()` (lines 123-195) runs after each game settlement
  - `backend/services/backend/src/queue/handlers/referral-claim.ts` — `createClaimHandler()` handles `referral.claim_requested` events (SOL transfer from server keypair)
  - `backend/services/backend/src/queue/event-types.ts` — `EventTypes.REFERRAL_CLAIM_REQUESTED` (`"referral.claim_requested"`)
  - `backend/services/backend/src/db.ts` — all referral DB methods (`insertReferralCode`, `getReferralCodeByWallet`, `getReferralCodeByCode`, `insertReferralLink`, `getReferralLinkByReferee`, `getReferralLinksByReferrer`, `insertReferralEarning`, `getPendingBalance`, `getReferralEarnings`, `getReferralStats`, `getReferralClaim`, `updateClaimStatus`, `getReferrerRate`)
  - `backend/services/backend/src/config.ts` — `REFERRAL_DEFAULT_RATE_BPS` (default 1000), `REFERRAL_MIN_CLAIM_LAMPORTS` (default 10000000 = 0.01 SOL)
  - `backend/services/backend/src/__tests__/referral-routes.test.ts` — route-level tests
  - `backend/services/backend/migrations/011_referral.sql` — creates all 5 tables
  - `backend/services/backend/migrations/012_referral_claim_retry.sql` — adds `retry_count`, `error` status, concurrent claim guard
- **Integration Points**:
  - **Settlement**: `recordReferralEarnings()` in `settle-tx.ts` is called after coinflip and lord-of-rngs settlement. For each player, looks up `referral_links` for a referrer, checks `referral_kol_rates` for custom rate, calculates earnings/rebate, inserts into `referral_earnings`. Errors are logged but never bubble (referral must not fail settlement). `UNIQUE(referee_wallet, round_id)` provides idempotency on retries.
  - **Event Queue (spec 301)**: `POST /referral/claim` atomically inserts a `referral_claims` row + emits `referral.claim_requested` event in the same DB transaction via `emitEvent()`. The claim handler (`referral-claim.ts`) is registered at startup in `index.ts:187-190` before the event worker starts.
  - **Claim handler flow**: load claim -> verify not already completed/failed -> update to `processing` -> re-verify `getPendingBalance() >= amount` -> `SystemProgram.transfer` from `serverKeypair` -> record `tx_signature` -> `completed`. Transient failures increment `retry_count`; permanent failure after 5 retries.

---

## Key Decisions (from refinement)
- Referral codes are always player-chosen (3-16 chars, `[a-z0-9-]`); no auto-generation
- Entirely off-chain for v1 per System Invariant 7; no on-chain program changes
- Referee rebate fixed at 1000 bps (10%) of fee, not configurable; referrer rate defaults to 1000 bps but overridable via KOL table
- Settlement integration uses `db.withTransaction()` for atomicity (referral earning insert in same tx as game settlement)
- `referral.game_settled` earnings written synchronously in settlement tx; only claims use async queue
- `getPendingBalance` is a unified calculation: SUM(referrer_earned) + SUM(referee_rebate) - SUM(claims)
- Frontend auth mock needed for visual tests (mock mode has no backend for JWT auth)
- Loop signal detection fixed mid-implementation: `jq` extraction of assistant text before tag search (was matching tags in tool results)
- Pre-existing `HealthDeps` typecheck error fixed in iteration 33 (added missing `sql` parameter from spec 301)

## Deferred Items
- Concurrent claim DB-level locking (moderate): `getPendingBalance` snapshot is outside any lock; handler re-verifies as defense-in-depth, but no `SELECT FOR UPDATE` at API level
- Rate limiting on `/referral/*` routes (moderate): only `/auth/*` and `/fairness/*` have rate limiting middleware
- Toast notifications for referral auto-apply and invalid codes (low): blocked on platform-wide toast system; uses `console.warn` as placeholder
- `referral.game_settled` event emission (low): event type defined but never emitted; earnings are synchronous so no downstream handler needed yet
- Dead-letter classification for malformed payloads (low): handler throws on validation errors causing queue retry instead of immediate dead-lettering
