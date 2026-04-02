/**
 * JWT authentication helper for devnet E2E tests.
 *
 * Performs the challenge-response flow against the backend to get an access token
 * for a given keypair. Uses Node.js crypto Ed25519 for signing (no extra deps).
 */
import { Keypair } from "@solana/web3.js";
import { sign } from "tweetnacl";
import bs58 from "bs58";

export async function authenticate(
  backendUrl: string,
  keypair: Keypair,
): Promise<string> {
  const wallet = keypair.publicKey.toBase58();

  // 1. Request challenge
  const challengeResp = await fetch(`${backendUrl}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!challengeResp.ok) {
    throw new Error(`auth/challenge failed: ${challengeResp.status}`);
  }
  const { nonce, message } = (await challengeResp.json()) as {
    nonce: string;
    message: string;
  };

  // 2. Sign the challenge message with the keypair's secret key
  const messageBytes = new TextEncoder().encode(message);
  const signature = sign.detached(messageBytes, keypair.secretKey);
  const signatureBase58 = bs58.encode(signature);

  // 3. Verify — returns access + refresh tokens
  const verifyResp = await fetch(`${backendUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, wallet, signature: signatureBase58 }),
  });
  if (!verifyResp.ok) {
    const body = await verifyResp.text();
    throw new Error(`auth/verify failed: ${verifyResp.status} — ${body}`);
  }
  const { accessToken } = (await verifyResp.json()) as {
    accessToken: string;
  };

  return accessToken;
}
