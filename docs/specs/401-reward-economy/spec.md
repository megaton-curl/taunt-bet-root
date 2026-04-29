# Specification: [401] Reward Economy

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Core |
| Supersedes | Reward-economy naming and multiplier semantics inside spec 400 |

---

## Overview

The reward economy has four canonical backend concepts:

1. **Points** - season-scoped reward balance earned from settled game activity and other reward grants.
2. **Multiplier** - an effective multiplier applied to reward calculations. It has lifetime, seasonal, and temporary components.
3. **Season** - the reset boundary for points balances and season-scoped multiplier state.
4. **Event** - a scheduled economy modifier window. Current product copy may call this "Gangbang", but code and APIs use `event`.

Product names are display labels, not domain names. Current working labels:

| Canonical concept | Current display label | Notes |
|---|---|---|
| `points` | Points | Expected to remain stable, but still treated as copy. |
| `multiplier` | PNS Size | Player-facing label only. Do not use in code, tables, URLs, or event names. |
| `event` | Gangbang | Player-facing event/campaign label only. Do not use in code, tables, URLs, or event names. |

Backend identifiers MUST stay generic so product copy can change without schema, endpoint, queue, or analytics migrations.

---

## Design Principles

- **Ledger data is permanent.** Season resets create new season balances; they do not delete grants, wager records, or lifetime counters.
- **Economic changes are future-only.** A rate or ladder change affects grants computed after the change, not prior grants.
- **Use compute-time configuration.** Point grants use the cached rates and active multiplier state available when the grant is computed.
- **All point grants are season-attributed.** A season reset is modeled by writing into a new season balance.
- **Only wager points are multiplier-aware by default.** Crate point grants stay unmultiplied at launch. Other fixed point grants stay fixed unless their reward definition explicitly opts into multiplier behavior later.
- **Display labels are data/copy.** They can appear in API response metadata for UI rendering, but not in canonical resource names.

---

## FR-1: Seasons

A season defines the active points bucket and the reset period for temporary multiplier state.

**Rules:**
- Exactly one season MUST be active for normal production traffic.
- Points balance resets by writing future grants to a new `season_id`.
- Historical point grants and prior season balances remain queryable.
- Temporary multipliers are season-scoped unless they have a shorter explicit end time.
- A season can only be ended through an atomic transition that activates the next season at the same boundary.
- Admin APIs should prevent ending or cancelling the active season unless a replacement season is being activated.
- Reward computation should treat "no active season" as an invariant violation: reject the grant, log/alert, and require operator repair rather than silently assigning points to an offseason bucket.

**Target table:**

```sql
CREATE TABLE seasons (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,              -- e.g. season-1
  name        TEXT NOT NULL,                     -- display copy
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  status      TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**API:**
- `GET /seasons/current`
- `GET /seasons`
- Admin: `POST /admin/seasons`, `PUT /admin/seasons/:id`

---

## FR-2: Points

Points are season-scoped. The current balance resets each season, but the ledger remains permanent.

**Formula for wager grants only:**

```text
base_points          = floor(wager_usd * active_points_rate)
effective_multiplier = compute_effective_multiplier(user_id, season_id, compute_time)
earned_points        = floor(base_points * effective_multiplier)
```

`wager_usd` uses the globally cached wager-value rate available at compute time. It does not need per-round real-time pricing. The cache target is 1-2 refreshes per day unless product or risk needs change.

All eligible settled players earn wager points: winners and losers. Refunded or reward-ineligible games do not earn points.

For launch, crate point grants are fixed amounts and are not multiplied. Other non-wager point grants, such as challenge rewards, admin grants, and reward grants, stay fixed by default unless their reward definition explicitly opts into multiplier behavior later. Fixed grants still carry `season_id` and should record `effective_multiplier = 1.0` for audit clarity.

**Target tables:**

```sql
CREATE TABLE point_rate_versions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_per_usd   NUMERIC(18,6) NOT NULL,          -- e.g. 100 points per $1 wagered
  effective_from TIMESTAMPTZ NOT NULL,
  label          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_point_rate_versions_effective
  ON point_rate_versions (effective_from DESC);

