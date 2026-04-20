/* eslint-disable no-console */
/**
 * On-chain pre-flight cleanup for Pot Shot devnet tests.
 *
 * Lord now settles through the backend-assisted commit-reveal path. Once a round
 * has two distinct players it remains `active` until either:
 * - the backend calls `claim_payout` after countdown + entropy slot, or
 * - anyone calls `timeout_refund` after the resolve deadline.
 *
 * There is no user-facing cancel path for a waiting round, so non-expired stale
 * waiting/active rounds must be surfaced as blockers instead of being "cleaned"
 * with old VRF-era fallback logic.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PotShotIDL } from "@taunt-bet/anchor-client";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getLordProgram,
  getLordConfigPda,
  POTSHOT_PROGRAM_ID,
  type PotShotRoundAccount,
} from "../../local/helpers/on-chain";
import { sendSignedTx } from "./tx-utils";

function getInstructionDiscriminator(instructionName: string): Buffer {
  const instruction = PotShotIDL.instructions.find(
    (entry) => entry.name === instructionName,
  );
  if (!instruction) {
    throw new Error(`Instruction ${instructionName} not found in Lord IDL`);
  }
  return Buffer.from(instruction.discriminator);
}

const LORD_TIMEOUT_REFUND_DISC = getInstructionDiscriminator("timeout_refund");
const LORD_FORCE_CLOSE_DISC = getInstructionDiscriminator("force_close");

let cachedAuthorityKeypair: Keypair | null | undefined;

function getDistinctPlayersInOrder(round: PotShotRoundAccount): PublicKey[] {
  const seen = new Set<string>();
  const players: PublicKey[] = [];
  for (const entry of round.entries) {
    const key = entry.player.toBase58();
    if (seen.has(key)) continue;
    seen.add(key);
    players.push(entry.player);
  }
  return players;
}

/** Find all active (unclosed) pot shot rounds involving a player. */
async function findPlayerRounds(
  connection: Connection,
  player: PublicKey,
): Promise<{ roundPda: PublicKey; round: PotShotRoundAccount }[]> {
  const program = getLordProgram(connection);
  const discriminator = PotShotIDL.accounts.find(
    (entry) => entry.name === "PotShotRound",
  )?.discriminator;
  if (!discriminator) {
    throw new Error("pot shotRound discriminator not found in Lord IDL");
  }

  const accounts = await connection.getProgramAccounts(POTSHOT_PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Uint8Array.from(discriminator)),
        },
      },
    ],
  });

  return accounts
    .map((account) => {
      try {
        const round = program.coder.accounts.decode(
          "pot shotRound",
          account.account.data,
        ) as PotShotRoundAccount;
        return { roundPda: account.pubkey, round };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { roundPda: PublicKey; round: PotShotRoundAccount } => entry !== null)
    .filter(({ round }) => {
      return (
        round.creator.equals(player) ||
        round.entries.some((entry) => entry.player.equals(player))
      );
    });
}

/** Build a timeout_refund instruction for a Lord round. */
function buildTimeoutRefundIx(
  caller: PublicKey,
  roundPda: PublicKey,
  round: PotShotRoundAccount,
): TransactionInstruction {
  const [configPda] = getLordConfigPda();
  const data = Buffer.alloc(16);
  LORD_TIMEOUT_REFUND_DISC.copy(data, 0);
  Buffer.from(round.matchId as number[]).copy(data, 8);

  const keys = [
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: roundPda, isSigner: false, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: round.server, isSigner: false, isWritable: true }, // rent_receiver
    ...getDistinctPlayersInOrder(round).map((player) => ({
      pubkey: player,
      isSigner: false,
      isWritable: true,
    })),
  ];

  return new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys,
    data,
  });
}

function loadAuthorityKeypair(expectedAuthority: PublicKey): Keypair | null {
  if (cachedAuthorityKeypair !== undefined) {
    return cachedAuthorityKeypair;
  }

  try {
    const keypairPath = join(homedir(), ".config", "solana", "id.json");
    const secret = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
    const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
    cachedAuthorityKeypair = signer.publicKey.equals(expectedAuthority) ? signer : null;
  } catch {
    cachedAuthorityKeypair = null;
  }

  return cachedAuthorityKeypair;
}

function buildForceCloseIx(
  authority: PublicKey,
  roundPda: PublicKey,
  round: PotShotRoundAccount,
): TransactionInstruction {
  const [configPda] = getLordConfigPda();
  const data = Buffer.alloc(16);
  LORD_FORCE_CLOSE_DISC.copy(data, 0);
  Buffer.from(round.matchId as number[]).copy(data, 8);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: roundPda, isSigner: false, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: round.server, isSigner: false, isWritable: true }, // rent_receiver
    ...getDistinctPlayersInOrder(round).map((player) => ({
      pubkey: player,
      isSigner: false,
      isWritable: true,
    })),
  ];

  return new TransactionInstruction({
    programId: POTSHOT_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * Ensure a clean state for Pot Shot devnet tests.
 * Finds and cleans any stale rounds involving the given player.
 */
export async function ensureLordCleanState(
  connection: Connection,
  playerKeypair: Keypair,
  label: string,
): Promise<void> {
  const program = getLordProgram(connection);
  const [configPda] = getLordConfigPda();
  const config = await program.account.lordConfig.fetch(configPda);
  const authority = (config as { authority: PublicKey }).authority;
  const authorityKeypair = loadAuthorityKeypair(authority);
  const player = playerKeypair.publicKey;
  const rounds = await findPlayerRounds(connection, player);

  if (rounds.length === 0) {
    console.log(`[lord-cleanup] ${label}: no stale rounds — clean`);
    return;
  }

  for (const { roundPda, round } of rounds) {
    const phase = Object.keys(round.phase)[0] ?? "unknown";
    const resolveDeadline = round.resolveDeadline.toNumber();
    const now = Math.floor(Date.now() / 1_000);

    console.log(
      `[lord-cleanup] ${label}: stale round detected (matchId=${Array.from(round.matchId as number[]).map((b: number) => b.toString(16).padStart(2, "0")).join("")}, phase="${phase}", pda=${roundPda.toBase58()})`,
    );

    if (phase === "active" && resolveDeadline > 0 && now > resolveDeadline) {
      console.log(
        `[lord-cleanup] ${label}: resolve deadline passed — using timeoutRefund`,
      );
      const ix = buildTimeoutRefundIx(player, roundPda, round);
      await sendSignedTx(
        connection,
        [ix],
        playerKeypair,
        `${label} lordTimeoutRefund`,
      );
      console.log(`[lord-cleanup] ${label}: round cleaned via timeoutRefund`);
      continue;
    }

    if (phase === "waiting" || phase === "active") {
      if (authorityKeypair) {
        console.log(
          `[lord-cleanup] ${label}: ${phase} round requires admin cleanup — using forceClose`,
        );
        const ix = buildForceCloseIx(authorityKeypair.publicKey, roundPda, round);
        await sendSignedTx(
          connection,
          [ix],
          authorityKeypair,
          `${label} lordForceClose`,
        );
        console.log(`[lord-cleanup] ${label}: round cleaned via forceClose`);
        continue;
      }

      throw new Error(
        `Settlement in-flight or admin cleanup required: ${label} has stale ${phase} round ` +
          `(deadline=${resolveDeadline}, now=${now}). ` +
          `PDA: ${roundPda.toBase58()}`,
      );
    }

    console.log(
      `[lord-cleanup] ${label}: round in unexpected phase "${phase}" — ignoring`,
    );
  }
}
