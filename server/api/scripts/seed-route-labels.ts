import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadRootEnv } from "../src/load-env.js";
import {
  ROUTE_LABELS_INIT_SQL,
  ROUTE_LABELS_MIGRATE_CATEGORY_SQL,
  ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL,
} from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type NigeriaRoutesFile = {
  routes: Array<{
    routeId: number | string;
    category?: string;
    name: string;
    detail?: string | null;
  }>;
};

loadRootEnv();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const jsonPath = resolve(__dirname, "../../../config/nigeria-routes.json");
  const raw = readFileSync(jsonPath, "utf8");
  const data = JSON.parse(raw) as NigeriaRoutesFile;

  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(ROUTE_LABELS_INIT_SQL);
    await pool.query(ROUTE_LABELS_MIGRATE_CATEGORY_SQL);
    await pool.query(ROUTE_LABELS_MIGRATE_ROUTE_ID_TO_TEXT_SQL);
    for (const row of data.routes) {
      const category = row.category?.trim() || "General";
      // operator_id is NOT NULL post-migration. Attach new seed rows to the
      // earliest-created still-active operator (the seed row in every current
      // deployment) so the script works against a freshly migrated DB without
      // needing a separate lookup round trip or a hardcoded slug. Existing
      // rows keep their operator_id through the DO UPDATE (operator_id is
      // not in the SET list, so ON CONFLICT leaves it alone).
      await pool.query(
        `INSERT INTO route_labels (route_id, name, detail, category, operator_id)
         VALUES ($1, $2, $3, $4,
           (SELECT id FROM operators WHERE status = 'active' ORDER BY id ASC LIMIT 1))
         ON CONFLICT (route_id) DO UPDATE SET
           name = EXCLUDED.name,
           detail = EXCLUDED.detail,
           category = EXCLUDED.category`,
        [String(row.routeId), row.name, row.detail ?? null, category],
      );
    }
    console.log(`[seed-route-labels] upserted ${data.routes.length} rows`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
