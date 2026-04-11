import { Router } from "express";
import { getPool } from "../lib/db.js";

export function createOperatorRouter(): Router {
  const r = Router();

  r.get("/events", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, event_type, tx_hash, log_index, block_number, block_hash,
                contract_address, token_id, route_id, valid_until_epoch, operator_addr,
                from_address, to_address, created_at
         FROM ticket_events
         ORDER BY block_number DESC, log_index DESC
         LIMIT 500`,
      );
      res.json({ events: rows });
    } catch (err) {
      console.error("[operator/events]", err);
      res.status(500).json({ error: "failed to read events" });
    }
  });

  r.get("/stats", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query<{
        mints_total: number;
        burns_total: number;
        mints_last_24h: number;
        burns_last_24h: number;
      }>(
        `SELECT
          COALESCE(SUM(CASE WHEN event_type = 'mint' THEN 1 ELSE 0 END), 0)::int AS mints_total,
          COALESCE(SUM(CASE WHEN event_type = 'burn' THEN 1 ELSE 0 END), 0)::int AS burns_total,
          COALESCE(
            SUM(CASE WHEN event_type = 'mint' AND created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END),
            0
          )::int AS mints_last_24h,
          COALESCE(
            SUM(CASE WHEN event_type = 'burn' AND created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END),
            0
          )::int AS burns_last_24h
         FROM ticket_events`,
      );
      const s = rows[0];
      if (!s) {
        res.json({
          totals: { mint: 0, burn: 0 },
          last24h: { mint: 0, burn: 0 },
        });
        return;
      }
      res.json({
        totals: { mint: s.mints_total, burn: s.burns_total },
        last24h: { mint: s.mints_last_24h, burn: s.burns_last_24h },
      });
    } catch (err) {
      console.error("[operator/stats]", err);
      res.status(500).json({ error: "failed to read stats" });
    }
  });

  return r;
}
