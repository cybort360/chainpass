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
 * Short code — 1-8 uppercase alphanumeric chars chosen by the operator at
 * registration time (e.g. "LAGIB", "ABJKD", "XPS"). Used as a glanceable
 * badge on pass cards and route listings so passengers can identify a
 * route at a distance without parsing the full decimal route ID. Nullable:
 * legacy routes that predate this column still render fine.
 */
export const ROUTE_LABELS_MIGRATE_SHORT_CODE_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS short_code TEXT;
DO $$
BEGIN
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_short_code_fmt
      CHECK (short_code IS NULL OR short_code ~ '^[A-Z0-9]{1,8}$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
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

/**
 * Permanent seat assignments — one row per minted ticket.
 *
 * Uniqueness is per (route_id, service_date, session_id, seat_number) so the
 * same seat number (e.g. "E1-1A") can be sold independently for the Monday
 * morning run and the Monday evening run — and for next Wednesday — without
 * collisions. Legacy rows predating bucketing land on a sentinel bucket
 * (service_date='1970-01-01', session_id=0) where each route's seat_number
 * is still globally unique, preserving old behaviour.
 */
export const SEAT_ASSIGNMENTS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS seat_assignments (
  id SERIAL PRIMARY KEY,
  route_id TEXT NOT NULL,
  token_id TEXT NOT NULL UNIQUE,
  seat_number TEXT NOT NULL,
  session_id INTEGER NOT NULL DEFAULT 0,
  service_date DATE NOT NULL DEFAULT '1970-01-01',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id, service_date, session_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seat_assignments_route_id ON seat_assignments(route_id);
-- The bucket index is deliberately NOT created here. On an existing production
-- DB the CREATE TABLE IF NOT EXISTS above is a no-op, so service_date /
-- session_id don't exist yet — an index referencing them would fail with
-- "column does not exist" (Postgres 42703). The bucket index is created in
-- SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL, which runs right after the ADD COLUMN
-- step and is the correct home for any DDL that depends on bucket columns.
`;

// NOTE: SEAT_ASSIGNMENTS_MIGRATE_UNIQUE_SEAT_SQL lived here and back-filled the
// narrow UNIQUE(route_id, seat_number) constraint on pre-bucket databases. It
// was removed because SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL below supersedes it
// and, on any DB that has already run the bucket migration, re-adding the
// narrow constraint would reject legitimate bucket-legal duplicates (same seat
// sold for two different (service_date, session_id) departures) and crash
// startup with 23505. The bucket migration is self-contained and covers all
// DB states (fresh / pre-bucket / post-bucket), so the narrow migration is no
// longer needed anywhere in the pipeline.

/**
 * Phase 1.5 — session/date bucketing for seat_assignments.
 *
 * Introduces `session_id` + `service_date` (NOT NULL, sentinel defaults) so a
 * seat number is unique per (route, date, session) rather than per route. This
 * fixes the bug where buying seat 1A on Wednesday-morning was making seat 1A
 * on Wednesday-evening (and Monday-morning, etc.) appear taken.
 *
 * Migration order:
 *   1. Add the columns (cheap — they default to sentinel values).
 *   2. Drop the old (route_id, seat_number) unique constraint if present.
 *   3. Add the new (route_id, service_date, session_id, seat_number) unique.
 *
 * Idempotent — every DDL uses IF NOT EXISTS / EXCEPTION guards. Old rows keep
 * working because they land in the sentinel bucket (1970-01-01 / session=0),
 * which still enforces per-route seat uniqueness for legacy data.
 */
export const SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL = `
ALTER TABLE seat_assignments ADD COLUMN IF NOT EXISTS session_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seat_assignments ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT '1970-01-01';
DO $$
BEGIN
  BEGIN
    ALTER TABLE seat_assignments DROP CONSTRAINT seat_assignments_route_id_seat_number_key;
  EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN
    ALTER TABLE seat_assignments ADD CONSTRAINT seat_assignments_bucket_key
      UNIQUE (route_id, service_date, session_id, seat_number);
  -- Postgres reports a pre-existing constraint-backed index as
  -- duplicate_table (42P07), not duplicate_object (42710). Catch both so
  -- the migration is truly idempotent across partial-failure states.
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END;
END $$;
CREATE INDEX IF NOT EXISTS idx_seat_assignments_bucket
  ON seat_assignments(route_id, service_date, session_id);
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
  holder_address TEXT,
  session_id INTEGER NOT NULL DEFAULT 0,
  service_date DATE NOT NULL DEFAULT '1970-01-01',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(route_id, service_date, session_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seat_reservations_route_id ON seat_reservations(route_id);
-- The holder_address and bucket indexes are deliberately NOT created here.
-- On an existing DB the CREATE TABLE IF NOT EXISTS above is a no-op, so
-- neither column is guaranteed to exist yet. Any index referencing them
-- would blow up with "column does not exist" (Postgres 42703) before the
-- corresponding MIGRATE step has had a chance to ADD COLUMN. Those indexes
-- live in SEAT_RESERVATIONS_MIGRATE_HOLDER_SQL and _BUCKET_SQL respectively,
-- each created right after its ADD COLUMN.
`;

/**
 * Back-fill holder_address on older DBs created before the column existed.
 * The column is nullable so rows predating this migration remain valid; they
 * simply can't be auto-reconciled by the indexer (which is fine — they've
 * long since expired anyway).
 */
export const SEAT_RESERVATIONS_MIGRATE_HOLDER_SQL = `
ALTER TABLE seat_reservations ADD COLUMN IF NOT EXISTS holder_address TEXT;
CREATE INDEX IF NOT EXISTS idx_seat_reservations_holder ON seat_reservations(route_id, LOWER(holder_address))
  WHERE holder_address IS NOT NULL;
`;

/**
 * Phase 1.5 — session/date bucketing for seat_reservations.
 *
 * Mirrors SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL so a held seat is scoped to the
 * same (route, service_date, session) bucket as the eventual assignment. That
 * lets the indexer's auto-claim path match reservation → assignment by token's
 * `to` address AND its intended bucket.
 *
 * Old DBs had `UNIQUE(route_id, seat_number)` — drop that and replace with
 * the bucketed key. Reserve/release/claim queries are updated in lockstep
 * (seats.ts) to target the new unique constraint.
 */
export const SEAT_RESERVATIONS_MIGRATE_BUCKET_SQL = `
ALTER TABLE seat_reservations ADD COLUMN IF NOT EXISTS session_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seat_reservations ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT '1970-01-01';
DO $$
BEGIN
  BEGIN
    ALTER TABLE seat_reservations DROP CONSTRAINT seat_reservations_route_id_seat_number_key;
  EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN
    ALTER TABLE seat_reservations ADD CONSTRAINT seat_reservations_bucket_key
      UNIQUE (route_id, service_date, session_id, seat_number);
  -- See SEAT_ASSIGNMENTS_MIGRATE_BUCKET_SQL — Postgres raises 42P07
  -- (duplicate_table) when the backing index name is already taken.
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END;
END $$;
CREATE INDEX IF NOT EXISTS idx_seat_reservations_bucket
  ON seat_reservations(route_id, service_date, session_id);
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

/**
 * Phase 1 — Schedule mode + weekly session templates.
 *
 * `schedule_mode` controls which booking flow the passenger sees:
 *   'sessions'  — recurring weekly timetable driven by route_sessions (default,
 *                 covers current long-haul train routes)
 *   'flexible'  — continuous service within operating_start/operating_end,
 *                 one trip ticket valid within the window (Phase 2)
 *
 * Both columns are nullable with sane defaults so existing rows stay valid
 * without a backfill. The flexible window fields are ignored when mode is
 * 'sessions'.
 */
export const ROUTE_LABELS_MIGRATE_SCHEDULE_MODE_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'sessions';
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS operating_start TEXT;
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS operating_end   TEXT;
DO $$
BEGIN
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_schedule_mode_check
      CHECK (schedule_mode IN ('sessions','flexible'));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_operating_start_fmt
      CHECK (operating_start IS NULL OR operating_start ~ '^[0-2][0-9]:[0-5][0-9]$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_operating_end_fmt
      CHECK (operating_end IS NULL OR operating_end ~ '^[0-2][0-9]:[0-5][0-9]$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
`;

/**
 * Weekly session template. Each row is one recurring session on one weekday.
 *
 *   day_of_week: 0 = Monday ... 6 = Sunday (not Postgres EXTRACT dow — we map
 *     explicitly to keep the client code unambiguous).
 *   name: operator-chosen label ("Morning", "Afternoon", "Express", etc.)
 *   departure_time / arrival_time: 'HH:MM' 24-hour local time. We do not store
 *     a timezone — routes are regional; the display layer renders in the
 *     route's implied timezone.
 *
 * UNIQUE(route_id, day_of_week, name) prevents two "Morning" rows on the same
 * day. Operators who want two morning slots name them distinctly ("Morning A",
 * "Morning B"), which is also how real-world rail timetables handle it.
 */
export const ROUTE_SESSIONS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS route_sessions (
  id             SERIAL PRIMARY KEY,
  route_id       TEXT    NOT NULL,
  day_of_week    INT     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  name           TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  departure_time TEXT    NOT NULL CHECK (departure_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  arrival_time   TEXT    NOT NULL CHECK (arrival_time   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, day_of_week, name)
);
CREATE INDEX IF NOT EXISTS idx_route_sessions_route_id ON route_sessions(route_id);
`;

/**
 * Phase 1 — multi-tenant foundation.
 *
 * Represents one transit operator on the marketplace (ABC Transport, GIGM, etc.).
 * The first row is a default "ChainPass Transit" operator that every pre-existing
 * route_labels row is retrofitted onto (see OPERATORS_SEED_DEFAULT_SQL and
 * ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL).
 *
 * slug: URL-safe identifier chosen at signup. Lowercase alphanumeric + dashes,
 *   1-40 chars. Public endpoints key on slug, not id, so operator URLs are
 *   stable across DB reseeds.
 * admin_wallet / treasury_wallet: nullable for the seed row (ChainPass Transit
 *   predates the wallet-on-signup flow). Required for operators created via
 *   the onboarding endpoint (enforced in application code, not DB, so the seed
 *   row can exist without a wallet).
 * status: pending (awaiting KYB) / active (visible + mintable) / suspended
 *   (hidden + mint disabled). Seed row starts 'active'.
 */
export const OPERATORS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS operators (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  admin_wallet    TEXT,
  treasury_wallet TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  logo_url        TEXT,
  contact_email   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CHECK constraints added separately with DO/EXCEPTION guards so re-runs on a
-- partially-migrated DB (column exists but constraint doesn't) don't crash.
DO $$
BEGIN
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_slug_fmt
      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 1 AND 40);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_name_len
      CHECK (char_length(name) BETWEEN 1 AND 100);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_admin_wallet_fmt
      CHECK (admin_wallet IS NULL OR admin_wallet ~ '^0x[0-9a-fA-F]{40}$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_treasury_wallet_fmt
      CHECK (treasury_wallet IS NULL OR treasury_wallet ~ '^0x[0-9a-fA-F]{40}$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_status_check
      CHECK (status IN ('pending', 'active', 'suspended'));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_logo_url_len
      CHECK (logo_url IS NULL OR char_length(logo_url) <= 500);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_contact_email_len
      CHECK (contact_email IS NULL OR char_length(contact_email) <= 200);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_operators_status ON operators(status);
`;

/**
 * Idempotent seed of the default operator. Every existing route_labels row is
 * attached to this operator by ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL. If the
 * row already exists, ON CONFLICT makes this a no-op.
 */
export const OPERATORS_SEED_DEFAULT_SQL = `
INSERT INTO operators (slug, name, status)
VALUES ('chainpass-transit', 'ChainPass Transit', 'active')
ON CONFLICT (slug) DO NOTHING;
`;
