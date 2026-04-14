/**
 * Keep DDL in sync with `server/indexer/src/schema.ts` (`ROUTE_LABELS_INIT_SQL` block).
 */
/** Full uint256 route IDs as decimal strings (on-chain uint256; BIGINT is too small). */
export const ROUTE_LABELS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS route_labels (
  route_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) <= 100),
  detail TEXT CHECK (detail IS NULL OR char_length(detail) <= 200),
  category TEXT NOT NULL DEFAULT 'General' CHECK (char_length(category) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/** For DBs created before `category` existed — safe to run every seed / startup. */
export const ROUTE_LABELS_MIGRATE_CATEGORY_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';
`;

/** Add CHECK length constraints to existing route_labels rows (idempotent via exception handler). */
export const ROUTE_LABELS_MIGRATE_LENGTH_CONSTRAINTS_SQL = `
DO $$
BEGIN
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_name_len CHECK (char_length(name) <= 100);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_detail_len CHECK (detail IS NULL OR char_length(detail) <= 200);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_category_len CHECK (char_length(category) <= 60);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
`;

/** Older DBs used BIGINT for route_id; migrate once to TEXT for full uint256. */
export const ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'route_labels'
      AND column_name = 'route_id'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE route_labels ALTER COLUMN route_id TYPE TEXT USING route_id::text;
  END IF;
END $$;
`;

/** Add schedule text field to route_labels (idempotent). */
export const ROUTE_LABELS_MIGRATE_SCHEDULE_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS schedule TEXT CHECK (schedule IS NULL OR char_length(schedule) <= 120);
`;

/**
 * Vehicle type + seat configuration columns (idempotent).
 *
 * vehicle_type: 'train' | 'bus' | 'light_rail'
 * is_interstate: true for cross-state routes
 * coaches / seats_per_coach: train layout (total capacity = coaches × seats_per_coach)
 * total_seats: bus seat count
 *
 * Derived rule enforced by the application (not a DB constraint to keep migrations simple):
 *   has_classes = vehicle_type = 'train' AND is_interstate = true
 */
export const ROUTE_LABELS_MIGRATE_VEHICLE_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS vehicle_type TEXT;
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS is_interstate BOOLEAN;
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS coaches INTEGER;
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS seats_per_coach INTEGER;
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS total_seats INTEGER;
`;

/**
 * Per-class coach configuration for trains (idempotent).
 *
 * coach_classes: JSONB array of { class, count, rows, leftCols, rightCols }
 *   class    : "first" | "business" | "economy"
 *   count    : number of coaches of this class
 *   rows     : seat rows per coach
 *   leftCols : seats left of the aisle (1-4)
 *   rightCols: seats right of the aisle (1-4)
 *
 * Replaces the flat coaches/seats_per_coach columns for new routes.
 * Old routes without coach_classes fall back to the coaches+seats_per_coach layout.
 */
export const ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS coach_classes JSONB;
`;

export const ROUTE_RATINGS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS route_ratings (
  id SERIAL PRIMARY KEY,
  token_id TEXT NOT NULL UNIQUE,
  route_id TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_ratings_route_id ON route_ratings(route_id);
`;

export const SEAT_ASSIGNMENTS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS seat_assignments (
  id SERIAL PRIMARY KEY,
  route_id TEXT NOT NULL,
  token_id TEXT NOT NULL UNIQUE,
  seat_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seat_assignments_route_id ON seat_assignments(route_id);
`;

/**
 * Back-fills the (route_id, seat_number) uniqueness guarantee on older databases
 * that were created before the constraint was added to SEAT_ASSIGNMENTS_INIT_SQL.
 * Safe to run repeatedly — skips if the constraint already exists.
 */
export const SEAT_ASSIGNMENTS_MIGRATE_UNIQUE_SEAT_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'seat_assignments'::regclass
      AND contype = 'u'
      AND conname = 'seat_assignments_route_id_seat_number_key'
  ) THEN
    ALTER TABLE seat_assignments ADD CONSTRAINT seat_assignments_route_id_seat_number_key UNIQUE(route_id, seat_number);
  END IF;
END $$;
`;

/**
 * Temporary seat holds — created when a passenger selects a seat, expire after 10 minutes.
 * Makes the seat appear "taken" to all other users while payment is in progress.
 * Confirmed into seat_assignments on successful mint; expired rows ignored automatically.
 */
export const SEAT_RESERVATIONS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS seat_reservations (
  id SERIAL PRIMARY KEY,
  route_id TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seat_reservations_route_id ON seat_reservations(route_id);
`;

/**
 * Scheduled departures for a route.
 *
 * status:
 *   scheduled — future, not yet open for boarding
 *   boarding  — gate open, conductor scanning tickets
 *   departed  — in transit, no new boarding
 *   arrived   — journey complete
 *   cancelled — trip will not run
 */
export const TRIPS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS trips (
  id          SERIAL PRIMARY KEY,
  route_id    TEXT        NOT NULL,
  departure_at TIMESTAMPTZ NOT NULL,
  arrival_at   TIMESTAMPTZ NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','boarding','departed','arrived','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trips_route_id     ON trips(route_id);
CREATE INDEX IF NOT EXISTS idx_trips_departure_at ON trips(departure_at);
`;

/**
 * Links a minted token to the specific trip it was purchased for.
 * Written after successful mint (same pattern as seat_assignments).
 */
export const TICKET_TRIPS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS ticket_trips (
  id         SERIAL PRIMARY KEY,
  token_id   TEXT    NOT NULL UNIQUE,
  trip_id    INTEGER NOT NULL,
  route_id   TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_trips_trip_id ON ticket_trips(trip_id);
`;
