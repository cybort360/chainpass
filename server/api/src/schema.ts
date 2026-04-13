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
