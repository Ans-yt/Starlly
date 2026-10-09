import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { requireOwner } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { setupRouter } from "./routes/setup.js";
import { businessRouter } from "./routes/business.js";
import { customersRouter } from "./routes/customers.js";
import { draftsRouter } from "./routes/drafts.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { dataRouter } from "./routes/data.js";
import { aiRouter } from "./routes/ai.js";
import { reviewsRouter } from "./routes/reviews.js";
import { themesRouter } from "./routes/themes.js";
import { rebookingRouter } from "./routes/rebooking.js";
import { chatRouter } from "./routes/chat.js";
import { getBusinessRow, setupFactsOf } from "../storage/business.js";
import { evaluateSetup } from "../domain/setup.js";
import type { Request, Response, NextFunction } from "express";

export interface AppServices {
  db: AppDatabase;
  config: AppConfig;
}

export function createApp(services: AppServices): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // Unauthenticated surfaces (ADR-0005): health, auth, and the token-guarded public routes.
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter(services));
  app.use("/api/public", publicRouter(services));
  // Setup status is public-but-secretless; setup mutations re-check ownership.
  app.use("/api", setupRouter(services));

  // Setup gate (S1): until the ordered setup is complete, owner data surfaces
  // answer 503 setup_incomplete — the SPA redirects every route to /setup.
  // Once completed, the latch stays set: deleting data later does not force
  // the owner through onboarding again (login still protects everything).
  const requireSetupComplete = (req: Request, res: Response, next: NextFunction): void => {
    const row = getBusinessRow(services.db);
    const complete = Boolean(row.setupCompletedAt) || evaluateSetup(setupFactsOf(row)).setupComplete;
    if (complete) {
      next();
      return;
    }
    res.status(503).json({ error: "setup_incomplete", message: "Finish setup first." });
  };

  // Owner API — open only in first-run setup mode; session-guarded once a password exists.
  app.use("/api", requireOwner(services.db));
  app.use("/api", businessRouter(services));
  app.use("/api", draftsRouter(services));
  app.use("/api", requireSetupComplete);
  app.use("/api", customersRouter(services));
  app.use("/api", dashboardRouter(services));
  app.use("/api", dataRouter(services));
  app.use("/api", aiRouter(services));
  app.use("/api", reviewsRouter(services));
  app.use("/api", themesRouter(services));
  app.use("/api", rebookingRouter(services));
  app.use("/api", chatRouter(services));

  // Serve the built frontend (same process owns the public customer pages).
  const webDist = path.resolve(process.cwd(), "../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA fallback for owner routes and /c/:token; never swallow /api.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  // Error handler — message only, never secrets.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[error] ${err.message}`);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
