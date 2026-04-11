/**
 * Keep DDL in sync with `server/indexer/src/schema.ts` (`ROUTE_LABELS_INIT_SQL` block).
 */
/** Full uint256 route IDs as decimal strings (on-chain uint256; BIGINT is too small). */
export const ROUTE_LABELS_INIT_SQL = `
CREATE TABLE IF NOT EXISTS route_labels (
  route_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  detail TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/** For DBs created before `category` existed — safe to run every seed / startup. */
export const ROUTE_LABELS_MIGRATE_CATEGORY_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';
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
