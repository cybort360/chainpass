import { createApp } from "./app.js";
import { ensureRouteLabelsTable } from "./lib/db.js";
import { loadRootEnv } from "./load-env.js";

loadRootEnv();

async function main(): Promise<void> {
  await ensureRouteLabelsTable();
  const app = createApp();
  const port = Number(process.env.PORT) || 3001;

  app.listen(port, () => {
    console.log(
      `[chainpass-api] Express on Node.js → http://localhost:${port} (health: /health)`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
