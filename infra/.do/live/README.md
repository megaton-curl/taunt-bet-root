# Live State Capture

Store local-only exports from `doctl` here.

The current implementation was derived from:

- `/workspaces/rng-utopia/dev-taunt-bet-spec.yaml`
- `/workspaces/rng-utopia/dev-taunt-bet-full.json`

Those root-level files should remain ignored or be moved into `infra/.do/live/` before any broad `git add` from the parent repo.

If you want to refresh the live state from another machine, run these commands from the root of the parent repo and save the outputs relative to that root:

```bash
doctl apps list --format ID,Spec.Name,DefaultIngress,Created,Updated > infra/.do/live/apps-list.txt
doctl apps get <DEV_TAUNT_BET_APP_ID> -o json > infra/.do/live/dev-taunt-bet.app.json
doctl apps spec get <DEV_TAUNT_BET_APP_ID> --format yaml > infra/.do/live/dev-taunt-bet.spec.yaml
doctl databases list -o json > infra/.do/live/databases.json
```

If you are keeping the current database cluster, also export its details:

```bash
doctl databases get <DB_ID> -o json > infra/.do/live/dev-taunt-db.json
doctl databases configuration get <DB_ID> --engine pg -o json > infra/.do/live/dev-taunt-db-config.json
doctl databases db list <DB_ID> -o json > infra/.do/live/dev-taunt-db-dbs.json
```

Do not commit anything in `live/`.
