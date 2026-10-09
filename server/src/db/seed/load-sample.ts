// Sample-data loader (ticket 020, decision 13). The owner supplies the dataset
// separately; this is ONLY the isolated import mechanism. Everything loads
// through the same rows real data uses, flagged isSample, and is deletable as
// a unit. JSON is the import format — never the primary database (ADR-0001).
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../client.js";
import { business, customers, events, requests, reviews, themes, reviewThemes } from "../schema.js";

const eventType = z.enum(["opened", "rated", "google_click", "call_requested"]);

export const sampleSchema = z.object({
  version: z.literal(1),
  business: z.object({
    name: z.string().min(1),
    ownerName: z.string().optional(),
    city: z.string().optional(),
    sinceDate: z.string().optional(),
    googleReviewUrl: z.string().optional(),
    googleRating: z.number().min(1).max(5).optional(),
    googleReviewCount: z.number().int().min(0).optional(),
  }),
  customers: z
    .array(
      z.object({
        name: z.string().min(1),
        contact: z.string().min(3),
        serviceType: z.string().optional(),
        lastJobDate: z.string().optional(),
        consent: z.boolean(),
      }),
    )
    .default([]),
  reviews: z
    .array(
      z.object({
        author: z.string().optional(),
        rating: z.number().int().min(1).max(5).optional(),
        date: z.string().optional(),
        text: z.string().min(1),
        source: z.enum(["google_import", "pasted"]).default("google_import"),
        /** Owner-supplied theme ids/labels to link (mapped onto loaded themes). */
        themes: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  themes: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
  requests: z
    .array(
      z.object({
        customerIndex: z.number().int().min(0),
        sentAt: z.string(),
        events: z
          .array(z.object({ type: eventType, value: z.string().optional(), at: z.string().optional() }))
          .default([]),
      }),
    )
    .default([]),
  privateFeedback: z
    .array(
      z.object({
        customerIndex: z.number().int().min(0),
        rating: z.number().int().min(1).max(5).optional(),
        text: z.string().min(1),
        at: z.string().optional(),
        themes: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

export type SampleData = z.infer<typeof sampleSchema>;

// ── Owner's multi-file demo shape ──────────────────────────────────────────
// The owner supplies separate files (business.json, customers.json, reviews.json,
// feedback.json, requests.json, themes.json, trend_weekly.json). This normalizer
// maps that shape onto the merged schema above. trend_weekly.json is accepted
// but not stored: the dashboard computes its rating trend from stored reviews.

const ownerBusiness = z.object({
  name: z.string().min(1),
  owner: z.string().optional(),
  city: z.string().optional(),
  since: z.string().optional(),
  google_rating: z.number().min(1).max(5).optional(),
  google_review_count: z.number().int().min(0).optional(),
  review_link: z.string().optional(),
});

const ownerCustomer = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  service: z.string().optional(),
  last_service: z.string().optional(),
  consent: z.boolean().optional(),
});

const ownerReview = z.object({
  author: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  date: z.string().optional(),
  text: z.string().min(1),
  source: z.string().optional(),
});

const ownerFeedback = z.object({
  author: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  date: z.string().optional(),
  text: z.string().min(1),
  themes: z.array(z.string()).optional(),
});

const ownerRequest = z.object({
  customer_id: z.string(),
  sent: z.string(),
  opened: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  google_click: z.boolean().optional(),
  feedback: z.boolean().optional(),
  call_request: z.boolean().optional(),
});

const ownerTheme = z.object({
  id: z.string().optional(),
  label: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  polarity: z.string().optional(),
  description: z.string().optional(),
});

const ownerShape = z.object({
  business: ownerBusiness,
  customers: z.array(ownerCustomer).default([]),
  reviews: z.array(ownerReview).default([]),
  feedback: z.array(ownerFeedback).default([]),
  requests: z.array(ownerRequest).default([]),
  themes: z.array(ownerTheme).default([]),
});

/** True when the input is the owner's multi-file shape rather than the merged one. */
export function isOwnerFileShape(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    "customers" in input &&
    "requests" in input &&
    !("version" in input)
  );
}

/**
 * Map the owner's multi-file demo dataset onto the merged sample schema.
 * Returns null when the input does not match the multi-file shape.
 * Feedback authors that match no customer become customers of their own —
 * the demo feedback was left by that business's customers.
 */
export function normalizeOwnerFiles(input: unknown): unknown | null {
  if (!isOwnerFileShape(input)) return null;
  const parsed = ownerShape.safeParse(input);
  if (!parsed.success) return null;
  const files = parsed.data;

  // Theme id map for per-review theme links (owner ids like "ontime").
  const themeIdMap = new Map<string, string>();
  const themeRows: { id: string; name: string; description: string }[] = [];
  for (const t of files.themes) {
    const name = t.label ?? t.name ?? "";
    if (!name || !t.id || themeIdMap.has(t.id)) continue;
    themeIdMap.set(t.id, t.id);
    themeRows.push({ id: t.id, name, description: t.description ?? "" });
  }

  // Requests reference customers by id; build id → index from the file itself.
  const customerIndexById = new Map<string, number>();
  files.customers.forEach((c, i) => {
    if (c.id) customerIndexById.set(c.id, i);
    customerIndexById.set(c.name, i);
  });

  // Feedback authors who match a customer keep that link; the rest join the
  // customer list as themselves (sample data, removable as a unit).
  const customers = files.customers.map((c) => ({
    name: c.name,
    contact: (c.email && c.email.trim()) || (c.phone && c.phone.trim()) || `customer-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown"}@sample.local`,
    serviceType: c.service,
    lastJobDate: c.last_service,
    consent: c.consent === true,
  }));
  const privateFeedback = files.feedback.map((f) => {
    let index = f.author ? customerIndexById.get(f.author) : undefined;
    if (index === undefined && f.author) {
      index = customers.length;
      customerIndexById.set(f.author, index);
      customers.push({
        name: f.author,
        contact: `feedback-${f.author.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown"}@sample.local`,
        serviceType: undefined,
        lastJobDate: undefined,
        consent: true,
      });
    }
    return {
      customerIndex: index ?? 0,
      rating: f.rating,
      text: f.text,
      at: f.date,
      themes: f.themes,
    };
  });

  return {
    version: 1 as const,
    business: {
      name: files.business.name,
      ownerName: files.business.owner,
      city: files.business.city,
      sinceDate: files.business.since,
      googleReviewUrl: files.business.review_link,
      googleRating: files.business.google_rating,
      googleReviewCount: files.business.google_review_count,
    },
    customers,
    reviews: files.reviews.map((r) => ({
      author: r.author,
      rating: r.rating,
      date: r.date,
      text: r.text,
      source: "google_import" as const,
    })),
    themes: themeRows,
    requests: files.requests
      .filter((r) => customerIndexById.has(r.customer_id))
      .map((r) => ({
        customerIndex: customerIndexById.get(r.customer_id)!,
        sentAt: r.sent,
        events: [
          ...(r.opened ? [{ type: "opened" as const, at: r.sent }] : []),
          ...(r.rating != null ? [{ type: "rated" as const, value: String(r.rating), at: r.sent }] : []),
          ...(r.google_click ? [{ type: "google_click" as const, at: r.sent }] : []),
          ...(r.call_request ? [{ type: "call_requested" as const, at: r.sent }] : []),
        ],
      })),
    privateFeedback,
  };
}

export interface SampleLoadResult {
  ok: boolean;
  errors: string[];
  loaded: {
    customers: number;
    reviews: number;
    privateFeedback: number;
    themes: number;
    requests: number;
    events: number;
  };
  /** Present (ok: false) when real (non-sample) data exists and confirmOverwrite was not set. */
  overwriteBlocked?: { customers: number; reviews: number };
}

/** Validate + load. Validation errors are per-item and human-readable.
 * Never overwrites real (non-sample) data without confirmOverwrite. */
export function loadSampleData(
  db: AppDatabase,
  rawInput: unknown,
  options: { confirmOverwrite?: boolean } = {},
): SampleLoadResult {
  // Accept both the merged shape and the owner's multi-file demo shape.
  const input = normalizeOwnerFiles(rawInput) ?? rawInput;
  const parsed = sampleSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, errors, loaded: { customers: 0, reviews: 0, privateFeedback: 0, themes: 0, requests: 0, events: 0 } };
  }
  const data = parsed.data;
  const errors: string[] = [];

  // Never overwrite real data silently (spec §11): if non-sample rows exist,
  // refuse unless the owner explicitly confirmed the overwrite.
  const realCustomers = db.select().from(customers).all().filter((c) => !c.isSample).length;
  const realReviews = db.select().from(reviews).all().filter((r) => !r.isSample).length;
  if ((realCustomers > 0 || realReviews > 0) && options.confirmOverwrite !== true) {
    return {
      ok: false,
      errors: [],
      overwriteBlocked: { customers: realCustomers, reviews: realReviews },
      loaded: { customers: 0, reviews: 0, privateFeedback: 0, themes: 0, requests: 0, events: 0 },
    };
  }

  // Cross-check indexes BEFORE inserting anything (all-or-nothing).
  const customerCount = data.customers.length;
  data.requests.forEach((request, i) => {
    if (request.customerIndex >= customerCount) {
      errors.push(`requests[${i}].customerIndex: no customer at index ${request.customerIndex}`);
    }
  });
  data.privateFeedback.forEach((feedback, i) => {
    if (feedback.customerIndex >= customerCount) {
      errors.push(`privateFeedback[${i}].customerIndex: no customer at index ${feedback.customerIndex}`);
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors, loaded: { customers: 0, reviews: 0, privateFeedback: 0, themes: 0, requests: 0, events: 0 } };
  }

  const loaded = { customers: 0, reviews: 0, privateFeedback: 0, themes: 0, requests: 0, events: 0 };
  const customerIds: string[] = [];
  const ts = new Date().toISOString();

  // Theme id/label → row id map, so per-review theme links can be inserted.
  const themeKeyToId = new Map<string, string>();
  for (const theme of data.themes) {
    const id = theme.id ?? crypto.randomUUID();
    themeKeyToId.set(theme.name.toLowerCase(), id);
    if (theme.id) themeKeyToId.set(theme.id, id);
  }

  db.transaction((tx) => {
    tx.update(business)
      .set({
        name: data.business.name,
        ownerName: data.business.ownerName ?? "",
        city: data.business.city ?? "",
        sinceDate: data.business.sinceDate ?? null,
        googleReviewUrl: data.business.googleReviewUrl ?? "",
        googleRating: data.business.googleRating ?? null,
        googleReviewCount: data.business.googleReviewCount ?? null,
        isSample: true,
        updatedAt: ts,
      })
      .run();

    for (const customer of data.customers) {
      const id = crypto.randomUUID();
      customerIds.push(id);
      tx.insert(customers)
        .values({
          id,
          name: customer.name,
          contact: customer.contact,
          serviceType: customer.serviceType ?? "",
          lastJobDate: customer.lastJobDate ?? null,
          consent: customer.consent,
          consentAt: customer.consent ? ts : null,
          isSample: true,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      loaded.customers++;
    }

    // Themes BEFORE reviews: reviewThemes.themeId → themes (FK).
    for (const theme of data.themes) {
      tx.insert(themes)
        .values({
          id: theme.id ?? crypto.randomUUID(),
          name: theme.name,
          description: theme.description ?? "",
          isSample: true,
          createdAt: ts,
        })
        .run();
      loaded.themes++;
    }

    for (const review of data.reviews) {
      const reviewId = crypto.randomUUID();
      tx.insert(reviews)
        .values({
          id: reviewId,
          source: review.source,
          author: review.author ?? "Imported review",
          rating: review.rating ?? null,
          reviewDate: review.date ?? ts,
          text: review.text,
          // Derive sentiment from the rating when the owner supplied one.
          sentiment: review.rating == null ? null : review.rating >= 4 ? "positive" : review.rating <= 2 ? "negative" : "neutral",
          isSample: true,
          createdAt: review.date ?? ts,
        })
        .run();
      for (const themeKey of review.themes ?? []) {
        const themeId = themeKeyToId.get(themeKey) ?? themeKeyToId.get(themeKey.toLowerCase());
        if (themeId) {
          tx.insert(reviewThemes).values({ reviewId, themeId, similarity: null }).run();
        }
      }
      loaded.reviews++;
    }

    for (const request of data.requests) {
      const requestId = crypto.randomUUID();
      tx.insert(requests)
        .values({
          id: requestId,
          customerId: customerIds[request.customerIndex]!,
          token: crypto.randomBytes(24).toString("base64url"),
          status: "sent",
          sentAt: request.sentAt,
          isSample: true,
          createdAt: request.sentAt,
        })
        .run();
      loaded.requests++;
      for (const event of request.events) {
        tx.insert(events)
          .values({
            id: crypto.randomUUID(),
            requestId,
            type: event.type,
            value: event.value ?? null,
            isSample: true,
            createdAt: event.at ?? request.sentAt,
          })
          .run();
        loaded.events++;
      }
    }

    for (const feedback of data.privateFeedback) {
      const requestId = crypto.randomUUID();
      tx.insert(requests)
        .values({
          id: requestId,
          customerId: customerIds[feedback.customerIndex]!,
          token: crypto.randomBytes(24).toString("base64url"),
          status: "sent",
          sentAt: ts,
          isSample: true,
          createdAt: ts,
        })
        .run();
      const at = feedback.at ?? ts;
      tx.insert(events)
        .values({ id: crypto.randomUUID(), requestId, type: "opened", isSample: true, createdAt: at })
        .run();
      tx.insert(events)
        .values({ id: crypto.randomUUID(), requestId, type: "rated", value: feedback.rating ? String(feedback.rating) : null, isSample: true, createdAt: at })
        .run();
      tx.insert(events)
        .values({ id: crypto.randomUUID(), requestId, type: "feedback_submitted", isSample: true, createdAt: at })
        .run();
      const feedbackReviewId = crypto.randomUUID();
      tx.insert(reviews)
        .values({
          id: feedbackReviewId,
          source: "private_feedback",
          author: data.customers[feedback.customerIndex]?.name ?? "Customer",
          rating: feedback.rating ?? null,
          reviewDate: at,
          text: feedback.text,
          requestId,
          sentiment: feedback.rating == null ? null : feedback.rating >= 4 ? "positive" : feedback.rating <= 2 ? "negative" : "neutral",
          isSample: true,
          createdAt: at,
        })
        .run();
      for (const themeKey of feedback.themes ?? []) {
        const themeId = themeKeyToId.get(themeKey) ?? themeKeyToId.get(themeKey.toLowerCase());
        if (themeId) {
          tx.insert(reviewThemes).values({ reviewId: feedbackReviewId, themeId, similarity: null }).run();
        }
      }
      loaded.privateFeedback++;
      loaded.events += 3;
    }
  });

  return { ok: true, errors: [], loaded };
}

/** Remove sample rows as a unit (Delete my data also wipes them). */
export function unloadSampleData(db: AppDatabase): { removed: { customers: number; reviews: number; requests: number; events: number; themes: number } } {
  const ts = new Date().toISOString();
  const businessRow = db.select().from(business).where(eq(business.id, 1)).get();
  let removed = { customers: 0, reviews: 0, requests: 0, events: 0, themes: 0 };
  db.transaction((tx) => {
    const sampleCustomers = tx.select().from(customers).all().filter((c) => c.isSample);
    const sampleRequests = tx.select().from(requests).all().filter((r) => r.isSample);
    const sampleEvents = tx.select().from(events).all().filter((e) => e.isSample);
    const sampleReviews = tx.select().from(reviews).all().filter((r) => r.isSample);
    const sampleThemes = tx.select().from(themes).all().filter((t) => t.isSample);
    removed = {
      customers: sampleCustomers.length,
      requests: sampleRequests.length,
      events: sampleEvents.length,
      reviews: sampleReviews.length,
      themes: sampleThemes.length,
    };
    for (const e of sampleEvents) tx.delete(events).where(eq(events.id, e.id)).run();
    // reviewThemes rows referencing sample reviews/themes must go first (FK).
    const sampleReviewIds = new Set(sampleReviews.map((r) => r.id));
    const sampleThemeIds = new Set(sampleThemes.map((t) => t.id));
    if (sampleReviewIds.size > 0 || sampleThemeIds.size > 0) {
      const links = tx.select().from(reviewThemes).all();
      for (const link of links) {
        if (sampleReviewIds.has(link.reviewId) || sampleThemeIds.has(link.themeId)) {
          tx.delete(reviewThemes).where(eq(reviewThemes.reviewId, link.reviewId)).run();
        }
      }
    }
    for (const r of sampleReviews) tx.delete(reviews).where(eq(reviews.id, r.id)).run();
    // Reviews must go BEFORE requests: reviews.requestId → requests (FK).
    for (const r of sampleRequests) tx.delete(requests).where(eq(requests.id, r.id)).run();
    for (const c of sampleCustomers) tx.delete(customers).where(eq(customers.id, c.id)).run();
    for (const t of sampleThemes) tx.delete(themes).where(eq(themes.id, t.id)).run();
    // If the business profile itself was sample-loaded, reset those fields
    // (provider settings and owner login stay).
    const patch: Record<string, unknown> = { isSample: false, updatedAt: ts };
    if (businessRow?.isSample) {
      Object.assign(patch, {
        name: "",
        ownerName: "",
        city: "",
        sinceDate: null,
        googleReviewUrl: "",
        googleRating: null,
        googleReviewCount: null,
      });
    }
    tx.update(business).set(patch).run();
  });
  return { removed };
}
