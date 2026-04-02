/**
 * Local E2E: Waitlist app + backend smoke test.
 *
 * Verifies:
 * 1. Waitlist app loads and renders (Playwright browser test)
 * 2. Backend health endpoint responds
 * 3. Auth challenge-response flow works (API-level, programmatic signing)
 * 4. Referral code set + apply flow works (API-level)
 *
 * Prerequisites:
 * - Backend running at http://localhost:3100 (DATABASE_URL pointing to local PG)
 * - Waitlist app running at http://localhost:5173 (npm run dev)
 *
 * Run: cd e2e && pnpm exec playwright test local/waitlist-smoke.spec.ts
 */
import { test, expect } from "@playwright/test";
import { Keypair } from "@solana/web3.js";
import { sign } from "tweetnacl";
import bs58 from "bs58";

const BACKEND_URL = process.env.VITE_FAIRNESS_BACKEND_URL ?? "http://127.0.0.1:3100";
const WAITLIST_URL = process.env.WAITLIST_URL ?? "http://127.0.0.1:5173";

// Deterministic test keypairs (not funded — no on-chain ops needed)
const USER_A = Keypair.generate();
const USER_B = Keypair.generate();

// ── Auth helper ────────────────────────────────────────────────────

async function authenticate(keypair: Keypair): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const wallet = keypair.publicKey.toBase58();

  const challengeResp = await fetch(`${BACKEND_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  expect(challengeResp.ok).toBe(true);
  const { nonce, message } = (await challengeResp.json()) as {
    nonce: string;
    message: string;
  };

  const messageBytes = new TextEncoder().encode(message);
  const signature = sign.detached(messageBytes, keypair.secretKey);
  const signatureBase58 = bs58.encode(signature);

  const verifyResp = await fetch(`${BACKEND_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, wallet, signature: signatureBase58 }),
  });
  expect(verifyResp.ok).toBe(true);
  const tokens = (await verifyResp.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  return tokens;
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

test.describe("waitlist + backend smoke", () => {
  test("backend health check", async () => {
    const resp = await fetch(`${BACKEND_URL}/health`);
    expect(resp.ok).toBe(true);
    const body = (await resp.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("waitlist app loads and renders", async ({ page }) => {
    await page.goto(WAITLIST_URL);
    // App should render (not blank screen)
    await expect(page.locator("body")).not.toBeEmpty();
    // Should have some visible content within 10s (check for any button — proves React rendered)
    await expect(page.locator("button").first()).toBeVisible({ timeout: 10_000 });
  });

  test("waitlist shows connect wallet button", async ({ page }) => {
    await page.goto(WAITLIST_URL);
    // Should have a wallet connect button/element
    const connectBtn = page.locator("button").filter({ hasText: /connect|wallet/i }).first();
    await expect(connectBtn).toBeVisible({ timeout: 10_000 });
  });

  test("auth: challenge → verify → profile created → refresh → logout", async () => {
    // 1. Authenticate
    const { accessToken, refreshToken } = await authenticate(USER_A);
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    // 2. Profile was auto-created — GET /profile/me should work
    const profileResp = await fetch(`${BACKEND_URL}/profile/me`, {
      headers: authHeaders(accessToken),
    });
    expect(profileResp.ok).toBe(true);
    const profile = (await profileResp.json()) as {
      userId: string;
      username: string;
    };
    expect(profile.userId).toMatch(/^usr_/);
    expect(profile.username).toBeTruthy();

    // 3. Refresh token works
    const refreshResp = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    expect(refreshResp.ok).toBe(true);
    const newTokens = (await refreshResp.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(newTokens.accessToken).toBeTruthy();

    // 4. Logout
    const logoutResp = await fetch(`${BACKEND_URL}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: newTokens.refreshToken }),
    });
    expect(logoutResp.ok).toBe(true);
  });

  test("referral: set code → apply → verify link", async () => {
    // Authenticate both users
    const { accessToken: tokenA } = await authenticate(USER_A);
    const { accessToken: tokenB } = await authenticate(USER_B);

    // User A sets a referral code
    const codeResp = await fetch(`${BACKEND_URL}/referral/code`, {
      method: "POST",
      headers: authHeaders(tokenA),
      body: JSON.stringify({ code: `t-${Date.now().toString(36)}` }),
    });
    if (!codeResp.ok) {
      const errBody = await codeResp.text();
      throw new Error(`POST /referral/code failed (${codeResp.status}): ${errBody}`);
    }
    const { code } = (await codeResp.json()) as { code: string };
    expect(code).toBeTruthy();

    // User B applies the code
    const applyResp = await fetch(`${BACKEND_URL}/referral/apply`, {
      method: "POST",
      headers: authHeaders(tokenB),
      body: JSON.stringify({ code }),
    });
    expect(applyResp.ok).toBe(true);

    // Verify the link exists
    const referrerResp = await fetch(`${BACKEND_URL}/referral/referrer`, {
      headers: authHeaders(tokenB),
    });
    expect(referrerResp.ok).toBe(true);
    const referrer = (await referrerResp.json()) as {
      referrerUserId: string;
      referrerUsername: string;
      referrerCode: string;
    };
    expect(referrer.referrerCode).toBe(code);
    expect(referrer.referrerUsername).toBeTruthy();

    // User A sees the referral in their list
    const referralsResp = await fetch(`${BACKEND_URL}/referral/referrals`, {
      headers: authHeaders(tokenA),
    });
    expect(referralsResp.ok).toBe(true);
    const referrals = (await referralsResp.json()) as {
      items: Array<{ refereeUserId: string; refereeUsername: string }>;
    };
    expect(referrals.items.length).toBeGreaterThanOrEqual(1);
    expect(referrals.items[0].refereeUsername).toBeTruthy();
  });
});
