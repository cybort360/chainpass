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
  });

  afterEach(() => {
    resetPoolForTests();
    delete process.env.DATABASE_URL;
    delete process.env.QR_SIGNING_SECRET;
    delete process.env.QR_TTL_SECONDS;
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
      // Handler includes schedule/vehicle/coach fields (nullable defaults) and
      // the Phase 1 scheduleMode default. Use objectContaining so the core
      // identity fields are the contract and the nullable extras stay flexible.
      expect(res.body.routes).toEqual([
        expect.objectContaining({
          routeId: "1", name: "Route A", detail: "Line 1", category: "North",
          scheduleMode: "sessions",
        }),
        expect.objectContaining({
          routeId: "2", name: "Route B", detail: null, category: "South",
          scheduleMode: "sessions",
        }),
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

      expect(res.body.route).toEqual(expect.objectContaining({
        routeId: "7402918472910384729",
        name: "Test BRT",
        detail: "Demo",
        category: "Lagos",
      }));
      // INSERT supplies 12 bound parameters (core 5 + vehicle/coach extras, all
      // null when the client omits them). operator_id is NOT bound — it is
      // resolved via a subquery that picks the earliest-created still-active
      // operator, so the 13-column INSERT lines up with 12 placeholders + 1
      // subquery. Pin both the column and the subquery shape so regressions
      // (e.g. silently dropping the subquery, reintroducing a hardcoded slug)
      // show up as failing tests rather than prod 500s.
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO route_labels[\s\S]*operator_id[\s\S]*SELECT id FROM operators WHERE status = 'active' ORDER BY id ASC LIMIT 1/),
        expect.arrayContaining(["7402918472910384729", "Test BRT", "Demo", "Lagos"]),
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

  });

  describe("POST /api/v1/seats/reserve", () => {
    it("returns 400 when routeId or seatNumber is missing", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      const res = await request(app)
        .post("/api/v1/seats/reserve")
        .send({ routeId: "1" })
        .expect(400);
      expect(res.body.error).toMatch(/routeId|seatNumber/);
    });

    it("persists holder_address (lowercased) when a valid 0x address is supplied", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      // routeRow lookup → no capacity row (skips overbooking branch)
      // taken seat lookup → none
      // INSERT seat_reservations → 1 row
      queryMock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // route_labels
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // seat_assignments (taken check)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // INSERT

      const mixedCase = "0xAbCdEfABCDEF1234567890aBcDeF1234567890Ab";
      const res = await request(app)
        .post("/api/v1/seats/reserve")
        .send({ routeId: "42", seatNumber: "E1-1B", holderAddress: mixedCase })
        .expect(200);
      expect(res.body.ok).toBe(true);

      // The INSERT should have been called with the 4th param lowercased.
      const insertCall = queryMock.mock.calls.find((c) =>
        typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[0]).toBe("42");
      expect(params[1]).toBe("E1-1B");
      expect(params[3]).toBe(mixedCase.toLowerCase());
    });

    it("stores holder_address = null when the address is malformed", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await request(app)
        .post("/api/v1/seats/reserve")
        .send({ routeId: "42", seatNumber: "E1-1C", holderAddress: "not-an-address" })
        .expect(200);

      const insertCall = queryMock.mock.calls.find((c) =>
        typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[3]).toBeNull();
    });

    it("stores holder_address = null when the address is omitted entirely (backwards compat)", async () => {
      process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
      queryMock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await request(app)
        .post("/api/v1/seats/reserve")
        .send({ routeId: "42", seatNumber: "E1-1D" })
        .expect(200);

      const insertCall = queryMock.mock.calls.find((c) =>
        typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[3]).toBeNull();
    });

    // ── Per-departure bucket (sessions-mode) ──────────────────────────────
    //
    // Each (route × date × session) is an independent inventory pool. A
    // morning-session 1A and an evening-session 1A do not conflict; a
    // Wednesday 1A and a Thursday 1A do not conflict. The same holds for
    // legacy/flexible-mode rows, which land in the (0, '1970-01-01') sentinel
    // bucket and continue to behave as before.
    describe("per-departure bucket", () => {
      it("persists sessionId + serviceDate on reserve when provided", async () => {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
        queryMock
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await request(app)
          .post("/api/v1/seats/reserve")
          .send({
            routeId: "42",
            seatNumber: "1A",
            sessionId: 7,
            serviceDate: "2026-04-15",
          })
          .expect(200);

        const insertCall = queryMock.mock.calls.find((c) =>
          typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
        );
        expect(insertCall).toBeDefined();
        const params = insertCall![1] as unknown[];
        // Params order in seats.ts reserve: route_id, seat_number, expires_at, holder, service_date, session_id
        expect(params[0]).toBe("42");
        expect(params[1]).toBe("1A");
        expect(params).toContain("2026-04-15");
        expect(params).toContain(7);
      });

      it("falls back to sentinel bucket (session=0, date='1970-01-01') when not provided", async () => {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
        queryMock
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await request(app)
          .post("/api/v1/seats/reserve")
          .send({ routeId: "42", seatNumber: "1A" })
          .expect(200);

        const insertCall = queryMock.mock.calls.find((c) =>
          typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
        );
        expect(insertCall).toBeDefined();
        const params = insertCall![1] as unknown[];
        expect(params).toContain("1970-01-01");
        expect(params).toContain(0);
      });

      it("scopes the 'taken' check to the bucket (same seat different session = not taken)", async () => {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
        queryMock
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // route_labels
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // taken — scoped, empty
          .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // INSERT

        await request(app)
          .post("/api/v1/seats/reserve")
          .send({
            routeId: "42",
            seatNumber: "1A",
            sessionId: 2,
            serviceDate: "2026-04-15",
          })
          .expect(200);

        const takenCall = queryMock.mock.calls.find((c) =>
          typeof c[0] === "string" && /FROM seat_assignments/i.test(c[0]),
        );
        expect(takenCall).toBeDefined();
        // The taken-check query must filter by bucket columns
        expect(takenCall![0]).toMatch(/service_date/);
        expect(takenCall![0]).toMatch(/session_id/);
      });

      it("rejects malformed sessionId / serviceDate by folding to sentinel", async () => {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chainpass";
        queryMock
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await request(app)
          .post("/api/v1/seats/reserve")
          .send({
            routeId: "42",
            seatNumber: "1A",
            sessionId: "not-a-number",
            serviceDate: "not-a-date",
          })
          .expect(200);

        const insertCall = queryMock.mock.calls.find((c) =>
          typeof c[0] === "string" && /INSERT INTO seat_reservations/.test(c[0]),
        );
        const params = insertCall![1] as unknown[];
        expect(params).toContain("1970-01-01");
        expect(params).toContain(0);
      });
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

  describe("GET /api/v1/operators", () => {
    it("returns empty list when DATABASE_URL is unset", async () => {
      const res = await request(app).get("/api/v1/operators").expect(200);
      expect(res.body).toEqual({ operators: [] });
    });

    it("returns operators from the DB, newest first, suspended excluded", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            slug: "abc-transport",
            name: "ABC Transport",
            admin_wallet: "0x0000000000000000000000000000000000000002",
            treasury_wallet: null,
            status: "active",
            logo_url: null,
            created_at: new Date("2026-04-01T00:00:00Z"),
          },
          {
            id: 1,
            slug: "chainpass-transit",
            name: "ChainPass Transit",
            admin_wallet: null,
            treasury_wallet: null,
            status: "active",
            logo_url: null,
            created_at: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        rowCount: 2,
      });

      const res = await request(app).get("/api/v1/operators").expect(200);
      expect(res.body.operators).toHaveLength(2);
      expect(res.body.operators[0]).toMatchObject({
        id: 2,
        slug: "abc-transport",
        name: "ABC Transport",
        adminWallet: "0x0000000000000000000000000000000000000002",
        treasuryWallet: null,
        status: "active",
        logoUrl: null,
      });
      expect(res.body.operators[0].createdAt).toBe("2026-04-01T00:00:00.000Z");
      expect(res.body.operators[0]).not.toHaveProperty("contactEmail");
      expect(res.body.operators[1].slug).toBe("chainpass-transit");

      // Sanity: the SQL actually filters suspended rows and orders newest-first.
      // Without these pins, the "newest first" assertion above would only prove
      // that the mock was constructed in the expected order, not that the router
      // requested that order from Postgres.
      const sql = queryMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/status\s*<>\s*'suspended'/);
      expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC/i);
    });

    it("returns generic 500 + logs tag when the DB errors", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      queryMock.mockRejectedValueOnce(new Error("sensitive connection detail"));

      const res = await request(app).get("/api/v1/operators").expect(500);
      expect(res.body).toEqual({ error: "failed to read operators" });
      // Never leak the underlying error message in the response
      expect(JSON.stringify(res.body)).not.toContain("sensitive connection detail");
      // But it must reach the server log with the [operators] tag
      expect(errSpy).toHaveBeenCalledWith("[operators]", expect.any(Error));

      errSpy.mockRestore();
    });
  });

  describe("GET /api/v1/operators/:slug", () => {
    it("returns 400 on a malformed slug", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      const res = await request(app)
        .get("/api/v1/operators/NOT_A_SLUG")
        .expect(400);
      expect(res.body.error).toBe("invalid slug");
    });

    it("returns 404 when DATABASE_URL is unset", async () => {
      const res = await request(app)
        .get("/api/v1/operators/chainpass-transit")
        .expect(404);
      expect(res.body.error).toBe("not found");
    });

    it("returns 404 when the slug does not match any operator", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await request(app)
        .get("/api/v1/operators/does-not-exist")
        .expect(404);
      expect(res.body.error).toBe("not found");
    });

    it("returns the matching operator", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            slug: "chainpass-transit",
            name: "ChainPass Transit",
            admin_wallet: null,
            treasury_wallet: null,
            status: "active",
            logo_url: null,
            created_at: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        rowCount: 1,
      });
      const res = await request(app)
        .get("/api/v1/operators/chainpass-transit")
        .expect(200);
      expect(res.body.operator).toMatchObject({
        id: 1,
        slug: "chainpass-transit",
        name: "ChainPass Transit",
        status: "active",
      });
      expect(res.body.operator).not.toHaveProperty("contactEmail");
    });

    it("returns generic 500 + logs tag on DB error", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      queryMock.mockRejectedValueOnce(new Error("some db error"));

      const res = await request(app)
        .get("/api/v1/operators/chainpass-transit")
        .expect(500);
      expect(res.body).toEqual({ error: "failed to read operator" });
      expect(errSpy).toHaveBeenCalledWith("[operators]", expect.any(Error));

      errSpy.mockRestore();
    });
  });

  // Named "wiring" rather than "idempotency" because with a fully-mocked pg.Pool
  // we can't actually prove DB-level idempotency; we can only prove the function
  // issues the expected SQL fragments and doesn't throw on repeated calls. True
  // idempotency is asserted at the SQL level (IF NOT EXISTS / DO $$ / ON CONFLICT
  // DO NOTHING) and verified against a live DB by the deployment pipeline.
  describe("ensureRouteLabelsTable operators wiring", () => {
    it("issues the operators DDL on repeated boots without throwing (mocked)", async () => {
      const { ensureRouteLabelsTable } = await import("../src/lib/db.js");
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

      await ensureRouteLabelsTable();
      await ensureRouteLabelsTable();

      const sqlCalls = queryMock.mock.calls.map((c) => String(c[0]));
      expect(sqlCalls.some((s) => /CREATE TABLE IF NOT EXISTS operators/i.test(s))).toBe(true);
      expect(
        sqlCalls.some(
          (s) =>
            /INSERT INTO operators[\s\S]*chainpass-transit[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/i.test(
              s,
            ),
        ),
      ).toBe(true);
      expect(
        sqlCalls.some((s) =>
          /ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS operator_id/i.test(s),
        ),
      ).toBe(true);
    });

    it("issues the marketplace fields migration (region/description/website_url)", async () => {
      const { ensureRouteLabelsTable } = await import("../src/lib/db.js");
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

      await ensureRouteLabelsTable();

      const sqlCalls = queryMock.mock.calls.map((c) => String(c[0]));
      // All three ADD COLUMN IF NOT EXISTS fragments land
      expect(
        sqlCalls.some((s) =>
          /ALTER TABLE operators ADD COLUMN IF NOT EXISTS region\b/i.test(s),
        ),
      ).toBe(true);
      expect(
        sqlCalls.some((s) =>
          /ALTER TABLE operators ADD COLUMN IF NOT EXISTS description\b/i.test(s),
        ),
      ).toBe(true);
      expect(
        sqlCalls.some((s) =>
          /ALTER TABLE operators ADD COLUMN IF NOT EXISTS website_url\b/i.test(s),
        ),
      ).toBe(true);
      // Length / format CHECK constraints are emitted (duplicate_object-guarded)
      expect(sqlCalls.some((s) => /operators_region_len/.test(s))).toBe(true);
      expect(sqlCalls.some((s) => /operators_description_len/.test(s))).toBe(true);
      expect(sqlCalls.some((s) => /operators_website_url_fmt/.test(s))).toBe(true);
    });
  });
});

