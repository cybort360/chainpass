import { Router } from "express";
import { getAddress, isAddress } from "viem";
import { getPool } from "../lib/db.js";

export function createRiderRouter(): Router {
  const r = Router();

  r.get("/passes", async (req, res) => {
    const raw = typeof req.query.holder === "string" ? req.query.holder.trim() : "";
    if (!raw || !isAddress(raw)) {
      res.status(400).json({ error: "invalid or missing holder query (expected 0x address)" });
      return;
    }
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "database is not configured (DATABASE_URL)" });
      return;
    }

    let holder: `0x${string}`;
    try {
      holder = getAddress(raw);
    } catch {
      res.status(400).json({ error: "invalid holder address" });
      return;
    }

    try {
      const pool = getPool();
      const holderLower = holder.toLowerCase();

      const used = await pool.query(
        `SELECT id, event_type, tx_hash, log_index, block_number, block_hash,
                contract_address, token_id, route_id, valid_until_epoch, operator_addr,
                from_address, to_address, created_at
         FROM ticket_events
         WHERE event_type = 'burn' AND LOWER(from_address) = $1
         ORDER BY block_number DESC, log_index DESC
         LIMIT 200`,
        [holderLower],
      );

      const active = await pool.query(
        `SELECT m.id, m.event_type, m.tx_hash, m.log_index, m.block_number, m.block_hash,
                m.contract_address, m.token_id, m.route_id, m.valid_until_epoch, m.operator_addr,
                m.from_address, m.to_address, m.created_at
         FROM ticket_events m
         WHERE m.event_type = 'mint' AND LOWER(m.to_address) = $1
           AND NOT EXISTS (
             SELECT 1 FROM ticket_events b
             WHERE b.event_type = 'burn' AND b.token_id = m.token_id
           )
         ORDER BY m.block_number DESC, m.log_index DESC
         LIMIT 200`,
        [holderLower],
      );

      res.json({
        holder,
        active: active.rows,
        used: used.rows,
      });
    } catch (err) {
      console.error("[rider/passes]", err);
      res.status(500).json({ error: "failed to read passes" });
    }
  });

  return r;
}
