# Rider-Facing Marketplace Front Door — Design Spec

**Date:** 2026-04-18
**Status:** Approved, ready for implementation plan
**Scope:** Turn ChainPass from a flat route catalogue into an operator-first marketplace. Riders start by picking an operator; the flat catalogue stays reachable as a fallback.

## 1. Goal and non-goals

### Goal
Ship the rider-facing marketplace front door:

- A new rider home at `/operators` — a scannable directory of transit operators.
- A new operator detail page at `/operators/:slug` with tabs for Routes, About, Schedule.
- The existing `/routes` page is demoted from rider home to an "all routes across all operators" fallback, still fully functional.

### Non-goals
- Per-operator authentication or auth middleware (tracked separately as Phase 1 Step 4 of the marketplace roadmap — this UI is visible to any logged-in rider).
- Operator-owner edit flows for About tab content. For MVP, description / region / website / contact email are edited through the existing Operator admin page (`/operator`). A dedicated operator-owner admin surface is a future phase.
- Search, filtering, or sorting UI on the operator directory. Rows are server-ordered by `route_count DESC` then `created_at DESC`.
- Logo uploads. `operators.logo_url` exists but there is no upload UI. Rows render a deterministic gradient block with initials when `logo_url` is null.
- Per-route schedule display on the operator detail page. The Schedule tab shows only operating-hours summary; per-trip timetables remain on the individual route pages.

## 2. Navigation restructure

- **Before:** Landing (`/`) → `/routes` (rider home, flat list of all routes).
- **After:** Landing (`/`) → `/operators` (rider home, directory of operators). `/routes` still exists; reached via a "Browse all routes" link at the bottom of `/operators`.

### Top nav changes (in `client/src/layouts/AppLayout.tsx`)
- "Routes" NavLink → renamed **"Marketplace"**, repointed to `/operators`.
- Same change applied to the mobile bottom-tab bar.
- `My Passes`, `Gate`, `Operations`, `Admin` NavLinks unchanged.
- No new top-level nav entries. `/routes` is reachable only via the in-page escape hatch on `/operators`.

### Landing page change (in `client/src/components/landing/LandingPage.tsx`)
- Primary CTA ("Enter app" / "Browse routes" / etc.) repointed from `/routes` to `/operators`.

## 3. Data model

Single table touched: `operators`. Three new nullable columns, all with length / format constraints. Migration is idempotent and additive.

### New SQL constant in `server/api/src/schema.ts`

```sql
-- OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL
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
      CHECK (website_url IS NULL OR website_url ~ '^https?://[^\s]+$');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;
```

### Bootstrap wiring
Called from `ensureRouteLabelsTable()` in `server/api/src/lib/db.ts`, placed after the existing `OPERATORS_INIT_SQL` block and before the `ROUTE_LABELS_MIGRATE_*` blocks. Same idempotent pattern as the existing migrations.

### Existing fields reused
- `operators.logo_url` (nullable, already present) — reserved for when logo upload ships; MVP uses a deterministic color block fallback.
- `operators.contact_email` (nullable, already present) — **not exposed** on the marketplace endpoints. The existing `server/api/src/routes/operators.ts` handler explicitly omits `contact_email` from responses on anti-phishing grounds (see comment lines 13–15). We preserve that posture: the About tab does **not** display an email. An opt-in public contact channel is deferred to a later phase.

### No other tables touched
- `route_labels.operator_id` already exists and is already populated (previous migration).
- Route count, starting price, primary category, and operating hours are derived at read time from existing data. No denormalized columns.

## 4. API changes

### 4.1 `GET /api/v1/operators` — modified
Existing handler in `server/api/src/routes/operators.ts` updated. Single query with a `LEFT JOIN` onto `route_labels`, aggregated per operator:

