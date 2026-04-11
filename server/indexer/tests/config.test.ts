import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getIndexerConfig } from "../src/config.js";

const KEYS = [
  "RPC_URL",
  "DATABASE_URL",
  "TICKET_CONTRACT_ADDRESS",
  "INDEXER_FROM_BLOCK",
  "INDEXER_POLL_MS",
  "INDEXER_BLOCK_CHUNK",
] as const;

describe("getIndexerConfig", () => {
  const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = snapshot[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("uses defaults when optional vars are unset", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.TICKET_CONTRACT_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    const c = getIndexerConfig();
    expect(c.rpcUrl).toBe("https://testnet-rpc.monad.xyz");
    expect(c.fromBlock).toBe(0n);
    expect(c.pollMs).toBe(4000);
    expect(c.blockChunk).toBe(100n);
  });

  it("parses INDEXER_FROM_BLOCK, POLL_MS, and BLOCK_CHUNK", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.TICKET_CONTRACT_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    process.env.RPC_URL = "https://custom-rpc.example";
    process.env.INDEXER_FROM_BLOCK = "1000";
    process.env.INDEXER_POLL_MS = "8000";
    process.env.INDEXER_BLOCK_CHUNK = "2000";
    const c = getIndexerConfig();
    expect(c.rpcUrl).toBe("https://custom-rpc.example");
    expect(c.fromBlock).toBe(1000n);
    expect(c.pollMs).toBe(8000);
    /** Monad public RPC max log range — values above 100 are capped */
    expect(c.blockChunk).toBe(100n);
  });

  it("allows INDEXER_BLOCK_CHUNK below the Monad public cap", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.TICKET_CONTRACT_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    process.env.INDEXER_BLOCK_CHUNK = "50";
    const c = getIndexerConfig();
    expect(c.blockChunk).toBe(50n);
  });

  it("falls back fromBlock to 0 when INDEXER_FROM_BLOCK is invalid", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.TICKET_CONTRACT_ADDRESS =
      "0x3333333333333333333333333333333333333333";
    process.env.INDEXER_FROM_BLOCK = "not-a-number";
    const c = getIndexerConfig();
    expect(c.fromBlock).toBe(0n);
  });

  it("clamps pollMs to 4000 when below 500", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    process.env.TICKET_CONTRACT_ADDRESS =
      "0x4444444444444444444444444444444444444444";
    process.env.INDEXER_POLL_MS = "100";
    const c = getIndexerConfig();
    expect(c.pollMs).toBe(4000);
  });

  it("returns undefined ticketContractAddress when missing or invalid", () => {
    process.env.DATABASE_URL = "postgresql://localhost/db";
    delete process.env.TICKET_CONTRACT_ADDRESS;
    expect(getIndexerConfig().ticketContractAddress).toBeUndefined();

    process.env.TICKET_CONTRACT_ADDRESS = "0xbad";
    expect(getIndexerConfig().ticketContractAddress).toBeUndefined();
  });
});

