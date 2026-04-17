import { Router } from "express";
import { getPool } from "../lib/db.js";

/**
 * Public operator directory.
 *
 * GET /operators        — list all non-suspended operators, newest first.
 * GET /operators/:slug  — single operator by slug; 404 if not found or suspended.
 *
 * Both endpoints are public read (no auth). admin_wallet and treasury_wallet
 * are intentionally included because they are already on-chain (every mint
 * and role event emits them) so the API surface adds no new disclosure.
 * contact_email is deliberately NOT returned here — emails on unauthenticated
 * JSON endpoints are a phishing harvest target; we'll add an explicit public
 * contact channel when an operator opts in, not by default.
 */
type OperatorRow = {
  id: number;
  slug: string;
  name: string;
  admin_wallet: string | null;
  treasury_wallet: string | null;
  status: string;
  logo_url: string | null;
  created_at: Date;
};

const OPERATOR_SELECT_COLUMNS = `
  id, slug, name, admin_wallet, treasury_wallet, status,
  logo_url, created_at
`;

function toResponse(row: OperatorRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adminWallet: row.admin_wallet,
    treasuryWallet: row.treasury_wallet,
    status: row.status,
    logoUrl: row.logo_url,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
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
        `SELECT ${OPERATOR_SELECT_COLUMNS} FROM operators
         WHERE status <> 'suspended'
         ORDER BY created_at DESC, id DESC`,
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
      const { rows } = await getPool().query<OperatorRow>(
        `SELECT ${OPERATOR_SELECT_COLUMNS} FROM operators
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
      console.error("[operators]", err);
      res.status(500).json({ error: "failed to read operator" });
    }
  });

  return r;
}
