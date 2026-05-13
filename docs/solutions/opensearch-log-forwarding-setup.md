---
tags: [observability, digitalocean, opensearch, app-platform]
area: infra
---

# OpenSearch log forwarding from DO App Platform

End-to-end recipe for shipping structured JSON logs from App Platform apps to a DO Managed OpenSearch cluster, with ingest-time JSON parsing so structured fields are queryable in Discover.

## Architecture

- One Managed OpenSearch cluster (`logs-db`) shared across dev and prod.
- Per-component `log_destinations` in each app spec.
- One index per `app-component` pair: `dev-api`, `dev-worker`, `prod-api`, `prod-worker`, etc.
- A single ingest pipeline (`parse-log-json`) parses the JSON-encoded `log` field DO wraps around each stdout line and promotes its keys to the document root.
- An index template (`logs-template`) makes the pipeline + keyword mappings apply to all future indices matching `dev-*` and `prod-*`.

## Why this setup looks the way it does

| Constraint | Consequence |
|---|---|
| DO log forwarder wraps each stdout line in `{log, do_app_name, do_component_name}` | Need an ingest pipeline to parse JSON back out |
| `${...}` substitution rejected in `log_destinations.basic_auth.user/password` | Cannot template credentials from bound DB vars |
| `cluster_name` binding requires Trusted Sources OFF on the cluster | Logs cluster sits on public internet, protected by basic auth only |
| Each `log_destinations` entry needs a unique `name:` field across the whole app spec | Use `opensearch-api`, `opensearch-worker`, etc. — not just `opensearch` |
| Index templates only apply at index creation time | Existing indices must be patched manually with `PUT <index>/_settings` |

## App spec — adding log forwarding to a component

For each service or worker in `.do/app-<env>.yaml`:

```yaml
log_destinations:
  - name: opensearch-<component>             # unique across the whole app spec
    open_search:
      cluster_name: logs-db                  # name of the DO Managed OpenSearch cluster
      index_name: <env>-<component>          # e.g. dev-api, prod-worker
```

**Per-env values:**

| App | Component | `log_destinations.name` | `index_name` |
|---|---|---|---|
| `dev-api` | `backend` (service) | `opensearch-api` | `dev-api` |
| `dev-api` | `worker` (worker) | `opensearch-worker` | `dev-worker` |
| `prod-api` | `backend` (service) | `opensearch-api` | `prod-api` |
| `prod-api` | `worker` (worker) | `opensearch-worker` | `prod-worker` |

The `databases:` binding for `logs-db` is **not** required for log forwarding (the `cluster_name` reference is enough). Leave it if you want bound env vars (`${logs-db.HOSTNAME}` etc.) available to app code; remove for a leaner spec.

## OpenSearch one-time setup

Run these once against the cluster, via **OpenSearch Dashboards → Dev Tools → Console**. They cover both dev and prod — patterns are `dev-*` and `prod-*`.

### 1. Create the ingest pipeline

```
PUT _ingest/pipeline/parse-log-json
{
  "description": "Parse DO-forwarded log JSON into top-level fields",
  "processors": [
    {
      "json": {
        "field": "log",
        "add_to_root": true,
        "ignore_failure": true
      }
    },
    {
      "remove": {
        "field": "log",
        "ignore_missing": true,
        "ignore_failure": true
      }
    }
  ]
}
```

Expect `{"acknowledged": true}`.

### 2. Create the index template

```
PUT _index_template/logs-template
{
  "index_patterns": ["dev-*", "prod-*"],
  "template": {
    "settings": {
      "index.default_pipeline": "parse-log-json"
    },
    "mappings": {
      "properties": {
        "timestamp": { "type": "date" },
        "level":     { "type": "keyword" },
        "service":   { "type": "keyword" },
        "module":    { "type": "keyword" },
        "message":   { "type": "text" }
      }
    }
  },
  "priority": 100
}
```

Expect `{"acknowledged": true}`.

### 3. Verify the pipeline works against a real log line

