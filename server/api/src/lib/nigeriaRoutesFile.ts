import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEther } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved from server/api/src/lib → repo root config file. */
export function defaultNigeriaRoutesJsonPath(): string {
  return resolve(__dirname, "../../../../config/nigeria-routes.json");
}

export type NigeriaRouteEntry = {
  routeId: string;
  category: string;
  name: string;
  detail: string;
  priceMon: number;
  priceWei: string;
};

type NigeriaRoutesDoc = {
  description?: string;
  network?: string;
  routes: NigeriaRouteEntry[];
};

function isSyncEnabled(): boolean {
  const v = process.env.NIGERIA_ROUTES_SYNC;
  if (v === undefined) return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

function resolvePath(): string {
  const fromEnv = process.env.NIGERIA_ROUTES_JSON_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : defaultNigeriaRoutesJsonPath();
}

/**
 * Appends one route to config/nigeria-routes.json (new route IDs only).
 * If routeId already exists in the file, returns an error (no overwrite).
 * Best-effort: failures are returned (caller still returns HTTP 200 for DB insert).
 */
export async function appendNigeriaRoutesFileEntry(input: {
  routeId: string;
  name: string;
  category: string;
  detail: string | null;
  priceMon: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isSyncEnabled()) {
    return { ok: false, reason: "disabled (NIGERIA_ROUTES_SYNC=0)" };
  }

  let priceWei: string;
  try {
    priceWei = parseEther(String(input.priceMon)).toString();
  } catch {
    return { ok: false, reason: "invalid priceMon for wei conversion" };
  }

  const path = resolvePath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `read failed (${path}): ${msg}` };
  }

  let doc: NigeriaRoutesDoc;
  try {
    doc = JSON.parse(raw) as NigeriaRoutesDoc;
  } catch {
    return { ok: false, reason: "invalid JSON in nigeria-routes file" };
  }

  if (!Array.isArray(doc.routes)) {
    return { ok: false, reason: "nigeria-routes.json missing routes array" };
  }

  const entry: NigeriaRouteEntry = {
    routeId: input.routeId,
    category: input.category,
    name: input.name,
    detail: input.detail ?? "",
    priceMon: input.priceMon,
    priceWei,
  };

  const exists = doc.routes.some((r) => String(r.routeId) === input.routeId);
  if (exists) {
    return {
      ok: false,
      reason: "route ID already exists in nigeria-routes.json (new routes only; remove the entry manually to re-add)",
    };
  }
  doc.routes.push(entry);

  const out = `${JSON.stringify(doc, null, 2)}\n`;
  try {
    await writeFile(path, out, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `write failed (${path}): ${msg}` };
  }

  return { ok: true };
}
