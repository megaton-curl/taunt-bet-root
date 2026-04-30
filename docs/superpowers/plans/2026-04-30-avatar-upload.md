# Avatar Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three backend endpoints for player avatar upload/clear via Cloudflare Images, plus the supporting DB schema, config, and CF API client. Spec: `docs/specs/008-user-profile/spec.md` FR-10.

**Architecture:** Backend brokers Cloudflare's `direct_upload` API to issue one-time, server-signed upload URLs. Image bytes never pass through our servers. Anti-hijack defense: at signing time we bake `{ userId, exp }` into CF-stored metadata; on confirm (`PATCH`) we read it back and verify it matches the JWT caller. Storage is two new nullable columns on the existing `player_profiles` table — `avatar_url` (already present) becomes the derived `imagedelivery.net/...` URL written at confirm time.

**Tech Stack:** TypeScript (NodeNext ESM), Hono `@hono/zod-openapi`, Cloudflare Images REST API v1 + v2, PostgreSQL via `postgres`, vitest.

**Out of scope:** Frontend upload UI, NSFW moderation, multiple variants beyond `240x240`, Loot-Crate avatar gating. See spec FR-10 "Out of scope".

---

## File structure

**Create:**
- `backend/migrations/024_player_avatar.sql` — adds `avatar_image_id`, `avatar_updated_at`
- `backend/src/lib/cloudflare-images.ts` — CF Images REST client (pure, dependency-injected fetch)
- `backend/src/__tests__/cloudflare-images.test.ts` — unit tests (mocked fetch)
- `backend/src/__tests__/avatar-routes.test.ts` — integration tests (mocked CF)

**Modify:**
- `backend/src/contracts/api-errors.ts` — 4 new error codes
- `backend/src/contracts/validators.ts` — request/response schemas
- `backend/src/config.ts` — 4 new required env vars on `Config` and `loadConfig`
- `backend/src/db/profiles.ts` — extend `PlayerProfile`, add 3 methods to `ProfilesDb`
- `backend/src/routes/profile.ts` — 3 new routes (POST/PATCH/DELETE under `/profile/avatar`)
- `backend/src/index.ts` — construct `CloudflareImagesClient`, pass into `createProfileRoutes`
- `backend/.env` — add 4 CLOUDFLARE_* keys (operator fills secrets)
- `backend/.do/app-dev.yaml` — declare 4 new env vars (per backend/CLAUDE.md "App Platform Env Contract")
- `backend/.do/app-prod.yaml` — same
- `docs/specs/008-user-profile/spec.md` — correct migration number from `014` to `024`

**No frontend changes** — frontend is a separate project (per root CLAUDE.md scope rules).

---

## Task 1 — Migration

**Files:**
- Create: `backend/migrations/024_player_avatar.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 024_player_avatar.sql
-- Adds avatar storage columns to player_profiles. Cloudflare Images backs the
-- bytes; this table only stores the image UUID and the change timestamp.
-- Both columns nullable, additive, no backfill — see spec FR-10.

ALTER TABLE player_profiles
  ADD COLUMN avatar_image_id TEXT,
  ADD COLUMN avatar_updated_at TIMESTAMPTZ;
```

- [ ] **Step 2: Apply the migration**

```bash
cd backend && pnpm migrate
```

Expected output: contains `Applied: 024_player_avatar.sql` (or equivalent — check `migrate.ts` output format if surprised).

- [ ] **Step 3: Verify columns**

```bash
cd backend && pnpm exec tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
const cols = await sql\`SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'player_profiles' AND column_name IN ('avatar_image_id', 'avatar_updated_at') ORDER BY column_name\`;
console.log(cols);
await sql.end();
"
```

Expected: two rows, both `is_nullable: 'YES'`, types `text` and `timestamp with time zone`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/024_player_avatar.sql
git commit -m "feat(profile): add avatar columns to player_profiles"
```

---

## Task 2 — API error codes

**Files:**
- Modify: `backend/src/contracts/api-errors.ts`

- [ ] **Step 1: Append new codes**

In the `API_ERROR_CODES` object (around line 32, between `INVALID_USERNAME` and `MATCH_NOT_FOUND`), insert:

```ts
  AVATAR_COOLDOWN: "AVATAR_COOLDOWN",
  AVATAR_NOT_READY: "AVATAR_NOT_READY",
  AVATAR_HIJACK: "AVATAR_HIJACK",
  AVATAR_NOT_FOUND: "AVATAR_NOT_FOUND",
```

- [ ] **Step 2: Lint**

```bash
cd backend && pnpm lint:self
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/contracts/api-errors.ts
git commit -m "feat(api): add avatar error codes"
```

---

## Task 3 — Config: Cloudflare env vars

**Files:**
- Modify: `backend/src/config.ts`
- Modify: `backend/.env`

- [ ] **Step 1: Extend `Config` interface**

In `backend/src/config.ts`, in the `Config` interface, after `chatFeedToken: string | undefined;`, add:

```ts
  cloudflareAccountId: string;
  cloudflareAccountHash: string;
  cloudflareImagesToken: string;
  cloudflareImagesVariant: string;