```
POST _ingest/pipeline/parse-log-json/_simulate
{
  "docs": [
    {
      "_source": {
        "log": "{\"timestamp\":\"2026-05-12T11:31:31.047Z\",\"level\":\"debug\",\"message\":\"settlement poll cycle\",\"service\":\"backend\",\"module\":\"worker.settlement\",\"slotMs\":229}",
        "do_app_name": "dev-api",
        "do_component_name": "backend"
      }
    }
  ]
}
```

`doc._source` in the response should contain `level`, `message`, `service`, `module`, `slotMs` at the top level, and no `log` field.

## Patching indices that predate the template

The template only applies at **index creation time**. If indices already exist (because forwarding started before the template was created), patch each one directly:

```
PUT <index-name>/_settings
{
  "index.default_pipeline": "parse-log-json"
}
```

Run for every existing index that should be parsed. Examples:

```
PUT dev-api/_settings    { "index.default_pipeline": "parse-log-json" }
PUT dev-worker/_settings { "index.default_pipeline": "parse-log-json" }
PUT prod-api/_settings   { "index.default_pipeline": "parse-log-json" }
PUT prod-worker/_settings { "index.default_pipeline": "parse-log-json" }
```

Existing documents stay in their wrapped form; only new ingests get parsed.

## Cluster prerequisites (DO control panel)

1. **Provision** Managed OpenSearch in the same region as the apps (currently `fra`). $11/mo Basic tier (1 vCPU / 2 GB / 40 GiB SSD) is sufficient for low/moderate volume.
2. **Trusted Sources: disabled.** Required for `cluster_name` binding to work. Cluster is protected by basic auth.
3. **doadmin password**: rotate to a strong DO-generated value. Never paste anywhere outside the DO console.
4. **Dashboard user**: create a separate Internal User with read-only role for human browsing — don't share doadmin for daily use.

## Rollout checklist for a new environment

When adding log forwarding to a new env (e.g. prod) or a new app:

**Preparation (do *before* the first deploy — guarantees indices auto-inherit pipeline + retention):**

- [ ] Confirm the index template (`logs-template`) already includes the new env's pattern (currently `["dev-*", "prod-*"]`)
- [ ] Confirm/create the env's retention policy (`logs-retention-<env>`) with `ism_template` matching `<env>-*`

**Deploy:**

- [ ] Add `log_destinations` block to each service/worker in `.do/app-<env>.yaml` (unique `name:`, env-prefixed `index_name`)
- [ ] Commit + push the submodule; root pointer bump
- [ ] Watch the deploy workflow for `failed to deploy` validation errors (common ones in the table above)
- [ ] After first successful deploy, generate traffic and confirm the new indices appear in OpenSearch

**Post-deploy verification:**

- [ ] In Dashboards Management → Index patterns, create/refresh the `<env>-*` pattern, then refresh the field list
- [ ] Verify in Discover: filter by `service`, `module`, `level` — fields are queryable
- [ ] Confirm ISM auto-attached: `GET _plugins/_ism/explain/<env>-api,<env>-worker` shows `policy_id: logs-retention-<env>`

**Retroactive patches (only needed if pipeline / policy were created *after* the indices already existed — happens once during initial setup, never on a clean rollout):**

- [ ] `PUT <index>/_settings { "index.default_pipeline": "parse-log-json" }`
- [ ] `POST _plugins/_ism/add/<index> { "policy_id": "logs-retention-<env>" }`

## ISM retention policies

Two policies, one per env. Both use simple delete-only — no rollover, no sliding window. Behavior: index accumulates for N days, then ISM deletes the whole index; forwarder creates a fresh empty one on the next write (template re-applies the pipeline automatically). At the deletion boundary you briefly see "no logs" until the next line arrives — for debugging/observability this is acceptable.

### Current policy values

| Env | Pattern | Retention |
|---|---|---|
| dev | `dev-*` | 7 days |
| prod | `prod-*` | 30 days |

### Create the dev policy