```sql
SELECT o.id, o.slug, o.name, o.status, o.logo_url,
       o.region, o.description, o.website_url,
       o.created_at,
       COUNT(r.route_id)::int                                     AS route_count,
       MODE() WITHIN GROUP (ORDER BY r.category)                  AS primary_category
FROM operators o
LEFT JOIN route_labels r ON r.operator_id = o.id
WHERE o.status <> 'suspended'
GROUP BY o.id
HAVING COUNT(r.route_id) > 0
ORDER BY route_count DESC, o.created_at DESC, o.id DESC;
```

Behavior notes:
- `HAVING COUNT(r.route_id) > 0` hides operators with zero routes from the directory.
- Ordering: busiest-first, then newest. Stable tiebreaker via `id DESC`.
- No price aggregation: `route_labels` stores no price column — ticket price lives on-chain via the contract's `mintPrice`. The directory therefore shows no "from-price" indicator. This is an explicit MVP limitation; a future phase can surface on-chain price via a cached read.

### Response shape
```ts
type OperatorResponse = {
  id: number;
  slug: string;
  name: string;
  status: "active" | "pending" | "suspended";
  logoUrl: string | null;
  region: string | null;
  description: string | null;
  websiteUrl: string | null;
  // contactEmail intentionally omitted — see §3 "Existing fields reused".
  createdAt: string; // ISO
  routeCount: number;
  primaryCategory: string | null;
};
```

### 4.2 `GET /api/v1/operators/:slug` — modified
Returns the same `OperatorResponse` shape defined in 4.1 (including `routeCount` and `primaryCategory` derived at read time). Does **not** filter by route count (direct links stay valid even when an operator has zero routes temporarily).

Two queries run in parallel:

```sql
-- 1) Operator row + aggregates
SELECT o.id, o.slug, o.name, o.status, o.logo_url,
       o.region, o.description, o.website_url,
       o.created_at,
       COUNT(r.route_id)::int                                     AS route_count,
       MODE() WITHIN GROUP (ORDER BY r.category)                  AS primary_category
FROM operators o
LEFT JOIN route_labels r ON r.operator_id = o.id
WHERE o.slug = $1 AND o.status <> 'suspended'
GROUP BY o.id
LIMIT 1;

-- 2) Schedule summary (runs only if operator was found; id comes from query 1)
SELECT MIN(s.departure_time)::text      AS first_departure,
       MAX(s.departure_time)::text      AS last_departure,
       COUNT(DISTINCT r.route_id)::int  AS routes_with_sessions
FROM route_labels r
LEFT JOIN route_sessions s ON s.route_id = r.route_id
WHERE r.operator_id = $1;
```

Returned as `schedule: { firstDeparture, lastDeparture, routesWithSessions }` on the response. All three are null when no sessions exist (Postgres returns NULL from `MIN`/`MAX` over an empty set, and `COUNT(DISTINCT …)` returns 0 — normalised to null by the handler when `firstDeparture` is null).

Schedule times come from `route_sessions.departure_time` (`HH:MM` text, format-validated by the existing CHECK constraint). No timezone math — these are local-time strings already.

Error behaviour:
- `400 { error: "invalid slug" }` if slug fails the `^[a-z0-9]+(-[a-z0-9]+)*$` regex or exceeds 40 chars.
- `404 { error: "not found" }` if slug unknown or operator is suspended.
- `500 { error: "failed to read operator" }` on DB errors.

### 4.3 `GET /api/v1/operators/:slug/routes` — new endpoint
Returns the operator's routes, shaped exactly like `GET /api/v1/routes` so the existing `ApiRouteLabel` type works unchanged.

```ts
GET /api/v1/operators/:slug/routes
→ 200 { routes: ApiRouteLabel[] }
→ 400 { error: "invalid slug" }
→ 404 { error: "not found" }        // unknown or suspended slug
→ 500 { error: "failed to read routes" }
```

