import { Router } from "express";
import { getPool } from "../lib/db.js";

export function createRatingsRouter(): Router {
  const r = Router();

  // POST /ratings  { tokenId, routeId, rating }
  r.post("/ratings", async (req, res) => {
    try {
      const { tokenId, routeId, rating } = req.body as {
        tokenId?: unknown;
        routeId?: unknown;
        rating?: unknown;
      };

      if (typeof tokenId !== "string" || tokenId.trim() === "") {
        res.status(400).json({ error: "tokenId must be a non-empty string" });
        return;
      }
      if (typeof routeId !== "string" || !/^\d+$/.test(routeId.trim())) {
        res.status(400).json({ error: "routeId must be a decimal string" });
        return;
      }
      if (
        typeof rating !== "number" ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        res.status(400).json({ error: "rating must be an integer between 1 and 5" });
        return;
      }

      const pool = getPool();
      await pool.query(
        `INSERT INTO route_ratings (token_id, route_id, rating)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_id) DO NOTHING`,
        [tokenId.trim(), routeId.trim(), rating],
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("POST /ratings error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  });

  // GET /ratings/:routeId  → { average: number|null, count: number }
  r.get("/ratings/:routeId", async (req, res) => {
    try {
      const { routeId } = req.params;
      const pool = getPool();
      const result = await pool.query<{ average: string | null; count: string }>(
        `SELECT ROUND(AVG(rating)::numeric, 1)::float as average, COUNT(*) as count
         FROM route_ratings
         WHERE route_id = $1`,
        [routeId],
      );

      const row = result.rows[0];
      const count = row ? parseInt(row.count, 10) : 0;
      const average = row && row.average !== null ? Number(row.average) : null;

      res.json({ average: count > 0 ? average : null, count });
    } catch (err) {
      console.error("GET /ratings/:routeId error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  });

  return r;
}
