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
  transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 0 }),
});

const pool = getPool(cfg.databaseUrl);

await pool.query(INIT_SQL);

async function nextFromBlock(): Promise<bigint> {
  // Resume from one past the highest block we've indexed across BOTH ticket_events
  // and role_events. If we only tracked ticket_events and a role change landed in
  // a later block, a restart would silently skip it.
  const mRes = await pool.query<{ m: string | null }>(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(block_number) FROM ticket_events), 0),
       COALESCE((SELECT MAX(block_number) FROM role_events), 0)
     )::text AS m`,
  );
  const m = mRes.rows[0]?.m;
  if (!m || m === "0") {
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
  paymentWei: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_events (
      event_type, tx_hash, log_index, block_number, block_hash, contract_address,
      token_id, route_id, valid_until_epoch, operator_addr, from_address, to_address, payment_wei
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12)
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
      args.paymentWei,
    ],
  );
}

/**
 * Guarantees that a passenger who reserved a seat and paid for their ticket
 * ends up with a permanent seat assignment — even if the client's explicit
 * POST /seats call never reaches the server.
 *
 * Trigger: every TicketMinted event the indexer ingests.
 *
 * Logic:
 *   1. If the token already has an assignment → nothing to do (client's fast
 *      path already wrote it).
 *   2. Look for a reservation on (routeId, holder = TicketMinted.to) that is
 *      still valid, OR expired within a short grace window AND the seat is
 *      not currently held by anyone else. The grace window covers slow RPC /
 *      long mempool waits where the reservation TTL ran out before the mint
 *      confirmed.
 *   3. Exactly one candidate → promote it (INSERT assignment, DELETE
 *      reservation) in a transaction.
 *   4. Zero or multiple candidates → log and skip; the seat stays unclaimed
 *      (same outcome as the pre-reconcile behaviour — no regression).
 *
 * All DB operations are idempotent via ON CONFLICT / constraints, so re-runs
 * over the same block range (e.g. after indexer restart) are safe.
 */
const AUTO_CLAIM_GRACE_MINUTES = 10;

async function autoClaimReservedSeat(args: {
  tokenId: string;
  routeId: string;
  to: string;
}): Promise<void> {
  const holder = args.to.toLowerCase();
  try {
    // 1. Skip if already assigned (client beat us to it — normal fast path).
    const already = await pool.query(
      `SELECT 1 FROM seat_assignments WHERE token_id = $1`,
      [args.tokenId],
    );
    if (already.rowCount && already.rowCount > 0) return;

    // 2. Find reservation candidates. Prefer currently-valid rows; fall back
    //    to recently-expired ones if the seat is still genuinely free. Pull
    //    the bucket columns too so we can propagate (service_date, session_id)
    //    from reservation → assignment. The same seat number can exist in
    //    multiple buckets simultaneously (morning vs evening run), so the
    //    bucket is part of the row's identity, not just its uniqueness key.
    type BucketRow = { seat_number: string; service_date: string | Date; session_id: number };
    let picked: BucketRow | null = null;

    const activeRes = await pool.query<BucketRow>(
      `SELECT seat_number, service_date, session_id FROM seat_reservations
       WHERE route_id = $1
         AND LOWER(holder_address) = $2
         AND expires_at > NOW()`,
      [args.routeId, holder],
    );
    if (activeRes.rowCount === 1) {
      picked = activeRes.rows[0];
    } else if (activeRes.rowCount && activeRes.rowCount > 1) {
      console.warn(
        `[auto-claim] multiple active reservations for holder=${holder} route=${args.routeId} — skipping token=${args.tokenId}`,
      );
      return;
    } else {
      // Grace-window fallback: recently expired and the exact (bucket, seat)
      // is still genuinely free. Bucket match is critical — a free seat in
      // a DIFFERENT session must not be auto-claimed for this mint.
      const graceRes = await pool.query<BucketRow>(
        `SELECT r.seat_number, r.service_date, r.session_id FROM seat_reservations r
         WHERE r.route_id = $1
           AND LOWER(r.holder_address) = $2
           AND r.expires_at > NOW() - INTERVAL '${AUTO_CLAIM_GRACE_MINUTES} minutes'
           AND NOT EXISTS (
             SELECT 1 FROM seat_assignments a
             WHERE a.route_id = r.route_id AND a.seat_number = r.seat_number
               AND a.service_date = r.service_date AND a.session_id = r.session_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM seat_reservations r2
             WHERE r2.route_id = r.route_id AND r2.seat_number = r.seat_number
               AND r2.service_date = r.service_date AND r2.session_id = r.session_id
               AND r2.expires_at > NOW()
               AND LOWER(r2.holder_address) <> $2
           )
         ORDER BY r.expires_at DESC
         LIMIT 1`,
        [args.routeId, holder],
      );
      if (graceRes.rowCount === 1) {
        picked = graceRes.rows[0];
        console.log(
          `[auto-claim] grace-window rescue for token=${args.tokenId} holder=${holder} seat=${picked.seat_number}`,
        );
      }
    }

    if (!picked) return;
    const { seat_number: seatNumber, service_date: serviceDate, session_id: sessionId } = picked;

    // 3. Promote: INSERT assignment (idempotent on conflict) + DELETE
    // reservation. Both statements scope on the full bucket so concurrent
    // mints in neighbouring sessions cannot stomp on each other.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query<{ id: number }>(
        `INSERT INTO seat_assignments (route_id, token_id, seat_number, service_date, session_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [args.routeId, args.tokenId, seatNumber, serviceDate, sessionId],
      );
      if (ins.rowCount) {
        await client.query(
          `DELETE FROM seat_reservations
           WHERE route_id = $1 AND seat_number = $2
             AND service_date = $3 AND session_id = $4`,
          [args.routeId, seatNumber, serviceDate, sessionId],
        );
        console.log(
          `[auto-claim] promoted token=${args.tokenId} route=${args.routeId} bucket=${String(serviceDate)}/${sessionId} seat=${seatNumber} holder=${holder}`,
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `[auto-claim] promotion failed token=${args.tokenId} seat=${picked.seat_number}:`,
        err,
      );
    } finally {
      client.release();
    }
  } catch (err) {
    // Fully non-fatal: the client's POST /seats path is still the primary
    // and this is the safety net. Log and move on.
    console.error(`[auto-claim] unexpected error token=${args.tokenId}:`, err);
  }
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
  // Free the seat so it can be resold — a burned ticket no longer owns a seat.
  // This is the root cause fix: without this, every conductor burn permanently
  // locked the seat in seat_assignments, causing the "sold seats not greying out
  // after a burn" bug to compound indefinitely.
  await pool.query(
    `DELETE FROM seat_assignments WHERE token_id = $1`,
    [args.tokenId],
  );
}