Implementation: reuses the SELECT shape from `/api/v1/routes`, adding:
```
WHERE operator_id = (SELECT id FROM operators WHERE slug = $1 AND status <> 'suspended')
```
Returns empty array `{ routes: [] }` for a known operator with zero routes (200, not 404). 404 is reserved for unknown/suspended operator slugs.

Rationale for a separate endpoint (vs `GET /api/v1/routes?operator=<slug>`):
- Keeps `/api/v1/routes` operator-agnostic.
- Clean separation of marketplace concerns from the flat catalogue.
- Slug-to-id resolution happens server-side; client never juggles ids.

### 4.4 `GET /api/v1/routes` — modified
Response extended with `operatorSlug` and `operatorName` on each `ApiRouteLabel`, via `JOIN operators ON operators.id = route_labels.operator_id`. Used by the flat catalogue to show "via **{operator}**" on each `RouteCard`.

No schema work; column additions only. `ApiRouteLabel` type in `client/src/lib/api.ts` gains two non-optional fields (both populated for every route because `operator_id` is `NOT NULL`).

### 4.5 No other endpoints touched
- `POST /api/v1/routes` — unchanged.
- `GET /api/v1/routes/:routeId` — unchanged.
- Conductor, admin, ticket, QR routes — unchanged.

### 4.6 Test coverage (`server/api/tests/http.test.ts`)
- `/operators` excludes zero-route operators (HAVING clause)
- `/operators` returns `routeCount` and `primaryCategory`
- `/operators` sorts by route_count then created_at
- `/operators/:slug` returns schedule summary when sessions exist
- `/operators/:slug` returns null schedule fields when no sessions
- `/operators/:slug/routes` returns routes scoped to that operator
- `/operators/:slug/routes` returns `{ routes: [] }` for a zero-route operator
- `/operators/:slug/routes` returns 404 for unknown slug
- `/routes` response includes `operatorSlug` and `operatorName` on each row

## 5. Frontend routing

### 5.1 Route table (`client/src/App.tsx`)

```tsx
<Route path="/" element={<LandingPage />} />
<Route element={<AppLayout />}>
  <Route path="operators" element={<OperatorsDirectoryPage />} />     {/* NEW */}
  <Route path="operators/:slug" element={<OperatorDetailPage />} />   {/* NEW */}
  <Route path="routes" element={<RoutesPage />} />                    {/* unchanged */}
  <Route path="routes/:routeId" element={<RoutePurchasePage />} />    {/* unchanged */}
  <Route path="pass/:tokenId" element={<PassPage />} />
  <Route path="profile" element={<ProfilePage />} />
  <Route path="conductor" element={<ConductorPage />} />
  <Route path="operator" element={<OperatorPage />} />
  <Route path="admin" element={<AdminPage />} />
</Route>
```

Naming note: `operators` (plural, public directory) vs `operator` (singular, existing admin page). Mirrors the server split of `createOperatorsRouter` vs `createOperatorRouter`. New pages get a header comment pointing to the sibling.

### 5.2 Breadcrumb behaviour
- `/operators` — no breadcrumb (root of its subtree).
- `/operators/:slug` — breadcrumb: **← All operators**.
- `/routes/:routeId` when reached from an operator — breadcrumb: **← {Operator name} · ← All operators**.
- `/routes/:routeId` when reached from `/routes` — breadcrumb: **← All routes**.
- `/routes/:routeId` reached via direct link (no referrer state) — no breadcrumb.

Operator context is passed via `react-router`'s `location.state`, not the URL:
```ts
navigate(`/routes/${routeId}`, { state: { fromOperator: { slug, name } } });
```
`RoutePurchasePage` reads `location.state?.fromOperator` and renders the 2-level breadcrumb when present.

Rationale: `routeId` is globally unique, so scoping the URL to `/operators/:slug/routes/:routeId` earns no backend win. Deep links from SMS / QR / shared URLs still resolve without operator context.

### 5.3 Shared marketplace components

