/**
 * Removes all indexed mint/burn rows so the indexer can replay from INDEXER_FROM_BLOCK
 * (e.g. after deploying a new ChainPassTicket). Does not touch route_labels.
 *
 * Usage (from repo root or server/indexer, with DATABASE_URL set):
 *   pnpm --filter @hoppr/indexer run db:clear-ticket-events
 */
import pg from "pg";
import { loadRootEnv } from "../src/load-env.js";

loadRootEnv();

/** Prefer direct Postgres URL (e.g. Supabase :5432) — poolers can block TRUNCATE. */
const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("[clear-ticket-events] Set DIRECT_URL or DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query("TRUNCATE TABLE ticket_events RESTART IDENTITY CASCADE");
  console.log("[clear-ticket-events] truncated ticket_events (indexer will use INDEXER_FROM_BLOCK on next empty scan)");
} finally {
  await pool.end();
}
