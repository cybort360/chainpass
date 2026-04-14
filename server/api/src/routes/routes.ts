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

type CoachClassConfig = { class: string; count: number; rows: number; leftCols: number; rightCols: number };

/** Validate and normalise a coachClasses payload (array of per-class coach configs). */
function parseCoachClasses(raw: unknown): CoachClassConfig[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const valid = (raw as unknown[]).flatMap((item): CoachClassConfig[] => {
    if (typeof item !== "object" || item === null) return [];
    const cc = item as Record<string, unknown>;
    if (!["first", "business", "economy"].includes(String(cc.class))) return [];
    const count = Math.floor(Number(cc.count));
    const rows = Math.floor(Number(cc.rows));
    const leftCols = Math.floor(Number(cc.leftCols));
    const rightCols = Math.floor(Number(cc.rightCols));
    if (count < 1 || rows < 1 || leftCols < 1 || rightCols < 1) return [];
    return [{ class: String(cc.class), count, rows, leftCols, rightCols }];
  });
  return valid.length > 0 ? valid : null;
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
        vehicle_type: string | null;
        is_interstate: boolean | null;
        coaches: number | null;
        seats_per_coach: number | null;
        total_seats: number | null;
        coach_classes: unknown | null;
      }>(
        `SELECT route_id, name, detail, category, schedule,
                vehicle_type, is_interstate, coaches, seats_per_coach, total_seats,
                coach_classes
         FROM route_labels
         ORDER BY category, route_id::numeric`,
      );
      res.json({
        routes: rows.map((row) => ({
          routeId: String(row.route_id),
          name: row.name,
          detail: row.detail,
          category: row.category,
          schedule: row.schedule,
          vehicleType: row.vehicle_type,
          isInterstate: row.is_interstate,
          coaches: row.coaches,
          seatsPerCoach: row.seats_per_coach,
          totalSeats: row.total_seats,
          coachClasses: row.coach_classes ?? null,
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
    const vehicleTypeRaw = body?.vehicleType;
    const vehicleType =
      vehicleTypeRaw === undefined ? undefined :
      vehicleTypeRaw === null ? null :
      ["train","bus","light_rail"].includes(String(vehicleTypeRaw)) ? String(vehicleTypeRaw) : undefined;
    const isInterstate = body?.isInterstate === undefined ? undefined :
      body.isInterstate === null ? null : Boolean(body.isInterstate);
    const coaches = body?.coaches === undefined ? undefined :
      body.coaches === null ? null : Number(body.coaches) > 0 ? Math.floor(Number(body.coaches)) : undefined;
    const seatsPerCoach = body?.seatsPerCoach === undefined ? undefined :
      body.seatsPerCoach === null ? null : Number(body.seatsPerCoach) > 0 ? Math.floor(Number(body.seatsPerCoach)) : undefined;
    const totalSeats = body?.totalSeats === undefined ? undefined :
      body.totalSeats === null ? null : Number(body.totalSeats) > 0 ? Math.floor(Number(body.totalSeats)) : undefined;
    const coachClassesPut = body?.coachClasses === undefined ? undefined :
      body.coachClasses === null ? null : parseCoachClasses(body.coachClasses);

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
    if (vehicleType !== undefined) { vals.push(vehicleType); sets.push(`vehicle_type = $${vals.length}`); }
    if (isInterstate !== undefined) { vals.push(isInterstate); sets.push(`is_interstate = $${vals.length}`); }
    if (coaches !== undefined) { vals.push(coaches); sets.push(`coaches = $${vals.length}`); }
    if (seatsPerCoach !== undefined) { vals.push(seatsPerCoach); sets.push(`seats_per_coach = $${vals.length}`); }
    if (totalSeats !== undefined) { vals.push(totalSeats); sets.push(`total_seats = $${vals.length}`); }
    if (coachClassesPut !== undefined) {
      vals.push(coachClassesPut ? JSON.stringify(coachClassesPut) : null);
      sets.push(`coach_classes = $${vals.length}`);
    }

    if (sets.length === 0) {
      res.status(400).json({ error: "no fields to update" });
      return;
    }

    vals.push(String(routeId));
    const setClause = sets.join(", ");

    try {
      const pool = getPool();
      const result = await pool.query(
        `UPDATE route_labels SET ${setClause} WHERE route_id = $${vals.length}
         RETURNING route_id, name, detail, category, schedule,
                   vehicle_type, is_interstate, coaches, seats_per_coach, total_seats, coach_classes`,
        vals,
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: "route not found" });
        return;
      }
      const row = result.rows[0] as {
        route_id: string; name: string; detail: string | null; category: string; schedule: string | null;
        vehicle_type: string | null; is_interstate: boolean | null; coaches: number | null;
        seats_per_coach: number | null; total_seats: number | null; coach_classes: unknown | null;
      };
      res.json({ route: {
        routeId: row.route_id, name: row.name, detail: row.detail, category: row.category, schedule: row.schedule,
        vehicleType: row.vehicle_type, isInterstate: row.is_interstate,
        coaches: row.coaches, seatsPerCoach: row.seats_per_coach, totalSeats: row.total_seats,
        coachClasses: row.coach_classes ?? null,
      } });
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

  // GET /routes/:routeId/capacity — sold + reserved tickets vs. route capacity
  r.get("/routes/:routeId/capacity", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.json({ capacity: null, sold: 0, reserved: 0, available: null, soldOut: false });
      return;
    }
    try {
      const pool = getPool();
      const routeIdStr = String(req.params.routeId).trim();

      // Fetch route capacity fields
      const routeRow = await pool.query<{
        coaches: number | null;
        seats_per_coach: number | null;
        total_seats: number | null;
        coach_classes: CoachClassConfig[] | null;
      }>(
        `SELECT coaches, seats_per_coach, total_seats, coach_classes
         FROM route_labels WHERE route_id = $1`,
        [routeIdStr],
      );

      if (!routeRow.rows[0]) {
        res.status(404).json({ error: "route not found" }); return;
      }

      const row = routeRow.rows[0];
      let capacity: number | null = null;

      if (row.coach_classes && Array.isArray(row.coach_classes) && row.coach_classes.length > 0) {
        // New-style: sum coach class seats
        capacity = (row.coach_classes as CoachClassConfig[]).reduce(
          (sum, cc) => sum + cc.count * cc.rows * (cc.leftCols + cc.rightCols),
          0,
        );
      } else if (row.coaches && row.seats_per_coach) {
        capacity = row.coaches * row.seats_per_coach;
      } else if (row.total_seats) {
        capacity = row.total_seats;
      }

      // Count sold (permanent assignments) and reserved (held, not yet minted)
      const [soldRes, reservedRes] = await Promise.all([
        pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM seat_assignments WHERE route_id = $1`,
          [routeIdStr],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM seat_reservations WHERE route_id = $1 AND expires_at > NOW()`,
          [routeIdStr],
        ),
      ]);

      const sold     = parseInt(soldRes.rows[0]?.count ?? "0", 10);
      const reserved = parseInt(reservedRes.rows[0]?.count ?? "0", 10);
      const available = capacity !== null ? Math.max(0, capacity - sold - reserved) : null;
      const soldOut   = capacity !== null && sold + reserved >= capacity;

      res.json({ capacity, sold, reserved, available, soldOut });
    } catch (err) {
      console.error("[routes capacity GET]", err);
      res.status(500).json({ error: "failed to fetch capacity" });
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

    // Vehicle / seat config
    const vehicleTypeRaw = body?.vehicleType;
    const vehicleType: string | null =
      vehicleTypeRaw !== undefined && ["train","bus","light_rail"].includes(String(vehicleTypeRaw))
        ? String(vehicleTypeRaw) : null;
    const isInterstate: boolean | null =
      body?.isInterstate !== undefined && body.isInterstate !== null
        ? Boolean(body.isInterstate) : null;
    const coachesRaw = body?.coaches;
    const coaches: number | null =
      coachesRaw !== undefined && coachesRaw !== null && Number(coachesRaw) > 0
        ? Math.floor(Number(coachesRaw)) : null;
    const seatsPerCoachRaw = body?.seatsPerCoach;
    const seatsPerCoach: number | null =
      seatsPerCoachRaw !== undefined && seatsPerCoachRaw !== null && Number(seatsPerCoachRaw) > 0
        ? Math.floor(Number(seatsPerCoachRaw)) : null;
    const totalSeatsRaw = body?.totalSeats;
    const totalSeats: number | null =
      totalSeatsRaw !== undefined && totalSeatsRaw !== null && Number(totalSeatsRaw) > 0
        ? Math.floor(Number(totalSeatsRaw)) : null;
    const coachClasses = parseCoachClasses(body?.coachClasses);

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
        `INSERT INTO route_labels
           (route_id, name, detail, category, schedule,
            vehicle_type, is_interstate, coaches, seats_per_coach, total_seats, coach_classes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [String(routeId), name, detail, category, schedulePost,
         vehicleType, isInterstate, coaches, seatsPerCoach, totalSeats,
         coachClasses ? JSON.stringify(coachClasses) : null],
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
          vehicleType,
          isInterstate,
          coaches,
          seatsPerCoach,
          totalSeats,
          coachClasses: coachClasses ?? null,
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
