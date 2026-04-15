import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * Weekly session templates for a route (schedule_mode = 'sessions').
 *
 * Wire format:
 *   {
 *     id: number,
 *     routeId: string,          // decimal uint256
 *     dayOfWeek: 0..6,          // 0 = Monday, 6 = Sunday
 *     name: string,             // 1..40 chars
 *     departure: "HH:MM",       // 24-hour local
 *     arrival:   "HH:MM",
 *   }
 *
 * A route has at most one (dayOfWeek, name) combination — this mirrors how real
 * timetables disambiguate multiple same-day slots by naming them distinctly
 * ("Morning A" / "Morning B"). The UNIQUE index in the DDL enforces it.
 */

const UINT256_MAX = 2n ** 256n - 1n;
const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;

/** Decimal-string uint256 → canonical decimal string, or null if malformed. */
function parseRouteIdParam(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(t)) return null;
  try {
    const b = BigInt(t);
    if (b < 0n || b > UINT256_MAX) return null;
    return String(b);
  } catch {
    return null;
  }
}

type SessionRow = {
  id: number;
  route_id: string;
  day_of_week: number;
  name: string;
  departure_time: string;
  arrival_time: string;
};

function toWire(row: SessionRow): {
  id: number;
  routeId: string;
  dayOfWeek: number;
  name: string;
  departure: string;
  arrival: string;
} {
  return {
    id: row.id,
    routeId: row.route_id,
    dayOfWeek: row.day_of_week,
    name: row.name,
    departure: row.departure_time,
    arrival: row.arrival_time,
  };
}

