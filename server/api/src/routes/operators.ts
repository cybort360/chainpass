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
