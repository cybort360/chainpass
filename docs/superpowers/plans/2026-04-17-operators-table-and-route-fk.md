# Operators Table + Route FK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `operators` table, attach every existing `route_labels` row to a default "ChainPass Transit" operator via a non-null `operator_id` FK, and expose two public read endpoints so the client can list operators.

**Architecture:** Additive, idempotent DDL in the existing `server/api/src/schema.ts` + `server/api/src/lib/db.ts` style (CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DO/EXCEPTION guards). Backfill runs inline as part of `ensureRouteLabelsTable()` so every boot converges to the correct state. New Express router `createOperatorsRouter()` mounted at `/api/v1` (matching existing public-read routers).

**Tech Stack:** Node 20, TypeScript, Express, `pg`, vitest + supertest.

---

## Scope

**In scope (this plan):**
- `operators` table DDL
- `route_labels.operator_id` FK: nullable → seed default operator → backfill → NOT NULL
- `GET /api/v1/operators` (public list)
- `GET /api/v1/operators/:slug` (public detail)
- Tests for migration idempotency + both endpoints

**Out of scope — separate follow-up plans:**
- `operator_id` on `route_sessions`, `trips`, `ticket_events`, `seat_assignments`, `role_events`. All of these can resolve their operator via `JOIN route_labels ON route_id` today. Denormalize only when a query proves the join is too expensive.
- API middleware that scopes writes by the caller's operator (Phase 1 step 4 — requires an auth primitive that doesn't exist yet).
- Operator-picker UI (Phase 1 step 6).
- KYB / approval queue, treasury withdrawals, operator signup flow.

**Tables the roadmap mentions but this plan skips:**
- `burners` — no standalone table exists; burners live in `role_events` as `kind='role_granted'` rows with `role_hash = keccak256("BURNER_ROLE")`. Scoping is inherited through the contract address, not a per-row `operator_id`, until we go multi-contract.
- `schedules` / `mints` — these are `route_sessions`/`trips` and `ticket_events`. Same reasoning as above.

---

## File Structure

**Modify:**
- `server/api/src/schema.ts` — add `OPERATORS_INIT_SQL`, `OPERATORS_SEED_DEFAULT_SQL`, `ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL`.
- `server/api/src/lib/db.ts` — call the three new SQL blocks in `ensureRouteLabelsTable()`, in the correct order (operators table → seed default → add route_labels.operator_id → backfill → NOT NULL + FK).
- `server/api/src/app.ts` — register `createOperatorsRouter()` at `/api/v1`.
- `server/api/tests/http.test.ts` — add endpoint tests.

**Create:**
- `server/api/src/routes/operators.ts` — `createOperatorsRouter()` with `GET /operators` and `GET /operators/:slug`.

**Not touched (deliberately):**
- `server/indexer/src/schema.ts` — indexer's `INIT_SQL` does not own `route_labels` writes; it only creates an empty shell so it can insert mint/burn rows. Leaving it alone is safe because the API boot path always reconciles `route_labels` via `ensureRouteLabelsTable()`. If we later add `operator_id` to `ticket_events` we'll mirror it there.

---

## Data model

