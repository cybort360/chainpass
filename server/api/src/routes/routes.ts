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
        schedule: string | null;
      }>(
        `SELECT route_id, name, detail, category, schedule FROM route_labels
         ORDER BY category, route_id::numeric`,
      );
      res.json({
        routes: rows.map((row) => ({
          routeId: String(row.route_id),
          name: row.name,
          detail: row.detail,
          category: row.category,
          schedule: row.schedule,
        })),
      });
    } catch (err) {
      console.error("[routes]", err);
      res.status(500).json({ error: "failed to read routes" });
    }
  });

  r.put("/routes/:routeId", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    const routeId = parseRouteIdBody(req.params.routeId);
    if (routeId === null) {
      res.status(400).json({ error: "invalid routeId" });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : undefined;
    const category = typeof body?.category === "string" ? body.category.trim() : undefined;
    const detailRaw = body?.detail;
    const detail =
      detailRaw === undefined
        ? undefined
        : detailRaw === null
          ? null
          : typeof detailRaw === "string"
            ? detailRaw.trim() || null
            : undefined;
    const scheduleRaw = body?.schedule;
    const schedule =
      scheduleRaw === undefined
        ? undefined
        : scheduleRaw === null
          ? null
          : typeof scheduleRaw === "string"
            ? scheduleRaw.trim() || null
            : undefined;

    if (name !== undefined && name.length > 100) {
      res.status(400).json({ error: "name must be 100 characters or fewer" });
      return;
    }
    if (category !== undefined && (!category || category.length > 60)) {
      res.status(400).json({ error: "category must be non-empty and 60 characters or fewer" });
      return;
    }
    if (detail !== undefined && detail !== null && detail.length > 200) {
      res.status(400).json({ error: "detail must be 200 characters or fewer" });
      return;
    }
    if (schedule !== undefined && schedule !== null && schedule.length > 120) {
      res.status(400).json({ error: "schedule must be 120 characters or fewer" });
      return;
    }

    // Build SET clause dynamically
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (name !== undefined) { vals.push(name); sets.push(`name = $${vals.length}`); }
    if (category !== undefined) { vals.push(category); sets.push(`category = $${vals.length}`); }
    if (detail !== undefined) { vals.push(detail); sets.push(`detail = $${vals.length}`); }
    if (schedule !== undefined) { vals.push(schedule); sets.push(`schedule = $${vals.length}`); }

    if (sets.length === 0) {
      res.status(400).json({ error: "no fields to update" });
      return;
    }

    vals.push(String(routeId));
    const setClause = sets.join(", ");

    try {
      const pool = getPool();
      const result = await pool.query(
        `UPDATE route_labels SET ${setClause} WHERE route_id = $${vals.length} RETURNING route_id, name, detail, category, schedule`,
        vals,
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: "route not found" });
        return;
      }
      const row = result.rows[0] as { route_id: string; name: string; detail: string | null; category: string; schedule: string | null };
      res.json({ route: { routeId: row.route_id, name: row.name, detail: row.detail, category: row.category, schedule: row.schedule } });
    } catch (err) {
      console.error("[routes PUT]", err);
      res.status(500).json({ error: "failed to update route" });
    }
  });

  r.delete("/routes/:routeId", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    const routeId = parseRouteIdBody(req.params.routeId);
    if (routeId === null) {
      res.status(400).json({ error: "invalid routeId" });
      return;
    }

    try {
      const pool = getPool();
      const result = await pool.query(
        `DELETE FROM route_labels WHERE route_id = $1`,
        [String(routeId)],
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: "route not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[routes DELETE]", err);
      res.status(500).json({ error: "failed to delete route" });
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
    const schedulePostRaw = body?.schedule;
    const schedulePost =
      schedulePostRaw === undefined || schedulePostRaw === null
        ? null
        : typeof schedulePostRaw === "string"
          ? schedulePostRaw.trim() || null
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
    if (name.length > 100) {
      res.status(400).json({ error: "name must be 100 characters or fewer" });
      return;
    }
    if (!category) {
      res.status(400).json({ error: "missing category" });
      return;
    }
    if (category.length > 60) {
      res.status(400).json({ error: "category must be 60 characters or fewer" });
      return;
    }
    if (detail !== null && detail.length > 200) {
      res.status(400).json({ error: "detail must be 200 characters or fewer" });
      return;
    }
    if (schedulePost !== null && schedulePost.length > 120) {
      res.status(400).json({ error: "schedule must be 120 characters or fewer" });
      return;
    }

    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO route_labels (route_id, name, detail, category, schedule)
         VALUES ($1, $2, $3, $4, $5)`,
        [String(routeId), name, detail, category, schedulePost],
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
          schedule: schedulePost,
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
