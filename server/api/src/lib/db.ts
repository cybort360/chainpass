import pg from "pg";
import {
  ROUTE_LABELS_INIT_SQL,
  ROUTE_LABELS_MIGRATE_CATEGORY_SQL,
  ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL,
  ROUTE_LABELS_MIGRATE_LENGTH_CONSTRAINTS_SQL,
  ROUTE_LABELS_MIGRATE_SCHEDULE_SQL,
  ROUTE_LABELS_MIGRATE_VEHICLE_SQL,
  ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL,
  ROUTE_RATINGS_INIT_SQL,
  SEAT_ASSIGNMENTS_INIT_SQL,
  SEAT_RESERVATIONS_INIT_SQL,
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
  await pool.query(ROUTE_LABELS_MIGRATE_VEHICLE_SQL);
  await pool.query(ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL);
  await pool.query(ROUTE_RATINGS_INIT_SQL);
  await pool.query(SEAT_ASSIGNMENTS_INIT_SQL);
  await pool.query(SEAT_RESERVATIONS_INIT_SQL);
}

