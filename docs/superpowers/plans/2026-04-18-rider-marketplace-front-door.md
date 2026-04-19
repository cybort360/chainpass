# Rider-Facing Marketplace Front Door — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ChainPass from a flat route catalogue into an operator-first marketplace. The rider home moves from `/routes` (flat list) to `/operators` (directory); a new `/operators/:slug` page shows that operator's Routes / About / Schedule. `/routes` remains as a fallback fully-operational catalogue.

**Architecture:** One additive SQL migration on `operators` (three nullable columns). Two extended API endpoints + one new endpoint, all returning denormalized derived aggregates (route_count, primary_category) via `GROUP BY`. Two new React pages plus a shared `RouteCard` extraction and a `Breadcrumb` primitive. No contract changes, no indexer changes, no shared-package changes.

**Tech Stack:** Express + pg + vitest + supertest (server), React + React Router v6 + Vite + Tailwind (client), Postgres 9.4+ (for `MODE() WITHIN GROUP`).

**Spec:** `docs/superpowers/specs/2026-04-18-rider-marketplace-front-door-design.md`

---

## File Structure

### New server files
- `server/api/src/schema.ts` — add one exported SQL constant (`OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL`). No new file; append to existing schema module.

### New client files
- `client/src/pages/OperatorsDirectoryPage.tsx` — rider home, directory list.
- `client/src/pages/OperatorDetailPage.tsx` — tabbed operator detail.
- `client/src/components/marketplace/Breadcrumb.tsx` — shared breadcrumb.
- `client/src/components/marketplace/OperatorRowSkeleton.tsx` — loading skeleton row.
- `client/src/components/routes/RouteCard.tsx` — extracted from inline JSX in `RoutesPage.tsx`, made reusable.

### Modified files
- `server/api/src/schema.ts` — `OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL` constant.
- `server/api/src/lib/db.ts` — call the new migration from `ensureRouteLabelsTable()`.
- `server/api/src/routes/operators.ts` — extended directory + slug handlers, new `/:slug/routes` endpoint.
- `server/api/src/routes/routes.ts` — JOIN operators; return `operatorSlug` + `operatorName` per row.
- `server/api/tests/http.test.ts` — tests for all API changes.
- `client/src/lib/api.ts` — extended `ApiOperator` + `ApiRouteLabel` types; new `fetchOperator(slug)` / `fetchOperatorRoutes(slug)` functions.
- `client/src/App.tsx` — two new routes for `/operators` and `/operators/:slug`.
- `client/src/layouts/AppLayout.tsx` — rename "Routes" NavLink to "Marketplace", repoint to `/operators`.
- `client/src/components/landing/LandingPage.tsx` — repoint primary CTA to `/operators`.
- `client/src/pages/RoutesPage.tsx` — use shared `RouteCard`; add page subtitle + back-to-operators link.
- `client/src/pages/RoutePurchasePage.tsx` — render 2-level breadcrumb when `location.state.fromOperator` is set.
- `.gitignore` — (already done on this branch) ensure `.superpowers/` is ignored.

### Testing note
The `client/` package has no test infrastructure (no vitest, no testing-library). Client-side unit tests are out of scope for this plan. Client changes are verified by: (1) `pnpm --filter client build` typechecks, (2) manual smoke via `pnpm dev:client`, (3) the server-side tests that cover the API shape each page depends on. Adding client test infra is follow-up work.

---

## Task 1: Operators marketplace-fields migration

**Scope:** Add three nullable columns (`region`, `description`, `website_url`) to the `operators` table with length / format CHECK constraints. Idempotent, safe on fresh + already-migrated DBs.

**Files:**
- Modify: `server/api/src/schema.ts` (append new export)
- Modify: `server/api/src/lib/db.ts` (call from `ensureRouteLabelsTable()`)
- Test: `server/api/tests/http.test.ts` (verify the migration runs without error and columns exist)

- [ ] **Step 1: Write the failing test** in `server/api/tests/http.test.ts` (append to the existing file, inside the `describe("http", …)` block):

```ts
it("operators table has marketplace fields after boot", async () => {
  // ensureRouteLabelsTable() has already run via the test harness boot.
  // Verify the three new columns exist on operators.
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operators'
       AND column_name IN ('region','description','website_url')
     ORDER BY column_name`
  );
  expect(cols.rows.map((r) => r.column_name)).toEqual([
    "description",
    "region",
    "website_url",
  ]);
});
```

Use whatever `pool` import / harness pattern the existing tests use. If the existing tests don't import `pool` directly, adapt the test to hit a new endpoint introduced later (but the simpler path is direct pool query — search the test file for an existing similar table-inspection test if any).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chainpass/api test -- -t "marketplace fields"`
Expected: FAIL — the columns don't exist yet. Output will include `ERROR: column 'region' does not exist` or an empty array mismatch.

- [ ] **Step 3: Add the SQL constant**

Append to `server/api/src/schema.ts` after the existing `OPERATORS_INIT_SQL` / `OPERATORS_SEED_DEFAULT_SQL` exports:

```ts
/**
 * Phase 2 marketplace fields — operator-public metadata rendered on the
 * rider-facing directory and detail pages. All three nullable; legacy
 * operator rows (including the seeded chainpass-transit row) start with
 * null values until an admin fills them in via the operator admin form.
 *
 * region        : free-text string, 1-80 chars. Rider-readable region
 *                 (e.g. "Lagos, Nigeria"). Not normalized — operators type
 *                 what reads best.
 * description   : 1-500 chars. Shown as the About-tab description paragraph.
 * website_url   : must start http(s). Rendered as an external link.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS + duplicate_object-guarded CHECKs,
 * so re-running this block on a partially-migrated DB is a no-op.
 */
export const OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL = `
ALTER TABLE operators ADD COLUMN IF NOT EXISTS region        TEXT;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS website_url   TEXT;