CREATE TABLE point_balances (
  user_id       TEXT NOT NULL,
  season_id     BIGINT NOT NULL REFERENCES seasons(id),
  wallet        TEXT NOT NULL,
  balance       BIGINT NOT NULL DEFAULT 0,
  season_earned BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

-- Existing point_grants remains the source-of-truth ledger, but becomes season-attributed.
ALTER TABLE point_grants
  ADD COLUMN season_id BIGINT REFERENCES seasons(id),
  ADD COLUMN effective_multiplier NUMERIC(12,6), -- 1.0 for unmultiplied fixed grants
  ADD COLUMN point_rate_version_id BIGINT REFERENCES point_rate_versions(id); -- NULL for fixed grants
```

`lifetime_earned` should be computed from `point_grants` or materialized in a separate aggregate if performance requires it. It should not be reset.

**Rate lookup:**
- Use the latest `point_rate_versions` row where `effective_from <= compute_time`.
- No `effective_to` is required; the next row supersedes the prior row.
- Default launch rate: `100` points per wagered USD.

**Season attribution answer:**
Every point grant should carry `season_id`, including non-wager grants such as challenges, admin grants, reward grants, and crate grants if crate points remain enabled. The reason is operational: if balances reset by season, every grant must know which season balance it mutates. The source ledger remains permanent, so no data is discarded.

**API:**
- `GET /points/mine` - current season balance, current season earned, lifetime earned, active rate metadata.
- `GET /points/mine/history?season=current|all` - point grant ledger.
- Admin: `POST /admin/point-rates`, `GET /admin/point-rates`.

---

## FR-3: Multiplier

The effective multiplier is generic domain logic. Current UI copy may call it "PNS Size".

Components:

1. **Lifetime component** - never resets; stepped by lifetime wagered USD.
2. **Season component** - resets by season; stepped by season wagered USD.
3. **Temporary modifiers** - event, admin, and reward modifiers. These are season-scoped by default and can also have explicit start/end times.

**Base formula:**

```text
base_multiplier = lifetime_component * season_component
effective       = apply_active_modifiers(base_multiplier)
```

No global cap is required for launch. Operators are responsible for not creating excessive multipliers. A cap can be added later without changing the canonical model.

**Ladders:**

```sql
CREATE TABLE multiplier_ladders (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          TEXT NOT NULL CHECK (scope IN ('lifetime', 'season')),
  metric         TEXT NOT NULL CHECK (metric IN ('wagered_usd')),
  season_id      BIGINT REFERENCES seasons(id),       -- NULL for lifetime ladders
  effective_from TIMESTAMPTZ NOT NULL,
  label          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE multiplier_ladder_steps (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ladder_id        BIGINT NOT NULL REFERENCES multiplier_ladders(id),
  level            INT NOT NULL,
  threshold_usd    NUMERIC(20,6) NOT NULL,
  multiplier       NUMERIC(12,6) NOT NULL,
  sort_order       INT NOT NULL DEFAULT 0,
  UNIQUE (ladder_id, threshold_usd)
);
```

Ladder lookup uses the latest active ladder by `scope` where `effective_from <= compute_time`. The chosen step is the highest threshold less than or equal to the user's metric value.

Values below the first threshold use `1.0`.

**Launch lifetime ladder:**

| Level | Lifetime Wagered USD | Multiplier |
|---:|---:|---:|
| 1 | 1,000 | 1.10 |
| 2 | 10,000 | 1.20 |
| 3 | 50,000 | 1.30 |
| 4 | 100,000 | 1.40 |
| 5 | 250,000 | 1.50 |
| 6 | 500,000 | 1.60 |
| 7 | 1,000,000 | 1.70 |
| 8 | 2,500,000 | 1.80 |
| 9 | 5,000,000 | 1.90 |
| 10 | 10,000,000 | 2.00 |

**Launch season ladder:**

| Level | Season Wagered USD | Multiplier |
|---:|---:|---:|
| 1 | 500 | 1.20 |
| 2 | 5,000 | 1.50 |
| 3 | 25,000 | 2.00 |
| 4 | 100,000 | 2.50 |
| 5 | 250,000 | 3.00 |

**Temporary modifiers:**

```sql
CREATE TABLE multiplier_modifiers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT,                                -- NULL = global modifier
  season_id     BIGINT REFERENCES seasons(id),
  source_type   TEXT NOT NULL CHECK (source_type IN ('event', 'admin', 'reward')),
  source_id     TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'set_value' CHECK (mode IN ('multiply', 'set_min', 'set_value')),
  value         NUMERIC(12,6) NOT NULL,
  priority      INT NOT NULL DEFAULT 0,
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Modifier modes:

| Mode | Behavior | Use case |
|---|---|---|
| `multiply` | `effective = effective * value` | Normal boost stacking. |
| `set_min` | `effective = max(effective, value)` | Event raises everyone to at least a shared multiplier, creating a more even field. |
| `set_value` | `effective = value` | Default event behavior: hard override the computed multiplier for the active window. |

If multiple modifiers overlap, they are all allowed. Apply them deterministically in this order:

1. Compute lifetime and season ladder components.
2. Apply active `multiply` modifiers.
3. Apply active `set_min` modifiers.
4. Apply active `set_value` modifiers by highest `priority`, then latest `created_at`.

This supports both stacking and overwrite-style event design without changing table shape. For launch, event-created modifiers default to `set_value`, so the event value completely overwrites the computed lifetime x season multiplier while active.

**API:**
- `GET /multiplier/mine` - effective multiplier, components, active modifiers, display label metadata.
- Admin: `POST /admin/multiplier-ladders`, `PUT /admin/multiplier-ladders/:id`, `POST /admin/multiplier-modifiers`, `GET /admin/multiplier-modifiers`.

---

## FR-4: Events

Events are generic scheduled modifier windows. Current UI copy may call a specific event type "Gangbang".

Events can overlap. Overlap is not rejected at the database level; the multiplier engine resolves the active modifiers deterministically.

**Target table:**

```sql
CREATE TABLE events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id     BIGINT REFERENCES seasons(id),
  event_type    TEXT NOT NULL DEFAULT 'generic',
  display_name  TEXT NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  config        JSONB NOT NULL DEFAULT '{}',
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_active
  ON events (status, starts_at, ends_at)
  WHERE status IN ('scheduled', 'active');
```

An event creates one or more `multiplier_modifiers` with `source_type = 'event'` and `source_id = events.id`. The default event modifier mode is `set_value`.

**API:**
- `GET /events/current`
- `GET /events/schedule`
- Admin: `POST /admin/events`, `PUT /admin/events/:id`, `GET /admin/events`

Legacy `dogpile` routes should become compatibility aliases for one release window:
- `/dogpile/current` -> `/events/current`
- `/dogpile/schedule` -> `/events/schedule`
- `/admin/dogpile` -> `/admin/events`

---

## FR-5: Display Metadata

APIs that render economy state should include display metadata without changing canonical field names.

Example:

```json
{
  "data": {
    "balance": "12000",
    "seasonEarned": "12000",
    "lifetimeEarned": "99000",
    "multiplier": 2.4,
    "display": {
      "pointsLabel": "Points",
      "multiplierLabel": "PNS Size",
      "eventLabel": "Gangbang"
    }
  }
}
```

Display labels can be season-specific or global config. They should not be hard-coded into backend resource names.

---

## Migration Plan

1. Add `seasons`, `point_rate_versions`, `multiplier_ladders`, `multiplier_ladder_steps`, `multiplier_modifiers`, and generic `events`.
2. Seed the current season and initial point rate (`100` points per wagered USD).
3. Seed launch lifetime and season multiplier ladders from FR-3.
4. Add `season_id`, `effective_multiplier`, and `point_rate_version_id` to `point_grants`.
5. Replace `player_points` with `point_balances`, or keep `player_points` as a compatibility view over the active season during migration.
6. Rename `dogpile_events` to generic `events`, or backfill `events` from `dogpile_events` and retire the old table after compatibility endpoints are removed.
7. Add generic endpoints first; keep existing Dogpile endpoints as aliases for one release window.
8. Rename code helpers from Dogpile/HEAT-specific names to event/multiplier names.
9. Update frontend display copy to read labels from API/config instead of code identifiers.

---

## Open Decisions

- Whether crate probability is affected by the multiplier. Crate point grants are unmultiplied for launch.
- Whether challenge/admin/reward fixed point grants should ever become multiplier-aware. They stay fixed by default unless explicitly designed otherwise.