async function insertRoleEvent(args: {
  kind: "operator_approved" | "role_granted" | "role_revoked";
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string | null;
  contractAddress: string;
  subject: string;
  roleHash: string | null;
  granted: boolean;
}): Promise<void> {
  await pool.query(
    `INSERT INTO role_events (
      kind, tx_hash, log_index, block_number, block_hash, contract_address,
      subject, role_hash, granted
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      args.kind,
      args.txHash,
      args.logIndex,
      args.blockNumber.toString(),
      args.blockHash,
      args.contractAddress,
      args.subject.toLowerCase(),
      args.roleHash ? args.roleHash.toLowerCase() : null,
      args.granted,
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

  // Role/admin events — written to role_events so AdminPage + OperatorPage don't
  // have to scan logs from the browser (which trips HTTP 413 on public RPCs).
  const operatorApprovedEvents = await getContractEvents(client, {
    address,
    abi: chainPassTicketAbi,
    eventName: "OperatorApproved",
    fromBlock,
    toBlock,
  });
  const roleGrantedEvents = await getContractEvents(client, {
    address,
    abi: chainPassTicketAbi,
    eventName: "RoleGranted",
    fromBlock,
    toBlock,
  });
  const roleRevokedEvents = await getContractEvents(client, {
    address,
    abi: chainPassTicketAbi,
    eventName: "RoleRevoked",
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
    let paymentWei: string | null = null;
    try {
      const tx = await client.getTransaction({ hash: transactionHash });
      paymentWei = tx.value > 0n ? tx.value.toString() : null;
    } catch {
      // Non-fatal: inflow data will be missing for this mint
    }
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
      paymentWei,
    });

    // Safety-net: every mint triggers an attempt to auto-promote any matching
    // reservation into a permanent assignment. No-op when the client's
    // POST /seats fast-path already wrote it, or when no reservation exists.
    await autoClaimReservedSeat({
      tokenId: String(args.tokenId),
      routeId: String(args.routeId),
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

  for (const log of operatorApprovedEvents) {
    const { transactionHash, logIndex, blockNumber, blockHash, address: logAddress } = log;
    const a = log.args as { operator: `0x${string}`; approved: boolean };
    await insertRoleEvent({
      kind: "operator_approved",
      txHash: transactionHash,
      logIndex,
      blockNumber,
      blockHash: blockHash ?? null,
      contractAddress: logAddress,
      subject: String(a.operator),
      roleHash: null,
      granted: Boolean(a.approved),
    });
  }

  for (const log of roleGrantedEvents) {
    const { transactionHash, logIndex, blockNumber, blockHash, address: logAddress } = log;
    const a = log.args as { role: `0x${string}`; account: `0x${string}` };
    await insertRoleEvent({
      kind: "role_granted",
      txHash: transactionHash,
      logIndex,
      blockNumber,
      blockHash: blockHash ?? null,
      contractAddress: logAddress,
      subject: String(a.account),
      roleHash: String(a.role),
      granted: true,
    });
  }

  for (const log of roleRevokedEvents) {
    const { transactionHash, logIndex, blockNumber, blockHash, address: logAddress } = log;
    const a = log.args as { role: `0x${string}`; account: `0x${string}` };
    await insertRoleEvent({
      kind: "role_revoked",
      txHash: transactionHash,
      logIndex,
      blockNumber,
      blockHash: blockHash ?? null,
      contractAddress: logAddress,
      subject: String(a.account),
      roleHash: String(a.role),
      granted: false,
    });
  }

  const total =
    mintEvents.length +
    burnEvents.length +
    operatorApprovedEvents.length +
    roleGrantedEvents.length +
    roleRevokedEvents.length;
  if (total > 0) {
    console.log(
      `[chainpass-indexer] blocks ${fromBlock}-${toBlock}: mint=${mintEvents.length} burn=${burnEvents.length} opApproved=${operatorApprovedEvents.length} roleGranted=${roleGrantedEvents.length} roleRevoked=${roleRevokedEvents.length}`,
    );
  }
}

async function getBlockNumberWithTimeout(ms = 10_000): Promise<bigint> {
  const res = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    signal: AbortSignal.timeout(ms),
  });
  const data = (await res.json()) as { result: string };
  return BigInt(data.result);
}

async function catchUpOnce(): Promise<void> {
  let fromBlock = await nextFromBlock();
  const head = await getBlockNumberWithTimeout();

  if (fromBlock > head) {
    return;
  }

  const totalBlocks = head - fromBlock;
  let lastProgressLog = Date.now();

  while (fromBlock <= head) {
    const toBlock =
      fromBlock + cfg.blockChunk - 1n < head ? fromBlock + cfg.blockChunk - 1n : head;
    await processRange(fromBlock, toBlock);
    fromBlock = toBlock + 1n;

    const now = Date.now();
    if (now - lastProgressLog >= 15_000) {
      lastProgressLog = now;
      const done = fromBlock - (head - totalBlocks);
      const pct = totalBlocks > 0n ? Number((done * 100n) / totalBlocks) : 100;
      console.log(`[chainpass-indexer] scanning… block=${fromBlock} / ${head} (${pct}%)`);
    }
  }
}

/** One-time backfill: fetch tx.value for mint rows where payment_wei is NULL. */
async function backfillPaymentWei(): Promise<void> {
  const { rows } = await pool.query<{ tx_hash: string }>(
    `SELECT DISTINCT tx_hash FROM ticket_events WHERE event_type = 'mint' AND payment_wei IS NULL LIMIT 500`,
  );
  if (rows.length === 0) return;
  console.log(`[chainpass-indexer] backfilling payment_wei for ${rows.length} mint tx(s)…`);
  let filled = 0;
  for (const row of rows) {
    try {
      const txPromise = client.getTransaction({ hash: row.tx_hash as `0x${string}` });
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000),
      );
      const tx = await Promise.race([txPromise, timeoutPromise]);
      if (!tx) continue;
      const wei = tx.value > 0n ? tx.value.toString() : "0";
      await pool.query(
        `UPDATE ticket_events SET payment_wei = $1 WHERE tx_hash = $2 AND event_type = 'mint' AND payment_wei IS NULL`,
        [wei, row.tx_hash],
      );
      filled++;
    } catch {
      // Non-fatal: skip this tx
    }
  }
  console.log(`[chainpass-indexer] backfill complete: ${filled}/${rows.length} updated`);
}

async function main(): Promise<void> {
  console.log(
    `[chainpass-indexer] contract=${cfg.ticketContractAddress} initial fromBlock=${cfg.fromBlock} (empty table uses this; else max(block)+1)`,
  );

  void backfillPaymentWei().catch(() => {/* non-fatal */});

  let lastHeartbeat = 0;
  const heartbeatMs = 45_000;

  for (;;) {
    try {
      await catchUpOnce();
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatMs) {
        lastHeartbeat = now;
        const head = await getBlockNumberWithTimeout();
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