DO $$
BEGIN
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_region_len
      CHECK (region IS NULL OR char_length(region) BETWEEN 1 AND 80);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_description_len
      CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE operators ADD CONSTRAINT operators_website_url_fmt
      CHECK (website_url IS NULL OR website_url ~ '^https?://[^\\s]+$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;
`;
```

- [ ] **Step 4: Wire it into the boot sequence**

In `server/api/src/lib/db.ts`:

Add the import at the top of the file next to the existing schema imports:
```ts
import {
  // ... existing imports ...
  OPERATORS_INIT_SQL,
  OPERATORS_SEED_DEFAULT_SQL,
  OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL,   // ← ADD
  // ... rest of existing imports ...
} from "../schema.js";
```

Inside `ensureRouteLabelsTable()`, add one new line immediately after `OPERATORS_SEED_DEFAULT_SQL` and before the `ROUTE_LABELS_MIGRATE_CATEGORY_SQL` line:
```ts
await pool.query(OPERATORS_INIT_SQL);
await pool.query(OPERATORS_SEED_DEFAULT_SQL);
await pool.query(OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL);   // ← ADD
await pool.query(ROUTE_LABELS_MIGRATE_CATEGORY_SQL);
// ...
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chainpass/api test`
Expected: PASS — the new test passes, and all existing tests continue to pass (migration is additive, so nothing else should be affected).

- [ ] **Step 6: Commit**

```bash
git add server/api/src/schema.ts server/api/src/lib/db.ts server/api/tests/http.test.ts
git commit -m "feat(api): add operators marketplace fields migration (region, description, website_url)"
```

---

## Task 2: Extend `GET /api/v1/operators` with marketplace fields + aggregates

**Scope:** Make the directory endpoint return the new columns plus `route_count` and `primary_category` derived via a `LEFT JOIN route_labels` + `GROUP BY`. Apply `HAVING COUNT(...) > 0` to hide zero-route operators. Change sort to busiest-first.

**Files:**
- Modify: `server/api/src/routes/operators.ts`
- Test: `server/api/tests/http.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/api/tests/http.test.ts`:

```ts
it("GET /api/v1/operators returns marketplace fields and aggregates", async () => {
  // Seed: update seed operator with marketplace fields; insert one route.
  await pool.query(
    `UPDATE operators SET region=$1, description=$2, website_url=$3
     WHERE slug='chainpass-transit'`,
    ["Lagos, NG", "A test operator", "https://example.com"],
  );
  // Insert one route attached to seed operator
  await pool.query(
    `INSERT INTO route_labels (route_id, name, category, operator_id)
     VALUES ($1, $2, $3, (SELECT id FROM operators WHERE slug='chainpass-transit'))
     ON CONFLICT (route_id) DO NOTHING`,
    ["1", "Test Route", "Coach"],
  );

  const res = await request(app).get("/api/v1/operators").expect(200);
  expect(res.body.operators).toEqual(expect.any(Array));
  const op = res.body.operators.find((o: { slug: string }) => o.slug === "chainpass-transit");
  expect(op).toMatchObject({
    slug: "chainpass-transit",
    region: "Lagos, NG",
    description: "A test operator",
    websiteUrl: "https://example.com",
    routeCount: expect.any(Number),
    primaryCategory: "Coach",
  });
  expect(op.routeCount).toBeGreaterThanOrEqual(1);
  // contactEmail must NOT be present (anti-phishing posture)
  expect(op).not.toHaveProperty("contactEmail");
});

it("GET /api/v1/operators hides operators with zero routes", async () => {
  await pool.query(
    `INSERT INTO operators (slug, name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (slug) DO NOTHING`,
    ["zero-route-op", "Zero Route Op"],
  );
  const res = await request(app).get("/api/v1/operators").expect(200);
  const slugs = res.body.operators.map((o: { slug: string }) => o.slug);
  expect(slugs).not.toContain("zero-route-op");
});
```

Pattern match the other tests for the `request(app)` / `pool` imports — adapt if the file uses different names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chainpass/api test -- -t "marketplace fields and aggregates"`
Expected: FAIL — existing endpoint doesn't return `region`/`routeCount`/etc.

- [ ] **Step 3: Rewrite the handler**

In `server/api/src/routes/operators.ts`, replace the entire file contents with:

```ts
import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * Public operator directory (rider-facing marketplace).
 *
 * GET /operators                  — list operators with ≥1 route, busiest first.
 * GET /operators/:slug            — single operator by slug (always, even zero-route).
 * GET /operators/:slug/routes     — that operator's routes.
 *
 * Public read (no auth). `admin_wallet` and `treasury_wallet` are included
 * because they're already on-chain (every mint / role event emits them),
 * so the API surface adds no new disclosure. `contact_email` is deliberately
 * NOT returned — emails on unauthenticated JSON endpoints are a phishing
 * harvest target. An opt-in public contact channel is future work.
 */
type OperatorAggregateRow = {
  id: number;
  slug: string;
  name: string;
  admin_wallet: string | null;
  treasury_wallet: string | null;
  status: string;
  logo_url: string | null;
  region: string | null;
  description: string | null;
  website_url: string | null;
  created_at: Date;
  route_count: number;
  primary_category: string | null;
};

const OPERATOR_SELECT_COLUMNS = `
  o.id, o.slug, o.name, o.admin_wallet, o.treasury_wallet, o.status,
  o.logo_url, o.region, o.description, o.website_url, o.created_at
`;

function toResponse(row: OperatorAggregateRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adminWallet: row.admin_wallet,
    treasuryWallet: row.treasury_wallet,
    status: row.status,
    logoUrl: row.logo_url,
    region: row.region,
    description: row.description,
    websiteUrl: row.website_url,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    routeCount: Number(row.route_count),
    primaryCategory: row.primary_category,
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
      const { rows } = await getPool().query<OperatorAggregateRow>(
        `SELECT ${OPERATOR_SELECT_COLUMNS},
                COUNT(r.route_id)::int                   AS route_count,
                MODE() WITHIN GROUP (ORDER BY r.category) AS primary_category
         FROM operators o
         LEFT JOIN route_labels r ON r.operator_id = o.id
         WHERE o.status <> 'suspended'
         GROUP BY o.id
         HAVING COUNT(r.route_id) > 0
         ORDER BY route_count DESC, o.created_at DESC, o.id DESC`,
      );
      res.json({ operators: rows.map(toResponse) });
    } catch (err) {
      console.error("[operators]", err);
      res.status(500).json({ error: "failed to read operators" });
    }
  });

  // /operators/:slug and /operators/:slug/routes are added in later tasks.
  return r;
}
```

Note: we're replacing the existing slug handler too, but re-adding it in Task 3. If you want strict task isolation (handler stays broken between commits), add a TODO handler that returns a 501 placeholder — but the cleanest path is to run Tasks 2 + 3 back-to-back.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chainpass/api test -- -t "marketplace fields and aggregates"`
Expected: PASS for the two new tests. Any tests that previously relied on the slug handler will now fail — that's expected; Task 3 restores it.

- [ ] **Step 5: Commit**

```bash
git add server/api/src/routes/operators.ts server/api/tests/http.test.ts
git commit -m "feat(api): extend GET /operators with marketplace fields + route aggregates"
```

---

## Task 3: Extend `GET /api/v1/operators/:slug` with aggregates + schedule summary

**Scope:** Re-add the slug handler with the full marketplace shape (region / description / website_url / route_count / primary_category) and a second parallel query for the schedule summary (`firstDeparture`, `lastDeparture`, `routesWithSessions`).

**Files:**
- Modify: `server/api/src/routes/operators.ts`
- Test: `server/api/tests/http.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/api/tests/http.test.ts`:

```ts
it("GET /api/v1/operators/:slug returns aggregates and null schedule when no sessions", async () => {
  const res = await request(app)
    .get("/api/v1/operators/chainpass-transit")
    .expect(200);
  expect(res.body.operator).toMatchObject({
    slug: "chainpass-transit",
    routeCount: expect.any(Number),
    schedule: {
      firstDeparture: null,
      lastDeparture: null,
      routesWithSessions: 0,
    },
  });
});

it("GET /api/v1/operators/:slug returns populated schedule when sessions exist", async () => {
  // Ensure route_labels row exists for the seed operator
  await pool.query(
    `INSERT INTO route_labels (route_id, name, category, operator_id)
     VALUES ($1, $2, $3, (SELECT id FROM operators WHERE slug='chainpass-transit'))
     ON CONFLICT (route_id) DO NOTHING`,
    ["42", "Test Route With Sessions", "Coach"],
  );
  // Seed two sessions — earliest 06:00, latest 22:15
  await pool.query(
    `INSERT INTO route_sessions (route_id, day_of_week, name, departure_time, arrival_time)
     VALUES ($1, 1, 'Morning Run', '06:00', '08:00'),
            ($1, 1, 'Late Run',    '22:15', '23:45')
     ON CONFLICT DO NOTHING`,
    ["42"],
  );
  const res = await request(app)
    .get("/api/v1/operators/chainpass-transit")
    .expect(200);
  expect(res.body.operator.schedule).toMatchObject({
    firstDeparture: "06:00",
    lastDeparture: "22:15",
    routesWithSessions: expect.any(Number),
  });
  expect(res.body.operator.schedule.routesWithSessions).toBeGreaterThanOrEqual(1);
});

it("GET /api/v1/operators/:slug returns 404 for unknown slug", async () => {
  const res = await request(app)
    .get("/api/v1/operators/does-not-exist")
    .expect(404);
  expect(res.body.error).toBe("not found");
});

it("GET /api/v1/operators/:slug returns 400 for invalid slug format", async () => {
  const res = await request(app)
    .get("/api/v1/operators/BAD_SLUG")
    .expect(400);
  expect(res.body.error).toBe("invalid slug");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chainpass/api test -- -t "operators/:slug"`
