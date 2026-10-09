// Dashboard API (ticket 009). Every number is computed from stored records
// (architecture rule 7); Google listing stats stay separate from corpus
// statistics (ADR-0001).
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { AppServices } from "../app.js";
import { events, requests, reviews, themes, reviewThemes } from "../../db/schema.js";
import { getBusinessRow } from "../../storage/business.js";
import { listCustomersWithStatus } from "../../storage/customer-views.js";
import { computeFunnel } from "../../domain/funnel.js";
import type { EventRecord } from "../../domain/events.js";

export function dashboardRouter(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  router.get("/dashboard", (req, res) => {
    const businessRow = getBusinessRow(db);
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;

    const allCustomers = listCustomersWithStatus(db);
    const waitingCount = allCustomers.filter((c) => c.derived === "waiting").length;
    const needsCall = allCustomers
      .filter((c) => c.derived === "needs_call")
      .map((c) => ({ id: c.id, name: c.name, contact: c.contact }));

    // Funnel from persisted events over sent requests (domain, pure).
    const sentRequests = db.select().from(requests).where(eq(requests.status, "sent")).all();
    const allEvents = db.select().from(events).all();
    const eventRecords: EventRecord[] = allEvents.map((e) => ({
      requestId: e.requestId,
      type: e.type as EventRecord["type"],
      value: e.value,
      createdAt: e.createdAt,
    }));
    const funnel = computeFunnel(
      sentRequests.map((r) => r.id),
      eventRecords,
    );

    // Rating trend over the corpus (imported reviews + private feedback),
    // bucketed by day. Google listing stats are NOT part of this series.
    const corpus = db.select().from(reviews).all();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const ratingTrend: { date: string; average: number; count: number }[] = [];
    const byDay = new Map<string, { sum: number; count: number }>();
    for (const review of corpus) {
      if (review.rating == null) continue;
      const day = (review.reviewDate ?? review.createdAt).slice(0, 10);
      const dayMs = new Date(`${day}T00:00:00Z`).getTime();
      if (dayMs < since) continue;
      const entry = byDay.get(day) ?? { sum: 0, count: 0 };
      entry.sum += review.rating;
      entry.count += 1;
      byDay.set(day, entry);
    }
    for (const [date, { sum, count }] of [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      ratingTrend.push({ date, average: Math.round((sum / count) * 100) / 100, count });
    }

    // Theme counts split by sentiment ("+" praise / "−" complaints).
    const allThemes = db.select().from(themes).all();
    const allReviewThemes = db.select().from(reviewThemes).all();
    const reviewById = new Map(corpus.map((r) => [r.id, r]));
    const themeCounts = allThemes.map((theme) => {
      let positive = 0;
      let negative = 0;
      for (const rt of allReviewThemes) {
        if (rt.themeId !== theme.id) continue;
        const review = reviewById.get(rt.reviewId);
        if (review?.sentiment === "positive") positive++;
        if (review?.sentiment === "negative") negative++;
      }
      return { id: theme.id, name: theme.name, positive, negative };
    });

    // Recent reviews feed with filters (all | needs_reply | low).
    const feedFilter = typeof req.query.feed === "string" ? req.query.feed : "all";
    const recent = db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(200).all();
    const filtered = recent.filter((r) => {
      if (feedFilter === "needs_reply") return !r.replied;
      if (feedFilter === "low") return r.rating != null && r.rating <= 3;
      return true;
    });

    const sampleLoaded =
      businessRow.isSample ||
      allCustomers.some((c) => c.isSample) ||
      corpus.some((r) => r.isSample) ||
      allEvents.some((e) => e.isSample);

    const emailAdapter = businessRow.emailAdapterId;
    // D7: "Email connected ✓" reflects a real passing test only — the
    // timestamp is written exclusively by /api/settings/test-email on success.
    // Copy only has no connection to test: it never shows "connected".
    const emailConnected = emailAdapter !== "copy-only" && Boolean(businessRow.emailLastTestAt);
    const emailConnectedAt = emailConnected ? businessRow.emailLastTestAt : null;

    res.json({
      company: {
        name: businessRow.name,
        ownerName: businessRow.ownerName,
        city: businessRow.city,
        sinceDate: businessRow.sinceDate,
        // Google listing stats — displayed separately, never merged into corpus stats.
        googleRating: businessRow.googleRating,
        googleReviewCount: businessRow.googleReviewCount,
        emailConnected: emailConnected,
        emailConnectedAt,
        emailAdapter,
        isSample: businessRow.isSample,
      },
      waitingCount,
      funnel,
      ratingTrend,
      themes: themeCounts,
      needsCall,
      recentReviews: filtered.slice(0, 10).map((r) => ({
        id: r.id,
        source: r.source,
        author: r.author,
        rating: r.rating,
        date: r.reviewDate ?? r.createdAt,
        snippet: r.text.slice(0, 160),
        replied: r.replied,
        sentiment: r.sentiment,
      })),
      sampleLoaded,
    });
  });

  return router;
}