```sql
CREATE TABLE operators (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE
                    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 1 AND 40),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  admin_wallet    TEXT CHECK (admin_wallet IS NULL OR admin_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  treasury_wallet TEXT CHECK (treasury_wallet IS NULL OR treasury_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('pending', 'active', 'suspended')),
  logo_url        TEXT CHECK (logo_url IS NULL OR char_length(logo_url) <= 500),
  contact_email   TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Default seed row:** `slug='chainpass-transit'`, `name='ChainPass Transit'`, `status='active'`, everything else NULL. Inserted via `ON CONFLICT (slug) DO NOTHING` so every boot is a no-op after the first.

**`route_labels.operator_id`:** nullable INTEGER → backfill to default operator's id → ALTER NOT NULL + add FK (ON DELETE RESTRICT — deleting an operator must not orphan routes).

---

## Task Breakdown

---

### Task 1: Add `operators` table DDL

**Files:**
- Modify: `server/api/src/schema.ts` (append after `ROUTE_SESSIONS_INIT_SQL`)

- [ ] **Step 1: Write the schema constant**

Append to `server/api/src/schema.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add server/api/src/schema.ts
git commit -m "feat(api): add operators table schema + default seed SQL"
```

---

### Task 2: Add `operator_id` column, backfill, then lock NOT NULL + FK

**Files:**
- Modify: `server/api/src/schema.ts` (append after the Task 1 blocks)

- [ ] **Step 1: Write the migration constant**

Append to `server/api/src/schema.ts`:

```typescript
/**
 * Attach every route_labels row to an operator.
 *
 * Runs in three phases inside one SQL block so partial-failure states converge
 * on re-run:
 *   1. ADD COLUMN IF NOT EXISTS operator_id INTEGER (nullable on first run).
 *   2. UPDATE rows where operator_id IS NULL to the default operator's id
 *      (resolved by slug lookup — the serial id isn't knowable ahead of time).
 *   3. ALTER COLUMN NOT NULL + ADD CONSTRAINT FK operator_id REFERENCES
 *      operators(id), both guarded so re-runs are no-ops.
 *
 * Depends on OPERATORS_INIT_SQL + OPERATORS_SEED_DEFAULT_SQL having run first.
 *
 * ON DELETE RESTRICT: we never want to accidentally orphan routes by deleting
 * an operator row. Soft-delete (status='suspended') is the correct move.
 */
export const ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL = `
ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS operator_id INTEGER;

UPDATE route_labels
SET operator_id = (SELECT id FROM operators WHERE slug = 'chainpass-transit')
WHERE operator_id IS NULL;

DO $$
BEGIN
  -- Set NOT NULL only if every row is populated. If a row slipped through as
  -- NULL (shouldn't happen because the UPDATE above covers everything, but
  -- defensive) this raises 23502 and we'll see it in startup logs rather than
  -- silently continuing.
  IF NOT EXISTS (SELECT 1 FROM route_labels WHERE operator_id IS NULL) THEN
    BEGIN
      ALTER TABLE route_labels ALTER COLUMN operator_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  BEGIN
    ALTER TABLE route_labels ADD CONSTRAINT route_labels_operator_id_fk
      FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_labels_operator_id ON route_labels(operator_id);
`;
```

- [ ] **Step 2: Commit**

```bash
git add server/api/src/schema.ts
git commit -m "feat(api): add route_labels.operator_id migration (nullable → backfill → NOT NULL FK)"
```

---

### Task 3: Wire the new SQL into `ensureRouteLabelsTable()`

**Files:**
- Modify: `server/api/src/lib/db.ts`

- [ ] **Step 1: Add imports**

At the top of `server/api/src/lib/db.ts`, add to the existing import block from `../schema.js`:

```typescript
import {
  // ...existing imports...
  OPERATORS_INIT_SQL,
  OPERATORS_SEED_DEFAULT_SQL,
  ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL,
} from "../schema.js";
```

- [ ] **Step 2: Run the new blocks in `ensureRouteLabelsTable()`**

Inside `ensureRouteLabelsTable()`, immediately after `await pool.query(ROUTE_LABELS_INIT_SQL);` and before `ROUTE_LABELS_MIGRATE_CATEGORY_SQL`, insert:

```typescript
  // Multi-tenant foundation: operators table must exist and be seeded before
  // route_labels.operator_id is back-filled. Order matters:
  //   1. CREATE TABLE operators + constraints
  //   2. INSERT default operator (idempotent)
  //   3. ADD operator_id to route_labels + backfill + NOT NULL + FK
  await pool.query(OPERATORS_INIT_SQL);
  await pool.query(OPERATORS_SEED_DEFAULT_SQL);
```

Then, **after** the existing `ROUTE_LABELS_MIGRATE_COACH_CLASSES_SQL` line (the last `route_labels` migration), insert:

```typescript
  // Depends on all prior route_labels migrations and operators being seeded.
  await pool.query(ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL);
