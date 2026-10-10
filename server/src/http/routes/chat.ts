import { partialAnswer, splitThinking } from "../../adapters/ai/streaming.js";
import { asyncRouter } from "../async-router.js";
// Chat assistant (ticket 021): read-only, cited, quote-verified. It can draft
// (into Messages, needing approval) but can never send. With zero keys it
// answers from local data deterministically.
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import {
  drafts,
  events,
  requests as requestsTable,
  reviewThemes,
  reviews as reviewsTable,
  themes,
} from "../../db/schema.js";
import { getBusinessRow } from "../../storage/business.js";
import { listCustomersWithStatus } from "../../storage/customer-views.js";
import { resolveAiSettings } from "../../adapters/ai/registry.js";
import {
  buildChatPrompt,
  buildDraftPrompt,
  parseJsonCompletion,
  draftCompletionSchema,
  chatCompletionSchema,
  type ChatCompletion,
  type DraftCompletion,
} from "../../adapters/ai/prompts.js";
import {
  verifyInsightQuotes,
  type CorpusReview,
} from "../../domain/quote-verifier.js";
import { computeFunnel } from "../../domain/funnel.js";
import type { EventRecord } from "../../domain/events.js";

const now = () => new Date().toISOString();

/** Simple keyword retrieval over the corpus — no vector DB needed at this scale. */
function retrieveReviews(
  message: string,
  corpus: CorpusReview[],
  limit: number,
  themeReviewIds = new Set<string>(),
): CorpusReview[] {
  const terms = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((t) => t.length >= 3);
  const scored = corpus
    .map((r) => ({
      r,
      score:
        (themeReviewIds.has(r.id) ? 5 : 0) +
        terms.reduce(
          (acc, t) => acc + (r.text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (scored.length > 0) return scored.map((s) => s.r);
  // No keyword overlap (e.g. "What should I fix first?") → latest reviews.
  return [...corpus].slice(-5).reverse();
}

function chatContext(services: AppServices) {
  const { db } = services;
  const customers = listCustomersWithStatus(db);
  const sentRequests = db
    .select()
    .from(requestsTable)
    .where(eq(requestsTable.status, "sent"))
    .all();
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
  return {
    waitingCount: customers.filter((c) => c.derived === "waiting").length,
    needsCallCount: customers.filter((c) => c.derived === "needs_call").length,
    funnelLast: funnel[funnel.length - 1]?.count ?? 0,
    funnelLabel: funnel[funnel.length - 1]?.label ?? "Clicked Google link",
    customers,
  };
}

function localAnswer(
  context: ReturnType<typeof chatContext>,
  themeSummary: string,
): string {
  const parts = [
    themeSummary
      ? `Top themes right now: ${themeSummary}.`
      : "No tagged themes yet — import reviews and run tagging in Insights.",
    `${context.needsCallCount} customer${context.needsCallCount === 1 ? "" : "s"} need a call.`,
    `${context.waitingCount} waiting for a review request.`,
  ];
  return `${parts.join(" ")} (Local-data answer — connect an AI provider in Settings for conversational answers.)`;
}

export function chatRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  router.post("/chat", async (req, res) => {
    const parsed = z
      .object({
        message: z.string().min(1).max(2000),
        stream: z.boolean().optional(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(16000),
            }),
          )
          .max(12)
          .optional(),
      })
      .safeParse(req.body);
    const streaming = parsed.success && parsed.data.stream;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const emit = (event: unknown) => {
      if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
    };
    const respond = (value: unknown) => {
      if (streaming) {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
        }
        emit({ type: "done", result: value });
        res.end();
      } else res.json(value);
    };
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const message = parsed.data.message;
    const business = getBusinessRow(db);
    const corpusRows = db
      .select()
      .from(reviewsTable)
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const corpus: CorpusReview[] = corpusRows.map((r) => ({
      id: r.id,
      text: r.text,
    }));
    const relevantThemes = db
      .select()
      .from(themes)
      .all()
      .filter((t) => message.toLowerCase().includes(t.name.toLowerCase()));
    const themeIds = new Set(relevantThemes.map((t) => t.id));
    const themeReviewIds = new Set(
      db
        .select()
        .from(reviewThemes)
        .all()
        .filter((t) => themeIds.has(t.themeId))
        .map((t) => t.reviewId),
    );
    const retrieved = retrieveReviews(message, corpus, 8, themeReviewIds).map(
      (r) => ({ ...r, text: r.text.slice(0, 2000) }),
    );
    const context = chatContext(services);

    // Theme summary for the local fallback answer.
    const themeRows = db.select().from(themes).all();
    const tags = db.select().from(reviewThemes).all();
    const countByTheme = new Map<string, number>();
    for (const tag of tags)
      countByTheme.set(tag.themeId, (countByTheme.get(tag.themeId) ?? 0) + 1);
    const themeSummary = [...countByTheme.entries()]
      .map(
        ([id, count]) =>
          `${themeRows.find((t) => t.id === id)?.name ?? "theme"} (${count})`,
      )
      .slice(0, 3)
      .join(", ");

    const resolved = resolveAiSettings(business);

    // Draft intent: create a DRAFT (never a send job) and point at Messages.
    if (
      /^(?:please\s+)?(?:draft|write|reply)\b/i.test(message.trim()) &&
      !/\b(?:don[’']t|do not|no)\s+(?:draft|write|reply)\b/i.test(message)
    ) {
      const kind = /\breply\b/i.test(message)
        ? "review_reply"
        : /review request/i.test(message)
          ? "review_request"
          : "follow_up";
      const matches = context.customers.filter((c) =>
        message.toLowerCase().includes(c.name.toLowerCase()),
      );
      const firstNames = context.customers.filter((c) =>
        message
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .includes(c.name.split(" ")[0]!.toLowerCase()),
      );
      const namedCustomer =
        matches.length === 1
          ? matches[0]
          : matches.length === 0 && firstNames.length === 1
            ? firstNames[0]
            : undefined;
      let subject: string;
      let body: string;
      if (resolved) {
        const prompt = buildDraftPrompt(
          business,
          kind,
          namedCustomer
            ? {
                name: namedCustomer.name,
                serviceType: namedCustomer.serviceType,
                lastJobDate: namedCustomer.lastJobDate,
              }
            : null,
        );
        const result = await resolved.adapter.chat(resolved.config, prompt, {
          maxTokens: 4096,
          temperature: 0.7,
        });
        if ("text" in result) {
          const completion = parseJsonCompletion<DraftCompletion>(
            result.text,
            draftCompletionSchema,
          );
          if (completion?.subject && completion.body) {
            subject = completion.subject;
            body = completion.body;
          }
        }
      }
      // Template fallback (zero keys or unusable AI output).
      subject ??=
        kind === "review_reply"
          ? `Reply to ${namedCustomer?.name ?? "a review"}`
          : `Following up with ${namedCustomer?.name ?? "you"}`;
      body ??= `Hi {{customer}},\n\n${
        kind === "review_reply"
          ? "Thanks for your feedback — we're sorry it wasn't right, and we'd like to make it right."
          : "It's been a while since your last service — we'd love to help again when it's time."
      }\n\n{{link}}\n\n— {{owner}}`;

      const id = crypto.randomUUID();
      const ts = now();
      db.insert(drafts)
        .values({
          id,
          kind,
          customerId: namedCustomer?.id ?? null,
          subject,
          body,
          status: "draft", // GLOSSARY: nothing sends without approval
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      respond({
        answer:
          "Draft created — it needs your approval in Messages before anything is sent.",
        draftId: id,
        quotes: [],
        sources: retrieved.map((r) => r.id),
        sourceLabel: "Draft created for your approval",
      });
      return;
    }

    if (resolved) {
      const reviewById = new Map(corpusRows.map((r) => [r.id, r]));
      const prompt = buildChatPrompt(
        message,
        retrieved.map((r) => ({
          id: r.id,
          text: r.text,
          rating: reviewById.get(r.id)?.rating ?? null,
          sentiment: reviewById.get(r.id)?.sentiment ?? null,
        })),
        context,
      );
      if (parsed.data.history?.length)
        prompt.splice(1, 0, ...parsed.data.history);
      let text = "",
        reasoning = "";
      let result: Awaited<ReturnType<typeof resolved.adapter.chat>>;
      try {
        if (streaming && resolved.adapter.stream) {
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.flushHeaders();
          for await (const delta of resolved.adapter.stream(
            resolved.config,
            prompt,
            { maxTokens: 4096, temperature: 0.4, signal: controller.signal },
          )) {
            if (controller.signal.aborted) break;
            if (delta.reasoning) {
              reasoning += delta.reasoning;
              emit({ type: "reasoning_delta", text: delta.reasoning });
            }
            if (delta.text) {
              text += delta.text;
              const separated = splitThinking(text);
              emit({ type: "answer", text: partialAnswer(separated.text) });
              if (separated.reasoning)
                emit({
                  type: "reasoning",
                  text: reasoning + separated.reasoning,
                });
            }
          }
          result = { text: splitThinking(text).text };
        } else
          result = await resolved.adapter.chat(resolved.config, prompt, {
            maxTokens: 4096,
            temperature: 0.4,
            signal: controller.signal,
          });
      } catch {
        if (controller.signal.aborted) return;
        const error = {
          error: "ai_failed",
          message:
            "The AI connection stopped before the reply finished. Please try again.",
        };
        if (res.headersSent) {
          emit({ type: "error", ...error });
          res.end();
        } else res.status(502).json(error);
        return;
      }
      if ("error" in result) {
        if (res.headersSent) {
          emit({ type: "error", message: result.error.message });
          res.end();
        } else
          res
            .status(502)
            .json({ error: "ai_failed", message: result.error.message });
        return;
      }
      const completion = parseJsonCompletion<ChatCompletion>(
        result.text,
        chatCompletionSchema,
      );
      if (completion?.answer) {
        // Grounding gate: quotes must exist in the corpus (spec §7.4).
        const verification = verifyInsightQuotes(
          (completion.quotes ?? []).map((q) => ({
            reviewId: q.reviewId,
            quote: q.quote,
          })),
          retrieved,
        );
        const verifiedQuotes = (completion.quotes ?? []).filter(
          (_, i) => verification.checks[i]?.verified,
        );
        if (completion.quotes.length && !verifiedQuotes.length) {
          const error = {
            error: "ungrounded",
            message:
              "I couldn't verify the reviews supporting that answer. Please rephrase your question.",
          };
          if (res.headersSent) {
            emit({ type: "error", ...error });
            res.end();
          } else res.status(422).json(error);
          return;
        }
        respond({
          answer: completion.answer,
          quotes: verifiedQuotes,
          droppedQuotes: verification.droppedCount,
          sources: [...new Set(verifiedQuotes.map((q) => q.reviewId))],
          sourceLabel: verifiedQuotes.length
            ? `Based on ${new Set(verifiedQuotes.map((q) => q.reviewId)).size} ${new Set(verifiedQuotes.map((q) => q.reviewId)).size === 1 ? "review" : "reviews"} · quotes verified`
            : "Based on your saved business records · no review citations",
        });
        return;
      }
      if (res.headersSent) {
        emit({
          type: "error",
          message:
            "The model did not return a usable answer. Please try again.",
        });
        res.end();
      } else
        res
          .status(502)
          .json({
            error: "ai_failed",
            message: "The model did not return a usable answer.",
          });
      return;
    }

    // Zero-key fallback: deterministic answer from local data.
    respond({
      answer: localAnswer(context, themeSummary),
      quotes: [],
      sources: retrieved.map((r) => r.id),
      sourceLabel: "Based on your saved business records",
      note: "local_data_answer",
    });
  });

  return router;
}
