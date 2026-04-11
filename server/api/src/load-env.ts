import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load `server/api/.env` only (cwd is this package when using `pnpm` dev/start). */
export function loadRootEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (existsSync(p)) {
    config({ path: p });
  }
}
