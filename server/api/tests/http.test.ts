import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetPoolForTests } from "../src/lib/db.js";
import { signQrPayload } from "../src/lib/qrSign.js";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      query = queryMock;
      end = vi.fn().mockResolvedValue(undefined);
    },
  },
}));

const app = createApp();

describe("HTTP API", () => {
  beforeEach(() => {
    resetPoolForTests();
    queryMock.mockReset();
    delete process.env.DATABASE_URL;
    delete process.env.QR_SIGNING_SECRET;
    delete process.env.QR_TTL_SECONDS;
    delete process.env.NIGERIA_ROUTES_JSON_PATH;
    delete process.env.NIGERIA_ROUTES_SYNC;
  });

  afterEach(() => {
    resetPoolForTests();
    delete process.env.DATABASE_URL;
    delete process.env.QR_SIGNING_SECRET;
    delete process.env.QR_TTL_SECONDS;
    delete process.env.NIGERIA_ROUTES_JSON_PATH;
    delete process.env.NIGERIA_ROUTES_SYNC;
  });

  describe("GET /health", () => {
    it("returns ok and metadata", async () => {
      const res = await request(app).get("/health").expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.service).toBe("chainpass-api");
      expect(res.body.stack).toBe("express");
      expect(res.body.runtime).toBe("node");
      expect(typeof res.body.shared).toBe("string");
    });
  });

  describe("POST /api/v1/qr/payload", () => {
    it("returns 500 when QR_SIGNING_SECRET is missing", async () => {
      const res = await request(app)
        .post("/api/v1/qr/payload")
        .send({ tokenId: "1", holder: "0x0000000000000000000000000000000000000001" })
        .expect(500);
      expect(res.body.error).toMatch(/QR_SIGNING_SECRET/);
    });

    it("returns signed payload when configured", async () => {
      process.env.QR_SIGNING_SECRET = "test-secret-key";
      const res = await request(app)
        .post("/api/v1/qr/payload")
        .send({
          tokenId: "99",
          holder: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        })
        .expect(200);
      expect(res.body.tokenId).toBe("99");
      expect(res.body.holder).toBe("0x742d35cc6634c0532925a3b844bc454e4438f44e");
      expect(typeof res.body.exp).toBe("number");
      expect(typeof res.body.signature).toBe("string");
      expect(res.body.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns 400 when tokenId or holder is missing", async () => {
      process.env.QR_SIGNING_SECRET = "k";
      const res = await request(app).post("/api/v1/qr/payload").send({ tokenId: "1" }).expect(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it("returns 400 for invalid tokenId", async () => {
      process.env.QR_SIGNING_SECRET = "k";
      const res = await request(app)
        .post("/api/v1/qr/payload")
        .send({ tokenId: "not-a-number", holder: "0x0000000000000000000000000000000000000001" })
        .expect(400);
      expect(res.body.error).toMatch(/tokenId/i);
    });

    it("returns 400 for invalid holder address", async () => {
      process.env.QR_SIGNING_SECRET = "k";
      const res = await request(app)
        .post("/api/v1/qr/payload")
        .send({ tokenId: "1", holder: "0xbad" })
        .expect(400);
      expect(res.body.error).toMatch(/holder/i);
    });

    it("returns 500 when QR_TTL_SECONDS is out of range", async () => {
      process.env.QR_SIGNING_SECRET = "k";
      process.env.QR_TTL_SECONDS = "99999";
      const res = await request(app)
        .post("/api/v1/qr/payload")
        .send({ tokenId: "1", holder: "0x0000000000000000000000000000000000000001" })
        .expect(500);
      expect(res.body.error).toMatch(/QR_TTL_SECONDS/);
    });
  });

  describe("POST /api/v1/qr/verify", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns 500 when QR_SIGNING_SECRET is missing", async () => {
      const res = await request(app)
        .post("/api/v1/qr/verify")
        .send({
          tokenId: "1",
          holder: "0x0000000000000000000000000000000000000001",
          exp: 9999999999,
          signature: "a".repeat(64),
        })
        .expect(500);
      expect(res.body.error).toMatch(/QR_SIGNING_SECRET/);
    });

    it("returns { valid: true } for a payload from signQrPayload", async () => {
      process.env.QR_SIGNING_SECRET = "http-verify-secret";
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
      const p = signQrPayload(
        7n,
        "0x0000000000000000000000000000000000000001",
        "http-verify-secret",
        300,
      );
      const res = await request(app)
        .post("/api/v1/qr/verify")
        .send({
          tokenId: p.tokenId,
          holder: p.holder,
          exp: p.exp,
          signature: p.signature,
        })
        .expect(200);
      expect(res.body).toEqual({ valid: true });
    });

    it("returns { valid: false } when signature is tampered", async () => {
      process.env.QR_SIGNING_SECRET = "http-verify-secret";
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
      const p = signQrPayload(
        7n,
        "0x0000000000000000000000000000000000000001",
        "http-verify-secret",
        300,
      );
      const last = p.signature[p.signature.length - 1];
      const badSig = p.signature.slice(0, -1) + (last === "a" ? "b" : "a");
      const res = await request(app)
        .post("/api/v1/qr/verify")
        .send({
          tokenId: p.tokenId,
          holder: p.holder,
          exp: p.exp,
          signature: badSig,
        })
        .expect(200);
      expect(res.body).toEqual({ valid: false });
    });

    it("returns 400 when required fields are missing", async () => {
      process.env.QR_SIGNING_SECRET = "k";
      const res = await request(app)
        .post("/api/v1/qr/verify")
        .send({ tokenId: "1", holder: "0x0000000000000000000000000000000000000001" })
        .expect(400);
      expect(res.body.error).toMatch(/required/i);
    });
  });

  describe("GET /api/v1/operator/events", () => {
    it("returns 503 when DATABASE_URL is unset", async () => {
      const res = await request(app).get("/api/v1/operator/events").expect(503);
      expect(res.body.error).toMatch(/DATABASE_URL/);
    });

    it("returns events from Postgres", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const row = {
        id: 1,
        event_type: "mint",
        tx_hash: "0x" + "a".repeat(64),
        log_index: 0,
        block_number: "12345",
        block_hash: "0x" + "b".repeat(64),
        contract_address: "0x" + "c".repeat(40),
        token_id: "1",
        route_id: "2",
        valid_until_epoch: "999",
        operator_addr: "0x" + "d".repeat(40),
        from_address: null,
        to_address: "0x" + "e".repeat(40),
        created_at: new Date().toISOString(),
      };
      queryMock.mockResolvedValue({ rows: [row] });

      const res = await request(app).get("/api/v1/operator/events").expect(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].event_type).toBe("mint");
      expect(queryMock).toHaveBeenCalled();
    });

    it("returns 500 when the query fails", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockRejectedValue(new Error("connection refused"));

      const res = await request(app).get("/api/v1/operator/events").expect(500);
      expect(res.body.error).toMatch(/failed/i);
    });
  });

  describe("GET /api/v1/operator/stats", () => {
    it("returns 503 when DATABASE_URL is unset", async () => {
      const res = await request(app).get("/api/v1/operator/stats").expect(503);
      expect(res.body.error).toMatch(/DATABASE_URL/);
    });

    it("returns totals and last-24h counts", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockResolvedValue({
        rows: [
          {
            mints_total: 3,
            burns_total: 1,
            mints_last_24h: 2,
            burns_last_24h: 0,
          },
        ],
      });

      const res = await request(app).get("/api/v1/operator/stats").expect(200);
      expect(res.body.totals).toEqual({ mint: 3, burn: 1 });
      expect(res.body.last24h).toEqual({ mint: 2, burn: 0 });
      expect(queryMock).toHaveBeenCalled();
    });

    it("returns 500 when the query fails", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockRejectedValue(new Error("connection refused"));

      const res = await request(app).get("/api/v1/operator/stats").expect(500);
      expect(res.body.error).toMatch(/failed/i);
    });
  });

  describe("GET /api/v1/routes", () => {
    it("returns 503 when DATABASE_URL is unset", async () => {
      const res = await request(app).get("/api/v1/routes").expect(503);
      expect(res.body.error).toMatch(/DATABASE_URL/);
    });

    it("returns route labels from Postgres", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockResolvedValue({
        rows: [
          { route_id: "1", name: "Route A", detail: "Line 1", category: "North" },
          { route_id: "2", name: "Route B", detail: null, category: "South" },
        ],
      });

      const res = await request(app).get("/api/v1/routes").expect(200);
      expect(res.body.routes).toEqual([
        { routeId: "1", name: "Route A", detail: "Line 1", category: "North" },
        { routeId: "2", name: "Route B", detail: null, category: "South" },
      ]);
      expect(queryMock).toHaveBeenCalled();
    });

    it("returns 200 with empty routes when table is empty", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockResolvedValue({ rows: [] });

      const res = await request(app).get("/api/v1/routes").expect(200);
      expect(res.body.routes).toEqual([]);
    });

    it("returns 500 when the query fails", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockRejectedValue(new Error("connection refused"));

      const res = await request(app).get("/api/v1/routes").expect(500);
      expect(res.body.error).toMatch(/failed/i);
    });
  });

  describe("POST /api/v1/routes", () => {
    it("returns 503 when DATABASE_URL is unset", async () => {
      delete process.env.DATABASE_URL;
      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "1", name: "A", category: "North" })
        .expect(503);
      expect(res.body.error).toMatch(/DATABASE_URL/);
    });

    it("returns 400 for invalid routeId", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "not-a-number", name: "A", category: "North" })
        .expect(400);
      expect(res.body.error).toMatch(/routeId/i);
    });

    it("returns 400 when name is missing", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "42", category: "North" })
        .expect(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it("returns 400 when category is missing", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "42", name: "Line" })
        .expect(400);
      expect(res.body.error).toMatch(/category/i);
    });

    it("inserts a new route_labels row and returns it", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockResolvedValue({ rowCount: 1, rows: [] });

      const res = await request(app)
        .post("/api/v1/routes")
        .send({
          routeId: "7402918472910384729",
          name: "Test BRT",
          detail: "Demo",
          category: "Lagos",
        })
        .expect(200);

      expect(res.body.route).toEqual({
        routeId: "7402918472910384729",
        name: "Test BRT",
        detail: "Demo",
        category: "Lagos",
      });
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO route_labels[\s\S]*VALUES \(\$1, \$2, \$3, \$4\)/),
        ["7402918472910384729", "Test BRT", "Demo", "Lagos"],
      );
    });

    it("returns 409 when route ID already exists", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
      queryMock.mockRejectedValueOnce(dup);

      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "1", name: "A", category: "North" })
        .expect(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it("returns 500 when insert fails", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockRejectedValue(new Error("connection refused"));

      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "1", name: "A", category: "North" })
        .expect(500);
      expect(res.body.error).toMatch(/failed to register route/i);
    });

    it("returns 400 for invalid priceMon", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const res = await request(app)
        .post("/api/v1/routes")
        .send({ routeId: "1", name: "A", category: "North", priceMon: -1 })
        .expect(400);
      expect(res.body.error).toMatch(/priceMon/i);
    });

    it("merges priceMon into nigeria-routes json when path is writable", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      process.env.NIGERIA_ROUTES_SYNC = "1";
      const dir = mkdtempSync(join(tmpdir(), "chainpass-nigeria-routes-"));
      const jsonPath = join(dir, "nigeria-routes.json");
      writeFileSync(
        jsonPath,
        JSON.stringify({
          description: "test",
          network: "monad-testnet",
          routes: [
            {
              routeId: "1",
              category: "X",
              name: "Existing",
              detail: "",
              priceMon: 0.01,
              priceWei: "10000000000000000",
            },
          ],
        }),
        "utf8",
      );
      process.env.NIGERIA_ROUTES_JSON_PATH = jsonPath;
      queryMock.mockResolvedValue({ rowCount: 1, rows: [] });

      const res = await request(app)
        .post("/api/v1/routes")
        .send({
          routeId: "7402918472910384729",
          name: "New BRT",
          detail: "Line",
          category: "Lagos",
          priceMon: 0.075,
        })
        .expect(200);

      expect(res.body.nigeriaRoutesFile).toEqual({ ok: true });
      const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
        routes: Array<{ routeId: string; name: string; priceWei: string; priceMon: number }>;
      };
      expect(doc.routes).toHaveLength(2);
      const added = doc.routes.find((r) => r.routeId === "7402918472910384729");
      expect(added?.name).toBe("New BRT");
      expect(added?.priceMon).toBe(0.075);
      expect(added?.priceWei).toBe("75000000000000000");

      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("GET /api/v1/rider/passes", () => {
    it("returns 400 when holder is missing", async () => {
      const res = await request(app).get("/api/v1/rider/passes").expect(400);
      expect(res.body.error).toMatch(/holder/i);
    });

    it("returns 400 for invalid holder address", async () => {
      const res = await request(app).get("/api/v1/rider/passes?holder=0xbad").expect(400);
      expect(res.body.error).toMatch(/holder/i);
    });

    it("returns 503 when DATABASE_URL is unset", async () => {
      const res = await request(app)
        .get("/api/v1/rider/passes?holder=0x0000000000000000000000000000000000000001")
        .expect(503);
      expect(res.body.error).toMatch(/DATABASE_URL/);
    });

    it("returns active and used rows from Postgres", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const holder = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
      const holderLower = holder.toLowerCase();
      const burnRow = {
        id: 1,
        event_type: "burn",
        tx_hash: "0x" + "a".repeat(64),
        log_index: 1,
        block_number: "100",
        block_hash: "0x" + "b".repeat(64),
        contract_address: "0x" + "c".repeat(40),
        token_id: "3",
        route_id: "1",
        valid_until_epoch: null,
        operator_addr: null,
        from_address: holderLower,
        to_address: null,
        created_at: new Date().toISOString(),
      };
      const mintRow = {
        id: 2,
        event_type: "mint",
        tx_hash: "0x" + "e".repeat(64),
        log_index: 0,
        block_number: "99",
        block_hash: "0x" + "f".repeat(64),
        contract_address: "0x" + "c".repeat(40),
        token_id: "7",
        route_id: "1",
        valid_until_epoch: "2000000000",
        operator_addr: "0x" + "d".repeat(40),
        from_address: null,
        to_address: holderLower,
        created_at: new Date().toISOString(),
      };
      queryMock.mockResolvedValueOnce({ rows: [burnRow] }).mockResolvedValueOnce({ rows: [mintRow] });

      const res = await request(app).get(`/api/v1/rider/passes?holder=${encodeURIComponent(holder)}`).expect(200);
      expect(res.body.holder).toBe(holder);
      expect(res.body.used).toHaveLength(1);
      expect(res.body.used[0].token_id).toBe("3");
      expect(res.body.active).toHaveLength(1);
      expect(res.body.active[0].token_id).toBe("7");
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it("returns 500 when the first query fails", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock.mockRejectedValue(new Error("connection refused"));

      const res = await request(app)
        .get("/api/v1/rider/passes?holder=0x0000000000000000000000000000000000000001")
        .expect(500);
      expect(res.body.error).toMatch(/failed/i);
    });
  });
});

