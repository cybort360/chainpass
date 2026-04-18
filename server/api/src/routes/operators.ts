import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * Public operator directory.
 *
 * GET /operators        — non-suspended operators with ≥1 route, ordered
 *                         busiest first (by route count) then newest. Operators
 *                         with zero routes are hidden so the directory never
 *                         shows dead-end listings to riders.
 * GET /operators/:slug  — single operator by slug, returning the operator row
 *                         plus marketplace aggregates (route_count,
 *                         primary_category) and a schedule summary
 *                         (firstDeparture, lastDeparture, routesWithSessions)
 *                         sourced from route_sessions. Unlike the directory
 *                         query, the slug query has no HAVING clause so direct
 *                         links to an operator with zero routes still resolve
 *                         (404 is reserved for unknown or suspended slugs).
 *
 * Both endpoints are public read (no auth). admin_wallet and treasury_wallet
 * are intentionally included because they are already on-chain (every mint
 * and role event emits them) so the API surface adds no new disclosure.
 * contact_email is deliberately NOT returned here — emails on unauthenticated
 * JSON endpoints are a phishing harvest target; we'll add an explicit public
 * contact channel when an operator opts in, not by default.
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

type ScheduleSummaryRow = {
  first_departure: string | null;
  last_departure: string | null;
  routes_with_sessions: number;
};

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
        `SELECT o.id, o.slug, o.name, o.admin_wallet, o.treasury_wallet, o.status,
                o.logo_url, o.region, o.description, o.website_url, o.created_at,
                COUNT(r.route_id)::int                    AS route_count,
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
      const opResult = await pool.query<OperatorAggregateRow>(
        `SELECT o.id, o.slug, o.name, o.admin_wallet, o.treasury_wallet, o.status,
                o.logo_url, o.region, o.description, o.website_url, o.created_at,
                COUNT(r.route_id)::int                    AS route_count,
                MODE() WITHIN GROUP (ORDER BY r.category) AS primary_category
         FROM operators o
         LEFT JOIN route_labels r ON r.operator_id = o.id
         WHERE o.slug = $1 AND o.status <> 'suspended'
         GROUP BY o.id
         LIMIT 1`,
        [slug],
      );
      if (opResult.rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const opRow = opResult.rows[0]!;
      // Schedule summary is keyed by the resolved operator id. The LEFT JOIN +
      // s.id IS NOT NULL guard makes "no sessions" return nulls / 0 rather
      // than no row, so the response always has a schedule object.
      const schResult = await pool.query<ScheduleSummaryRow>(
        `SELECT MIN(s.departure_time)::text      AS first_departure,
                MAX(s.departure_time)::text      AS last_departure,
                COUNT(DISTINCT r.route_id)::int  AS routes_with_sessions
         FROM route_labels r
         LEFT JOIN route_sessions s ON s.route_id = r.route_id
         WHERE r.operator_id = $1
           AND s.id IS NOT NULL`,
        [opRow.id],
      );
      const sch = schResult.rows[0] ?? {
        first_departure: null,
        last_departure: null,
        routes_with_sessions: 0,
      };
      res.json({
        operator: {
          ...toResponse(opRow),
          schedule: {
            firstDeparture: sch.first_departure,
            lastDeparture: sch.last_departure,
            routesWithSessions: Number(sch.routes_with_sessions),
          },
        },
      });
    } catch (err) {
      console.error("[operators]", err);
      res.status(500).json({ error: "failed to read operator" });
    }
  });

  return r;
}
