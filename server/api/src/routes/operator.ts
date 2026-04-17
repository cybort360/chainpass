import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * keccak256("BURNER_ROLE") — matches `keccak256(toBytes("BURNER_ROLE"))` on the
 * client (see OperatorPage.tsx). Used to filter role_events rows down to
 * conductor (burner) grants/revokes.
 */
const BURNER_ROLE_HASH = "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848";

export function createOperatorRouter(): Router {
  const r = Router();

  /**
   * GET /api/v1/operator/burners
   *
   * Replaces the client-side chain scan in OperatorPage.loadBurners. Reads
   * role_events (populated by the indexer) and collapses to the latest state
   * per address. Response shape matches what OperatorPage already consumes:
   *   { burners: [{ address, active }] }
   */
  r.get("/burners", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ subject: string; granted: boolean }>(
        `SELECT DISTINCT ON (subject) subject, granted
         FROM role_events
         WHERE kind IN ('role_granted', 'role_revoked') AND role_hash = $1
         ORDER BY subject, block_number DESC, log_index DESC`,
        [BURNER_ROLE_HASH],
      );
      res.json({
        burners: rows.map((row) => ({ address: row.subject, active: row.granted })),
      });
    } catch (err) {
      console.error("[operator/burners]", err);
      res.status(500).json({ error: "failed to read burners" });
    }
  });

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
        total_inflow_wei: string;
      }>(
        `SELECT
          COALESCE(SUM(CASE WHEN event_type = 'mint' THEN 1 ELSE 0 END), 0)::int AS mints_total,
          COALESCE(SUM(CASE WHEN event_type = 'burn' THEN 1 ELSE 0 END), 0)::int AS burns_total,
          COALESCE(SUM(CASE WHEN event_type = 'mint' AND created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::int AS mints_last_24h,
          COALESCE(SUM(CASE WHEN event_type = 'burn' AND created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::int AS burns_last_24h,
          COALESCE(SUM(CASE WHEN event_type = 'mint' AND payment_wei IS NOT NULL THEN payment_wei::numeric ELSE 0 END), 0)::text AS total_inflow_wei
         FROM ticket_events`,
      );
      const s = rows[0];
      if (!s) {
        res.json({ totals: { mint: 0, burn: 0 }, last24h: { mint: 0, burn: 0 }, totalInflowWei: "0" });
        return;
      }
      res.json({
        totals: { mint: s.mints_total, burn: s.burns_total },
        last24h: { mint: s.mints_last_24h, burn: s.burns_last_24h },
        totalInflowWei: s.total_inflow_wei,
      });
    } catch (err) {
      console.error("[operator/stats]", err);
      res.status(500).json({ error: "failed to read stats" });
    }
  });

  r.get("/route-stats", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ route_id: string; mint_count: string }>(
        `SELECT route_id, COUNT(*) as mint_count
         FROM ticket_events
         WHERE event_type = 'mint'
         GROUP BY route_id
         ORDER BY mint_count DESC`,
      );
      res.json({
        routeStats: rows.map((row) => ({
          routeId: row.route_id,
          mintCount: Number(row.mint_count),
        })),
      });
    } catch (err) {
      console.error("[operator/route-stats]", err);
      res.status(500).json({ error: "failed to read route stats" });
    }
  });

  r.get("/timeseries", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    const period = typeof req.query.period === "string" ? req.query.period : "7d";
    let intervalSql: string;
    let bucketSql: string;
    switch (period) {
      case "24h":
        intervalSql = "24 hours";
        bucketSql = "hour";
        break;
      case "30d":
        intervalSql = "30 days";
        bucketSql = "day";
        break;
      default:
        intervalSql = "7 days";
        bucketSql = "day";
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query<{
        bucket: string;
        mints: number;
        burns: number;
        inflow_wei: string;
      }>(
        `SELECT
          date_trunc($1, created_at) AS bucket,
          SUM(CASE WHEN event_type = 'mint' THEN 1 ELSE 0 END)::int AS mints,
          SUM(CASE WHEN event_type = 'burn' THEN 1 ELSE 0 END)::int AS burns,
          COALESCE(SUM(CASE WHEN event_type = 'mint' AND payment_wei IS NOT NULL THEN payment_wei::numeric ELSE 0 END), 0)::text AS inflow_wei
         FROM ticket_events
         WHERE created_at >= NOW() - INTERVAL '${intervalSql}'
         GROUP BY date_trunc($1, created_at)
         ORDER BY bucket`,
        [bucketSql],
      );
      res.json({ period, buckets: rows });
    } catch (err) {
      console.error("[operator/timeseries]", err);
      res.status(500).json({ error: "failed to read timeseries" });
    }
  });

  return r;
}