- `client/src/components/marketplace/Breadcrumb.tsx` — `{ items: { label: string; to?: string }[] }`. Last item renders as plain text (not a link).
- `client/src/components/marketplace/OperatorRowSkeleton.tsx` — skeleton for one directory row. Used by `OperatorsDirectoryPage` loading state.

## 6. UI: Operator directory (`/operators`)

New component: `client/src/pages/OperatorsDirectoryPage.tsx`. Single-column scannable list.

### 6.1 Page structure

```
[ Header ]
    Marketplace
    {N} operators · {M} routes available

[ Operator list ]
    ┌────────────────────────────────────────────────────────┐
    │ [logo]  {operator.name}            {route_count} routes│
    │         {primary_category} · {region}                  │
    │         [ {category} ]  [ From MON {min_price} ]       │
    └────────────────────────────────────────────────────────┘
    ... more rows ...

[ Escape hatch footer ]
    Looking for something specific?
    → Browse all {M} routes
```

### 6.2 Row rendering rules
- **Logo block** (56×56): if `logoUrl` is non-null, render image. Otherwise render a gradient block with 2-letter initials from `name`. The gradient pair is chosen deterministically from a hash of `slug` (so the same operator shows the same colors across reloads). No logo upload in MVP.
- **Top line:** `name` (left), `{routeCount} routes` (right).
- **Subtitle:** `{primaryCategory} · {region}`. Omit ` · {region}` when `region` is null. Omit the whole line when both are null (defensive — shouldn't happen under `HAVING COUNT > 0` since `route_labels.category` is `NOT NULL`).
- **Pills:** `[{primaryCategory}]`. One pill per row. (From-price pill is deferred until on-chain price surfacing lands — see §4.1 notes.)
- **Click target:** whole row navigates to `/operators/:slug`.

### 6.3 Page-level states
- **Loading:** 3 `OperatorRowSkeleton` rows.
- **Empty (zero operators returned):**
  ```
  Marketplace
  ─────────────
  No operators yet.

  The marketplace is empty. Once an operator registers and adds a route,
  you'll see them here.

  [ Register as an operator → ] (links to /operator)
  ```
- **Error (fetch failed):** same pattern as `RoutesPage.tsx`'s "failed to load routes" toast + retry button.

### 6.4 Escape hatch footer
Always present except on the empty state. Links to `/routes`. Total route count mirrors the header (sum of `routeCount` across operators).

### 6.5 Tests (vitest + testing-library)
- Rows render when API returns operators (mock `fetch`).
- Empty state when API returns `{ operators: [] }`.
- Loading skeleton shows during in-flight fetch.
- Error state shows on 500.
- Row click navigates to `/operators/:slug`.
- Escape hatch is hidden in the empty state.

## 7. UI: Operator detail (`/operators/:slug`)

New component: `client/src/pages/OperatorDetailPage.tsx`. Tabbed layout.

### 7.1 Page structure

```
[ Breadcrumb ] ← All operators

[ Header ]
    [logo]  {operator.name}
            {primaryCategory} · {region} · {routeCount} routes

[ Tabs ]  Routes | About | Schedule

[ Tab panel — default: Routes ]
```

### 7.2 Data fetches
Two fetches on mount, in parallel:
1. `GET /api/v1/operators/:slug` — header + schedule summary.
2. `GET /api/v1/operators/:slug/routes` — routes for the Routes tab.

### 7.3 Tab selection
Controlled via URL query param `?tab=routes|about|schedule`. No param → default `routes`. Switching tabs updates the URL (`navigate` with `{ replace: true }`). Back/forward restores the active tab.

### 7.4 Routes tab (default)
- Renders each route via the shared `RouteCard` component, passing `showOperator={false}` so the operator name isn't repeated on its own page.
- Sort: by `created_at DESC` (same as flat catalogue — no per-operator re-ordering).
- Card click navigates to `/routes/:routeId` with `{ state: { fromOperator: { slug, name } } }` so `RoutePurchasePage` can render the 2-level breadcrumb (§5.2). If `RouteCard` wraps its own navigation, it exposes a prop (e.g. `navigateState`) the parent can populate; otherwise the parent renders cards with an onClick wrapper. Implementation choice is open.
- **Loading:** 3 `RouteCardSkeleton` rows.
- **Empty (operator exists but `routes: []`):** "This operator hasn't added any routes yet." Only reachable via direct link, since the directory hides zero-route operators.

### 7.5 About tab

```
[ Description ]
    {operator.description || "This operator hasn't added a description yet."}

[ Details ]
    Region:    {region}                    (shown only if non-null)
    Website:   {websiteUrl}                (shown only if non-null)
```

- `websiteUrl` is an `<a target="_blank" rel="noopener noreferrer">`.
- Fields with null values are hidden entirely (not rendered as "—" or "None").
- If **all** of `description`, `region`, `websiteUrl` are null: render "No operator details yet."
- Email is **not** shown here, per the anti-phishing posture in §3.

### 7.6 Schedule tab

Uses `schedule.{firstDeparture, lastDeparture, routesWithSessions}` from the operator fetch.

```
[ Operating hours ]
    Service hours:   {firstDeparture} – {lastDeparture}
    Active routes:   {routesWithSessions} of {routeCount} published

    Derived from the operator's current session data. Refreshes when sessions change.
```

- When `firstDeparture` is null → render instead: "This operator hasn't published a schedule yet. Individual route pages may still show upcoming departures once sessions are added."
- When `routesWithSessions < routeCount` → the "X of Y published" copy communicates the gap.
- No per-route timetable — that's on each route's detail page.

### 7.7 Error / 404 handling
- If either fetch returns 404 (unknown or suspended slug) → full-page "Operator not found" with a link back to `/operators`. Matches the existing 404 pattern in `RoutePurchasePage`.
- If either fetch fails for transport reasons → same retry-toast pattern as the directory.

### 7.8 Tests
- All three tabs render with a populated operator.
- Tab switching updates `?tab=` and vice versa.
- About tab hides null fields row-by-row.
- About tab shows "No operator details yet." when all three fields (description, region, websiteUrl) are null.
- Schedule tab shows the "hasn't published a schedule yet" copy when `firstDeparture` is null.
- Unknown slug → 404 page.
- Routes tab's card click navigates to `/routes/:routeId` with `{ state: { fromOperator } }`.

## 8. UI: `/routes` flat catalogue (fallback)

`client/src/pages/RoutesPage.tsx` stays mostly unchanged. Two additions:

### 8.1 Page header addition
New subtitle and back link under the page header:
```
Routes
All routes across every operator on ChainPass.
← Back to operators                     (always present)
```

### 8.2 Route card addition (shared component)
`RouteCard` gains an optional prop:
```tsx
<RouteCard route={...} showOperator={true} />   // default: true
```
When `showOperator` is true (flat catalogue at `/routes`), the card renders an extra line: `via {operatorName}`. Populated from the new `operatorName` field on `ApiRouteLabel`.

The Routes tab on `/operators/:slug` (§7.4) passes `showOperator={false}` so the operator name isn't redundantly repeated on its own operator's page.

When a card is clicked from `/routes`, it navigates to `/routes/:routeId` **without** `fromOperator` state, so `RoutePurchasePage` shows the 1-level "← All routes" breadcrumb.

### 8.3 No other changes
Favourites, search, filters, empty state — all unchanged.

## 9. Empty states (consolidated)

| Surface | Empty condition | Copy |
|---|---|---|
| `/operators` directory | Zero operators with routes | "No operators yet. The marketplace is empty. Once an operator registers and adds a route, you'll see them here." + CTA → `/operator` |
| `/operators/:slug` Routes tab | Operator has zero routes | "This operator hasn't added any routes yet." |
| `/operators/:slug` About tab | All of `description`, `region`, `websiteUrl` are null | "No operator details yet." |
| `/operators/:slug` Schedule tab | Zero sessions across all operator's routes | "This operator hasn't published a schedule yet. Individual route pages may still show upcoming departures once sessions are added." |
| `/routes` | Zero routes total | Existing "No routes yet..." copy, unchanged |

## 10. File-by-file scope

### New files
- `client/src/pages/OperatorsDirectoryPage.tsx`
- `client/src/pages/OperatorDetailPage.tsx`
- `client/src/components/marketplace/Breadcrumb.tsx`
- `client/src/components/marketplace/OperatorRowSkeleton.tsx`
- `client/src/pages/__tests__/OperatorsDirectoryPage.test.tsx` (if client vitest infra exists; otherwise deferred)
- `client/src/pages/__tests__/OperatorDetailPage.test.tsx` (same note)

### Modified files
- `client/src/App.tsx` — two new route entries.
- `client/src/layouts/AppLayout.tsx` — rename "Routes" → "Marketplace", repoint `to="/operators"`. Apply same rename on mobile bottom-tab bar.
- `client/src/components/landing/LandingPage.tsx` — repoint primary CTA to `/operators`.
- `client/src/pages/RoutesPage.tsx` — header subtitle + "← Back to operators" link. Passes `showOperator={true}` to `RouteCard`.
- `client/src/pages/RoutesPage.tsx` (or wherever `RouteCard` is defined) — `RouteCard` gains optional `showOperator?: boolean` prop (default `true`); renders "via {operatorName}" line when true.
- `client/src/pages/RoutePurchasePage.tsx` — read `location.state?.fromOperator` and render 2-level breadcrumb when present.
- `client/src/lib/api.ts` — extend `ApiOperator` response type with new fields; extend `ApiRouteLabel` with `operatorSlug`/`operatorName`; add `fetchOperator(slug)` and `fetchOperatorRoutes(slug)` functions.
- `server/api/src/routes/operators.ts` — directory query with joins and aggregates; slug handler with schedule summary; new `/:slug/routes` endpoint.
- `server/api/src/routes/routes.ts` — JOIN operators; return `operatorSlug` + `operatorName` per route.
- `server/api/src/schema.ts` — new `OPERATORS_MIGRATE_MARKETPLACE_FIELDS_SQL` constant.
- `server/api/src/lib/db.ts` — run the new migration at startup.
- `server/api/tests/http.test.ts` — tests per section 4.6.

### Files NOT changed
- `contracts/*` — no contract changes.
- `server/indexer/*` — no indexer changes.
- `shared/*` — no changes. `stableRouteIdDecimalForLabel` and related routeId logic are untouched.
- Seat / session / ticket / QR / conductor paths — all untouched.

## 11. Ship checklist

- One DB migration: additive, idempotent, all columns nullable. Safe under concurrent boot.
- One API-level breaking change: `ApiRouteLabel` gains `operatorSlug` and `operatorName`. Because every `route_labels` row has a non-null `operator_id` (enforced by the previous migration), these fields are always populated — clients that don't use them continue to work.
- No contract redeploy required.
- No indexer reset required.
- Deployable as a single PR.

## 12. Future work (explicitly deferred)

- Per-operator auth middleware (Phase 1 Step 4).
- Operator-owner admin surface for About tab edits.
- Logo uploads.
- Search / filter / sort on the operator directory.
- Per-route schedule aggregation beyond operating-hours summary.
- Operator ratings / reviews (distinct from the existing per-route ratings).
- Multi-tenant billing / payouts.
- Surfacing on-chain `mintPrice` in the directory (so rows can show a "From MON X" pill). Requires either a cached contract read or a price-snapshot table; deferred because the MVP is already the-shape-of-a-marketplace without it.
