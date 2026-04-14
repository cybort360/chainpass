import { CHAINPASS_SHARED_VERSION } from "@chainpass/shared";
import cors from "cors";
import express, { type Express } from "express";
import morgan from "morgan";
import { createOperatorRouter } from "./routes/operator.js";
import { createQrRouter } from "./routes/qr.js";
import { createRatingsRouter } from "./routes/ratings.js";
import { createRiderRouter } from "./routes/rider.js";
import { createRoutesRouter } from "./routes/routes.js";
import { createSeatsRouter } from "./routes/seats.js";
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

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "chainpass-api",
      stack: "express",
      runtime: "node",
      shared: CHAINPASS_SHARED_VERSION,
    });
  });

  app.use("/api/v1/qr", createQrRouter());
  app.use("/api/v1/operator", createOperatorRouter());
  app.use("/api/v1/rider", createRiderRouter());
  app.use("/api/v1", createRatingsRouter());
  app.use("/api/v1", createRoutesRouter());
  app.use("/api/v1", createSeatsRouter());
  app.use("/api/v1", createTripsRouter());

  return app;
}
