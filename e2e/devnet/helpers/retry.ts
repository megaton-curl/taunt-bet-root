/* eslint-disable no-console */
/**
 * Generic retry wrapper for on-chain assertions on devnet.
 *
 * Devnet RPC reads may lag behind state changes. This utility retries
 * an async assertion function with configurable delay and attempt count,
 * logging each attempt for observability.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3). */
  retries?: number;
  /** Delay between retries in milliseconds (default: 2000). */
  delayMs?: number;
  /** Human-readable label for log messages. */
  label?: string;
}

/**
 * Retry an async function up to `retries` times with a fixed delay between attempts.
 * The last error is re-thrown if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 3, delayMs = 2_000, label = "withRetry" } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.log(
          `[retry] ${label}: attempt ${attempt}/${retries} failed, retrying in ${delayMs}ms — ${err instanceof Error ? err.message : String(err)}`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.log(
    `[retry] ${label}: all ${retries} attempts exhausted`,
  );
  throw lastError;
}