```
PUT _plugins/_ism/policies/logs-retention-dev
{
  "policy": {
    "description": "Delete dev-* indices older than 7 days",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [],
        "transitions": [
          { "state_name": "delete", "conditions": { "min_index_age": "7d" } }
        ]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }],
        "transitions": []
      }
    ],
    "ism_template": [
      { "index_patterns": ["dev-*"], "priority": 100 }
    ]
  }
}
```

### Create the prod policy

```
PUT _plugins/_ism/policies/logs-retention-prod
{
  "policy": {
    "description": "Delete prod-* indices older than 30 days",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [],
        "transitions": [
          { "state_name": "delete", "conditions": { "min_index_age": "30d" } }
        ]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }],
        "transitions": []
      }
    ],
    "ism_template": [
      { "index_patterns": ["prod-*"], "priority": 100 }
    ]
  }
}
```

### Attach policy to existing indices

`ism_template` only auto-attaches the policy to indices created **after** the policy exists. For indices that already exist, attach manually:

```
POST _plugins/_ism/add/dev-api    { "policy_id": "logs-retention-dev" }
POST _plugins/_ism/add/dev-worker { "policy_id": "logs-retention-dev" }
POST _plugins/_ism/add/prod-api   { "policy_id": "logs-retention-prod" }
POST _plugins/_ism/add/prod-worker{ "policy_id": "logs-retention-prod" }
```

Run the prod ones only after the prod indices have been created (i.e. after first prod deploy + first log line).

### Verify a policy is attached

```
GET _plugins/_ism/explain/<index-name>
```

Should show `policy_id` and current `state.name: "hot"` with a transition to `"delete"` pending on `min_index_age`.

### Changing retention later

Edit the policy in Dashboards → Index Management → State management policies, or PUT a new policy body. The new conditions apply on the next ISM evaluation cycle (default: every 5 minutes).

### Disk budget caveat

40 GiB cluster × 70% target = ~28 GiB usable across all envs. If prod log volume turns out high (>1 GB/day), 30 days × 1 GB ≈ 30 GiB and you're over budget. Mitigations: lower retention, raise `LOG_LEVEL` from `debug` to `info` in prod, or upsize the cluster.

### Upgrade path: sliding-window retention

Current setup deletes the whole index at age N. Result: periodic "purge cliffs" where logs disappear instantly. For a true sliding window (always have the last N days of logs available), switch to rollover:

1. Backing indices named `<env>-<component>-000001`, `-000002`, ... with alias `<env>-<component>` pointing at the current write index
2. ISM `rollover` action triggers a new backing index daily or by size
3. ISM `delete` action deletes individual backing indices when they're N days old
4. Requires reindexing existing `dev-api` → `dev-api-000001` and creating the alias

Not done yet. Only worth the migration if the purge-cliff behavior becomes painful in practice.

## Gotchas seen during initial setup

1. **`opensearch` vs `open_search`** — DO's log_destinations field name uses an underscore. The destination's user-facing `name:` field can use either.
2. **`${...}` in `basic_auth`** — rejected by the validator regex regardless of whether it's a bound-DB ref or a spec-level env var. Use `cluster_name` binding instead of `endpoint + basic_auth`.
3. **Hardcoded `endpoint`** — also rejected if it contains `${...}` for host/port. If you must use `endpoint`, the host has to be a literal URL — but then you still hit the basic_auth substitution wall, so you end up needing `cluster_name` anyway.
4. **Duplicate `log_destinations.name`** — must be unique across the whole app spec, even across service/worker boundaries.
5. **`add_to_root_conflict_strategy`** — not supported in the OpenSearch version on DO's image. Drop the parameter.
6. **Index template doesn't apply retroactively** — manual `PUT _settings` patch needed for pre-existing indices.

## References

- `backend/.do/app-dev.yaml` — current dev log_destinations
- `backend/src/logger.ts` — structured JSON logger emitting `service`, `module`, `level`, custom fields
- DO docs: <https://docs.digitalocean.com/products/app-platform/reference/app-spec/>