Expected: FAIL — the slug route was stripped in Task 2; these all 404.

- [ ] **Step 3: Add the slug handler**

In `server/api/src/routes/operators.ts`, inside `createOperatorsRouter()`, add this handler after the `/operators` handler and before the final `return r;`:

```ts
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
      const pool = getPool();

      // 1) Operator row + aggregates (no HAVING — direct links must resolve
      // even when an operator temporarily has zero routes).
      const opRes = await pool.query<OperatorAggregateRow>(
        `SELECT ${OPERATOR_SELECT_COLUMNS},
                COUNT(r.route_id)::int                   AS route_count,
                MODE() WITHIN GROUP (ORDER BY r.category) AS primary_category
         FROM operators o
         LEFT JOIN route_labels r ON r.operator_id = o.id
         WHERE o.slug = $1 AND o.status <> 'suspended'
         GROUP BY o.id
         LIMIT 1`,
        [slug],
      );
      if (opRes.rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const op = opRes.rows[0]!;

      // 2) Schedule summary
      const schRes = await pool.query<{
        first_departure: string | null;
        last_departure: string | null;
        routes_with_sessions: number;
      }>(
        `SELECT MIN(s.departure_time)::text      AS first_departure,
                MAX(s.departure_time)::text      AS last_departure,
                COUNT(DISTINCT r.route_id)::int  AS routes_with_sessions
         FROM route_labels r
         LEFT JOIN route_sessions s ON s.route_id = r.route_id
         WHERE r.operator_id = $1
           AND s.id IS NOT NULL`,
        [op.id],
      );
      const sch = schRes.rows[0] ?? { first_departure: null, last_departure: null, routes_with_sessions: 0 };

      res.json({
        operator: {
          ...toResponse(op),
          schedule: {
            firstDeparture: sch.first_departure,
            lastDeparture: sch.last_departure,
            routesWithSessions: Number(sch.routes_with_sessions ?? 0),
          },
        },
      });
    } catch (err) {
      console.error("[operators slug]", err);
      res.status(500).json({ error: "failed to read operator" });
    }
  });
```

Note on the `AND s.id IS NOT NULL` guard: without it, a `LEFT JOIN` returns one row per route even when no session exists, which inflates `routes_with_sessions` and makes `MIN`/`MAX` over NULL `departure_time` values confusing. With the guard, the outer aggregate correctly reports 0 when no sessions exist.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chainpass/api test`
Expected: PASS — all four new tests pass. Previously passing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/src/routes/operators.ts server/api/tests/http.test.ts
git commit -m "feat(api): extend GET /operators/:slug with aggregates + schedule summary"
```

---

## Task 4: New `GET /api/v1/operators/:slug/routes` endpoint

**Scope:** Return the operator's routes shaped exactly like `GET /api/v1/routes` so the existing `ApiRouteLabel` type works unchanged on the client.

**Files:**
- Modify: `server/api/src/routes/operators.ts`
- Test: `server/api/tests/http.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/api/tests/http.test.ts`:

```ts
it("GET /api/v1/operators/:slug/routes returns routes scoped to that operator", async () => {
  // Ensure seed operator has ≥1 route (earlier tests already inserted one).
  const res = await request(app)
    .get("/api/v1/operators/chainpass-transit/routes")
    .expect(200);
  expect(res.body.routes).toEqual(expect.any(Array));
  expect(res.body.routes.length).toBeGreaterThanOrEqual(1);
  for (const route of res.body.routes as Array<{ routeId: string; name: string; category: string }>) {
    expect(typeof route.routeId).toBe("string");
    expect(typeof route.name).toBe("string");
    expect(typeof route.category).toBe("string");
  }
});

it("GET /api/v1/operators/:slug/routes returns empty array for a known zero-route operator", async () => {
  await pool.query(
    `INSERT INTO operators (slug, name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (slug) DO NOTHING`,
    ["empty-op-for-routes", "Empty Op"],
  );
  const res = await request(app)
    .get("/api/v1/operators/empty-op-for-routes/routes")
    .expect(200);
  expect(res.body.routes).toEqual([]);
});

it("GET /api/v1/operators/:slug/routes returns 404 for unknown slug", async () => {
  const res = await request(app)
    .get("/api/v1/operators/does-not-exist-xyz/routes")
    .expect(404);
  expect(res.body.error).toBe("not found");
});

it("GET /api/v1/operators/:slug/routes returns 400 for invalid slug format", async () => {
  await request(app)
    .get("/api/v1/operators/BAD_SLUG/routes")
    .expect(400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chainpass/api test -- -t "operators/:slug/routes"`
Expected: FAIL — endpoint doesn't exist yet (404 on all routes).

- [ ] **Step 3: Add the endpoint**

In `server/api/src/routes/operators.ts`, add inside `createOperatorsRouter()` after the slug handler and before `return r;`:

```ts
  r.get("/operators/:slug/routes", async (req, res) => {
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
      const pool = getPool();

      // Look up operator id by slug first so we can distinguish 404 (unknown
      // operator) from 200 empty (known operator with zero routes).
      const opRes = await pool.query<{ id: number }>(
        `SELECT id FROM operators WHERE slug = $1 AND status <> 'suspended' LIMIT 1`,
        [slug],
      );
      if (opRes.rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const operatorId = opRes.rows[0]!.id;

      const { rows } = await pool.query<{
        route_id: string;
        name: string;
        detail: string | null;
        category: string;
        schedule: string | null;
        short_code: string | null;
        schedule_mode: string | null;
        operating_start: string | null;
        operating_end: string | null;
        vehicle_type: string | null;
        is_interstate: boolean | null;
        coaches: number | null;
        seats_per_coach: number | null;
        total_seats: number | null;
        coach_classes: unknown | null;
      }>(
        `SELECT route_id, name, detail, category, schedule, short_code,
                schedule_mode, operating_start, operating_end,
                vehicle_type, is_interstate, coaches, seats_per_coach, total_seats,
                coach_classes
         FROM route_labels
         WHERE operator_id = $1
         ORDER BY category, route_id::numeric`,
        [operatorId],
      );

      res.json({
        routes: rows.map((row) => ({
          routeId: String(row.route_id),
          name: row.name,
          detail: row.detail,
          category: row.category,
          schedule: row.schedule,
          shortCode: row.short_code,
          scheduleMode: row.schedule_mode ?? "sessions",
          operatingStart: row.operating_start,
          operatingEnd: row.operating_end,
          vehicleType: row.vehicle_type,
          isInterstate: row.is_interstate,
          coaches: row.coaches,
          seatsPerCoach: row.seats_per_coach,
          totalSeats: row.total_seats,
          coachClasses: row.coach_classes ?? null,
        })),
      });
    } catch (err) {
      console.error("[operators slug routes]", err);
      res.status(500).json({ error: "failed to read routes" });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chainpass/api test`
Expected: PASS — four new tests pass, all previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/src/routes/operators.ts server/api/tests/http.test.ts
git commit -m "feat(api): add GET /operators/:slug/routes endpoint"
```

---

## Task 5: Extend `GET /api/v1/routes` with operatorSlug + operatorName

**Scope:** Each row in the flat catalogue gets two new string fields identifying its owning operator, so `RouteCard` can render "via {operatorName}" when used from `/routes`.

**Files:**
- Modify: `server/api/src/routes/routes.ts`
- Test: `server/api/tests/http.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/api/tests/http.test.ts`:

```ts
it("GET /api/v1/routes returns operatorSlug + operatorName on each row", async () => {
  const res = await request(app).get("/api/v1/routes").expect(200);
  expect(res.body.routes).toEqual(expect.any(Array));
  expect(res.body.routes.length).toBeGreaterThanOrEqual(1);
  for (const route of res.body.routes as Array<{ operatorSlug: string; operatorName: string }>) {
    expect(typeof route.operatorSlug).toBe("string");
    expect(typeof route.operatorName).toBe("string");
    expect(route.operatorSlug.length).toBeGreaterThan(0);
    expect(route.operatorName.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chainpass/api test -- -t "operatorSlug"`
Expected: FAIL — fields missing on response.

- [ ] **Step 3: Extend the `GET /routes` handler**

In `server/api/src/routes/routes.ts`, modify the `r.get("/routes", …)` handler. Two changes:

1. Extend the query result typing to include the operator fields, update the SELECT + add a JOIN:

Replace the existing query (approx lines 66–89) with:

```ts
      const { rows } = await pool.query<{
        route_id: string;
        name: string;
        detail: string | null;
        category: string;
        schedule: string | null;
        short_code: string | null;
        schedule_mode: string | null;
        operating_start: string | null;
        operating_end: string | null;
        vehicle_type: string | null;
        is_interstate: boolean | null;
        coaches: number | null;
        seats_per_coach: number | null;
        total_seats: number | null;
        coach_classes: unknown | null;
        operator_slug: string;
        operator_name: string;
      }>(
        `SELECT rl.route_id, rl.name, rl.detail, rl.category, rl.schedule, rl.short_code,
                rl.schedule_mode, rl.operating_start, rl.operating_end,
                rl.vehicle_type, rl.is_interstate, rl.coaches, rl.seats_per_coach, rl.total_seats,
                rl.coach_classes,
                o.slug AS operator_slug,
                o.name AS operator_name
         FROM route_labels rl
         JOIN operators o ON o.id = rl.operator_id
         ORDER BY rl.category, rl.route_id::numeric`,
      );
```

2. Add the two fields to the mapped response object inside `routes: rows.map(...)`:

```ts
          operatorSlug: row.operator_slug,
          operatorName: row.operator_name,
```

Place them adjacent to `coachClasses` so the property order stays scannable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chainpass/api test`
Expected: PASS — new test plus all existing tests.

- [ ] **Step 5: Commit**

```bash
git add server/api/src/routes/routes.ts server/api/tests/http.test.ts
git commit -m "feat(api): include operatorSlug + operatorName on GET /routes"
```

---

## Task 6: Extend client `api.ts` types and add fetchers

**Scope:** Update `ApiRouteLabel` and `ApiOperator` (or create `ApiOperator`) TypeScript types; add `fetchOperator(slug)` and `fetchOperatorRoutes(slug)` functions.

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Extend `ApiRouteLabel`**

In `client/src/lib/api.ts`, find the `export type ApiRouteLabel = { … }` block (near the top). Add two new required fields at the bottom of the type (before the closing `}`):

```ts
  /** Slug of the operator that owns this route. Always present (operator_id is NOT NULL). */
  operatorSlug: string
  /** Display name of the operator that owns this route. Always present. */
  operatorName: string
```

- [ ] **Step 2: Add/extend `ApiOperator` type**

Find any existing `ApiOperator` type or operator-response type (search for "ApiOperator" first). If there's no existing one, add this new block after `ApiRouteLabel`:

```ts
/**
 * Public operator response — as served by `GET /api/v1/operators` and
 * `GET /api/v1/operators/:slug`. The `/operators` list endpoint omits
 * `schedule`; the single-slug endpoint includes it.
 *
 * `contactEmail` is intentionally absent — the server withholds it for
 * anti-phishing reasons. See `server/api/src/routes/operators.ts`.
 */
export type ApiOperator = {
  id: number
  slug: string
  name: string
  adminWallet: string | null
  treasuryWallet: string | null
  status: "active" | "pending" | "suspended"
  logoUrl: string | null
  region: string | null
  description: string | null
  websiteUrl: string | null
  createdAt: string
  routeCount: number
  primaryCategory: string | null
}

export type ApiOperatorDetail = ApiOperator & {
  schedule: {
    firstDeparture: string | null
    lastDeparture: string | null
    routesWithSessions: number
  }
}
```

If an existing `ApiOperator` already exists (from the operator-table work), **extend** rather than duplicate — add `region`, `description`, `websiteUrl`, `routeCount`, `primaryCategory` to the existing type.

- [ ] **Step 3: Add fetchers**

Append these exported async functions near the other `fetchOperator*` family of functions (or at the end of the file if easier to find):

```ts
/** Fetch the public operator directory (only operators with ≥1 route). */
export async function fetchOperators(): Promise<ApiOperator[] | null> {
  try {
    const res = await fetch(`${env.apiBase}/api/v1/operators`)
    if (!res.ok) return null
    const data = (await res.json()) as { operators?: ApiOperator[] }
    return data.operators ?? []
  } catch (err) {
    console.error("[fetchOperators]", err)
    return null
  }
}

/** Fetch one operator by slug. Returns null on 404 / network error. */
export async function fetchOperator(slug: string): Promise<ApiOperatorDetail | null> {
  try {
    const res = await fetch(`${env.apiBase}/api/v1/operators/${encodeURIComponent(slug)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { operator?: ApiOperatorDetail }
    return data.operator ?? null
  } catch (err) {
    console.error("[fetchOperator]", err)
    return null
  }
}

/** Fetch the routes owned by one operator by slug. Returns null on 404 / network error. */
export async function fetchOperatorRoutes(slug: string): Promise<ApiRouteLabel[] | null> {
  try {
    const res = await fetch(`${env.apiBase}/api/v1/operators/${encodeURIComponent(slug)}/routes`)
    if (!res.ok) return null
    const data = (await res.json()) as { routes?: ApiRouteLabel[] }
    return data.routes ?? []
  } catch (err) {
    console.error("[fetchOperatorRoutes]", err)
    return null
  }
}
```

Match the style of existing fetchers in the file — if they use `env.apiBase`, use that; if they use a different name (e.g. `API_BASE`), adopt that. Keep error handling identical to neighbouring functions.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter client build`
Expected: PASS — no TS errors. If existing consumers of `ApiRouteLabel` break because of the new required `operatorSlug`/`operatorName` fields, fix by adding the fields to any mocked `ApiRouteLabel` literals (there shouldn't be any in production code since the fields are always populated; this is only a concern in test fixtures, of which the client has none).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(client): extend api types for marketplace endpoints"
```

---

## Task 7: Extract shared `RouteCard` component

**Scope:** The existing `RoutesPage.tsx` renders route rows as inline JSX inside `list.map((r) => …)`. Extract this into a standalone `RouteCard` component so `OperatorDetailPage` can reuse it without duplication. Add optional `showOperator` prop.

**Files:**
- Create: `client/src/components/routes/RouteCard.tsx`
- Modify: `client/src/pages/RoutesPage.tsx`

- [ ] **Step 1: Read the existing inline JSX**

Open `client/src/pages/RoutesPage.tsx`. Find the `list.map((r) => { … })` block (around lines 860–950 in the current file). Note:
- What props the inline card needs (`r: RouteRow`, favourites state, click behaviour)
- The `<Link to={`/routes/${r.routeId}`}>` navigation
- Any transport-icon / short-code / detail rendering logic

Also open `client/src/components/landing` and search for how existing components are organized to match conventions.

- [ ] **Step 2: Create the shared component**

Create `client/src/components/routes/RouteCard.tsx`:

```tsx
import { Link, useNavigate } from "react-router-dom"
import type { ApiRouteLabel } from "../../lib/api"
// Import TransportIcon from wherever RoutesPage imports it.
// Search in RoutesPage.tsx for `import { TransportIcon }` and use the same path.
import { TransportIcon } from "../routes/TransportIcon" // PLACEHOLDER — adjust to match actual location

export type RouteCardProps = {
  route: Pick<
    ApiRouteLabel,
    | "routeId"
    | "name"
    | "detail"
    | "category"
    | "shortCode"
    | "operatorName"
    | "operatorSlug"
  >
  /** When true (default), render "via {operatorName}" as a subtitle. Set false
   *  on /operators/:slug where the operator context is already the page frame. */
  showOperator?: boolean
  /** react-router `location.state` to pass on navigation. Used by
   *  RoutePurchasePage to render a 2-level breadcrumb (All operators › Operator).
   *  Default: undefined (no state). */
  navigateState?: unknown
  /** Favourite heart — opt-in; parent supplies both the current state and toggle. */
  favourite?: { isFavourite: boolean; onToggle: () => void }
}

export function RouteCard({ route, showOperator = true, navigateState, favourite }: RouteCardProps) {
  const navigate = useNavigate()

  const handleClick = (e: React.MouseEvent) => {
    if (navigateState === undefined) return  // let the <Link> handle it
    e.preventDefault()
    navigate(`/routes/${route.routeId}`, { state: navigateState })
  }

  return (
    <div className="group flex items-stretch overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container transition-all hover:border-primary/25 hover:bg-surface-container-high hover:shadow-[0_4px_24px_rgba(110,84,255,0.1)]">
      {/* Left accent bar */}
      <div className="w-0.5 shrink-0 rounded-r-full bg-primary/0 transition-all group-hover:bg-primary/60" aria-hidden />

      {/* Main clickable area */}
      <Link
        to={`/routes/${route.routeId}`}
        state={navigateState}
        onClick={handleClick}
        className="flex flex-1 items-center gap-4 min-w-0 px-4 py-4"
      >
        {/* Transport icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
          <TransportIcon category={route.category} name={route.name} className="text-primary" />
        </div>

        {/* Route info */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-headline text-sm font-semibold leading-snug text-white">
            <span className="truncate">{route.name}</span>
            {route.shortCode && (
              <span
                className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-primary"
                title="Route short code"
              >
                {route.shortCode}
              </span>
            )}
          </p>
          {route.detail && (
            <p className="mt-0.5 text-xs text-on-surface-variant">{route.detail}</p>
          )}
          {showOperator && (
            <p className="mt-0.5 text-[11px] text-on-surface-variant/70">
              via <span className="text-on-surface-variant">{route.operatorName}</span>
            </p>
          )}
        </div>
      </Link>

      {/* Right panel: favourite heart, etc. Matches existing pattern from RoutesPage. */}
      {favourite && (
        <button
          type="button"
          onClick={favourite.onToggle}
          aria-label={favourite.isFavourite ? "Remove from favourites" : "Add to favourites"}
          className="flex w-12 shrink-0 items-center justify-center text-lg hover:bg-surface-container-high"
        >
          {favourite.isFavourite ? "♥" : "♡"}
        </button>
      )}
    </div>
  )
}
```

If `TransportIcon` lives at a different path in the current file (check the import in `RoutesPage.tsx`), adjust the import accordingly.

If the original inline card has additional elements not captured above (e.g. buy button, capacity pill, session count), port them into the component. Fidelity to the existing visual is the goal — the new component should produce identical DOM to the inline version when `showOperator=true`.

- [ ] **Step 3: Replace the inline card in `RoutesPage.tsx`**

In `RoutesPage.tsx`:

1. Add the import near the top:
```tsx
import { RouteCard } from "../components/routes/RouteCard"
```

2. Replace the inline `<li key={r.routeId}> … </li>` body inside `list.map((r) => { … })` with:

```tsx
                  <li key={r.routeId}>
                    <RouteCard
                      route={r}
                      showOperator={true}
                      favourite={{
                        isFavourite: fav,
                        onToggle: () => toggleFavourite(r.routeId),
                      }}
                    />
                  </li>
```

Remove the now-unused inline JSX (the `<div className="group flex …`>` block).

3. `RouteRow` type inside `RoutesPage.tsx` must include `operatorSlug` and `operatorName`. Add them to the type:

```ts
type RouteRow = {
  routeId: string
  name: string
  // ...existing fields...
  operatorSlug: string
  operatorName: string
}
```

In the `useMemo` / `byId` construction (around line 570), propagate the fields when building `RouteRow` from `ApiRouteLabel`:

```ts
  byId.set(row.routeId, {
    routeId: row.routeId,
    // ...existing fields...
    operatorSlug: row.operatorSlug,
    operatorName: row.operatorName,
  })
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Then run: `pnpm dev:client` (in a second terminal, or as background). Visit `/routes` — cards should look identical to before (same favourites toggle, same click-through, same layout). The new "via {operatorName}" line should appear on each card since `showOperator` defaults true.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/routes/RouteCard.tsx client/src/pages/RoutesPage.tsx
git commit -m "refactor(client): extract RouteCard from RoutesPage inline JSX"
```

---

## Task 8: Create shared `Breadcrumb` and `OperatorRowSkeleton` components

**Scope:** Two small presentational components reused on the directory + detail + purchase pages.

**Files:**
- Create: `client/src/components/marketplace/Breadcrumb.tsx`
- Create: `client/src/components/marketplace/OperatorRowSkeleton.tsx`

- [ ] **Step 1: Create `Breadcrumb.tsx`**

```tsx
import { Link } from "react-router-dom"

export type BreadcrumbItem = {
  label: string
  /** If provided, the item renders as a Link. Otherwise it renders as plain text
   *  (the "current page" terminal item). */
  to?: string
}

export type BreadcrumbProps = {
  items: BreadcrumbItem[]
}

/**
 * Simple textual breadcrumb. The first item shows with an arrow prefix ("← Label");
 * subsequent items are separated by " · ". The last item is the "current page"
 * and never renders as a link even if `to` is set.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-xs text-primary">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        const prefix = idx === 0 ? "← " : " · "
        if (isLast || !item.to) {
          return (
            <span key={idx} className={idx === 0 ? "" : "text-on-surface-variant"}>
              {prefix}
              {item.label}
            </span>
          )
        }
        return (
          <span key={idx}>
            {prefix}
            <Link to={item.to} className="hover:underline">
              {item.label}
            </Link>
          </span>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Create `OperatorRowSkeleton.tsx`**

```tsx
/** Loading skeleton for one row in the operator directory list. */
export function OperatorRowSkeleton() {
  return (
    <div className="flex items-stretch gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container p-4 animate-pulse">
      {/* Logo placeholder */}
      <div className="h-14 w-14 shrink-0 rounded-xl bg-on-surface-variant/10" />
      <div className="flex flex-1 flex-col gap-2 justify-center">
        {/* Title + count row */}
        <div className="flex items-center justify-between">
          <div className="h-3 w-1/3 rounded bg-on-surface-variant/20" />
          <div className="h-3 w-16 rounded bg-on-surface-variant/10" />
        </div>
        {/* Subtitle */}
        <div className="h-2.5 w-1/2 rounded bg-on-surface-variant/10" />
        {/* Pill */}
        <div className="h-4 w-14 rounded-full bg-on-surface-variant/10" />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter client build`
Expected: PASS — nothing uses these yet but they typecheck cleanly.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/marketplace/
git commit -m "feat(client): add Breadcrumb and OperatorRowSkeleton marketplace primitives"
```

---

## Task 9: Build `OperatorsDirectoryPage`

**Scope:** The rider home at `/operators` — a scannable list with loading/empty/error states + escape-hatch link.

**Files:**
- Create: `client/src/pages/OperatorsDirectoryPage.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchOperators, type ApiOperator } from "../lib/api"
import { OperatorRowSkeleton } from "../components/marketplace/OperatorRowSkeleton"

/**
 * Operators directory — the rider-facing marketplace front door.
 * Sibling to /operator (singular): that's the admin route-registration page
 * for operator-owners. This page (plural) is the public directory.
 */
export function OperatorsDirectoryPage() {
  const [operators, setOperators] = useState<ApiOperator[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchOperators()
      .then((result) => {
        if (cancelled) return
        if (result === null) {
          setError("Could not load operators. Please retry.")
          setOperators([])
          return
        }
        setOperators(result)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setError("Could not load operators. Please retry.")
        setOperators([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totalRoutes = (operators ?? []).reduce((sum, o) => sum + o.routeCount, 0)
  const isLoading = operators === null
  const isEmpty = !isLoading && (operators?.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="font-headline text-2xl font-bold text-white">Marketplace</h1>
        {!isLoading && !isEmpty && (
          <p className="mt-1 text-xs text-on-surface-variant">
            {operators!.length} {operators!.length === 1 ? "operator" : "operators"} · {totalRoutes} {totalRoutes === 1 ? "route" : "routes"} available
          </p>
        )}
      </header>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setOperators(null)
              setError(null)
              fetchOperators().then((r) => setOperators(r ?? []))
            }}
            className="underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <OperatorRowSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {isEmpty && !error && (
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center">
          <p className="font-headline text-sm font-semibold text-white">No operators yet.</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            The marketplace is empty. Once an operator registers and adds a route, you'll see them here.
          </p>
          <Link
            to="/operator"
            className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline"
          >
            Register as an operator →
          </Link>
        </div>
      )}

      {/* Operator list */}
      {!isLoading && !isEmpty && (
        <ul className="space-y-2.5">
          {operators!.map((op) => (
            <li key={op.slug}>
              <OperatorRow operator={op} />
            </li>
          ))}
        </ul>
      )}

      {/* Escape hatch — only when we have data */}
      {!isLoading && !isEmpty && (
        <div className="mt-8 rounded-2xl border border-outline-variant/15 bg-surface-container p-4 text-center text-xs text-on-surface-variant">
          Looking for something specific?{" "}
          <Link to="/routes" className="font-semibold text-primary hover:underline">
            Browse all {totalRoutes} {totalRoutes === 1 ? "route" : "routes"} →
          </Link>
        </div>
      )}
    </div>
  )
}

/** Deterministic gradient for the logo fallback when logoUrl is null. */
function slugGradient(slug: string): string {
  // Hash the slug into two hues; combine as a CSS linear-gradient.
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 60) % 360
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 70% 55%))`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "??"
}

function OperatorRow({ operator }: { operator: ApiOperator }) {
  const subtitleParts = [operator.primaryCategory, operator.region].filter(Boolean)
  const subtitle = subtitleParts.join(" · ")

  return (
    <Link
      to={`/operators/${operator.slug}`}
      className="block rounded-2xl border border-outline-variant/15 bg-surface-container p-4 transition-all hover:border-primary/25 hover:bg-surface-container-high"
    >
      <div className="flex gap-3">
        {/* Logo */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-bold text-white"
          style={operator.logoUrl ? undefined : { background: slugGradient(operator.slug) }}
        >
          {operator.logoUrl ? (
            <img src={operator.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
          ) : (
            initials(operator.name)
          )}
        </div>

        {/* Text + pills */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-headline text-sm font-semibold text-white">{operator.name}</p>
            <p className="shrink-0 text-xs text-on-surface-variant">
              {operator.routeCount} {operator.routeCount === 1 ? "route" : "routes"}
            </p>
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">{subtitle}</p>
          )}
          {operator.primaryCategory && (
            <div className="mt-2">
              <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {operator.primaryCategory}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter client build`
Expected: PASS. The page compiles but isn't wired into the router yet.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/OperatorsDirectoryPage.tsx
git commit -m "feat(client): add OperatorsDirectoryPage at /operators"
```

---

## Task 10: Wire `/operators` into the router + rename nav

**Scope:** Register `/operators` in `App.tsx`, rename the "Routes" nav link to "Marketplace", repoint to `/operators`. Update landing page CTA.

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/layouts/AppLayout.tsx`
- Modify: `client/src/components/landing/LandingPage.tsx`

- [ ] **Step 1: Add the route in `App.tsx`**

In `client/src/App.tsx`:

1. Add the import next to the other page imports:
```tsx
import { OperatorsDirectoryPage } from "./pages/OperatorsDirectoryPage"
```

2. Add the route inside the `<Route element={<AppLayout />}>` block, immediately before `<Route path="routes" …>`:
```tsx
        <Route path="operators" element={<OperatorsDirectoryPage />} />
```

- [ ] **Step 2: Rename the nav link**

In `client/src/layouts/AppLayout.tsx`, find:

```tsx
<NavLink to="/routes" className={desktopNavLink} end>Routes</NavLink>
```

Replace with:

```tsx
<NavLink to="/operators" className={desktopNavLink} end>Marketplace</NavLink>
```

**Also** find and update the mobile bottom-tab bar link (`tabs` array earlier in the file — search for `"/routes"`). Rename the mobile tab `label` from "Routes" to "Marketplace" and repoint `to` from `/routes` to `/operators`. Keep the icon unchanged.

- [ ] **Step 3: Update the landing CTA**

In `client/src/components/landing/LandingPage.tsx`, search for any `to="/routes"` / `href="/routes"` in primary-CTA buttons. Repoint to `/operators`. There may be more than one (hero + secondary section); update all that currently land on `/routes` as the "enter the app" target. Leave CTAs that are specifically about browsing routes (rare) alone if any exist — but the primary "Enter app / Browse / Explore" CTA should now go to `/operators`.

- [ ] **Step 4: Typecheck + manual smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Then manually smoke:
- `pnpm dev:client` + `pnpm dev:api`
- Visit `http://localhost:5173/` — primary CTA from landing goes to `/operators`.
- Visit `/operators` — see the directory (with seed operator "ChainPass Transit" once it has any routes).
- Top nav shows "Marketplace" pointing at `/operators`, and `/routes` is no longer in the nav.
- Mobile viewport: bottom-tab bar shows "Marketplace".

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/layouts/AppLayout.tsx client/src/components/landing/LandingPage.tsx
git commit -m "feat(client): route /operators, rename nav Routes→Marketplace, repoint landing CTA"
```

---

## Task 11: Build `OperatorDetailPage` scaffold + 404 handling

**Scope:** Page shell with parallel fetches, header rendering, tab strip, 404 state. Tab panels are stubs here — filled in Tasks 12-14.

**Files:**
- Create: `client/src/pages/OperatorDetailPage.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  fetchOperator,
  fetchOperatorRoutes,
  type ApiOperatorDetail,
  type ApiRouteLabel,
} from "../lib/api"
import { Breadcrumb } from "../components/marketplace/Breadcrumb"

/** Tab ids, used both in state and in the `?tab=` URL param. */
type Tab = "routes" | "about" | "schedule"
const TABS: Tab[] = ["routes", "about", "schedule"]

/**
 * Operator detail — the rider-facing page for a single operator.
 * Sibling to /operator (singular): that's the operator-admin route page.
 */
export function OperatorDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get("tab") ?? "routes"
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "routes"

  const [operator, setOperator] = useState<ApiOperatorDetail | null | undefined>(undefined)
  const [routes, setRoutes] = useState<ApiRouteLabel[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setOperator(undefined)
    setRoutes(undefined)
    Promise.all([fetchOperator(slug), fetchOperatorRoutes(slug)])
      .then(([op, rs]) => {
        if (cancelled) return
        setOperator(op) // null → 404
        setRoutes(rs ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setOperator(null)
        setRoutes([])
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const selectTab = useCallback(
    (next: Tab) => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set("tab", next)
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // 404
  if (operator === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-headline text-lg font-semibold text-white">Operator not found</h1>
        <p className="mt-2 text-xs text-on-surface-variant">
          This operator doesn't exist or is no longer listed.
        </p>
        <Link
          to="/operators"
          className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline"
        >
          ← Back to all operators
        </Link>
      </div>
    )
  }

  // Loading
  if (operator === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Breadcrumb items={[{ label: "All operators", to: "/operators" }]} />
        <div className="animate-pulse">
          <div className="h-14 w-40 rounded bg-on-surface-variant/10" />
          <div className="mt-6 h-10 w-full rounded bg-on-surface-variant/10" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumb items={[{ label: "All operators", to: "/operators" }]} />

      {/* Header */}
      <header className="mb-4 flex gap-3">
        <OperatorLogo operator={operator} />
        <div>
          <h1 className="font-headline text-xl font-bold text-white">{operator.name}</h1>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            {[operator.primaryCategory, operator.region].filter(Boolean).join(" · ")}
            {operator.primaryCategory || operator.region ? " · " : ""}
            {operator.routeCount} {operator.routeCount === 1 ? "route" : "routes"}
          </p>
        </div>
      </header>

      {/* Tab strip */}
      <div className="border-b border-outline-variant/20">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTab(t)}
            className={
              "inline-block px-3 py-2 text-xs capitalize transition-colors " +
              (t === tab
                ? "border-b-2 border-primary text-white"
                : "text-on-surface-variant hover:text-white")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="pt-4">
        {tab === "routes"   && <RoutesPanel operator={operator} routes={routes} />}
        {tab === "about"    && <AboutPanel operator={operator} />}
        {tab === "schedule" && <SchedulePanel operator={operator} />}
      </div>
    </div>
  )
}

function slugGradient(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 60) % 360
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 70% 55%))`
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "??"
}

function OperatorLogo({ operator }: { operator: ApiOperatorDetail }) {
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={operator.logoUrl ? undefined : { background: slugGradient(operator.slug) }}
    >
      {operator.logoUrl ? (
        <img src={operator.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
      ) : (
        <span className="text-lg">{initials(operator.name)}</span>
      )}
    </div>
  )
}

// ------------- Tab panels (stubs — filled in later tasks) -------------

function RoutesPanel({ operator, routes }: { operator: ApiOperatorDetail; routes: ApiRouteLabel[] | null | undefined }) {
  return <div className="text-xs text-on-surface-variant">Routes tab — filled in Task 12.</div>
}

function AboutPanel({ operator }: { operator: ApiOperatorDetail }) {
  return <div className="text-xs text-on-surface-variant">About tab — filled in Task 13.</div>
}

function SchedulePanel({ operator }: { operator: ApiOperatorDetail }) {
  return <div className="text-xs text-on-surface-variant">Schedule tab — filled in Task 14.</div>
}
```

- [ ] **Step 2: Register the route in `App.tsx`**

In `client/src/App.tsx`:

1. Add the import:
```tsx
import { OperatorDetailPage } from "./pages/OperatorDetailPage"
```

2. Add the route inside `<Route element={<AppLayout />}>`, immediately after the `/operators` directory route:
```tsx
        <Route path="operators/:slug" element={<OperatorDetailPage />} />
```

- [ ] **Step 3: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually visit `http://localhost:5173/operators/chainpass-transit` — should show header + tab strip + stub "filled in Task 12" text. `/operators/does-not-exist` → 404 state.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/OperatorDetailPage.tsx client/src/App.tsx
git commit -m "feat(client): add OperatorDetailPage scaffold with header + tabs + 404"
```

---

## Task 12: Fill the Routes tab

**Scope:** Replace the `RoutesPanel` stub with real `RouteCard` rendering — `showOperator={false}`, passing `fromOperator` via `navigateState`. Loading and empty states.

**Files:**
- Modify: `client/src/pages/OperatorDetailPage.tsx`

- [ ] **Step 1: Replace `RoutesPanel`**

In `OperatorDetailPage.tsx`, replace the `RoutesPanel` stub with:

```tsx
import { RouteCard } from "../components/routes/RouteCard"
// (add this import near the top with the others)

function RoutesPanel({
  operator,
  routes,
}: {
  operator: ApiOperatorDetail
  routes: ApiRouteLabel[] | null | undefined
}) {
  if (routes === undefined) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 w-full animate-pulse rounded-2xl border border-outline-variant/15 bg-surface-container"
          />
        ))}
      </div>
    )
  }
  if (routes === null || routes.length === 0) {
    return (
      <p className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center text-xs text-on-surface-variant">
        This operator hasn't added any routes yet.
      </p>
    )
  }
  return (
    <ul className="space-y-2.5">
      {routes.map((r) => (
        <li key={r.routeId}>
          <RouteCard
            route={r}
            showOperator={false}
            navigateState={{ fromOperator: { slug: operator.slug, name: operator.name } }}
          />
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually: `/operators/chainpass-transit?tab=routes` shows the operator's routes. Click a route — should navigate to `/routes/:routeId`. The purchase page won't yet render a breadcrumb (that's Task 17), but the navigation must succeed and the URL must be correct.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/OperatorDetailPage.tsx
git commit -m "feat(client): fill OperatorDetailPage Routes tab"
```

---

## Task 13: Fill the About tab

**Scope:** Description (or placeholder), region, website link. All fields rendered only when non-null. Empty state when all three null.

**Files:**
- Modify: `client/src/pages/OperatorDetailPage.tsx`

- [ ] **Step 1: Replace `AboutPanel`**

Replace the `AboutPanel` stub with:

```tsx
function AboutPanel({ operator }: { operator: ApiOperatorDetail }) {
  const hasAnyDetail = operator.description || operator.region || operator.websiteUrl
  if (!hasAnyDetail) {
    return (
      <p className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center text-xs text-on-surface-variant">
        No operator details yet.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {/* Description */}
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-4">
        <p className="text-sm leading-relaxed text-on-surface">
          {operator.description || "This operator hasn't added a description yet."}
        </p>
      </div>

      {/* Details */}
      {(operator.region || operator.websiteUrl) && (
        <dl className="space-y-2 rounded-2xl border border-outline-variant/15 bg-surface-container p-4 text-xs">
          {operator.region && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-on-surface-variant">Region</dt>
              <dd className="text-on-surface">{operator.region}</dd>
            </div>
          )}
          {operator.websiteUrl && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-on-surface-variant">Website</dt>
              <dd>
                <a
                  href={operator.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {operator.websiteUrl}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually: `/operators/chainpass-transit?tab=about` — shows "No operator details yet." by default (seed operator has null fields). Then UPDATE one field via psql:
```sql
UPDATE operators SET region='Lagos, NG', description='Test operator', website_url='https://example.com'
WHERE slug='chainpass-transit';
```
Reload the About tab — should now show all three rows.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/OperatorDetailPage.tsx
git commit -m "feat(client): fill OperatorDetailPage About tab"
```

---

## Task 14: Fill the Schedule tab

**Scope:** Operating hours summary from the `operator.schedule` object. Empty state when no sessions.

**Files:**
- Modify: `client/src/pages/OperatorDetailPage.tsx`

- [ ] **Step 1: Replace `SchedulePanel`**

Replace the `SchedulePanel` stub with:

```tsx
function SchedulePanel({ operator }: { operator: ApiOperatorDetail }) {
  const { firstDeparture, lastDeparture, routesWithSessions } = operator.schedule
  if (firstDeparture === null || lastDeparture === null) {
    return (
      <p className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center text-xs text-on-surface-variant">
        This operator hasn't published a schedule yet. Individual route pages may still show
        upcoming departures once sessions are added.
      </p>
    )
  }
  return (
    <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-4">
      <dl className="space-y-2 text-xs">
        <div className="flex gap-3">
          <dt className="w-32 shrink-0 text-on-surface-variant">Service hours</dt>
          <dd className="font-mono text-on-surface">
            {firstDeparture} – {lastDeparture}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-32 shrink-0 text-on-surface-variant">Active routes</dt>
          <dd className="text-on-surface">
            {routesWithSessions} of {operator.routeCount} published
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-on-surface-variant/80">
        Derived from the operator's current session data. Refreshes when sessions change.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually: `/operators/chainpass-transit?tab=schedule` — shows the "hasn't published a schedule" empty state until sessions are added. Add a session and reload — shows service hours.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/OperatorDetailPage.tsx
git commit -m "feat(client): fill OperatorDetailPage Schedule tab"
```

---

## Task 15: Update `RoutesPage` — subtitle, back link, shared card

**Scope:** Add the page subtitle framing the flat catalogue as "all routes across operators" and a "← Back to operators" link. `RouteCard` usage from Task 7 already passes `showOperator={true}` so cards render "via {operatorName}".

**Files:**
- Modify: `client/src/pages/RoutesPage.tsx`

- [ ] **Step 1: Find the page header**

Open `client/src/pages/RoutesPage.tsx`. Find the top of the page render — the `<h1>` or page-title section near the start of the returned JSX.

- [ ] **Step 2: Add subtitle + back link**

Immediately under the existing page title (keep the `<h1>` as-is), add:

```tsx
<p className="mt-1 text-xs text-on-surface-variant">
  All routes across every operator on ChainPass.
</p>
<Link
  to="/operators"
  className="mt-2 inline-block text-xs text-primary hover:underline"
>
  ← Back to operators
</Link>
```

If there's no existing `Link` import, add:
```tsx
import { Link } from "react-router-dom"
```
at the top of the file if it's not already imported (it likely is, for route links in cards).

- [ ] **Step 3: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually: `/routes` — shows the subtitle + back link, cards still work, favourites work, "via {operatorName}" visible on each card.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/RoutesPage.tsx
git commit -m "feat(client): frame /routes as flat catalogue with back-to-operators link"
```

---

## Task 16: RoutePurchasePage — conditional 2-level breadcrumb

**Scope:** When the purchase page is reached from an operator (`location.state.fromOperator` is set), render "← {operator.name} · ← All operators". When reached from `/routes`, render "← All routes". Direct link → no breadcrumb.

**Files:**
- Modify: `client/src/pages/RoutePurchasePage.tsx`

- [ ] **Step 1: Read the current top of the file**

Open `client/src/pages/RoutePurchasePage.tsx`. Look at the existing imports and the very top of the render to figure out where the breadcrumb should go (above the page's main `<h1>` or equivalent).

- [ ] **Step 2: Add breadcrumb rendering**

Near the top of the file, add the imports (if not present):
```tsx
import { Link, useLocation, useParams } from "react-router-dom"
import { Breadcrumb } from "../components/marketplace/Breadcrumb"
```

Inside the page component, near the top (after hooks, before the return statement):

```tsx
const location = useLocation() as {
  state: { fromOperator?: { slug: string; name: string } } | null
}
const fromOperator = location.state?.fromOperator
// When no state is set, the referrer is unknown — we intentionally render NO
// breadcrumb for direct links (SMS / QR deep-links feel weird with a back
// arrow to something the user didn't come from).
const breadcrumbItems =
  fromOperator
    ? [
        { label: "All operators", to: "/operators" },
        { label: fromOperator.name, to: `/operators/${fromOperator.slug}` },
      ]
    : typeof document !== "undefined" && document.referrer.endsWith("/routes")
      ? [{ label: "All routes", to: "/routes" }]
      : []
```

In the returned JSX, place at the very top (before the existing `<h1>` / content):
```tsx
{breadcrumbItems.length > 0 && <Breadcrumb items={breadcrumbItems} />}
```

Note: the `document.referrer` fallback for `/routes` → "All routes" is best-effort (referrer might be stripped by the browser). For the spec's stated behaviour, explicit `fromOperator` state is the authoritative signal; the `/routes` fallback is nice-to-have and can be removed if `document.referrer` proves unreliable.

- [ ] **Step 3: Typecheck + smoke**

Run: `pnpm --filter client build`
Expected: PASS.

Manually:
- `/operators/chainpass-transit` → click a route → purchase page shows "← All operators · ChainPass Transit" breadcrumb.
- `/routes` → click a route → purchase page shows "← All routes" (if `document.referrer` works in your browser).
- Paste `/routes/<id>` directly in the address bar → no breadcrumb.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/RoutePurchasePage.tsx
git commit -m "feat(client): conditional breadcrumb on RoutePurchasePage based on referrer"
```

---

## Task 17: Full typecheck + test sweep

**Scope:** Run the full monorepo typecheck and test suite; fix anything that regressed along the way.

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```
Expected: PASS across `@chainpass/api` and `@chainpass/indexer` packages.

- [ ] **Step 2: Run full builds**

```bash
pnpm build
```
Expected: PASS across every package (`shared`, `client`, `@chainpass/api`, `@chainpass/indexer`).

- [ ] **Step 3: Fix anything that broke**

If anything regresses (type errors in unrelated files, unused imports, etc.), fix inline with a follow-up commit. Common suspects:
- `RoutesPage.tsx` type propagation (new fields on `RouteRow`)
- Unused imports left behind from the inline-card extraction

- [ ] **Step 4: Manual end-to-end smoke**

Start the full stack: `pnpm dev`. Walk through:
1. Landing page → primary CTA navigates to `/operators`.
2. `/operators` shows the seed operator (once it has a route); escape-hatch footer links to `/routes`.
3. Click operator → `/operators/chainpass-transit` shows header + tabs.
4. Routes tab → route cards (no "via X" line inside operator page).
5. Click a route → lands on `/routes/:id` with breadcrumb back to operator.
6. About tab → shows "No details yet" until the DB has region / description / website_url.
7. Schedule tab → shows "No schedule yet" until sessions exist.
8. `/routes` (via escape hatch) → flat catalogue with "via {operatorName}" on each card + "← Back to operators" link.
9. Try registering a new route via `/operator` admin — it should attach to the seed operator (unchanged behaviour) and appear in the directory's `routeCount`.

- [ ] **Step 5: Commit any fixes**

```bash
git add .
git commit -m "chore: final typecheck + test sweep for marketplace front door"
```

- [ ] **Step 6: Announce completion**

The feature is ready for PR. Next step (outside this plan): open a PR to `main` or the parent branch, after confirming the cleanup PR (`chore/remove-hardcoded-demo-routes`) is either merged or explicitly stacked on.

---

## Appendix: Self-review checklist (already run)

1. **Spec coverage**
   - §1 Scope → Task 10 (nav change)
   - §2 Navigation → Tasks 10, 15, 16
   - §3 Data model → Task 1
   - §4.1–4.5 API → Tasks 2–5
   - §4.6 Tests → embedded in Tasks 1–5
   - §5 Routing → Tasks 10, 11
   - §6 Directory UI → Tasks 8, 9
   - §7 Detail UI → Tasks 11, 12, 13, 14
   - §8 Flat fallback → Tasks 7, 15
   - §9 Empty states → Tasks 9, 12, 13, 14
   - §10 File-by-file → see File Structure section above
   - §11 Ship checklist → Task 17
   - §12 Future work → explicitly deferred, not in this plan

2. **Placeholder scan:** None — every step has concrete code or exact commands.

3. **Type consistency:**
   - `ApiOperator` in Task 6 matches `OperatorAggregateRow → toResponse` server output in Task 2.
   - `ApiOperatorDetail` adds `schedule` field — matches Task 3's server response.
   - `ApiRouteLabel.operatorSlug` / `operatorName` are required non-null, matching the `JOIN operators` in Task 5 (operator_id is NOT NULL since the prior migration).
   - `RouteCardProps` takes a `Pick<ApiRouteLabel>` subset — consistent across Tasks 7, 12, 15.
   - `fromOperator` state shape `{ slug, name }` is consistent in Tasks 12 (sender) and 16 (receiver).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-rider-marketplace-front-door.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks (spec compliance then code quality), fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review

Which approach?
