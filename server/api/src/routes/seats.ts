import { Router } from "express";
import { getPool } from "../lib/db.js";

export function createSeatsRouter(): Router {
  const r = Router();

  // GET /seats/assignment/:tokenId — get seat for a specific token
  r.get("/seats/assignment/:tokenId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ seatNumber: null }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ seat_number: string }>(
        `SELECT seat_number FROM seat_assignments WHERE token_id = $1`,
        [req.params.tokenId],
      );
      res.json({ seatNumber: rows[0]?.seat_number ?? null });
    } catch { res.json({ seatNumber: null }); }
  });

  // GET /seats/:routeId — occupied seats for a route
  r.get("/seats/:routeId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ occupied: [] }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ seat_number: string }>(
        `SELECT seat_number FROM seat_assignments WHERE route_id = $1`,
        [req.params.routeId],
      );
      res.json({ occupied: rows.map((row) => row.seat_number) });
    } catch (err) {
      console.error("[seats GET]", err);
      res.status(500).json({ error: "failed to fetch seats" });
    }
  });

  // POST /seats — claim a seat after mint
  r.post("/seats", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ ok: true, seatNumber: (req.body as Record<string,unknown>).seatNumber }); return; }
    const body = req.body as Record<string, unknown>;
    const tokenId = typeof body.tokenId === "string" ? body.tokenId.trim() : "";
    const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
    const seatNumber = typeof body.seatNumber === "string" ? body.seatNumber.trim() : "";
    if (!tokenId || !routeId || !seatNumber) {
      res.status(400).json({ error: "missing tokenId, routeId, or seatNumber" }); return;
    }
    try {
      const pool = getPool();
      const existing = await pool.query(
        `SELECT token_id FROM seat_assignments WHERE route_id = $1 AND seat_number = $2`,
        [routeId, seatNumber],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        res.status(409).json({ error: "seat already taken" }); return;
      }
      await pool.query(
        `INSERT INTO seat_assignments (route_id, token_id, seat_number) VALUES ($1, $2, $3) ON CONFLICT (token_id) DO NOTHING`,
        [routeId, tokenId, seatNumber],
      );
      res.json({ ok: true, seatNumber });
    } catch (err) {
      console.error("[seats POST]", err);
      res.status(500).json({ error: "failed to claim seat" });
    }
  });

  return r;
}
