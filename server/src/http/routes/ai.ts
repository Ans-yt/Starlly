import { asyncRouter } from "../async-router.js";
// AI routes (ticket 015): LLM drafting into DRAFTS (never direct-send) and
// quote-verified theme summaries. Untrusted text never becomes instructions.
import { Router } from "express";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { drafts, insightSummaries, reviewThemes, reviews, themes } from "../../db/schema.js";
import { getBusinessRow } from "../../storage/business.js";
import { getCustomerById } from "../../storage/customer-views.js";
import { checkDraftPolicy } from "../../domain/policy.js";
import { verifyInsightQuotes, type CorpusReview } from "../../domain/quote-verifier.js";
import { resolveAiSettings } from "../../adapters/ai/registry.js";
import {
  buildDraftPrompt,
  buildSummaryPrompt,
  parseJsonCompletion, draftCompletionSchema, summaryCompletionSchema,
  type DraftCompletion,
  type SummaryCompletion,
} from "../../adapters/ai/prompts.js";

const now = () => new Date().toISOString();

function notConfigured(res: import("express").Response): void {
  res
    .status(400)
    .json({ error: "ai_not_configured", message: "Set an AI provider (style, model, key) in Settings first." });
}

export function aiRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  // Draft with the LLM → always lands as a Draft needing owner approval.
  router.post("/drafts/ai-draft", async (req, res) => {
    const parsed = z
      .object({
        kind: z.enum(["review_request", "follow_up", "review_reply"]),
        customerId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const business = getBusinessRow(db);
    const resolved = resolveAiSettings(business);
    if (!resolved) {
      notConfigured(res);
      return;
    }
    const customer = parsed.data.customerId ? getCustomerById(db, parsed.data.customerId) : null;
    if (parsed.data.customerId && !customer) {
      res.status(404).json({ error: "not_found", message: "Customer not found." });
      return;
    }

    const messages = buildDraftPrompt(business, parsed.data.kind, customer ? {
      name: customer.name,
      serviceType: customer.serviceType,
      lastJobDate: customer.lastJobDate,
    } : null);
    const result = await resolved.adapter.chat(resolved.config, messages, { maxTokens: 4096, temperature: 0.7 });
    if ("error" in result) {
      res.status(502).json({ error: "ai_failed", message: `${result.error.kind}: ${result.error.message}` });
      return;
    }
    const completion = parseJsonCompletion<DraftCompletion>(result.text, draftCompletionSchema);
    if (!completion?.subject || !completion.body) {
      res.status(502).json({ error: "ai_failed", message: "The model did not return a usable draft." });
      return;
    }

    const id = crypto.randomUUID();
    const ts = now();
    db.insert(drafts)
      .values({
        id,
        kind: parsed.data.kind,
        customerId: customer?.id ?? null,
        subject: completion.subject.slice(0, 200),
        body: completion.body,
        status: "draft", // never pre-approved (GLOSSARY: owner stays in control)
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const issues = checkDraftPolicy({
      subject: completion.subject,
      body: completion.body,
      googleReviewUrl: business.googleReviewUrl || undefined,
    });
    res.json({ id, subject: completion.subject, body: completion.body, status: "draft", policyIssues: issues });
  });

  // Summarize one theme from its tagged reviews; quotes must verify (§7.4).
  router.post("/insights/summarize", async (req, res) => {
    const parsed = z.object({ themeId: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const theme = db.select().from(themes).where(eq(themes.id, parsed.data.themeId)).get();
    if (!theme) {
      res.status(404).json({ error: "not_found", message: "Theme not found." });
      return;
    }
    const tagged = db.select().from(reviewThemes).where(eq(reviewThemes.themeId, theme.id)).all();
    const corpusRows = db.select().from(reviews).all();
    const byId = new Map(corpusRows.map((r) => [r.id, r]));
    const themeReviews = tagged
      .map((t) => byId.get(t.reviewId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    if (themeReviews.length === 0) {
      res.status(400).json({ error: "no_reviews", message: "No tagged reviews for this theme yet." });
      return;
    }

    const business = getBusinessRow(db);
    const resolved = resolveAiSettings(business);
    if (!resolved) {
      notConfigured(res);
      return;
    }
    const messages = buildSummaryPrompt(
      theme.name,
      theme.description,
      themeReviews.slice(0, 40).map((r) => ({ id: r.id, text: r.text.slice(0, 2000), rating: r.rating, sentiment: r.sentiment })),
    );
    const result = await resolved.adapter.chat(resolved.config, messages, { maxTokens: 4096, temperature: 0.3 });
    if ("error" in result) {
      res.status(502).json({ error: "ai_failed", message: `${result.error.kind}: ${result.error.message}` });
      return;
    }
    const completion = parseJsonCompletion<SummaryCompletion>(result.text, summaryCompletionSchema);
    if (!completion?.summary || !Array.isArray(completion.quotes)) {
      res.status(502).json({ error: "ai_failed", message: "The model did not return a usable summary." });
      return;
    }

    // Grounding gate: verify every quote; drop the ones that fail.
    const corpus: CorpusReview[] = themeReviews.slice(0, 40).map((r) => ({ id: r.id, text: r.text.slice(0, 2000) }));
    const verification = verifyInsightQuotes(
      completion.quotes.map((q) => ({ reviewId: q.reviewId, quote: q.quote })),
      corpus,
    );
    const verifiedQuotes = completion.quotes.filter((_, i) => verification.checks[i]?.verified);
    if (verifiedQuotes.length === 0) {
      res.status(422).json({
        error: "ungrounded",
        message: "None of the model's quotes exist in the review corpus — summary dropped.",
        checks: verification.checks,
      });
      return;
    }

    const id = crypto.randomUUID();
    db.insert(insightSummaries)
      .values({
        id,
        themeId: theme.id,
        summary: completion.summary,
        quotes: verifiedQuotes.map((q) => ({ reviewId: q.reviewId, quote: q.quote })),
        droppedQuotes: verification.droppedCount,
        createdAt: now(),
      })
      .run();
    res.json({
      id,
      themeId: theme.id,
      summary: completion.summary,
      quotes: verifiedQuotes,
      droppedQuotes: verification.droppedCount,
    });
  });

  // Latest stored summary for a theme (evidence panel / regenerate view).
  router.get("/insights/themes/:themeId/summary", (req, res) => {
    const row = db
      .select()
      .from(insightSummaries)
      .where(eq(insightSummaries.themeId, req.params.themeId ?? ""))
      .orderBy(desc(insightSummaries.createdAt))
      .get();
    if (!row) {
      res.json({ summary: null });
      return;
    }
    res.json({ summary: row });
  });

  return router;
}