```

- [ ] **Step 2: Extend `loadConfig()` returned object**

In the `return { ... }` body of `loadConfig`, add (place near other infrastructure vars):

```ts
    cloudflareAccountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareAccountHash: requireEnv("CLOUDFLARE_ACCOUNT_HASH"),
    cloudflareImagesToken: requireEnv("CLOUDFLARE_IMAGES_TOKEN"),
    cloudflareImagesVariant: requireEnv("CLOUDFLARE_IMAGES_VARIANT"),
```

- [ ] **Step 3: Add to `backend/.env`** (operator fills secret values; account hash + variant are already known)

Append:

```
# Cloudflare Images — avatar upload (spec 008 FR-10)
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_ACCOUNT_HASH=Nu1tHIHtX_h4t_YnuzsO_Q
CLOUDFLARE_IMAGES_TOKEN=
CLOUDFLARE_IMAGES_VARIANT=240x240
```

If the values are already present from earlier manual testing, leave them as-is.

- [ ] **Step 4: Typecheck + lint**

```bash
cd backend && pnpm typecheck && pnpm lint:self
```

Expected: 0 errors. (If `loadConfig` is called from a test before `.env` is populated, fill the values first.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.ts backend/.env
git commit -m "feat(config): require Cloudflare Images env vars"
```

---

## Task 4 — App Platform env contract

**Files:**
- Modify: `backend/.do/app-dev.yaml`
- Modify: `backend/.do/app-prod.yaml`

Per `backend/CLAUDE.md` "App Platform Env Contract", every new mandatory env var must be declared in both `.do/app-{dev,prod}.yaml` in the same task.

- [ ] **Step 1: Read existing structure**

```bash
cd backend && grep -n "envs:\|- key:" .do/app-dev.yaml | head -30
```

Identify the format used for the existing service envs (likely `- key: NAME` followed by `value: ${NAME}` or `scope:`).

- [ ] **Step 2: Append CF env vars to `app-dev.yaml`**

In the same `envs:` block as the other backend service env vars, add four entries (matching the existing scope/secret pattern — secrets use `${VAR}` interpolation; non-secrets like the variant + account hash can be inline):

```yaml
      - key: CLOUDFLARE_ACCOUNT_ID
        scope: RUN_AND_BUILD_TIME
        value: ${CLOUDFLARE_ACCOUNT_ID}
      - key: CLOUDFLARE_ACCOUNT_HASH
        scope: RUN_AND_BUILD_TIME
        value: Nu1tHIHtX_h4t_YnuzsO_Q
      - key: CLOUDFLARE_IMAGES_TOKEN
        scope: RUN_AND_BUILD_TIME
        type: SECRET
        value: ${CLOUDFLARE_IMAGES_TOKEN}
      - key: CLOUDFLARE_IMAGES_VARIANT
        scope: RUN_AND_BUILD_TIME
        value: 240x240
```

If the prevailing yaml style differs (e.g. uses `scope: RUN_TIME` only, or omits `type: SECRET` because SECRET is implied), match the file.

- [ ] **Step 3: Mirror in `app-prod.yaml`**

Append the same four entries (a separate prod CF account/token may be desirable later, but for MVP the values are the same).

- [ ] **Step 4: Confirm GitHub deploy workflows**

```bash
grep -n "CLOUDFLARE\|secrets\." /workspaces/rng-utopia/backend/.github/workflows/deploy-*.yml 2>/dev/null
ls /workspaces/rng-utopia/backend/.github/workflows/ 2>/dev/null
```

If the deploy workflows pass env vars explicitly (e.g. via `env:` blocks for the App Platform CLI), add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_IMAGES_TOKEN` (sourced from GitHub secrets) plus the two non-secret values. If they do not (i.e. the workflow only triggers App Platform redeploys), no change is needed beyond the yaml.

- [ ] **Step 5: Commit**

```bash
git add backend/.do/
git commit -m "chore(deploy): declare Cloudflare Images env vars in App Platform contract"
```

Note: secrets must be set in the DigitalOcean App Platform console + GitHub repository secrets BEFORE the next deploy. Out of scope for this code change but flag in PR description.

---

## Task 5 — Cloudflare Images client: failing tests

**Files:**
- Create: `backend/src/__tests__/cloudflare-images.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { CloudflareImagesClient } from "../lib/cloudflare-images.js";

