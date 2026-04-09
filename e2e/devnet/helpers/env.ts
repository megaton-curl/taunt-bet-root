/**
 * Devnet E2E environment contract.
 *
 * Validates that all required environment variables are present and well-formed
 * before any devnet test runs. Fails fast with clear error messages so CI
 * doesn't waste time on doomed runs.
 *
 * Required env vars:
 *   VITE_RPC_URL             — Devnet RPC endpoint (https URL)
 *   VITE_FLIPYOU_PROGRAM_ID — Deployed flipyou program address (base58)
 *   VITE_PLATFORM_PROGRAM_ID — Deployed platform program address (base58)
 *   VITE_FAIRNESS_BACKEND_URL — Running fairness backend base URL (http(s) URL)
 *
 * Optional (with defaults):
 *   VITE_SOLANA_NETWORK      — Cluster name (default: "devnet")
 */

import { Connection, PublicKey } from "@solana/web3.js";

/** Validated devnet configuration. */
export interface DevnetConfig {
  rpcUrl: string;
  network: string;
  fairnessBackendUrl: string;
  flipyouProgramId: PublicKey;
  platformProgramId: PublicKey;
  /** Optional — falls back to IDL address if env var missing. */
  potshotProgramId: PublicKey | null;
  /** Optional — Close Call program ID. Tests skip if not configured. */
  closecallProgramId: PublicKey | null;
}

/** Validate a base58 public key string. Throws if invalid. */
function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(
      `${label} is not a valid Solana address (base58): "${value}"`,
    );
  }
}

/** Validate a URL string. Throws if malformed. */
function parseUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("not http(s)");
    }
    return value;
  } catch {
    throw new Error(
      `${label} is not a valid HTTP(S) URL: "${value}"`,
    );
  }
}

/**
 * Read and validate all required devnet env vars.
 * Throws with a consolidated error listing every missing/invalid variable.
 */
export function validateDevnetEnv(): DevnetConfig {
  const errors: string[] = [];

  // --- Required ---
  const rpcUrl = process.env.VITE_RPC_URL;
  if (!rpcUrl) {
    errors.push("VITE_RPC_URL is required (devnet RPC endpoint)");
  }

  const flipyouId = process.env.VITE_FLIPYOU_PROGRAM_ID;
  if (!flipyouId) {
    errors.push(
      "VITE_FLIPYOU_PROGRAM_ID is required (deployed flipyou program address)",
    );
  }

  const platformId = process.env.VITE_PLATFORM_PROGRAM_ID;
  if (!platformId) {
    errors.push(
      "VITE_PLATFORM_PROGRAM_ID is required (deployed platform program address)",
    );
  }

  const fairnessBackendUrl = process.env.VITE_FAIRNESS_BACKEND_URL;
  if (!fairnessBackendUrl) {
    errors.push(
      "VITE_FAIRNESS_BACKEND_URL is required (running backend base URL)",
    );
  }

  // Fail fast if any required var is missing
  if (errors.length > 0) {
    throw new Error(
      `Devnet E2E env validation failed:\n  - ${errors.join("\n  - ")}\n\n` +
        `Hint: copy .env.devnet to .env.local and update program IDs, ` +
        `or export the variables before running tests.`,
    );
  }

  // --- Format validation ---
  const validatedUrl = parseUrl(rpcUrl!, "VITE_RPC_URL");
  const validatedBackendUrl = parseUrl(
    fairnessBackendUrl!,
    "VITE_FAIRNESS_BACKEND_URL",
  );
  const flipyouProgramId = parsePublicKey(
    flipyouId!,
    "VITE_FLIPYOU_PROGRAM_ID",
  );
  const platformProgramId = parsePublicKey(
    platformId!,
    "VITE_PLATFORM_PROGRAM_ID",
  );

  // --- Optional with default ---
  const network = process.env.VITE_SOLANA_NETWORK ?? "devnet";

  // --- Optional potshot (IDL fallback if env var missing) ---
  const potshotIdStr = process.env.VITE_POTSHOT_PROGRAM_ID;
  let potshotProgramId: PublicKey | null = null;
  if (potshotIdStr) {
    try {
      potshotProgramId = parsePublicKey(potshotIdStr, "VITE_POTSHOT_PROGRAM_ID");
    } catch {
      console.warn(`VITE_POTSHOT_PROGRAM_ID is invalid: "${potshotIdStr}" — Lord tests will skip`);
    }
  }

  // --- Optional closecall ---
  const closecallIdStr = process.env.VITE_CLOSECALL_PROGRAM_ID;
  let closecallProgramId: PublicKey | null = null;
  if (closecallIdStr) {
    try {
      closecallProgramId = parsePublicKey(closecallIdStr, "VITE_CLOSECALL_PROGRAM_ID");
    } catch {
      console.warn(`VITE_CLOSECALL_PROGRAM_ID is invalid: "${closecallIdStr}" — Close Call tests will skip`);
    }
  }

  return {
    rpcUrl: validatedUrl,
    network,
    fairnessBackendUrl: validatedBackendUrl.replace(/\/$/, ""),
    flipyouProgramId,
    platformProgramId,
    potshotProgramId,
    closecallProgramId,
  };
}

/**
 * Verify that the devnet RPC is reachable and that required programs
 * are deployed. Call this once in globalSetup or the first test's beforeAll.
 */
export async function verifyDevnetDeployments(
  config: DevnetConfig,
): Promise<void> {
  const connection = new Connection(config.rpcUrl, "confirmed");

  // 1. RPC health check
  try {
    await connection.getLatestBlockhash();
  } catch (err) {
    throw new Error(
      `Cannot reach devnet RPC at ${config.rpcUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 2. FlipYou program deployed
  const flipyouAccount = await connection.getAccountInfo(
    config.flipyouProgramId,
  );
  if (!flipyouAccount || !flipyouAccount.executable) {
    throw new Error(
      `FlipYou program not found or not executable at ${config.flipyouProgramId.toBase58()}`,
    );
  }

  // 3. Platform program deployed
  const platformAccount = await connection.getAccountInfo(
    config.platformProgramId,
  );
  if (!platformAccount || !platformAccount.executable) {
    throw new Error(
      `Platform program not found or not executable at ${config.platformProgramId.toBase58()}`,
    );
  }

  // 4. Pot Shot program deployed (optional — skip if not configured)
  if (config.potshotProgramId) {
    const lordAccount = await connection.getAccountInfo(
      config.potshotProgramId,
    );
    if (!lordAccount || !lordAccount.executable) {
      throw new Error(
        `Pot Shot program not found or not executable at ${config.potshotProgramId.toBase58()}`,
      );
    }
  }

  // 5. Close Call program deployed (optional — skip if not configured)
  if (config.closecallProgramId) {
    const closecallAccount = await connection.getAccountInfo(
      config.closecallProgramId,
    );
    if (!closecallAccount || !closecallAccount.executable) {
      throw new Error(
        `Close Call program not found or not executable at ${config.closecallProgramId.toBase58()}`,
      );
    }
  }
}

export async function verifyFairnessBackend(
  config: DevnetConfig,
): Promise<void> {
  const response = await fetch(`${config.fairnessBackendUrl}/health`);
  if (!response.ok) {
    throw new Error(
      `Fairness backend health check failed: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    dbConnected?: boolean;
    workerRunning?: boolean;
  };

  if (!json.dbConnected) {
    throw new Error("Fairness backend reports database disconnected");
  }
  if (!json.workerRunning) {
    throw new Error("Fairness backend worker is not running");
  }
}
