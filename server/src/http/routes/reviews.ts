import { parseCsv } from "../../domain/csv.js";
import { asyncRouter } from "../async-router.js";
// Review corpus import (spec §5.3): pasted text and CSV upload become
// corpus rows (GLOSSARY: public review vs private feedback). Private feedback
// arrives via the customer page, not here.
import { Router } from "express";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { insightSummaries, reviewThemes, reviews, themes } from "../../db/schema.js";
import { tagUntaggedReviews, isTransformersMissingError, TaggerError } from "../../inference/tagger.js";
import { embedCached } from "../../inference/embedder.js";
import { cosineSimilarity } from "../../inference/tagging.js";
import { detectRatingDrop, detectThemeSpikes, windowIndexFor, type ThemeSeries } from "../../domain/trends.js";

const now = () => new Date().toISOString();
/** Above this cosine similarity, two reviews are worth the owner's attention. */
export const DUPLICATE_THRESHOLD = 0.92;
/** Weekly windows used by trend alerts (rolling 7-day buckets). */
const TREND_WEEKS = 5;

function reviewRow(row: typeof reviews.$inferSelect) {
  return {
    id: row.id,
    source: row.source,
    author: row.author,
    rating: row.rating,
    date: row.reviewDate ?? row.createdAt,
    text: row.text,
    sentiment: row.sentiment,
    replied: row.replied,
    themeIds: [] as string[],
  };
}