describe("CloudflareImagesClient", () => {
  const cfg = { accountId: "acct", token: "tok" };

  it("requestDirectUpload posts multipart with metadata + expiry, returns id + uploadURL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: "img-123", uploadURL: "https://upload.example/abc" },
          errors: [],
          messages: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);

    const out = await client.requestDirectUpload({
      metadata: { userId: "usr_xxxxxxxx", exp: "2026-04-30T12:05:00.000Z" },
      expiryIso: "2026-04-30T12:05:00.000Z",
    });

    expect(out).toEqual({ imageId: "img-123", uploadURL: "https://upload.example/abc" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/images/v2/direct_upload",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
    const body = (init as RequestInit).body as FormData;
    expect(body.get("metadata")).toBe(
      JSON.stringify({ userId: "usr_xxxxxxxx", exp: "2026-04-30T12:05:00.000Z" }),
    );
    expect(body.get("requireSignedURLs")).toBe("false");
    expect(body.get("expiry")).toBe("2026-04-30T12:05:00.000Z");
  });

  it("requestDirectUpload throws on non-2xx", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 401 }),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);
    await expect(
      client.requestDirectUpload({
        metadata: { userId: "u", exp: "x" },
        expiryIso: "x",
      }),
    ).rejects.toThrow();
  });

  it("getImage returns draft + meta when CF reports the image", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            id: "img-123",
            draft: false,
            meta: { userId: "usr_xxxxxxxx", exp: "..." },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);

    const out = await client.getImage("img-123");

    expect(out).toEqual({ draft: false, meta: { userId: "usr_xxxxxxxx", exp: "..." } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/images/v1/img-123",
    );
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("getImage returns null on 404", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 404 }),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);
    expect(await client.getImage("img-missing")).toBeNull();
  });

  it("getImage throws on 5xx", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 503 }),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);
    await expect(client.getImage("img-x")).rejects.toThrow();
  });

  it("deleteImage swallows 404 (idempotent)", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 404 }),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);
    await expect(client.deleteImage("img-missing")).resolves.toBeUndefined();
  });

  it("deleteImage throws on 5xx", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 500 }),
    );
    const client = new CloudflareImagesClient(cfg, fetcher);
    await expect(client.deleteImage("img-x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && pnpm exec vitest run src/__tests__/cloudflare-images.test.ts
```

Expected: FAIL — `Cannot find module '../lib/cloudflare-images.js'` or equivalent.

---

## Task 6 — Cloudflare Images client: implementation

**Files:**
- Create: `backend/src/lib/cloudflare-images.ts`

- [ ] **Step 1: Implement the client**

```ts
/**
 * Thin wrapper over the Cloudflare Images REST API.
 *
 * - `v2/direct_upload` (POST): issue one-time pre-signed upload URLs to clients
 * - `v1/{id}`         (GET):   read image metadata for confirm-time verification
 * - `v1/{id}`         (DELETE): remove the image (idempotent on 404)
 *
 * The fetcher is dependency-injected so unit tests don't need to mock globals.
 */

export interface CloudflareImagesConfig {
  readonly accountId: string;
  readonly token: string;
}

export interface DirectUploadInput {
  readonly metadata: Record<string, string>;
  readonly expiryIso: string;
}

export interface DirectUploadResult {
  readonly imageId: string;
  readonly uploadURL: string;
}

export interface ImageMetadata {
  readonly draft: boolean;
  readonly meta: Record<string, string>;
}

type Fetcher = typeof globalThis.fetch;

export class CloudflareImagesClient {
  private readonly baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(
    private readonly cfg: CloudflareImagesConfig,
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  async requestDirectUpload(input: DirectUploadInput): Promise<DirectUploadResult> {
    const form = new FormData();
    form.set("metadata", JSON.stringify(input.metadata));
    form.set("requireSignedURLs", "false");
    form.set("expiry", input.expiryIso);

    const res = await this.fetcher(
      `${this.baseUrl}/accounts/${this.cfg.accountId}/images/v2/direct_upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.token}` },
        body: form,
      },
    );

    if (!res.ok) {
      throw new Error(`Cloudflare direct_upload failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      result?: { id?: string; uploadURL?: string };
    };
    if (!json.success || !json.result?.id || !json.result?.uploadURL) {
      throw new Error("Cloudflare direct_upload returned invalid payload");
    }
    return { imageId: json.result.id, uploadURL: json.result.uploadURL };
  }

  async getImage(imageId: string): Promise<ImageMetadata | null> {
    const res = await this.fetcher(
      `${this.baseUrl}/accounts/${this.cfg.accountId}/images/v1/${encodeURIComponent(imageId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${this.cfg.token}` },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Cloudflare getImage failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      result?: { draft?: boolean; meta?: Record<string, string> };
    };
    if (!json.success || !json.result) {
      throw new Error("Cloudflare getImage returned invalid payload");
    }
    return {
      draft: Boolean(json.result.draft),
      meta: json.result.meta ?? {},
    };
  }

  async deleteImage(imageId: string): Promise<void> {
    const res = await this.fetcher(
      `${this.baseUrl}/accounts/${this.cfg.accountId}/images/v1/${encodeURIComponent(imageId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.cfg.token}` },
      },
    );
    if (res.status === 404) return; // already gone — idempotent
    if (!res.ok) {
      throw new Error(`Cloudflare deleteImage failed: HTTP ${res.status}`);
    }
  }
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
cd backend && pnpm exec vitest run src/__tests__/cloudflare-images.test.ts
```

Expected: 7 passed.

- [ ] **Step 3: Lint**

```bash
cd backend && pnpm lint:self
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/cloudflare-images.ts backend/src/__tests__/cloudflare-images.test.ts
git commit -m "feat(lib): add Cloudflare Images REST client"
```

---

## Task 7 — DB: extend `PlayerProfile` + add 3 methods

**Files:**
- Modify: `backend/src/db/profiles.ts`

- [ ] **Step 1: Extend the `PlayerProfile` interface**

In `backend/src/db/profiles.ts`, replace the `PlayerProfile` interface (currently lines 7-15) with:

```ts
export interface PlayerProfile {
  id: number;
  user_id: string;
  wallet: string;
  username: string;
  username_updated_at: Date | null;
  avatar_url: string | null;
  avatar_image_id: string | null;
  avatar_updated_at: Date | null;
  created_at: Date;
}
```

The existing selectors use `SELECT * FROM player_profiles`, so the new columns flow through automatically; no SQL changes for read paths.

- [ ] **Step 2: Extend `ProfilesDb` interface**

After the `getOrCreateProfile` declaration in the interface, add:

```ts
  /**
   * Read avatar state for cooldown checks + previous-image-delete lookups.
   * Returns `null` if the profile does not exist.
   */
  getProfileAvatarState(userId: string): Promise<{
    imageId: string | null;
    updatedAt: Date | null;
  } | null>;

  /** Set a custom avatar. Stamps `avatar_updated_at = now()`. */
  setProfileAvatar(
    userId: string,
    imageId: string,
    avatarUrl: string,
  ): Promise<void>;

  /** Clear a custom avatar (back to identicon). Stamps `avatar_updated_at = now()`. */
  clearProfileAvatar(userId: string): Promise<void>;
```

- [ ] **Step 3: Implement on the `db` object inside `createProfilesDb`**

Inside the `const db: ProfilesDb = { ... }` block, append three new methods (place after `getOrCreateProfile`):

```ts
    async getProfileAvatarState(userId) {
      const rows = await sql<
        {
          avatar_image_id: string | null;
          avatar_updated_at: Date | null;
        }[]
      >`
        SELECT avatar_image_id, avatar_updated_at
        FROM player_profiles
        WHERE user_id = ${userId}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return {
        imageId: rows[0]!.avatar_image_id,
        updatedAt: rows[0]!.avatar_updated_at,
      };
    },

    async setProfileAvatar(userId, imageId, avatarUrl) {
      await sql`
        UPDATE player_profiles
        SET avatar_image_id = ${imageId},
            avatar_url = ${avatarUrl},
            avatar_updated_at = now()
        WHERE user_id = ${userId}
      `;
    },

    async clearProfileAvatar(userId) {
      await sql`
        UPDATE player_profiles
        SET avatar_image_id = NULL,
            avatar_url = NULL,
            avatar_updated_at = now()
        WHERE user_id = ${userId}
      `;
    },
```

- [ ] **Step 4: Typecheck + lint**

```bash
cd backend && pnpm typecheck && pnpm lint:self
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/profiles.ts
git commit -m "feat(db): avatar state read/write on player_profiles"
```

---

## Task 8 — Validators: request/response schemas

**Files:**
- Modify: `backend/src/contracts/validators.ts`

- [ ] **Step 1: Inspect existing patterns**

```bash
grep -n "export const\|z.object" /workspaces/rng-utopia/backend/src/contracts/validators.ts | head -20
```

Note the file's conventions for naming + structure (e.g. `UsernameBodySchema`, `UsernameUpdateResponseSchema`).

- [ ] **Step 2: Append new schemas**

At the bottom of `validators.ts` (or grouped near the existing avatar/profile schemas if there's a convention):

```ts
// ---------------------------------------------------------------------------
// Avatar upload (spec 008 FR-10)
// ---------------------------------------------------------------------------

export const AvatarUploadUrlResponseSchema = z.object({
  uploadURL: z.string().url(),
  imageId: z.string().min(1),
});

export const AvatarUpdateBodySchema = z.object({
  imageId: z.string().min(1).max(128),
});

export const AvatarUpdateResponseSchema = z.object({
  avatarUrl: z.string().url(),
});

export const AvatarCooldownDetailsSchema = z.object({
  nextChangeAvailableAt: z.string(), // ISO 8601
});
```

- [ ] **Step 3: Lint + typecheck**

```bash
cd backend && pnpm typecheck && pnpm lint:self
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/contracts/validators.ts
git commit -m "feat(api): add avatar request/response schemas"
```

---

## Task 9 — Routes: failing integration tests

**Files:**
- Create: `backend/src/__tests__/avatar-routes.test.ts`

- [ ] **Step 1: Inspect an existing integration test for the test harness pattern**

```bash
cat /workspaces/rng-utopia/backend/src/__tests__/auth-routes.test.ts | head -80
```

Identify how the harness wires up: DB setup, JWT issuance helper, route mounting, etc. Reuse the same helpers.

- [ ] **Step 2: Write the failing test file**

The exact harness imports vary; below is the structural template. Adapt imports + `buildApp` to whatever the existing tests use. Where the harness uses `setupTestDb` or similar — reuse it. Where it constructs a Hono app for testing — extend it to inject a fake CF client.

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
// Reuse the test harness from existing route tests:
import { buildTestApp, issueTestJwt, resetTestDb } from "./integration-test-helpers.js"; // adjust path/name to whatever exists

interface FakeCfClient {
  requestDirectUpload: ReturnType<typeof vi.fn>;
  getImage: ReturnType<typeof vi.fn>;
  deleteImage: ReturnType<typeof vi.fn>;
}

function makeFakeCf(): FakeCfClient {
  return {
    requestDirectUpload: vi.fn(),
    getImage: vi.fn(),
    deleteImage: vi.fn(),
  };
}

describe("/profile/avatar", () => {
  let cf: FakeCfClient;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let token: string;

  beforeEach(async () => {
    await resetTestDb();
    cf = makeFakeCf();
    app = await buildTestApp({ cloudflareImages: cf as never });
    const session = await issueTestJwt({ wallet: "TestWallet111111111111111111111111111111111" });
    userId = session.userId;
    token = session.accessToken;
  });

  it("POST /avatar/upload-url returns CF-issued upload URL with userId in metadata", async () => {
    cf.requestDirectUpload.mockResolvedValue({
      imageId: "img-aaa",
      uploadURL: "https://upload.cf.example/aaa",
    });

    const res = await app.request("/profile/avatar/upload-url", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { uploadURL: "https://upload.cf.example/aaa", imageId: "img-aaa" },
    });

    expect(cf.requestDirectUpload).toHaveBeenCalledTimes(1);
    const arg = cf.requestDirectUpload.mock.calls[0]![0];
    expect(arg.metadata.userId).toBe(userId);
    expect(typeof arg.metadata.exp).toBe("string");
    expect(typeof arg.expiryIso).toBe("string");
  });

  it("PATCH /avatar with valid imageId writes avatar_url and best-effort deletes prior image", async () => {
    cf.getImage.mockResolvedValue({ draft: false, meta: { userId } });
    cf.deleteImage.mockResolvedValue(undefined);

    const res = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-new" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.avatarUrl).toMatch(
      /^https:\/\/imagedelivery\.net\/[^/]+\/img-new\/[^/]+$/,
    );

    // No previous image existed yet, so deleteImage should not have been called.
    expect(cf.deleteImage).not.toHaveBeenCalled();
  });

  it("PATCH /avatar returns 403 when CF metadata.userId does not match caller", async () => {
    cf.getImage.mockResolvedValue({
      draft: false,
      meta: { userId: "usr_someoneelse" },
    });

    const res = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-stolen" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AVATAR_HIJACK");
  });

  it("PATCH /avatar returns 422 when CF reports draft: true", async () => {
    cf.getImage.mockResolvedValue({ draft: true, meta: { userId } });

    const res = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-pending" }),
    });

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("AVATAR_NOT_READY");
  });

  it("PATCH /avatar returns 404 when CF reports image does not exist", async () => {
    cf.getImage.mockResolvedValue(null);

    const res = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-ghost" }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AVATAR_NOT_FOUND");
  });

  it("PATCH /avatar best-effort deletes the previous image", async () => {
    // First successful change
    cf.getImage.mockResolvedValueOnce({ draft: false, meta: { userId } });
    await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-first" }),
    });

    // ... cooldown means we can't immediately PATCH again. Manipulate DB to bypass.
    // The harness should expose a helper to reset avatar_updated_at, or we use sql directly:
    // (Adapt to the project's test SQL helper.)
    // await testSql`UPDATE player_profiles SET avatar_updated_at = now() - interval '10 minutes' WHERE user_id = ${userId}`;

    cf.getImage.mockResolvedValueOnce({ draft: false, meta: { userId } });
    cf.deleteImage.mockResolvedValue(undefined);
    const res = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-second" }),
    });

    expect(res.status).toBe(200);
    expect(cf.deleteImage).toHaveBeenCalledWith("img-first");
  });

  it("PATCH /avatar twice within 5min returns 429 with nextChangeAvailableAt", async () => {
    cf.getImage.mockResolvedValue({ draft: false, meta: { userId } });

    const r1 = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-a" }),
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-b" }),
    });
    expect(r2.status).toBe(429);
    const body = await r2.json();
    expect(body.error.code).toBe("AVATAR_COOLDOWN");
    expect(typeof body.error.details.nextChangeAvailableAt).toBe("string");
  });

  it("DELETE /avatar clears columns and best-effort deletes CF image", async () => {
    // First set an avatar
    cf.getImage.mockResolvedValueOnce({ draft: false, meta: { userId } });
    await app.request("/profile/avatar", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: "img-existing" }),
    });

    // Bypass cooldown — see helper note above
    // await testSql`UPDATE player_profiles SET avatar_updated_at = now() - interval '10 minutes' WHERE user_id = ${userId}`;

    cf.deleteImage.mockResolvedValue(undefined);
    const res = await app.request("/profile/avatar", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    expect(cf.deleteImage).toHaveBeenCalledWith("img-existing");
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd backend && pnpm exec vitest run src/__tests__/avatar-routes.test.ts
```

Expected: FAIL — either route 404s or harness import errors. Don't proceed until the harness imports resolve (i.e. `buildTestApp`/`issueTestJwt`/`resetTestDb` reflect the project's actual helper names; rename as needed). The route assertions will fail because the routes don't exist yet — that's correct for TDD.

---

## Task 10 — Route: `POST /profile/avatar/upload-url`

**Files:**
- Modify: `backend/src/routes/profile.ts`

- [ ] **Step 1: Extend `ProfileRoutesDeps`**

Find:
```ts
export interface ProfileRoutesDeps {
  db: Db;
}
```

Replace with:
```ts
import type { CloudflareImagesClient } from "../lib/cloudflare-images.js";

export interface ProfileRoutesDeps {
  db: Db;
  cloudflareImages: CloudflareImagesClient;
  cloudflareAccountHash: string;
  cloudflareImagesVariant: string;
}
```

(Place the `import type` line with the other imports at the top.)

- [ ] **Step 2: Pull deps in the factory body**

Where the factory does `const { db } = deps;`, change to:

```ts
const { db, cloudflareImages, cloudflareAccountHash, cloudflareImagesVariant } = deps;
```

- [ ] **Step 3: Define the cooldown helper (file-local)**

Just above `export function createProfileRoutes`, add:

```ts
const AVATAR_COOLDOWN_MS = 5 * 60 * 1000;

function avatarCooldownDetails(updatedAt: Date | null): {
  active: boolean;
  nextChangeAvailableAt: string | null;
} {
  if (!updatedAt) return { active: false, nextChangeAvailableAt: null };
  const next = updatedAt.getTime() + AVATAR_COOLDOWN_MS;
  if (Date.now() >= next) return { active: false, nextChangeAvailableAt: null };
  return { active: true, nextChangeAvailableAt: new Date(next).toISOString() };
}
```

- [ ] **Step 4: Add the route definition**

Inside `createProfileRoutes`, add the OpenAPI route + handler. Reuse the `createRoute` import already in the file. Place near the other profile routes.

```ts
import {
  AvatarUpdateBodySchema,
  AvatarUpdateResponseSchema,
  AvatarUploadUrlResponseSchema,
} from "../contracts/validators.js";

// ... inside createProfileRoutes:

const avatarUploadUrlRoute = createRoute({
  method: "post",
  path: "/avatar/upload-url",
  tags: ["Profile"],
  summary: "Request a one-time Cloudflare Images direct-upload URL",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: envelope(AvatarUploadUrlResponseSchema) } },
      description: "Upload URL issued",
    },
    401: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Auth required" },
    404: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Profile not found" },
    429: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Cooldown active" },
    500: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Cloudflare unavailable" },
  },
});

app.openapi(avatarUploadUrlRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required");
  }

  const state = await db.getProfileAvatarState(userId);
  if (!state) {
    return err(c, 404, API_ERROR_CODES.PROFILE_NOT_FOUND, "Profile not found");
  }

  const cooldown = avatarCooldownDetails(state.updatedAt);
  if (cooldown.active) {
    return err(c, 429, API_ERROR_CODES.AVATAR_COOLDOWN, "Avatar change cooldown active", {
      retryable: true,
      details: { nextChangeAvailableAt: cooldown.nextChangeAvailableAt },
    });
  }

  const expiryIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  try {
    const result = await cloudflareImages.requestDirectUpload({
      metadata: { userId, exp: expiryIso },
      expiryIso,
    });
    return ok(c, { uploadURL: result.uploadURL, imageId: result.imageId });
  } catch (e) {
    logger.error("avatar/upload-url: cloudflare direct_upload failed", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(c, 500, API_ERROR_CODES.PRECONDITION_FAILED, "Avatar upload service unavailable", {
      retryable: true,
    });
  }
});
```

- [ ] **Step 5: Run targeted tests**

```bash
cd backend && pnpm exec vitest run src/__tests__/avatar-routes.test.ts -t "upload-url"
```

Expected: the upload-url tests pass. PATCH/DELETE tests still fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/profile.ts
git commit -m "feat(profile): POST /profile/avatar/upload-url"
```

---

## Task 11 — Route: `PATCH /profile/avatar`

**Files:**
- Modify: `backend/src/routes/profile.ts`

- [ ] **Step 1: Add the PATCH route + handler**

Inside `createProfileRoutes` (place after the upload-url route):

```ts
const avatarPatchRoute = createRoute({
  method: "patch",
  path: "/avatar",
  tags: ["Profile"],
  summary: "Confirm an uploaded image as the player's avatar",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: AvatarUpdateBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: envelope(AvatarUpdateResponseSchema) } },
      description: "Avatar updated",
    },
    401: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Auth required" },
    403: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Image belongs to another user" },
    404: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Image or profile not found" },
    422: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Image upload not yet completed" },
    429: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Cooldown active" },
    500: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Cloudflare unavailable" },
  },
});

app.openapi(avatarPatchRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required");
  }

  const { imageId } = c.req.valid("json");

  const state = await db.getProfileAvatarState(userId);
  if (!state) {
    return err(c, 404, API_ERROR_CODES.PROFILE_NOT_FOUND, "Profile not found");
  }

  const cooldown = avatarCooldownDetails(state.updatedAt);
  if (cooldown.active) {
    return err(c, 429, API_ERROR_CODES.AVATAR_COOLDOWN, "Avatar change cooldown active", {
      retryable: true,
      details: { nextChangeAvailableAt: cooldown.nextChangeAvailableAt },
    });
  }

  let cfMeta: Awaited<ReturnType<typeof cloudflareImages.getImage>>;
  try {
    cfMeta = await cloudflareImages.getImage(imageId);
  } catch (e) {
    logger.error("avatar PATCH: cloudflare getImage failed", {
      userId,
      imageId,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(c, 500, API_ERROR_CODES.PRECONDITION_FAILED, "Avatar verification failed", {
      retryable: true,
    });
  }

  if (!cfMeta) {
    return err(c, 404, API_ERROR_CODES.AVATAR_NOT_FOUND, "Image not found at Cloudflare");
  }
  if (cfMeta.draft) {
    return err(c, 422, API_ERROR_CODES.AVATAR_NOT_READY, "Image upload has not completed");
  }
  if (cfMeta.meta.userId !== userId) {
    return err(c, 403, API_ERROR_CODES.AVATAR_HIJACK, "Image does not belong to this user");
  }

  const avatarUrl = `https://imagedelivery.net/${cloudflareAccountHash}/${imageId}/${cloudflareImagesVariant}`;

  await db.setProfileAvatar(userId, imageId, avatarUrl);

  // Best-effort delete of the previous image. Never bubble up.
  if (state.imageId && state.imageId !== imageId) {
    cloudflareImages.deleteImage(state.imageId).catch((e) => {
      logger.warn("avatar PATCH: failed to delete previous CF image", {
        userId,
        previousImageId: state.imageId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return ok(c, { avatarUrl });
});
```

- [ ] **Step 2: Run targeted tests**

```bash
cd backend && pnpm exec vitest run src/__tests__/avatar-routes.test.ts -t "PATCH"
```

Expected: PATCH tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/profile.ts
git commit -m "feat(profile): PATCH /profile/avatar with hijack protection"
```

---

## Task 12 — Route: `DELETE /profile/avatar`

**Files:**
- Modify: `backend/src/routes/profile.ts`

- [ ] **Step 1: Add the DELETE route + handler**

```ts
const avatarDeleteRoute = createRoute({
  method: "delete",
  path: "/avatar",
  tags: ["Profile"],
  summary: "Clear the player's custom avatar",
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: "Avatar cleared" },
    401: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Auth required" },
    404: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Profile not found" },
    429: { content: { "application/json": { schema: ErrorEnvelopeSchema } }, description: "Cooldown active" },
  },
});

app.openapi(avatarDeleteRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return err(c, 401, API_ERROR_CODES.AUTH_REQUIRED, "Authentication required");
  }

  const state = await db.getProfileAvatarState(userId);
  if (!state) {
    return err(c, 404, API_ERROR_CODES.PROFILE_NOT_FOUND, "Profile not found");
  }

  const cooldown = avatarCooldownDetails(state.updatedAt);
  if (cooldown.active) {
    return err(c, 429, API_ERROR_CODES.AVATAR_COOLDOWN, "Avatar change cooldown active", {
      retryable: true,
      details: { nextChangeAvailableAt: cooldown.nextChangeAvailableAt },
    });
  }

  await db.clearProfileAvatar(userId);

  if (state.imageId) {
    cloudflareImages.deleteImage(state.imageId).catch((e) => {
      logger.warn("avatar DELETE: failed to delete CF image", {
        userId,
        imageId: state.imageId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return c.body(null, 204);
});
```

- [ ] **Step 2: Run all avatar tests**

```bash
cd backend && pnpm exec vitest run src/__tests__/avatar-routes.test.ts
```

Expected: all tests pass. If the cooldown-bypass helper in the integration test was left as a comment placeholder, fix it now to actually mutate `avatar_updated_at` via the project's test SQL helper.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/profile.ts
git commit -m "feat(profile): DELETE /profile/avatar"
```

---

## Task 13 — Wire `CloudflareImagesClient` into `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Import and construct**

Near the other top-level imports in `backend/src/index.ts`:

```ts
import { CloudflareImagesClient } from "./lib/cloudflare-images.js";
```

After `loadConfig()` is called and `db` is constructed (around the existing `app.route("/profile", ...)` call), construct the client:

```ts
const cloudflareImages = new CloudflareImagesClient({
  accountId: config.cloudflareAccountId,
  token: config.cloudflareImagesToken,
});
```

- [ ] **Step 2: Pass into createProfileRoutes**

Find:
```ts
app.route("/profile", createProfileRoutes({ db }));
```

Replace with:
```ts
app.route(
  "/profile",
  createProfileRoutes({
    db,
    cloudflareImages,
    cloudflareAccountHash: config.cloudflareAccountHash,
    cloudflareImagesVariant: config.cloudflareImagesVariant,
  }),
);
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "wire(profile): inject Cloudflare Images client into profile routes"
```

---

## Task 14 — Spec correction

**Files:**
- Modify: `docs/specs/008-user-profile/spec.md`

- [ ] **Step 1: Fix migration number**

The Iteration 3 checklist names the migration `014_player_avatar.sql`, but `014` is taken (`014_telegram_links.sql`). Replace with `024_player_avatar.sql`.

```bash
grep -n "014_player_avatar" docs/specs/008-user-profile/spec.md
```

Use Edit to change `014_player_avatar.sql` → `024_player_avatar.sql` in the spec.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/008-user-profile/spec.md
git commit -m "docs(spec-008): correct avatar migration number to 024"
```

---

## Task 15 — Full verify

- [ ] **Step 1: Backend lint + typecheck + tests**

```bash
cd backend && pnpm lint && pnpm typecheck && pnpm test
```

Expected: 0 errors, all tests pass. Pay particular attention to the OpenAPI contract test (`openapi-contract.test.ts`) which enforces that every 2xx route returns `envelope(...)` and every 4xx/5xx returns `ErrorEnvelopeSchema`. If it fails, fix the route definitions to match the existing pattern.

- [ ] **Step 2: Cross-repo verify**

```bash
cd /workspaces/rng-utopia && ./scripts/verify
```

Expected: exit 0.

- [ ] **Step 3: End-to-end smoke against dev Cloudflare**

With `backend/.env` populated with real `CLOUDFLARE_*` values:

```bash
cd backend && pnpm dev &
sleep 3

# 1. Get an access token (use existing test wallet or auth flow — adapt to project tooling)
TOKEN=...  # supply by your usual local auth helper

# 2. Request an upload URL
curl -s -X POST http://localhost:3100/profile/avatar/upload-url \
  -H "Authorization: Bearer $TOKEN" | jq

# Save the returned imageId + uploadURL
IMAGE_ID=...
UPLOAD_URL=...

# 3. Upload a test image directly to CF
curl -s -X PUT -F file=@./test-avatar.png "$UPLOAD_URL" | jq

# 4. Confirm via PATCH
curl -s -X PATCH http://localhost:3100/profile/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"imageId\":\"$IMAGE_ID\"}" | jq

# 5. Verify avatar_url points to imagedelivery.net
curl -s http://localhost:3100/profile/me \
  -H "Authorization: Bearer $TOKEN" | jq .data.avatarUrl
```

Expected: final response is the `imagedelivery.net/Nu1tHIHtX_h4t_YnuzsO_Q/<imageId>/240x240` URL. Open it in a browser to confirm the image renders.

- [ ] **Step 4: Commit any final cleanup, push branch**

If verify uncovered any straggling fixes:

```bash
git add -A
git commit -m "fix: verify-cycle cleanup for avatar upload"
```

---

## Self-review checklist (already done by the planner; recorded here for the executor)

**Spec coverage:** every FR-10 acceptance criterion is mapped to at least one task:

| AC | Task |
|---|---|
| Migration adds columns | Task 1 |
| Migration runs cleanly | Task 1 step 2 |
| upload-url returns CF URL with metadata | Task 10, Task 9 test 1 |
| PATCH 403 on hijack | Task 11, Task 9 test 3 |
| PATCH 404 on missing | Task 11, Task 9 test 5 |
| PATCH 422 on draft | Task 11, Task 9 test 4 |
| PATCH success writes columns + derived URL | Task 11, Task 9 test 2 |
| PATCH best-effort previous-image delete | Task 11, Task 9 test 6 |
| DELETE clears columns + best-effort CF delete | Task 12, Task 9 test 8 |
| Cooldown 429 with `nextChangeAvailableAt` | Tasks 10/11/12, Task 9 test 7 |
| `GET /profile/me` emits imagedelivery URL | flows automatically — `avatar_url` is already in the response and `setProfileAvatar` writes the imagedelivery URL there. Verified by Task 15 step 3 |
| No multipart on backend | Code review: confirm no `multipart/*` content types or file-buffer reads in any new route handler |
| OpenAPI exposes 3 paths | Tasks 10/11/12 register routes via `app.openapi(...)` which emits OpenAPI; `openapi-contract.test.ts` enforces shape |

**Type consistency:** `getProfileAvatarState`, `setProfileAvatar`, `clearProfileAvatar` are named identically in interface, implementation, and routes.

**No placeholders:** every step has concrete code or commands.

---

## Execution

The executing agent should follow tasks in order. Each task ends in a commit so progress is checkpointed. Cooldown-bypass in tests requires a small SQL helper — left as a TODO comment in Task 9 to be resolved against the project's actual test harness in Task 9 step 2 (the helper imports already imply its existence; if it doesn't, a one-line `await testSql\`UPDATE player_profiles SET avatar_updated_at = now() - interval '10 minutes' WHERE user_id = ${userId}\`` works).
