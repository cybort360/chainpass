import { Router, type Response } from "express";
import { getPool } from "../lib/db.js";

// ── SSE seat-change broadcaster ────────────────────────────────────────────
const seatSubs = new Map<string, Set<Response>>()
function seatSubAdd(routeId: string, res: Response): void {
  if (!seatSubs.has(routeId)) seatSubs.set(routeId, new Set())
  seatSubs.get(routeId)!.add(res)
}
function seatSubRemove(routeId: string, res: Response): void {
  seatSubs.get(routeId)?.delete(res)
}
/** Push a "seats-changed" event to every browser watching this route. */
export function seatNotify(routeId: string): void {
  const subs = seatSubs.get(routeId)
  if (!subs?.size) return
  for (const res of subs) res.write("event: seats-changed\ndata: {}\n\n")
}

type CoachClassConfig = { count: number; rows: number; leftCols: number; rightCols: number };

/** Compute total seat capacity for a route from its DB fields. Returns null if undefined. */
function computeCapacity(row: {
  coaches: number | null;
  seats_per_coach: number | null;
  total_seats: number | null;
  coach_classes: CoachClassConfig[] | null;
}): number | null {
  if (row.coach_classes && Array.isArray(row.coach_classes) && row.coach_classes.length > 0) {
    return (row.coach_classes as CoachClassConfig[]).reduce(
      (s, cc) => s + cc.count * cc.rows * (cc.leftCols + cc.rightCols),
      0,
    );
  }
  if (row.coaches && row.seats_per_coach) return row.coaches * row.seats_per_coach;
  if (row.total_seats) return row.total_seats;
  return null;
}

/** Reservation TTL in minutes — covers signing + block confirmation time. */
const RESERVATION_TTL_MINUTES = 10;

export function createSeatsRouter(): Router {
  const r = Router();

  // GET /seats/stream/:routeId — SSE stream; pushes "seats-changed" on every reserve/release/claim
  r.get("/seats/stream/:routeId", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()
    const routeId = req.params.routeId
    seatSubAdd(routeId, res)
    // Keep-alive comment every 25 s (proxy / load-balancer idle timeout guard)
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000)
    req.on("close", () => { clearInterval(ping); seatSubRemove(routeId, res) })
  })

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

  // DELETE /seats/reserve — release a hold when passenger deselects
  r.delete("/seats/reserve", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ ok: true }); return; }
    const body = req.body as Record<string, unknown>;
    const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
    const seatNumber = typeof body.seatNumber === "string" ? body.seatNumber.trim() : "";
    if (!routeId || !seatNumber) {
      res.status(400).json({ error: "missing routeId or seatNumber" }); return;
    }
    try {
      const pool = getPool();
      await pool.query(
        `DELETE FROM seat_reservations WHERE route_id = $1 AND seat_number = $2`,
        [routeId, seatNumber],
      );
      seatNotify(routeId)
      res.json({ ok: true });
    } catch (err) {
      console.error("[seats release]", err);
      res.status(500).json({ error: "failed to release seat" });
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

      // ── Overbooking check: reject if route is at capacity ──
      const routeRow = await pool.query<{
        coaches: number | null; seats_per_coach: number | null;
        total_seats: number | null; coach_classes: CoachClassConfig[] | null;
      }>(
        `SELECT coaches, seats_per_coach, total_seats, coach_classes FROM route_labels WHERE route_id = $1`,
        [routeId],
      );
      if (routeRow.rows[0]) {
        const capacity = computeCapacity(routeRow.rows[0]);
        if (capacity !== null) {
          // UNION deduplicates seats that briefly appear in both tables (race window
          // between INSERT seat_assignments and DELETE seat_reservations at claim time).
          const occupiedRes = await pool.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM (
               SELECT seat_number FROM seat_assignments WHERE route_id = $1
               UNION
               SELECT seat_number FROM seat_reservations WHERE route_id = $1 AND expires_at > NOW()
             ) AS occupied`,
            [routeId, routeId],
          );
          const occupied = parseInt(occupiedRes.rows[0]?.count ?? "0", 10);
          if (occupied >= capacity) {
            res.status(409).json({ error: "SOLD_OUT" }); return;
          }
        }
      }

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
      seatNotify(routeId)
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
      seatNotify(routeId)
      res.json({ ok: true, seatNumber });
    } catch (err) {
      console.error("[seats POST]", err);
      res.status(500).json({ error: "failed to claim seat" });
    }
  });

  return r;
}
