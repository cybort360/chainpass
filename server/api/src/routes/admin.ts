import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * keccak256("MINTER_ROLE") — matches `keccak256(toBytes("MINTER_ROLE"))` on the
 * client. Used to filter role_events rows down to minter grants/revokes.
 */
const MINTER_ROLE_HASH = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

export function createAdminRouter(): Router {
  const r = Router();

  /**
   * GET /api/v1/admin/roles
   *
   * Replaces the client-side chain scan in AdminPage.loadRoles. Reads from
   * role_events (populated by the indexer) and collapses to the latest state
   * per address via DISTINCT ON (…) ORDER BY block_number DESC.
   *
   * Response shape matches what AdminPage already consumes:
   *   { operators: [{ address, approved }], minters: [{ address, active }] }
   */
  r.get("/roles", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }
    try {
      const pool = getPool();

      const operatorsQ = await pool.query<{ subject: string; granted: boolean }>(
        `SELECT DISTINCT ON (subject) subject, granted
         FROM role_events
         WHERE kind = 'operator_approved'
         ORDER BY subject, block_number DESC, log_index DESC`,
      );

      const mintersQ = await pool.query<{ subject: string; granted: boolean }>(
        `SELECT DISTINCT ON (subject) subject, granted
         FROM role_events
         WHERE kind IN ('role_granted', 'role_revoked') AND role_hash = $1
         ORDER BY subject, block_number DESC, log_index DESC`,
        [MINTER_ROLE_HASH],
      );

      res.json({
        operators: operatorsQ.rows.map((row) => ({
          address: row.subject,
          approved: row.granted,
        })),
        minters: mintersQ.rows.map((row) => ({
          address: row.subject,
          active: row.granted,
        })),
      });
    } catch (err) {
      console.error("[admin/roles]", err);
      res.status(500).json({ error: "failed to read roles" });
    }
  });

  return r;
}
