import { Router } from "express";
import { getPool } from "../lib/db.js";

/** Reservation TTL in minutes — covers signing + block confirmation time. */
const RESERVATION_TTL_MINUTES = 10;

export function createSeatsRouter(): Router {
  const r = Router();

  // GET /seats/assignment/:tokenId — permanent seat for a specific token
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

  // GET /seats/:routeId — permanently assigned + currently reserved seats
  r.get("/seats/:routeId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ occupied: [] }); return; }
    try {
      const pool = getPool();
      const [assigned, reserved] = await Promise.all([
        pool.query<{ seat_number: string }>(
          `SELECT seat_number FROM seat_assignments WHERE route_id = $1`,
          [req.params.routeId],
        ),
        pool.query<{ seat_number: string }>(
          `SELECT seat_number FROM seat_reservations
           WHERE route_id = $1 AND expires_at > NOW()`,
          [req.params.routeId],
        ),
      ]);
      const occupied = [
        ...assigned.rows.map((row) => row.seat_number),
        ...reserved.rows.map((row) => row.seat_number),
      ];
      // Deduplicate (a seat may be in both if claim was fast)
      res.json({ occupied: [...new Set(occupied)] });
    } catch (err) {
      console.error("[seats GET]", err);
      res.status(500).json({ error: "failed to fetch seats" });
    }
  });

  // POST /seats/reserve — temporarily lock a seat while passenger pays
  // Idempotent: re-selecting the same seat refreshes the TTL.
  r.post("/seats/reserve", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ ok: true }); return; }
    const body = req.body as Record<string, unknown>;
    const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
    const seatNumber = typeof body.seatNumber === "string" ? body.seatNumber.trim() : "";
    if (!routeId || !seatNumber) {
      res.status(400).json({ error: "missing routeId or seatNumber" }); return;
    }
    try {
      const pool = getPool();
      // Reject if already permanently assigned
      const taken = await pool.query(
        `SELECT 1 FROM seat_assignments WHERE route_id = $1 AND seat_number = $2`,
        [routeId, seatNumber],
      );
      if (taken.rowCount && taken.rowCount > 0) {
        res.status(409).json({ error: "seat already taken" }); return;
      }
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
      // Upsert: if someone else already has a live reservation on this seat, reject
      const existing = await pool.query(
        `SELECT 1 FROM seat_reservations
         WHERE route_id = $1 AND seat_number = $2 AND expires_at > NOW()`,
        [routeId, seatNumber],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        res.status(409).json({ error: "seat is being held by another passenger" }); return;
      }
      // Insert or refresh (e.g. user re-selected same seat)
      await pool.query(
        `INSERT INTO seat_reservations (route_id, seat_number, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (route_id, seat_number)
         DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [routeId, seatNumber, expiresAt],
      );
      res.json({ ok: true, expiresAt: expiresAt.toISOString() });
    } catch (err) {
      console.error("[seats reserve]", err);
      res.status(500).json({ error: "failed to reserve seat" });
    }
  });

  // POST /seats — confirm permanent assignment after successful on-chain mint
  r.post("/seats", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.json({ ok: true, seatNumber: (req.body as Record<string, unknown>).seatNumber });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const tokenId = typeof body.tokenId === "string" ? body.tokenId.trim() : "";
    const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
    const seatNumber = typeof body.seatNumber === "string" ? body.seatNumber.trim() : "";
    if (!tokenId || !routeId || !seatNumber) {
      res.status(400).json({ error: "missing tokenId, routeId, or seatNumber" }); return;
    }
    try {
      const pool = getPool();
      // Check no other token already owns this seat permanently
      const existing = await pool.query(
        `SELECT token_id FROM seat_assignments WHERE route_id = $1 AND seat_number = $2`,
        [routeId, seatNumber],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const existingToken = (existing.rows[0] as { token_id: string }).token_id;
        // Idempotent: same token confirming again is fine
        if (existingToken !== tokenId) {
          res.status(409).json({ error: "seat already taken by another ticket" }); return;
        }
        res.json({ ok: true, seatNumber }); return;
      }
      // Write permanent assignment
      await pool.query(
        `INSERT INTO seat_assignments (route_id, token_id, seat_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_id) DO NOTHING`,
        [routeId, tokenId, seatNumber],
      );
      // Clean up the reservation (no longer needed)
      await pool.query(
        `DELETE FROM seat_reservations WHERE route_id = $1 AND seat_number = $2`,
        [routeId, seatNumber],
      );
      res.json({ ok: true, seatNumber });
    } catch (err) {
      console.error("[seats POST]", err);
      res.status(500).json({ error: "failed to claim seat" });
    }
  });

  return r;
}