```

- [ ] **Step 3: Run the API and verify migrations apply cleanly**

Run locally (requires `DATABASE_URL` to a local or test Postgres):

```bash
cd server/api
pnpm build
DATABASE_URL=$DATABASE_URL node dist/index.js &
sleep 3
kill %1
```

Expected: no errors in startup log, service prints its usual boot banner.

- [ ] **Step 4: Verify schema in Postgres**

```bash
psql "$DATABASE_URL" -c "\d operators"
psql "$DATABASE_URL" -c "\d route_labels" | grep operator_id
psql "$DATABASE_URL" -c "SELECT id, slug, name, status FROM operators;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM route_labels WHERE operator_id IS NULL;"
```

Expected:
- `operators` table has all columns + constraints listed.
- `route_labels` has `operator_id integer not null`.
- One row in `operators`: `(1, 'chainpass-transit', 'ChainPass Transit', 'active')`.
- Zero `route_labels` rows with NULL operator_id.

- [ ] **Step 5: Commit**

```bash
git add server/api/src/lib/db.ts
git commit -m "feat(api): run operators + route_labels.operator_id migrations on boot"
```

---

### Task 4: Create `createOperatorsRouter()`

**Files:**
- Create: `server/api/src/routes/operators.ts`

- [ ] **Step 1: Write the router**

Create `server/api/src/routes/operators.ts`:

```typescript
import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * Public operator directory.
 *
 * GET /operators        — list all non-suspended operators, newest first.
 * GET /operators/:slug  — single operator by slug; 404 if not found or suspended.
 *
 * Both endpoints are public read — no auth. Private fields (contact_email,
 * admin_wallet) are intentionally included because they're part of the trust
 * signal the rider sees ("is this operator real?"). Revisit if we later add
 * private-only fields.
 */
type OperatorRow = {
  id: number;
  slug: string;
  name: string;
  admin_wallet: string | null;
  treasury_wallet: string | null;
  status: string;
  logo_url: string | null;
  contact_email: string | null;
  created_at: Date;
};

function toResponse(row: OperatorRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adminWallet: row.admin_wallet,
    treasuryWallet: row.treasury_wallet,
    status: row.status,
    logoUrl: row.logo_url,
    contactEmail: row.contact_email,
    createdAt: row.created_at.toISOString(),
  };
}

export function createOperatorsRouter(): Router {
  const r = Router();

  r.get("/operators", async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.json({ operators: [] });
      return;
    }
    try {
      const { rows } = await getPool().query<OperatorRow>(
        `SELECT id, slug, name, admin_wallet, treasury_wallet, status,
                logo_url, contact_email, created_at
         FROM operators
         WHERE status <> 'suspended'
         ORDER BY created_at DESC, id DESC`,
      );
      res.json({ operators: rows.map(toResponse) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "db error" });
    }
  });

  r.get("/operators/:slug", async (req, res) => {
    const slug = String(req.params.slug ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 40) {
      res.status(400).json({ error: "invalid slug" });
      return;
    }
    if (!process.env.DATABASE_URL) {
      res.status(404).json({ error: "not found" });
      return;
    }
    try {
      const { rows } = await getPool().query<OperatorRow>(
        `SELECT id, slug, name, admin_wallet, treasury_wallet, status,
                logo_url, contact_email, created_at
         FROM operators
         WHERE slug = $1 AND status <> 'suspended'
         LIMIT 1`,
        [slug],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ operator: toResponse(rows[0]!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "db error" });
    }
  });

  return r;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/api/src/routes/operators.ts
git commit -m "feat(api): add public operators directory endpoints"
```

---

### Task 5: Register the router in `app.ts`

**Files:**
- Modify: `server/api/src/app.ts`

- [ ] **Step 1: Import the factory**

Add to the block of imports at the top, keeping alphabetical order with the neighbours:

```typescript
import { createOperatorsRouter } from "./routes/operators.js";
```

- [ ] **Step 2: Mount the router**

After `app.use("/api/v1", createRoutesRouter());` (public-read neighbourhood), add:

```typescript
  app.use("/api/v1", createOperatorsRouter());
