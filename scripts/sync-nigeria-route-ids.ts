/**
 * Rewrites `config/nigeria-routes.json` routeId values using the same UUID v5 + keccak
 * scheme as `stableRouteIdDecimalForLabel` in @chainpass/shared, and refreshes priceWei from priceMon.
 *
 * Run from repo root after `pnpm --filter @chainpass/shared run build`:
 *   pnpm exec tsx scripts/sync-nigeria-route-ids.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEther } from 'viem';
import { stableRouteIdDecimalForLabel } from '@chainpass/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(__dirname, '../config/nigeria-routes.json');

type Row = {
  routeId: string;
  category: string;
  name: string;
  detail: string;
  priceMon: number;
  priceWei: string;
};

type Doc = {
  description?: string;
  network?: string;
  routes: Row[];
};

const raw = readFileSync(jsonPath, 'utf8');
const doc = JSON.parse(raw) as Doc;

for (const r of doc.routes) {
  r.routeId = stableRouteIdDecimalForLabel(r.category, r.name);
  r.priceWei = parseEther(String(r.priceMon)).toString();
}

writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(
  `[sync-nigeria-route-ids] updated ${doc.routes.length} rows → ${jsonPath}`,
);