export function createSessionsRouter(): Router {
  const r = Router();

  // GET /routes/:routeId/sessions — all sessions for a route, sorted by (day, departure)
  r.get("/routes/:routeId/sessions", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    const routeId = parseRouteIdParam(req.params.routeId);
    if (!routeId) {
      res.status(400).json({ error: "invalid routeId" });
      return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query<SessionRow>(
        `SELECT id, route_id, day_of_week, name, departure_time, arrival_time
         FROM route_sessions
         WHERE route_id = $1
         ORDER BY day_of_week, departure_time, id`,
        [routeId],
      );
      res.json({ sessions: rows.map(toWire) });
    } catch (err) {
      console.error("[sessions GET]", err);
      res.status(500).json({ error: "failed to read sessions" });
    }
  });

  // POST /routes/:routeId/sessions — create a new weekly session
  r.post("/routes/:routeId/sessions", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    const routeId = parseRouteIdParam(req.params.routeId);
    if (!routeId) {
      res.status(400).json({ error: "invalid routeId" });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const dayOfWeek = Number(body?.dayOfWeek);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const departure = typeof body?.departure === "string" ? body.departure.trim() : "";
    const arrival = typeof body?.arrival === "string" ? body.arrival.trim() : "";

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: "dayOfWeek must be an integer in 0..6" }); return;
    }
    if (!name || name.length > 40) {
      res.status(400).json({ error: "name must be 1..40 characters" }); return;
    }
    if (!HHMM.test(departure)) {
      res.status(400).json({ error: "departure must be HH:MM (24h)" }); return;
    }
    if (!HHMM.test(arrival)) {
      res.status(400).json({ error: "arrival must be HH:MM (24h)" }); return;
    }

    try {
      const pool = getPool();
      // Ensure parent route exists — avoids dangling rows when DDL evolves.
      const routeExists = await pool.query(
        `SELECT 1 FROM route_labels WHERE route_id = $1`,
        [routeId],
      );
      if (routeExists.rowCount === 0) {
        res.status(404).json({ error: "route not found" }); return;
      }

      const { rows } = await pool.query<SessionRow>(
        `INSERT INTO route_sessions (route_id, day_of_week, name, departure_time, arrival_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, route_id, day_of_week, name, departure_time, arrival_time`,
        [routeId, dayOfWeek, name, departure, arrival],
      );
      res.status(201).json({ session: toWire(rows[0]) });
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: string }).code) : "";
      if (code === "23505") {
        res.status(409).json({ error: "a session with this name already exists on this day" });
        return;
      }
      console.error("[sessions POST]", err);
      res.status(500).json({ error: "failed to create session" });
    }
  });

  // PATCH /routes/:routeId/sessions/:sessionId — edit any subset of fields
  r.patch("/routes/:routeId/sessions/:sessionId", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    const routeId = parseRouteIdParam(req.params.routeId);
    const sessionId = Number(req.params.sessionId);
    if (!routeId) { res.status(400).json({ error: "invalid routeId" }); return; }
    if (!Number.isInteger(sessionId) || sessionId < 1) {
      res.status(400).json({ error: "invalid sessionId" }); return;
    }

    const body = req.body as Record<string, unknown> | null;

    // Each field is independently updatable. `undefined` = skip.
    const dayOfWeek = body?.dayOfWeek === undefined ? undefined : Number(body.dayOfWeek);
    const name = typeof body?.name === "string" ? body.name.trim() : undefined;
    const departure = typeof body?.departure === "string" ? body.departure.trim() : undefined;
    const arrival = typeof body?.arrival === "string" ? body.arrival.trim() : undefined;

    if (dayOfWeek !== undefined && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      res.status(400).json({ error: "dayOfWeek must be an integer in 0..6" }); return;
    }
    if (name !== undefined && (!name || name.length > 40)) {
      res.status(400).json({ error: "name must be 1..40 characters" }); return;
    }
    if (departure !== undefined && !HHMM.test(departure)) {
      res.status(400).json({ error: "departure must be HH:MM (24h)" }); return;
    }
    if (arrival !== undefined && !HHMM.test(arrival)) {
      res.status(400).json({ error: "arrival must be HH:MM (24h)" }); return;
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (dayOfWeek !== undefined) { vals.push(dayOfWeek); sets.push(`day_of_week = $${vals.length}`); }
    if (name !== undefined) { vals.push(name); sets.push(`name = $${vals.length}`); }
    if (departure !== undefined) { vals.push(departure); sets.push(`departure_time = $${vals.length}`); }
    if (arrival !== undefined) { vals.push(arrival); sets.push(`arrival_time = $${vals.length}`); }
    if (sets.length === 0) {
      res.status(400).json({ error: "no fields to update" }); return;
    }
    vals.push(sessionId);
    vals.push(routeId);

    try {
      const pool = getPool();
      const { rows, rowCount } = await pool.query<SessionRow>(
        `UPDATE route_sessions SET ${sets.join(", ")}
         WHERE id = $${vals.length - 1} AND route_id = $${vals.length}
         RETURNING id, route_id, day_of_week, name, departure_time, arrival_time`,
        vals,
      );
      if (!rowCount) { res.status(404).json({ error: "session not found" }); return; }
      res.json({ session: toWire(rows[0]) });
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: string }).code) : "";
      if (code === "23505") {
        res.status(409).json({ error: "a session with this name already exists on this day" });
        return;
      }
      console.error("[sessions PATCH]", err);
      res.status(500).json({ error: "failed to update session" });
    }
  });

  // DELETE /routes/:routeId/sessions/:sessionId
  r.delete("/routes/:routeId/sessions/:sessionId", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    const routeId = parseRouteIdParam(req.params.routeId);
    const sessionId = Number(req.params.sessionId);
    if (!routeId) { res.status(400).json({ error: "invalid routeId" }); return; }
    if (!Number.isInteger(sessionId) || sessionId < 1) {
      res.status(400).json({ error: "invalid sessionId" }); return;
    }
    try {
      const pool = getPool();
      const { rowCount } = await pool.query(
        `DELETE FROM route_sessions WHERE id = $1 AND route_id = $2`,
        [sessionId, routeId],
      );
      if (!rowCount) { res.status(404).json({ error: "session not found" }); return; }
      res.json({ ok: true });
    } catch (err) {
      console.error("[sessions DELETE]", err);
      res.status(500).json({ error: "failed to delete session" });
    }
  });

  return r;
}
