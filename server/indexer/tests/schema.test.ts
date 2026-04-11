import { describe, it, expect } from "vitest";
import { INIT_SQL } from "../src/schema.js";

describe("INIT_SQL", () => {
  it("creates ticket_events with expected columns and uniqueness", () => {
    expect(INIT_SQL).toContain("CREATE TABLE IF NOT EXISTS ticket_events");
    expect(INIT_SQL).toContain("event_type");
    expect(INIT_SQL).toContain("UNIQUE (tx_hash, log_index)");
    expect(INIT_SQL).toContain("ticket_events_block_idx");
    expect(INIT_SQL).toContain("ticket_events_mint_to_lower_idx");
    expect(INIT_SQL).toContain("CREATE TABLE IF NOT EXISTS route_labels");
    expect(INIT_SQL).toContain("route_id TEXT PRIMARY KEY");
    expect(INIT_SQL).toContain("category");
  });
});

