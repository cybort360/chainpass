/** Run once at startup — idempotent. */
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS ticket_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('mint', 'burn')),
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT,
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  route_id TEXT,
  valid_until_epoch BIGINT,
  operator_addr TEXT,
  from_address TEXT,
  to_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS ticket_events_block_idx ON ticket_events (block_number DESC);

CREATE INDEX IF NOT EXISTS ticket_events_mint_to_lower_idx ON ticket_events (LOWER(to_address))
  WHERE event_type = 'mint';
CREATE INDEX IF NOT EXISTS ticket_events_burn_from_lower_idx ON ticket_events (LOWER(from_address))
  WHERE event_type = 'burn';
CREATE INDEX IF NOT EXISTS ticket_events_burn_token_idx ON ticket_events (token_id)
  WHERE event_type = 'burn';

-- Keep in sync with server/api/src/schema.ts (ROUTE_LABELS_INIT_SQL).
CREATE TABLE IF NOT EXISTS route_labels (
  route_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  detail TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';

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