```

- [ ] **Step 3: Smoke-test both endpoints against a running API**

```bash
cd server/api
pnpm build
DATABASE_URL=$DATABASE_URL node dist/index.js &
sleep 3
curl -s http://localhost:3001/api/v1/operators | jq .
curl -s http://localhost:3001/api/v1/operators/chainpass-transit | jq .
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/v1/operators/does-not-exist
kill %1
```

Expected:
- First: `{"operators":[{"id":1,"slug":"chainpass-transit",...}]}`
- Second: `{"operator":{"id":1,"slug":"chainpass-transit",...}}`
- Third: `404`

Adjust port if `server/api/src/config.ts` uses something other than 3001.

- [ ] **Step 4: Commit**

```bash
git add server/api/src/app.ts
git commit -m "feat(api): mount operators router at /api/v1"
```

---

### Task 6: Tests — operators endpoints

**Files:**
- Modify: `server/api/tests/http.test.ts`

The existing suite mocks `pg.Pool` so the test never hits a real DB — `queryMock` returns whatever you configure. Follow that exact pattern.

- [ ] **Step 1: Add the test block**

Append inside the top-level `describe("HTTP API", ...)`, after the existing blocks:

```typescript
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
            contact_email: "ops@abc.ng",
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
            contact_email: null,
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
        status: "active",
        contactEmail: "ops@abc.ng",
      });
      expect(res.body.operators[0].createdAt).toBe("2026-04-01T00:00:00.000Z");
      expect(res.body.operators[1].slug).toBe("chainpass-transit");

      // Sanity: the SQL actually filters suspended rows.
      const sql = queryMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/status\s*<>\s*'suspended'/);
    });

    it("returns 500 when the DB errors", async () => {
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).get("/api/v1/operators").expect(500);
      expect(res.body.error).toBe("boom");
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
            contact_email: null,
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
    });
  });
