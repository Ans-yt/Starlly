// Owner-curated themes (GLOSSARY: Theme). The LLM may propose; the owner edits.
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { reviewThemes, themes } from "../../db/schema.js";

const now = () => new Date().toISOString();

export function themesRouter(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  router.get("/themes", (_req, res) => {
    const rows = db.select().from(themes).all();
    const counts = db.select().from(reviewThemes).all();
    const countByTheme = new Map<string, number>();
    for (const rt of counts) countByTheme.set(rt.themeId, (countByTheme.get(rt.themeId) ?? 0) + 1);
    res.json({
      themes: rows.map((t) => ({ id: t.id, name: t.name, description: t.description, reviewCount: countByTheme.get(t.id) ?? 0 })),
    });
  });

  router.post("/themes", (req, res) => {
    const parsed = z
      .object({ name: z.string().min(1).max(60), description: z.string().max(400).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const id = crypto.randomUUID();
    db.insert(themes)
      .values({ id, name: parsed.data.name, description: parsed.data.description ?? "", createdAt: now() })
      .run();
    res.json({ id });
  });

  router.patch("/themes/:id", (req, res) => {
    const parsed = z
      .object({ name: z.string().min(1).max(60).optional(), description: z.string().max(400).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const row = db.select().from(themes).where(eq(themes.id, req.params.id ?? "")).get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    db.update(themes)
      .set({ ...parsed.data })
      .where(eq(themes.id, row.id))
      .run();
    res.json({ ok: true });
  });

  router.delete("/themes/:id", (req, res) => {
    const id = req.params.id ?? "";
    const row = db.select().from(themes).where(eq(themes.id, id)).get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    db.transaction((tx) => {
      tx.delete(reviewThemes).where(eq(reviewThemes.themeId, id)).run();
      tx.delete(themes).where(eq(themes.id, id)).run();
    });
    res.json({ ok: true });
  });

  return router;
}
