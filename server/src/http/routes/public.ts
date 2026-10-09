// Public customer-page API (ADR-0005, ticket 007). The only unauthenticated
// surface: token-guarded, rate-limited, minimal data exposure. Never returns
// customer contact details.
import { Router } from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { and, eq as eqOp } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { events, requests, reviews } from "../../db/schema.js";
import { getBusinessRow } from "../../storage/business.js";
import { getCustomerById } from "../../storage/customer-views.js";
import { isValidRating } from "../../domain/events.js";

const now = () => new Date().toISOString();

const publicGetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const publicPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-token throttle (in-memory; single self-hosted instance).
const tokenHits = new Map<string, number[]>();
function tokenThrottle(token: string, max = 40, windowMs = 10 * 60 * 1000): boolean {
  const nowMs = Date.now();
  const hits = (tokenHits.get(token) ?? []).filter((t) => t > nowMs - windowMs);
  if (hits.length >= max) {
    tokenHits.set(token, hits);
    return false;
  }
  hits.push(nowMs);
  tokenHits.set(token, hits);
  return true;
}

interface TokenRequest {
  row: typeof requests.$inferSelect;
}

function loadValidRequest(services: AppServices, token: string): TokenRequest | { error: number; message: string } {
  const row = services.db.select().from(requests).where(eqOp(requests.token, token)).get();
  if (!row) return { error: 404, message: "Unknown link." };
  if (row.revokedAt) return { error: 410, message: "This link was revoked." };
  if (row.status !== "sent") return { error: 410, message: "This link is not active yet." };
  if (row.expiresAt && row.expiresAt < now()) return { error: 410, message: "This link has expired." };
  return { row };
}

function recordEvent(services: AppServices, requestId: string, type: string, value?: string): void {
  services.db
    .insert(events)
    .values({ id: crypto.randomUUID(), requestId, type, value: value ?? null, createdAt: now() })
    .run();
}

function pageState(services: AppServices, requestId: string) {
  const rows = services.db.select().from(events).where(eqOp(events.requestId, requestId)).all();
  let rating: number | null = null;
  let feedbackSubmitted = false;
  let callRequested = false;
  for (const e of rows) {
    if (e.type === "rated") rating = Number(e.value);
    if (e.type === "feedback_submitted") feedbackSubmitted = true;
    if (e.type === "call_requested") callRequested = true;
  }
  return { rating, feedbackSubmitted, callRequested };
}

export function publicRouter(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  router.get("/requests/:token", publicGetLimiter, (req, res) => {
    if (!tokenThrottle(req.params.token ?? "")) {
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again later." });
      return;
    }
    const found = loadValidRequest(services, req.params.token ?? "");
    if ("error" in found) {
      res.status(found.error).json({ error: "link_invalid", message: found.message });
      return;
    }
    const business = getBusinessRow(db);
    // Record "opened" once per request (funnel counts requests, not loads).
    const existingOpened = db
      .select()
      .from(events)
      .where(and(eqOp(events.requestId, found.row.id), eqOp(events.type, "opened")))
      .get();
    if (!existingOpened) {
      recordEvent(services, found.row.id, "opened");
    }
    res.json({
      businessName: business.name,
      question: "How did we do?",
      // The one canonical link — identical for every rating (spec 5.2, ADR-0005).
      googleReviewUrl: business.googleReviewUrl,
      state: pageState(services, found.row.id),
    });
  });

  router.post("/requests/:token/rate", publicPostLimiter, (req, res) => {
    const found = loadValidRequest(services, req.params.token ?? "");
    if ("error" in found) {
      res.status(found.error).json({ error: "link_invalid", message: found.message });
      return;
    }
    const rating = (req.body as { rating?: unknown }).rating;
    if (!isValidRating(rating)) {
      res.status(400).json({ error: "validation", message: "Rating must be an integer 1–5." });
      return;
    }
    recordEvent(services, found.row.id, "rated", String(rating));
    res.json({ ok: true, state: pageState(services, found.row.id) });
  });

  router.post("/requests/:token/google-click", publicPostLimiter, (req, res) => {
    const found = loadValidRequest(services, req.params.token ?? "");
    if ("error" in found) {
      res.status(found.error).json({ error: "link_invalid", message: found.message });
      return;
    }
    // GLOSSARY: this event never means "posted a review".
    recordEvent(services, found.row.id, "google_click");
    res.json({ ok: true });
  });

  router.post("/requests/:token/feedback", publicPostLimiter, (req, res) => {
    const found = loadValidRequest(services, req.params.token ?? "");
    if ("error" in found) {
      res.status(found.error).json({ error: "link_invalid", message: found.message });
      return;
    }
    const parsed = z
      .object({ text: z.string().min(1).max(10_000) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const ts = now();
    const customer = getCustomerById(db, found.row.customerId);
    const state = pageState(services, found.row.id);
    // Private feedback joins the review corpus (GLOSSARY), linked to its request.
    db.insert(reviews)
      .values({
        id: crypto.randomUUID(),
        source: "private_feedback",
        author: customer?.name ?? "Customer",
        rating: state.rating,
        reviewDate: ts,
        text: parsed.data.text,
        requestId: found.row.id,
        createdAt: ts,
      })
      .run();
    recordEvent(services, found.row.id, "feedback_submitted");
    res.json({ ok: true, state: pageState(services, found.row.id) });
  });

  router.post("/requests/:token/call-request", publicPostLimiter, (req, res) => {
    const found = loadValidRequest(services, req.params.token ?? "");
    if ("error" in found) {
      res.status(found.error).json({ error: "link_invalid", message: found.message });
      return;
    }
    recordEvent(services, found.row.id, "call_requested");
    res.json({ ok: true, state: pageState(services, found.row.id) });
  });

  return router;
}
