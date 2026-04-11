import { CHAINPASS_SHARED_VERSION, chainPassTicketAbi, monadTestnet } from "@chainpass/shared";
import { createPublicClient, http } from "viem";
import { getContractEvents } from "viem/actions";
import { getIndexerConfig } from "./config.js";
import { getPool, closePool } from "./db.js";
import { loadRootEnv } from "./load-env.js";
import { INIT_SQL } from "./schema.js";

loadRootEnv();

const cfg = getIndexerConfig();

console.log(
  `[chainpass-indexer] Node.js + TypeScript (viem + pg). shared=${CHAINPASS_SHARED_VERSION}`,
);
console.log(
  `[chainpass-indexer] RPC=${cfg.rpcUrl} DATABASE_URL=${cfg.databaseUrl ? "set" : "missing"}`,
);

if (!cfg.databaseUrl) {
  console.error("[chainpass-indexer] DATABASE_URL is required");
  process.exit(1);
}

if (!cfg.ticketContractAddress) {
  console.error("[chainpass-indexer] TICKET_CONTRACT_ADDRESS is required (0x + 40 hex)");
  process.exit(1);
}

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(cfg.rpcUrl),
});

const pool = getPool(cfg.databaseUrl);

await pool.query(INIT_SQL);

async function nextFromBlock(): Promise<bigint> {
  const cRes = await pool.query<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM ticket_events",
  );
  const count = Number(cRes.rows[0]?.c ?? "0");
  if (count === 0) {
    return cfg.fromBlock;
  }
  const mRes = await pool.query<{ m: string | null }>(
    "SELECT MAX(block_number)::text AS m FROM ticket_events",
  );
  const m = mRes.rows[0]?.m;
  if (m === null || m === undefined || m === "") {
    return cfg.fromBlock;
  }
  return BigInt(m) + 1n;
}

async function insertMint(args: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string | null;
  contractAddress: string;
  tokenId: string;
  routeId: string;
  validUntilEpoch: string;
  operatorAddr: string;
  to: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_events (
      event_type, tx_hash, log_index, block_number, block_hash, contract_address,
      token_id, route_id, valid_until_epoch, operator_addr, from_address, to_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      "mint",
      args.txHash,
      args.logIndex,
      args.blockNumber.toString(),
      args.blockHash,
      args.contractAddress,
      args.tokenId,
      args.routeId,
      args.validUntilEpoch,
      args.operatorAddr,
      args.to,
    ],
  );
}

async function insertBurn(args: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string | null;
  contractAddress: string;
  tokenId: string;
  routeId: string;
  fromAddr: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_events (
      event_type, tx_hash, log_index, block_number, block_hash, contract_address,
      token_id, route_id, valid_until_epoch, operator_addr, from_address, to_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, $9, NULL)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      "burn",
      args.txHash,
      args.logIndex,
      args.blockNumber.toString(),
      args.blockHash,
      args.contractAddress,
      args.tokenId,
      args.routeId,
      args.fromAddr,
    ],
  );
}

async function processRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const address = cfg.ticketContractAddress!;

  const mintEvents = await getContractEvents(client, {
    address,
    abi: chainPassTicketAbi,
    eventName: "TicketMinted",
    fromBlock,
    toBlock,
  });

  const burnEvents = await getContractEvents(client, {
    address,
    abi: chainPassTicketAbi,
    eventName: "TicketBurned",
    fromBlock,
    toBlock,
  });

  for (const log of mintEvents) {
    const { transactionHash, logIndex, blockNumber, blockHash, address: logAddress } = log;
    const args = log.args as {
      to: `0x${string}`;
      tokenId: bigint;
      routeId: bigint;
      validUntilEpoch: bigint;
      operatorAddr: `0x${string}`;
    };
    await insertMint({
      txHash: transactionHash,
      logIndex,
      blockNumber,
      blockHash: blockHash ?? null,
      contractAddress: logAddress,
      tokenId: String(args.tokenId),
      routeId: String(args.routeId),
      validUntilEpoch: String(args.validUntilEpoch),
      operatorAddr: String(args.operatorAddr),
      to: String(args.to),
    });
  }

  for (const log of burnEvents) {
    const { transactionHash, logIndex, blockNumber, blockHash, address: logAddress } = log;
    const args = log.args as {
      from: `0x${string}`;
      tokenId: bigint;
      routeId: bigint;
    };
    await insertBurn({
      txHash: transactionHash,
      logIndex,
      blockNumber,
      blockHash: blockHash ?? null,
      contractAddress: logAddress,
      tokenId: String(args.tokenId),
      routeId: String(args.routeId),
      fromAddr: String(args.from),
    });
  }

  const total = mintEvents.length + burnEvents.length;
  if (total > 0) {
    console.log(
      `[chainpass-indexer] blocks ${fromBlock}-${toBlock}: mint=${mintEvents.length} burn=${burnEvents.length}`,
    );
  }
}

async function catchUpOnce(): Promise<void> {
  let fromBlock = await nextFromBlock();
  const head = await client.getBlockNumber();

  if (fromBlock > head) {
    return;
  }

  while (fromBlock <= head) {
    const toBlock =
      fromBlock + cfg.blockChunk - 1n < head ? fromBlock + cfg.blockChunk - 1n : head;
    await processRange(fromBlock, toBlock);
    fromBlock = toBlock + 1n;
  }
}

async function main(): Promise<void> {
  console.log(
    `[chainpass-indexer] contract=${cfg.ticketContractAddress} initial fromBlock=${cfg.fromBlock} (empty table uses this; else max(block)+1)`,
  );

  let lastHeartbeat = 0;
  const heartbeatMs = 45_000;

  for (;;) {
    try {
      await catchUpOnce();
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatMs) {
        lastHeartbeat = now;
        const head = await client.getBlockNumber();
        const next = await nextFromBlock();
        console.log(
          `[chainpass-indexer] heartbeat chainHead=${head} nextFromBlock=${next} pollMs=${cfg.pollMs}`,
        );
      }
    } catch (err) {
      console.error("[chainpass-indexer] catch-up error:", err);
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

const shutdown = async () => {
  await closePool();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((err) => {
  console.error("[chainpass-indexer] fatal:", err);
  process.exit(1);
});