```

- [ ] **Step 2: Run the tests**

```bash
cd server/api
pnpm vitest run tests/http.test.ts
```

Expected: all existing tests green + 7 new tests green (empty list, list-happy, list-error, 400 malformed, 404 no-db, 404 not-found, happy-detail).

- [ ] **Step 3: Run the full test suite to catch regressions**

```bash
cd server/api
pnpm vitest run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/api/tests/http.test.ts
git commit -m "test(api): cover public operators endpoints"
```

---

### Task 7: Migration idempotency test

This catches the class of bug where a second boot crashes because a constraint or column already exists — the pattern we already defend against with DO/EXCEPTION guards, but which we should prove holds.

**Files:**
- Modify: `server/api/tests/http.test.ts`

- [ ] **Step 1: Add the idempotency test**

Append inside `describe("HTTP API", ...)`:

```typescript
  describe("ensureRouteLabelsTable idempotency", () => {
    it("runs the new operators DDL each boot without error (mocked)", async () => {
      // Import lazily because the function is not exported from app.ts.
      const { ensureRouteLabelsTable } = await import("../src/lib/db.js");
      process.env.DATABASE_URL = "postgres://fake";
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

      await ensureRouteLabelsTable();
      await ensureRouteLabelsTable();

      const sqlCalls = queryMock.mock.calls.map((c) => String(c[0]));
      // OPERATORS_INIT_SQL
      expect(sqlCalls.some((s) => /CREATE TABLE IF NOT EXISTS operators/i.test(s))).toBe(true);
      // Default seed — must be ON CONFLICT DO NOTHING so re-runs are safe.
      expect(
        sqlCalls.some(
          (s) =>
            /INSERT INTO operators[\s\S]*chainpass-transit[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/i.test(
              s,
            ),
        ),
      ).toBe(true);
      // route_labels.operator_id
      expect(
        sqlCalls.some((s) =>
          /ALTER TABLE route_labels ADD COLUMN IF NOT EXISTS operator_id/i.test(s),
        ),
      ).toBe(true);
    });
  });
```

- [ ] **Step 2: Run it**

```bash
cd server/api
pnpm vitest run tests/http.test.ts -t "ensureRouteLabelsTable"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/api/tests/http.test.ts
git commit -m "test(api): verify operators migrations run and are idempotent"
```

---

### Task 8: Document the migration in `docs/PHASE_0.md` notes (optional)

Skip this task unless the PHASE_0 / roadmap docs are where the team tracks what's shipped. If they are, add a one-line entry under Phase 1 saying "operators table + default backfill landed <date>, commit <sha>."

- [ ] **Step 1: Check whether docs/PHASE_0.md tracks shipped milestones**

```bash
cat docs/PHASE_0.md
```

- [ ] **Step 2: If yes, append a one-liner. If no, skip and end the plan.**

---

## Verification checklist (run after the whole plan is applied)

- [ ] `pnpm vitest run` in `server/api` — all green
- [ ] Fresh DB (drop + recreate) boots cleanly with one idempotent migration pass
- [ ] Production DB boots cleanly — existing `route_labels` rows end up attached to operator id 1
- [ ] `curl /api/v1/operators` returns exactly one operator (`chainpass-transit`)
- [ ] `curl /api/v1/operators/chainpass-transit` returns 200 with the seed row
- [ ] `curl /api/v1/operators/does-not-exist` returns 404
- [ ] `psql` — `SELECT COUNT(*) FROM route_labels WHERE operator_id IS NULL` returns 0
- [ ] `psql` — trying to `DELETE FROM operators WHERE id=1` fails with FK violation (proves ON DELETE RESTRICT is wired)

---

## Rollback

If the migration misbehaves in production (should not happen — everything is idempotent and additive — but worst case):

```sql
-- Safe to run; does not lose data, only removes the FK + NOT NULL + column.
ALTER TABLE route_labels DROP CONSTRAINT IF EXISTS route_labels_operator_id_fk;
ALTER TABLE route_labels ALTER COLUMN operator_id DROP NOT NULL;
-- Only drop the column if you are sure nothing else reads it yet.
-- ALTER TABLE route_labels DROP COLUMN IF EXISTS operator_id;
-- DROP TABLE IF EXISTS operators;
```

Do NOT drop `operators` or the column without double-checking that no deploy in flight depends on them.

---

## Post-implementation deltas (2026-04-17)

The shipped code diverges from this plan in two small, deliberate ways — recorded here so the plan is not read as current truth:

1. **`contact_email` is NOT returned by the public API.** The plan's Task 4/5 suggested exposing `contact_email` on `GET /operators` and `GET /operators/:slug`. During spec-compliance review it was flagged as a phishing-harvest target on an unauthenticated endpoint. The column still exists in the `operators` table (seeded NULL for `chainpass-transit`), but the router SELECTs and `toResponse()` omit it. If we ever want public contact, add an opt-in column and a separate endpoint — don't flip the default.

2. **500 error bodies are generic, no `err.message`.** The plan's sample handlers passed `err.message` back in the JSON body. That diverges from every other router in `server/api/src/routes/*` and leaks DB internals (table/column names, SQLSTATE). Final shape: body is `{ error: "failed to read operators" }` / `{ error: "failed to read operator" }`, and the raw error is logged via `console.error("[operators]", err)`. Tests pin both halves of that contract.

3. **Commit `883e3cc` briefly had a swallow-SET-NOT-NULL bug.** The initial version of `ROUTE_LABELS_MIGRATE_OPERATOR_ID_SQL` wrapped `ALTER ... SET NOT NULL` in an `EXCEPTION WHEN others THEN NULL` block, which would have silently hidden real 23502 / lock-timeout errors. Fixed in `e152807` before any deploy. If you are cherry-picking or bisecting, skip or squash commits ≤ `883e3cc`.
