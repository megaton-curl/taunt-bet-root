import { Keypair } from "@solana/web3.js";

// Dedicated deterministic wallets for devnet E2E.
// These must be normal system accounts on devnet (fee-payer capable).
const SEED_PLAYER_A = new Uint8Array([
  249, 96, 168, 181, 111, 178, 254, 95,
  53, 242, 24, 180, 4, 41, 240, 186,
  84, 214, 41, 112, 237, 195, 181, 80,
  97, 62, 84, 214, 23, 235, 167, 247,
]);

const SEED_PLAYER_B = new Uint8Array([
  131, 192, 135, 198, 45, 197, 164, 89,
  222, 162, 30, 40, 101, 244, 127, 99,
  84, 0, 58, 229, 214, 135, 35, 129,
  145, 3, 246, 115, 149, 212, 51, 128,
]);

export const PLAYER_A = Keypair.fromSeed(SEED_PLAYER_A);
export const PLAYER_B = Keypair.fromSeed(SEED_PLAYER_B);