export function reviewsRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  router.get("/reviews", (req, res) => {
    const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
    let rows = db.select().from(reviews).orderBy(desc(reviews.createdAt)).all();
    if (filter === "needs_reply") rows = rows.filter((r) => !r.replied);
    if (filter === "low") rows = rows.filter((r) => r.rating != null && r.rating <= 3);
    const tags = db.select().from(reviewThemes).all();
    const byReview = new Map<string, string[]>();
    for (const t of tags) {
      const list = byReview.get(t.reviewId) ?? [];
      list.push(t.themeId);
      byReview.set(t.reviewId, list);
    }
    res.json({
      reviews: rows.map((r) => ({ ...reviewRow(r), themeIds: byReview.get(r.id) ?? [] })),
    });
  });

  router.post("/reviews", (req, res) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(20_000),
        author: z.string().max(120).optional(),
        rating: z.number().int().min(1).max(5).nullable().optional(),
        reviewDate: z.string().optional(),
        source: z.enum(["pasted", "google_import"]).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const id = crypto.randomUUID();
    const ts = now();
    db.insert(reviews)
      .values({
        id,
        source: parsed.data.source ?? "pasted",
        author: parsed.data.author ?? "Imported review",
        rating: parsed.data.rating ?? null,
        reviewDate: parsed.data.reviewDate ?? ts,
        text: parsed.data.text,
        createdAt: ts,
      })
      .run();
    res.json({ id });
  });

  // CSV import: author, rating, date, text
  router.post("/reviews/import", (req, res) => {
    const parsed = z.object({ csv: z.string().min(1).max(2_000_000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    let lines: string[][];
    try { lines = parseCsv(parsed.data.csv); } catch {res.status(400).json({error:"validation",message:"CSV contains an invalid quoted field."});return;}
    if (lines.length < 2) {
      res.status(400).json({ error: "validation", message: "CSV needs a header row and at least one review." });
      return;
    }
    const header = lines[0]!.map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    if (idx("text") < 0) {
      res.status(400).json({ error: "validation", message: "CSV must have a 'text' column." });
      return;
    }
    let imported = 0;
    const errors: { line: number; message: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i]!;
      const text = idx("text") >= 0 ? (fields[idx("text")] ?? "").trim() : "";
      if (!text) {
        errors.push({ line: i + 1, message: "Missing text." });
        continue;
      }
      const ratingRaw = idx("rating") >= 0 ? (fields[idx("rating")] ?? "").trim() : "";
      const rating = Number(ratingRaw);
      if (text.length > 20000 || (ratingRaw && (!Number.isInteger(rating) || rating < 1 || rating > 5))) {errors.push({line:i+1,message:"Review text is too long or rating must be an integer 1–5."});continue;}
      const ts = now();
      db.insert(reviews)
        .values({
          id: crypto.randomUUID(),
          source: "google_import",
          author: idx("author") >= 0 ? (fields[idx("author")] ?? "").trim() : "Imported review",
          rating: ratingRaw && rating >= 1 && rating <= 5 ? rating : null,
          reviewDate: idx("date") >= 0 && (fields[idx("date")] ?? "").trim() ? (fields[idx("date")] ?? "").trim() : ts,
          text,
          createdAt: ts,
        })
        .run();
      imported++;
    }
    res.json({ imported, errors });
  });

  router.delete("/reviews/:id", (req, res) => {
    const id = req.params.id ?? "";
    const row = db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    db.transaction((tx) => {
      tx.delete(insightSummaries).run();
      tx.delete(reviewThemes).where(eq(reviewThemes.reviewId, id)).run();
      tx.delete(reviews).where(eq(reviews.id, id)).run();
    });
    res.json({ ok: true });
  });

  // Tag untagged corpus reviews with themes + sentiment (ADR-0003).
  router.post("/insights/tag", async (_req, res) => {
    try {
      const result = await tagUntaggedReviews(db);
      res.json(result);
    } catch (err) {
      if (err instanceof TaggerError) {
        res.status(400).json({ error: "no_themes", message: err.message });
        return;
      }
      if (isTransformersMissingError(err)) {
        res.status(503).json({
          error: "model_unavailable",
          message: "Local tagging model is not available. Run npm install, then try again.",
        });
        return;
      }
      const message = err instanceof Error ? err.message : "Tagging failed.";
      res.status(500).json({ error: "tagging_failed", message });
    }
  });

  // Trend alerts (spec §7.3): weekly theme counts + rating averages, z-scored.
  router.get("/insights/alerts", (_req, res) => {
    const nowMs = Date.now();
    const reviewRows = db.select().from(reviews).all();
    const themeRows = db.select().from(themes).all();
    const tags = db.select().from(reviewThemes).all();
    const reviewById = new Map(reviewRows.map((r) => [r.id, r]));

    const countsByTheme = new Map<string, number[]>(themeRows.map((t) => [t.id, new Array<number>(TREND_WEEKS).fill(0)]));
    for (const tag of tags) {
      const review = reviewById.get(tag.reviewId);
      if (!review) continue;
      const w = windowIndexFor(review.reviewDate ?? review.createdAt, TREND_WEEKS, nowMs);
      if (w < 0) continue;
      const arr = countsByTheme.get(tag.themeId);
      if (arr) arr[w]!++;
    }
    const series: ThemeSeries[] = themeRows
      .map((t) => ({ themeId: t.id, themeName: t.name, counts: countsByTheme.get(t.id) ?? [] }))
      .filter((s) => s.counts.length === TREND_WEEKS);
    const alerts = detectThemeSpikes(series);

    const sums = new Array<number>(TREND_WEEKS).fill(0);
    const counts = new Array<number>(TREND_WEEKS).fill(0);
    for (const review of reviewRows) {
      if (review.rating == null) continue;
      const w = windowIndexFor(review.reviewDate ?? review.createdAt, TREND_WEEKS, nowMs);
      if (w < 0) continue;
      sums[w]! += review.rating;
      counts[w]!++;
    }
    const averages = sums.map((s, i) => (counts[i]! > 0 ? s / counts[i]! : 0));
    const ratingAlert = detectRatingDrop(averages);
    if (ratingAlert) alerts.push(ratingAlert);

    res.json({ alerts, windowCount: TREND_WEEKS });
  });

  // Near-duplicate detector (spec §7): embedding similarity flags unusually
  // similar reviews for the owner to look at. Flag only — no accusation.
  router.post("/insights/duplicates", async (_req, res) => {
    const rows = db.select().from(reviews).all();
    if (rows.length < 2) {
      res.json({ pairs: [], threshold: DUPLICATE_THRESHOLD, note: "Not enough reviews to compare." });
      return;
    }
    try {
      const vectors = await embedCached(db, rows.map((r) => r.text));
      const pairs: { aId: string; aText: string; bId: string; bText: string; similarity: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const similarity = cosineSimilarity(vectors[i]!, vectors[j]!);
          if (similarity >= DUPLICATE_THRESHOLD) {
            pairs.push({
              aId: rows[i]!.id,
              aText: rows[i]!.text.slice(0, 120),
              bId: rows[j]!.id,
              bText: rows[j]!.text.slice(0, 120),
              similarity: Math.round(similarity * 1000) / 1000,
            });
          }
        }
      }
      res.json({
        pairs,
        threshold: DUPLICATE_THRESHOLD,
        note: "Flag only — a similarity score never proves a review is fake.",
      });
    } catch (err) {
      if (isTransformersMissingError(err)) {
        res.status(503).json({ error: "model_unavailable", message: "Local embedding model is not available." });
        return;
      }
      res.status(500).json({ error: "duplicates_failed", message: err instanceof Error ? err.message : "failed" });
    }
  });

  return router;
}
