import { CHAINPASS_SHARED_VERSION } from "@chainpass/shared";
import cors from "cors";
import express, { type Express } from "express";
import morgan from "morgan";
import { getPool } from "./lib/db.js";
import { createAdminRouter } from "./routes/admin.js";
import { createOperatorRouter } from "./routes/operator.js";
import { createOperatorsRouter } from "./routes/operators.js";
import { createQrRouter } from "./routes/qr.js";
import { createRatingsRouter } from "./routes/ratings.js";
import { createRiderRouter } from "./routes/rider.js";
import { createRoutesRouter } from "./routes/routes.js";
import { createSeatsRouter } from "./routes/seats.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createTripsRouter } from "./routes/trips.js";

export function createApp(): Express {
  const app = express();

  app.use(morgan("dev"));
  /** Hackathon: allow any browser origin (`origin: true` reflects the request `Origin` header; works with `credentials: true`). */
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    // Actually ping the DB — `databaseConnected` confirms the pool can round-trip.
    // `databaseConfigured` tells us only whether DATABASE_URL is set.
    let databaseConnected = false;
    let databaseError: string | null = null;
    if (process.env.DATABASE_URL?.trim()) {
      try {
        await getPool().query("SELECT 1");
        databaseConnected = true;
      } catch (err) {
        databaseError = err instanceof Error ? err.message : String(err);
      }
    }
    res.json({
      ok: true,
      service: "chainpass-api",
      stack: "express",
      runtime: "node",
      shared: CHAINPASS_SHARED_VERSION,
      databaseConfigured: !!process.env.DATABASE_URL,
      databaseConnected,
      databaseError,
    });
  });

  app.use("/api/v1/qr", createQrRouter());
  app.use("/api/v1/admin", createAdminRouter());
  app.use("/api/v1/operator", createOperatorRouter());
  app.use("/api/v1/rider", createRiderRouter());
  app.use("/api/v1", createRatingsRouter());
  app.use("/api/v1", createRoutesRouter());
  app.use("/api/v1", createOperatorsRouter());
  app.use("/api/v1", createSeatsRouter());
  app.use("/api/v1", createSessionsRouter());
  app.use("/api/v1", createTripsRouter());

  return app;
}
