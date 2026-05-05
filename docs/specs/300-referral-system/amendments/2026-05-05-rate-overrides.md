---
date: 2026-05-05
amends: docs/specs/300-referral-system/spec.md
also-touches:
  - docs/specs/308-referral-tiers/spec.md
  - docs/specs/305-peek-operations-admin/spec.md
status: Complete
---

# Amendment: Rate Override Expiry + KOL→Override Rename

## Why

Two changes that pair naturally:

1. **Manual referrer rate overrides need an expiry.** Today operators can set a custom referrer rate via `referral_kol_rates`, but the row lives forever. Operators have no signal to revisit a deal, and no automatic decay back to tier-based rates when a deal lapses. We need an `expires_at` timestamp so the override only wins while it's active.
2. **The "KOL" label is the wrong primitive.** The table stores *manual rate overrides*. KOLs happen to be the dominant use case, but the semantics are "operator-set fixed rate for this user". Calling it `referral_kol_rates` blurs the abstraction (especially now that we auto-grant a 90-day override to every new code creator — those people are not KOLs). Rename storage, code, and admin to `rate_override` everywhere.

## Scope changes vs spec 300

### FR-1 (Referral Code Creation) — addition

When a player successfully creates their first referral code, the backend additionally inserts a default rate override at **1500 bps (15%)** with `expires_at = now() + INTERVAL '90 days'` and `set_by = 'auto:initial-90d'`. This insert is **best-effort**: if it fails, the code-creation response still succeeds and the user simply falls through to tier-based rates. Operators can manually add the override after the fact if reported.

The auto-insert uses `ON CONFLICT (user_id) DO NOTHING`, so if an operator pre-set a permanent KOL deal before the user created their code, the operator deal is preserved.

### FR-10 (KOL Custom Rate) — replaced by Rate Override

- Rename `referral_kol_rates` → `referral_rate_overrides`.
- Add `expires_at TIMESTAMPTZ NOT NULL`.
- Resolution filters `WHERE expires_at > now()`. Expired rows are ignored and the resolver falls through to tier → default.
- "Permanent" deals are represented by setting `expires_at` to a far-future date (e.g. 2099-01-01). NULL is not allowed — the column is NOT NULL — to keep resolution semantics uniform.
- Past `referral_earnings` rows are unaffected: the rate is snapshotted at settlement, so backfilling expiry has no effect on already-settled earnings (FR-4 invariant preserved).

### Public API impact (`GET /referral/stats`)

The `tier.source` enum changes from `"kol" | "tier" | "default"` → `"override" | "tier" | "default"`. This is a coordinated rename — the waitlist and webapp consult-only frontends do not currently read this string, so no rollout gap is created.

## Migration plan (`030_referral_rate_overrides.sql`)

```sql
ALTER TABLE referral_kol_rates RENAME TO referral_rate_overrides;

ALTER TABLE referral_rate_overrides ADD COLUMN expires_at TIMESTAMPTZ;

-- Backfill every referral_codes user not already in overrides.
INSERT INTO referral_rate_overrides (user_id, wallet, rate_bps, set_by, expires_at)
SELECT rc.user_id, rc.wallet, 1500, 'auto:initial-90d', '2026-08-30 00:00:00+00'::timestamptz
FROM referral_codes rc
WHERE rc.user_id NOT IN (SELECT user_id FROM referral_rate_overrides);

-- Defensive: any pre-existing row without expiry gets the same default.
UPDATE referral_rate_overrides SET expires_at = '2026-08-30 00:00:00+00'::timestamptz
WHERE expires_at IS NULL;

ALTER TABLE referral_rate_overrides ALTER COLUMN expires_at SET NOT NULL;

-- Hot path is per-user lookup; PK on user_id covers it.
-- Add expires_at index for admin "expiring soon" / cleanup queries.
CREATE INDEX referral_rate_overrides_expires_at_idx
  ON referral_rate_overrides (expires_at);
```

## Indexes

- `PRIMARY KEY (user_id)` — kept. Hot path: `WHERE user_id = $1 AND expires_at > now()` returns at most 1 row.
- `UNIQUE (wallet)` — kept.
- `INDEX (expires_at)` — new. Supports admin queries like "show overrides expiring in 7 days" and "show all expired".

No partial indexes on `expires_at > now()` because `now()` is not immutable and PG won't allow it.

## Acceptance Criteria

- [x] Migration `030_referral_rate_overrides.sql` renames the table and adds NOT NULL `expires_at` with the documented backfill.
- [x] `referral_rate_overrides` has an index on `expires_at`.
- [x] `getReferrerRate` and `getReferralRateOverride` filter `expires_at > now()`.
- [x] `POST /referral/code` best-effort inserts an initial 1500 bps / 90-day override; failure does not affect the code-creation response.
- [x] `GET /referral/stats` returns `tier.source: "override" | "tier" | "default"`.
- [x] Past `referral_earnings.referrer_rate_bps` rows are unchanged after migration.
- [x] Peek admin (`/growth/overrides`, mutation, exporter, queries, audit keys) uses "rate override" / "rate_override.update" terminology end-to-end; no "kol" string remains in owned code (excluding historical commit messages and migration filenames).
- [x] Test fixtures (`integration-test-helpers.ts`, route tests, integration tests) mirror the renamed schema and the new auto-insert behavior.
