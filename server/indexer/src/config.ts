/**
 * Indexer configuration (Node + TypeScript + viem + pg).
 * HTTP is handled by server/api (Express); this process only ingests chain events.
 */
export function getIndexerConfig() {
  const fromBlockRaw = process.env.INDEXER_FROM_BLOCK ?? "0";
  let fromBlock: bigint;
  try {
    fromBlock = BigInt(fromBlockRaw);
  } catch {
    fromBlock = 0n;
  }

  const pollMs = Number(process.env.INDEXER_POLL_MS ?? "4000");
  /** Monad public RPC (`testnet-rpc.monad.xyz`) limits `eth_getLogs` to a 100-block range; larger chunks fail. */
  const MONAD_PUBLIC_MAX_LOG_RANGE = 100n;
  let blockChunk = BigInt(process.env.INDEXER_BLOCK_CHUNK ?? "100");
  if (blockChunk <= 0n) {
    blockChunk = 100n;
  } else if (blockChunk > MONAD_PUBLIC_MAX_LOG_RANGE) {
    blockChunk = MONAD_PUBLIC_MAX_LOG_RANGE;
  }

  const addr = process.env.TICKET_CONTRACT_ADDRESS?.trim();
  const ticketContractAddress =
    addr && /^0x[a-fA-F0-9]{40}$/.test(addr) ? (addr as `0x${string}`) : undefined;

  return {
    rpcUrl: process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz",
    databaseUrl: process.env.DATABASE_URL,
    ticketContractAddress,
    fromBlock,
    pollMs: Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 4000,
    blockChunk,
  };
}
