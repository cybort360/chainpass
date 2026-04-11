import { Router } from "express";
import { getPool } from "../lib/db.js";
import { appendNigeriaRoutesFileEntry } from "../lib/nigeriaRoutesFile.js";

const UINT256_MAX = 2n ** 256n - 1n;

/** Accept decimal string route ids matching on-chain uint256. */
function parseRouteIdBody(raw: unknown): bigint | null {
  if (raw === undefined || raw === null) return null;
  const t = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw).trim() : "";
  if (!/^\d+$/.test(t)) return null;
  try {
    const b = BigInt(t);
    if (b < 0n || b > UINT256_MAX) return null;
    return b;
  } catch {
    return null;
  }
}

export function createRoutesRouter(): Router {
  const r = Router();

  r.get("/routes", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<{
        route_id: string;
        name: string;
        detail: string | null;
        category: string;
      }>(
        `SELECT route_id, name, detail, category FROM route_labels
         ORDER BY category, route_id::numeric`,
      );
      res.json({
        routes: rows.map((row) => ({
          routeId: String(row.route_id),
          name: row.name,
          detail: row.detail,
          category: row.category,
        })),
      });
    } catch (err) {
      console.error("[routes]", err);
      res.status(500).json({ error: "failed to read routes" });
    }
  });

  r.post("/routes", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const routeId = parseRouteIdBody(body?.routeId);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const detailRaw = body?.detail;
    const detail =
      detailRaw === undefined || detailRaw === null
        ? null
        : typeof detailRaw === "string"
          ? detailRaw.trim() || null
          : null;

    const priceMonRaw = body?.priceMon;
    let priceMon: number | undefined;
    if (priceMonRaw !== undefined && priceMonRaw !== null) {
      const n =
        typeof priceMonRaw === "number"
          ? priceMonRaw
          : typeof priceMonRaw === "string"
            ? Number(priceMonRaw.trim())
            : NaN;
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ error: "invalid priceMon (non-negative number)" });
        return;
      }
      priceMon = n;
    }

    if (routeId === null) {
      res.status(400).json({ error: "invalid or missing routeId (decimal uint256)" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "missing name" });
      return;
    }
    if (!category) {
      res.status(400).json({ error: "missing category" });
      return;
    }

    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO route_labels (route_id, name, detail, category)
         VALUES ($1, $2, $3, $4)`,
        [String(routeId), name, detail, category],
      );

      let nigeriaRoutesFile: { ok: true } | { ok: false; reason: string } | undefined;
      if (priceMon !== undefined) {
        nigeriaRoutesFile = await appendNigeriaRoutesFileEntry({
          routeId: String(routeId),
          name,
          category,
          detail,
          priceMon,
        });
        if (!nigeriaRoutesFile.ok) {
          console.warn("[routes POST] nigeria-routes.json:", nigeriaRoutesFile.reason);
        }
      }

      res.status(200).json({
        route: {
          routeId: String(routeId),
          name,
          detail,
          category,
        },
        ...(nigeriaRoutesFile !== undefined ? { nigeriaRoutesFile } : {}),
      });
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "23505") {
        res.status(409).json({
          error: "this route ID is already registered; use a new ID or edit data in the database directly",
        });
        return;
      }
      console.error("[routes POST]", err);
      res.status(500).json({ error: "failed to register route" });
    }
  });

  return r;
}
