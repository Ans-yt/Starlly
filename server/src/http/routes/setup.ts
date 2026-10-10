import { asyncRouter } from "../async-router.js";
// Setup gate routes (spec §4.2). Status is public-but-secretless (the SPA needs
// it on first run, before any auth exists); completion and Places choices are
// owner actions. Keys are never returned here — only booleans and timestamps.
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { AppServices } from "../app.js";
import { business } from "../../db/schema.js";
import { getBusinessRow, setupFactsOf } from "../../storage/business.js";
import { evaluateSetup } from "../../domain/setup.js";
import { isConfigured, requireOwner } from "../auth.js";

const now = () => new Date().toISOString();

export function setupRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  // Status is public-but-secretless: the SPA must see it on first run before
  // any password exists. Everything that mutates requires the owner.
  router.get("/setup/status", (_req, res) => {
    const row = getBusinessRow(db);
    // The completion latch wins (same rule as the 503 middleware): once the
    // owner has finished setup, deleting data must NOT re-close the gate.
    const evaluation = evaluateSetup(setupFactsOf(row));
    const setupComplete = Boolean(row.setupCompletedAt) || evaluation.setupComplete;
    res.json({
      setupComplete,
      blocked: setupComplete ? [] : evaluation.blocked,
      items: evaluation.items,
      // Whether the owner password exists yet (the last gate step asks for one).
      passwordConfigured: isConfigured(db),
    });
  });

  router.use("/setup", requireOwner(db));

  router.post("/setup/complete", (_req, res) => {
    const row = getBusinessRow(db);
    const evaluation = evaluateSetup(setupFactsOf(row));
    if (!evaluation.setupComplete) {
      res.status(409).json({
        error: "setup_incomplete",
        blocked: evaluation.blocked,
        items: evaluation.items,
      });
      return;
    }
    db.update(business).set({ setupCompletedAt: now(), updatedAt: now() }).where(eq(business.id, 1)).run();
    res.json({ ok: true });
  });

  // Explicit skip choice: "I'll paste or import my reviews instead" (S3).
  router.post("/setup/places-skip", (_req, res) => {
    db.update(business).set({ placesMode: "import", updatedAt: now() }).where(eq(business.id, 1)).run();
    res.json({ ok: true });
  });

  // Undo the skip (owner picked a Places key after all).
  router.post("/setup/places-use-key", (_req, res) => {
    db.update(business).set({ placesMode: "places", updatedAt: now() }).where(eq(business.id, 1)).run();
    res.json({ ok: true });
  });

  return router;
}
