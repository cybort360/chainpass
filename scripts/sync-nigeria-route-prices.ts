/**
 * Sync per-route minimum prices from config/nigeria-routes.json to ChainPassTicket on-chain.
 *
 * Required env:
 *   PRIVATE_KEY        — admin (DEFAULT_ADMIN_ROLE) hex private key, 0x-prefixed
 *   TICKET_CONTRACT_ADDRESS — deployed ChainPassTicket (same as indexer / client)
 *
 * Optional:
 *   RPC_URL            — defaults to Monad testnet in @chainpass/shared
 *   DRY_RUN=1          — print planned txs only
 *   CHAINPASS_ROUTES_JSON — override path to JSON (default: ../config/nigeria-routes.json next to this file)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chainPassTicketAbi, monadTestnet } from '@chainpass/shared';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

type RouteRow = {
  routeId: string;
  category?: string;
  name: string;
  detail?: string;
  priceMon?: number;
  priceWei: string;
};

type RoutesDoc = {
  routes: RouteRow[];
};

function loadJson(path: string): RoutesDoc {
  const raw = readFileSync(path, 'utf8');
  const doc = JSON.parse(raw) as RoutesDoc;
  if (!Array.isArray(doc.routes)) {
    throw new Error('Invalid JSON: expected top-level .routes array');
  }
  return doc;
}

async function main() {
  const dryRun =
    process.env.DRY_RUN === '1' ||
    process.env.DRY_RUN === 'true' ||
    process.argv.includes('--dry-run');

  const pkRaw = process.env.PRIVATE_KEY;
  const ticketRaw = process.env.TICKET_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

  const jsonPath =
    process.env.CHAINPASS_ROUTES_JSON ??
    join(__dirname, '../config/nigeria-routes.json');

  if (!pkRaw || !/^0x[0-9a-fA-F]{64}$/.test(pkRaw)) {
    console.error('Set PRIVATE_KEY (0x + 64 hex chars).');
    process.exit(1);
  }
  if (!ticketRaw || !isAddress(ticketRaw)) {
    console.error(
      'Set TICKET_CONTRACT_ADDRESS to the deployed ChainPassTicket.',
    );
    process.exit(1);
  }

  const pk = pkRaw as Hex;
  const ticket = ticketRaw as Address;

  const doc = loadJson(jsonPath);
  const chain = { ...monadTestnet, rpcUrls: { default: { http: [rpcUrl] } } };

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  console.log(`RPC: ${rpcUrl}`);
  console.log(`Contract: ${ticket}`);
  console.log(`Caller (must be DEFAULT_ADMIN): ${account.address}`);
  console.log(`Routes file: ${jsonPath}`);
  console.log(`Routes count: ${doc.routes.length}`);
  if (dryRun) {
    console.log('DRY RUN — no transactions will be sent.\n');
  }

  for (const r of doc.routes) {
    let routeId: bigint;
    let priceWei: bigint;
    try {
      routeId = BigInt(r.routeId);
      priceWei = BigInt(r.priceWei);
    } catch {
      console.error(`Invalid route row: ${JSON.stringify(r)}`);
      throw new Error(
        'Invalid routeId or priceWei (expected decimal integers as strings).',
      );
    }

    const label = r.name ?? r.routeId;
    if (dryRun) {
      console.log(
        `Would setRouteMintPrice(${routeId}, ${priceWei}) — ${label}`,
      );
      continue;
    }

    const hash = await wallet.writeContract({
      address: ticket,
      abi: chainPassTicketAbi,
      functionName: 'setRouteMintPrice',
      args: [routeId, priceWei] as const,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `route ${routeId} ${label.length > 48 ? label.slice(0, 48) + '…' : label} status=${receipt.status} tx=${hash}`,
    );
  }

  if (!dryRun) {
    console.log('Done.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
