import pg from "pg";
import {
  ROUTE_LABELS_INIT_SQL,
  ROUTE_LABELS_MIGRATE_CATEGORY_SQL,
  ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL,
  ROUTE_LABELS_MIGRATE_LENGTH_CONSTRAINTS_SQL,
  ROUTE_LABELS_MIGRATE_SCHEDULE_SQL,
  ROUTE_LABELS_MIGRATE_SHORT_CODE_SQL,
  ROUTE_LABELS_MIGRATE_SCHEDULE_MODE_SQL,
  ROUTE_LABELS_MIGRATE_VEHICLE_SQL,
  ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL,
  ROUTE_RATINGS_INIT_SQL,
  ROUTE_SESSIONS_INIT_SQL,
  SEAT_ASSIGNMENTS_INIT_SQL,
  SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL,
  SEAT_RESERVATIONS_INIT_SQL,
  SEAT_RESERVATIONS_MIGRATE_HOLDER_SQL,
  SEAT_RESERVATIONS_MIGRATE_BUCKET_SQL,
  TRIPS_INIT_SQL,
  TICKET_TRIPS_INIT_SQL,
} from "../schema.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

/** Clears the singleton pool (e.g. between tests). */
export function resetPoolForTests(): void {
  if (pool) {
    void pool.end();
    pool = null;
  }
}

/** Idempotent DDL for `route_labels` (no-op if `DATABASE_URL` unset). */
export async function ensureRouteLabelsTable(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    return;
  }
  const pool = getPool();
  await pool.query(ROUTE_LABELS_INIT_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_CATEGORY_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_LENGTH_CONSTRAINTS_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_SCHEDULE_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_SHORT_CODE_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_SCHEDULE_MODE_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_VEHICLE_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL);
  await pool.query(ROUTE_RATINGS_INIT_SQL);
  await pool.query(ROUTE_SESSIONS_INIT_SQL);
  await pool.query(SEAT_ASSIGNMENTS_INIT_SQL);
  // NOTE: SEAT_ASSIGNMENTS_MIGRATE_UNIQUE_SEAT_SQL used to run here to back-fill
  // a narrow UNIQUE(route_id, seat_number) constraint on pre-bucket databases.
  // It was removed because on any DB that has already been through the bucket
  // migration, the narrow constraint was DROPPED on purpose (per-route uniqueness
  // is now (route_id, service_date, session_id, seat_number)) and legitimate
  // bucket-legal duplicates — e.g. seat E1-1D sold for two different departures —
  // would cause the re-add to crash startup (Postgres 23505). Bucket migration
  // below is self-contained and handles all states.
  await pool.query(SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL);
  await pool.query(SEAT_RESERVATIONS_INIT_SQL);
  await pool.query(SEAT_RESERVATIONS_MIGRATE_HOLDER_SQL);
  await pool.query(SEAT_RESERVATIONS_MIGRATE_BUCKET_SQL);
  await pool.query(TRIPS_INIT_SQL);
  await pool.query(TICKET_TRIPS_INIT_SQL);

  // One-time cleanup: remove any seat_assignments rows whose token was burned
  // on-chain. These accumulate when the indexer processes burns without clearing
  // the seat (fixed in indexer, but historical rows need a one-time purge).
  // ticket_events is owned by the indexer — skip safely if it doesn't exist yet.
  try {
    await pool.query(`
      DELETE FROM seat_assignments
      WHERE token_id IN (
        SELECT DISTINCT token_id FROM ticket_events WHERE event_type = 'burn'
      )
    `);
  } catch {
    // ticket_events table not yet created by the indexer — nothing to clean up
  }

  // One-time cleanup: stale diagnostic rows written during live investigation
  // of the pre-reconcile claim bug. Safe to run every startup — DELETE is a
  // no-op once the row is gone. Remove this block after the first deploy has
  // run if you want to tidy the migration list.
  try {
    await pool.query(
      `DELETE FROM seat_assignments WHERE token_id LIKE 'diag-test-%'`,
    );
  } catch { /* non-fatal */ }
}

