#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Standalone script to clean up stale Pot Shot rounds on devnet.
 *
 * Usage: npx tsx e2e/devnet/helpers/cleanup-stale-rounds.ts
 *
 * Requires .env.devnet or equivalent env vars set.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getLordProgram, type PotShotRoundAccount } from "../../local/helpers/on-chain";
import { getOraoRandomnessPda } from "./tx-utils";
import {
  joinLordRoundOnChain,
  startLordSpinOnChain,
  waitForLordOraoFulfillment,
  readLordVrfWinner,
  claimLordPayoutOnChain,
} from "./potshot-vrf-fallback";
// Env vars must be set before running (source .env.devnet or export them).

const RPC_URL = process.env.VITE_RPC_URL;
if (!RPC_URL) {
  console.error("VITE_RPC_URL not set. Load .env.devnet first.");
  process.exit(1);
}

// Deterministic test wallet seeds (same as wallets.ts)
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

const PLAYER_A = Keypair.fromSeed(SEED_PLAYER_A);
const PLAYER_B = Keypair.fromSeed(SEED_PLAYER_B);

async function main() {
  const connection = new Connection(RPC_URL!, "confirmed");
  const program = getLordProgram(connection);

  console.log(`Player A: ${PLAYER_A.publicKey.toBase58()}`);
  console.log(`Player B: ${PLAYER_B.publicKey.toBase58()}`);

  // Check balances
  const balA = await connection.getBalance(PLAYER_A.publicKey);
  const balB = await connection.getBalance(PLAYER_B.publicKey);
  console.log(`Player A balance: ${(balA / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Player B balance: ${(balB / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Fetch all rounds
  const allRounds = await program.account.pot shotRound.all();
  console.log(`\nTotal rounds on-chain: ${allRounds.length}`);

  if (allRounds.length === 0) {
    console.log("No rounds found — clean state!");
    return;
  }

  for (const entry of allRounds) {
    const round = entry.account as unknown as PotShotRoundAccount;
    const pda = entry.publicKey;
    const phase = Object.keys(round.phase)[0];
    const playerKeys = round.players.map((p) => p.player.toBase58().slice(0, 8));

    console.log(`\n--- Round ---`);
    console.log(`  PDA: ${pda.toBase58()}`);
    console.log(`  Tier: ${round.tier}, Round#: ${round.roundNumber.toNumber()}`);
    console.log(`  Phase: ${phase}`);
    console.log(`  Players: ${round.players.length} [${playerKeys.join(", ")}...]`);
    console.log(`  Total entries: ${round.totalEntries}`);
    console.log(`  Creator: ${round.creator.toBase58().slice(0, 8)}...`);
    console.log(`  Claimed: ${round.claimed}`);

    const involvesA = round.players.some((p) => p.player.equals(PLAYER_A.publicKey));
    const involvesB = round.players.some((p) => p.player.equals(PLAYER_B.publicKey));

    if (!involvesA && !involvesB) {
      console.log(`  → Not our round, skipping`);
      continue;
    }

    // Try to advance this round to completion
    if (phase === "waiting") {
      console.log(`  → Waiting phase. Need 2nd player to start countdown.`);

      if (round.players.length < 2) {
        // Join with the other player
        const joiner = involvesA ? PLAYER_B : PLAYER_A;
        const joinerLabel = involvesA ? "Player B" : "Player A";
        console.log(`  → Joining with ${joinerLabel}...`);
        try {
          await joinLordRoundOnChain(connection, joiner, round.tier, round.roundNumber.toNumber(), 1);
          console.log(`  → ${joinerLabel} joined successfully`);
        } catch (err) {
          console.error(`  → Join failed: ${err}`);
          continue;
        }
      }

      // Now it should be active — wait for countdown (60s) + spin
      console.log(`  → Waiting 65s for countdown to expire...`);
      await new Promise((r) => setTimeout(r, 65_000));

      // Start spin
      console.log(`  → Starting spin...`);
      try {
        await startLordSpinOnChain(connection, PLAYER_A, round.tier, round.roundNumber.toNumber(), pda);
        console.log(`  → Spin started`);
      } catch (err) {
        console.error(`  → Spin failed: ${err}`);
        continue;
      }

      // Wait for VRF
      console.log(`  → Waiting for VRF fulfillment...`);
      try {
        await waitForLordOraoFulfillment(connection, pda, 180_000);
        console.log(`  → VRF fulfilled`);
      } catch (err) {
        console.error(`  → VRF wait failed: ${err}`);
        continue;
      }

      // Re-fetch round for claim
      const updatedRound = (await program.account.pot shotRound.fetch(pda)) as unknown as PotShotRoundAccount;
      const { winner } = await readLordVrfWinner(connection, pda, updatedRound);
      console.log(`  → Winner: ${winner.toBase58().slice(0, 8)}...`);

      const claimCaller = winner.equals(PLAYER_A.publicKey) ? PLAYER_A : PLAYER_B;
      await claimLordPayoutOnChain(connection, claimCaller, pda, updatedRound, winner);
      console.log(`  → Claimed! Round cleaned up.`);

    } else if (phase === "active") {
      // Check countdown
      const countdownEndsAt = (round as unknown as { countdownEndsAt: { toNumber(): number } }).countdownEndsAt?.toNumber() ?? 0;
      const now = Math.floor(Date.now() / 1000);
      const remaining = countdownEndsAt - now;

      if (remaining > 0) {
        console.log(`  → Active, countdown remaining: ${remaining}s. Waiting...`);
        await new Promise((r) => setTimeout(r, (remaining + 5) * 1000));
      }

      // Start spin
      console.log(`  → Starting spin...`);
      try {
        await startLordSpinOnChain(connection, PLAYER_A, round.tier, round.roundNumber.toNumber(), pda);
        console.log(`  → Spin started`);
      } catch (err) {
        console.error(`  → Spin failed: ${err}`);
        continue;
      }

      // Wait for VRF
      console.log(`  → Waiting for VRF fulfillment...`);
      await waitForLordOraoFulfillment(connection, pda, 180_000);

      // Re-fetch and claim
      const updatedRound = (await program.account.pot shotRound.fetch(pda)) as unknown as PotShotRoundAccount;
      const { winner } = await readLordVrfWinner(connection, pda, updatedRound);
      const claimCaller = winner.equals(PLAYER_A.publicKey) ? PLAYER_A : PLAYER_B;
      await claimLordPayoutOnChain(connection, claimCaller, pda, updatedRound, winner);
      console.log(`  → Claimed! Round cleaned up.`);

    } else if (phase === "locked") {
      // Check VRF status
      const randomnessPda = getOraoRandomnessPda(pda.toBytes());
      const vrfAccount = await connection.getAccountInfo(randomnessPda);

      if (vrfAccount && vrfAccount.data.length >= 137 && vrfAccount.data[8] === 1) {
        const randomness = vrfAccount.data.subarray(73, 137);
        if (randomness.some((b) => b !== 0)) {
          console.log(`  → VRF fulfilled, claiming...`);
          const { winner } = await readLordVrfWinner(connection, pda, round);
          const claimCaller = winner.equals(PLAYER_A.publicKey) ? PLAYER_A : PLAYER_B;
          await claimLordPayoutOnChain(connection, claimCaller, pda, round, winner);
          console.log(`  → Claimed! Round cleaned up.`);
        } else {
          console.log(`  → VRF pending, waiting...`);
          await waitForLordOraoFulfillment(connection, pda, 180_000);
          const { winner } = await readLordVrfWinner(connection, pda, round);
          const claimCaller = winner.equals(PLAYER_A.publicKey) ? PLAYER_A : PLAYER_B;
          await claimLordPayoutOnChain(connection, claimCaller, pda, round, winner);
          console.log(`  → Claimed!`);
        }
      } else {
        console.log(`  → No VRF account — this is a mock-VRF build or VRF not yet requested`);
        console.log(`  → Cannot clean automatically, may need timeout_refund`);
      }
    } else {
      console.log(`  → Unknown phase "${phase}", skipping`);
    }
  }

  console.log("\nCleanup complete!");
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
