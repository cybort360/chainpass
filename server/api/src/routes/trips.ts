import { Router } from "express";
import { getPool } from "../lib/db.js";

export type TripStatus = "scheduled" | "boarding" | "departed" | "arrived" | "cancelled";

export type TripRow = {
  id: number;
  route_id: string;
  departure_at: string;
  arrival_at: string;
  status: TripStatus;
  created_at: string;
};

export function createTripsRouter(): Router {
  const r = Router();

  // GET /trips?routeId=X — list trips for a route (upcoming first, then recent past)
  // GET /trips?status=boarding — list all trips with a given status (for offline manifest pre-load)
  r.get("/trips", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ trips: [] }); return; }
    const routeId = typeof req.query.routeId === "string" ? req.query.routeId.trim() : "";
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";

    if (statusFilter) {
      // Return all trips with the given status (used for offline manifest pre-load)
      try {
        const pool = getPool();
        const { rows } = await pool.query<TripRow>(
          `SELECT id, route_id, departure_at, arrival_at, status, created_at
           FROM trips WHERE status = $1 ORDER BY departure_at ASC`,
          [statusFilter],
        );
        res.json({ trips: rows });
      } catch (err) {
        console.error("[trips GET by status]", err);
        res.status(500).json({ error: "failed to fetch trips" });
      }
      return;
    }

    if (!routeId) { res.status(400).json({ error: "routeId or status is required" }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<TripRow>(
        `SELECT id, route_id, departure_at, arrival_at, status, created_at
         FROM trips
         WHERE route_id = $1
         ORDER BY departure_at ASC`,
        [routeId],
      );
      res.json({ trips: rows });
    } catch (err) {
      console.error("[trips GET]", err);
      res.status(500).json({ error: "failed to fetch trips" });
    }
  });

  // GET /trips/:tripId — single trip detail
  r.get("/trips/:tripId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.status(404).json({ error: "not found" }); return; }
    const tripId = parseInt(req.params.tripId, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: "invalid tripId" }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<TripRow>(
        `SELECT id, route_id, departure_at, arrival_at, status, created_at
         FROM trips WHERE id = $1`,
        [tripId],
      );
      if (!rows[0]) { res.status(404).json({ error: "trip not found" }); return; }
      res.json({ trip: rows[0] });
    } catch (err) {
      console.error("[trips/:id GET]", err);
      res.status(500).json({ error: "failed to fetch trip" });
    }
  });

  // POST /trips — create a new trip (operator admin)
  r.post("/trips", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.status(503).json({ error: "database not configured" }); return; }
    const body = req.body as Record<string, unknown>;
    const routeId     = typeof body.routeId     === "string" ? body.routeId.trim()     : "";
    const departureAt = typeof body.departureAt  === "string" ? body.departureAt.trim() : "";
    const arrivalAt   = typeof body.arrivalAt    === "string" ? body.arrivalAt.trim()   : "";

    if (!routeId)     { res.status(400).json({ error: "routeId is required" });     return; }
    if (!departureAt) { res.status(400).json({ error: "departureAt is required" }); return; }
    if (!arrivalAt)   { res.status(400).json({ error: "arrivalAt is required" });   return; }

    const dep = new Date(departureAt);
    const arr = new Date(arrivalAt);
    if (isNaN(dep.getTime())) { res.status(400).json({ error: "invalid departureAt" }); return; }
    if (isNaN(arr.getTime())) { res.status(400).json({ error: "invalid arrivalAt" });   return; }
    if (arr <= dep)           { res.status(400).json({ error: "arrivalAt must be after departureAt" }); return; }

    try {
      const pool = getPool();
      const { rows } = await pool.query<TripRow>(
        `INSERT INTO trips (route_id, departure_at, arrival_at)
         VALUES ($1, $2, $3)
         RETURNING id, route_id, departure_at, arrival_at, status, created_at`,
        [routeId, dep.toISOString(), arr.toISOString()],
      );
      res.status(201).json({ trip: rows[0] });
    } catch (err) {
      console.error("[trips POST]", err);
      res.status(500).json({ error: "failed to create trip" });
    }
  });

  // PATCH /trips/:tripId/status — update trip status
  r.patch("/trips/:tripId/status", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.status(503).json({ error: "database not configured" }); return; }
    const tripId = parseInt(req.params.tripId, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: "invalid tripId" }); return; }
    const body = req.body as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status.trim() : "";
    const validStatuses: TripStatus[] = ["scheduled", "boarding", "departed", "arrived", "cancelled"];
    if (!validStatuses.includes(status as TripStatus)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` }); return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query<TripRow>(
        `UPDATE trips SET status = $1 WHERE id = $2
         RETURNING id, route_id, departure_at, arrival_at, status, created_at`,
        [status, tripId],
      );
      if (!rows[0]) { res.status(404).json({ error: "trip not found" }); return; }
      res.json({ trip: rows[0] });
    } catch (err) {
      console.error("[trips PATCH status]", err);
      res.status(500).json({ error: "failed to update trip status" });
    }
  });

  // DELETE /trips/:tripId — remove a trip (only if no tickets linked)
  r.delete("/trips/:tripId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.status(503).json({ error: "database not configured" }); return; }
    const tripId = parseInt(req.params.tripId, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: "invalid tripId" }); return; }
    try {
      const pool = getPool();
      const linked = await pool.query(
        `SELECT 1 FROM ticket_trips WHERE trip_id = $1 LIMIT 1`,
        [tripId],
      );
      if (linked.rowCount && linked.rowCount > 0) {
        res.status(409).json({ error: "cannot delete trip with linked tickets" }); return;
      }
      await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
      res.json({ ok: true });
    } catch (err) {
      console.error("[trips DELETE]", err);
      res.status(500).json({ error: "failed to delete trip" });
    }
  });

  // POST /trips/link — record which trip a token was purchased for (called post-mint)
  r.post("/trips/link", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.json({ ok: true }); return;
    }
    const body = req.body as Record<string, unknown>;
    const tokenId = typeof body.tokenId === "string" ? body.tokenId.trim() : "";
    const tripId  = typeof body.tripId  === "number" ? body.tripId : parseInt(String(body.tripId ?? ""), 10);
    const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";

    if (!tokenId || isNaN(tripId) || !routeId) {
      res.status(400).json({ error: "tokenId, tripId, and routeId are required" }); return;
    }
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO ticket_trips (token_id, trip_id, route_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_id) DO NOTHING`,
        [tokenId, tripId, routeId],
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("[trips/link POST]", err);
      res.status(500).json({ error: "failed to link token to trip" });
    }
  });

  // GET /trips/:tripId/manifest — all token IDs booked on this trip (for offline caching)
  r.get("/trips/:tripId/manifest", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ tokenIds: [] }); return; }
    const tripId = parseInt(req.params.tripId, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: "invalid tripId" }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ token_id: string }>(
        `SELECT token_id FROM ticket_trips WHERE trip_id = $1`,
        [tripId],
      );
      res.json({ tokenIds: rows.map((r) => r.token_id) });
    } catch (err) {
      console.error("[trips/:id/manifest GET]", err);
      res.status(500).json({ error: "failed to fetch manifest" });
    }
  });

  // GET /trips/token/:tokenId — which trip is this token for?
  r.get("/trips/token/:tokenId", async (req, res) => {
    if (!process.env.DATABASE_URL) { res.json({ trip: null }); return; }
    try {
      const pool = getPool();
      const { rows } = await pool.query<TripRow>(
        `SELECT t.id, t.route_id, t.departure_at, t.arrival_at, t.status, t.created_at
         FROM trips t
         JOIN ticket_trips tt ON tt.trip_id = t.id
         WHERE tt.token_id = $1`,
        [req.params.tokenId],
      );
      res.json({ trip: rows[0] ?? null });
    } catch (err) {
      console.error("[trips/token GET]", err);
      res.status(500).json({ error: "failed to fetch trip for token" });
    }
  });

  return r;
}
