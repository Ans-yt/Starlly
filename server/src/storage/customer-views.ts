// Derived customer statuses (GLOSSARY: no "Reviewed" status — Starlly cannot
// observe whether a review was posted). Computed from stored records only.
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { customers, events, requests, reviews } from "../db/schema.js";

export type DerivedCustomerStatus = "waiting" | "requested" | "needs_call";

export interface CustomerWithStatus {
  id: string;
  name: string;
  contact: string;
  serviceType: string;
  lastJobDate: string | null;
  consent: boolean;
  status: string;
  callResolvedAt: string | null;
  isSample: boolean;
  derived: DerivedCustomerStatus | null; // null: not eligible (no consent / do-not-contact)
}

export function listCustomersWithStatus(db: AppDatabase): CustomerWithStatus[] {
  const all = db.select().from(customers).all();

  // Customers with at least one sent review request.
  const sentRequests = db.select().from(requests).where(eq(requests.status, "sent")).all();
  const sentCustomerIds = new Set(sentRequests.map((r) => r.customerId));

  // Needs-a-call signals: call_requested or low rating (<= 3) or private feedback.
  const allEvents = db.select().from(events).all();
  const requestById = new Map(db.select().from(requests).all().map((r) => [r.id, r]));

  const signalByRequest = new Map<string, string /* event createdAt */>();
  for (const e of allEvents) {
    const isCall = e.type === "call_requested";
    const isLowRating = e.type === "rated" && Number(e.value) <= 3;
    if (!isCall && !isLowRating) continue;
    const prev = signalByRequest.get(e.requestId);
    if (!prev || prev < e.createdAt) signalByRequest.set(e.requestId, e.createdAt);
  }
  // Private feedback reviews linked to a request count too.
  const feedbackReviews = db.select().from(reviews).where(eq(reviews.source, "private_feedback")).all();
  const feedbackByRequest = new Map<string, string>();
  for (const review of feedbackReviews) {
    if (!review.requestId) continue;
    const prev = feedbackByRequest.get(review.requestId);
    if (!prev || prev < review.createdAt) feedbackByRequest.set(review.requestId, review.createdAt);
  }
  for (const [requestId, createdAt] of feedbackByRequest) {
    const prev = signalByRequest.get(requestId);
    if (!prev || prev < createdAt) signalByRequest.set(requestId, createdAt);
  }

  const needsCall = new Set<string>();
  for (const [requestId, signalAt] of signalByRequest) {
    const request = requestById.get(requestId);
    if (!request) continue;
    const customer = all.find((c) => c.id === request.customerId);
    const resolvedAt = customer?.callResolvedAt;
    if (resolvedAt && resolvedAt >= signalAt) continue; // resolved after the latest signal
    needsCall.add(request.customerId);
  }

  return all.map((c) => {
    const eligible = c.consent && c.status === "active";
    let derived: DerivedCustomerStatus | null = null;
    if (eligible) {
      if (needsCall.has(c.id)) derived = "needs_call";
      else if (sentCustomerIds.has(c.id)) derived = "requested";
      else derived = "waiting";
    }
    return {
      id: c.id,
      name: c.name,
      contact: c.contact,
      serviceType: c.serviceType,
      lastJobDate: c.lastJobDate,
      consent: c.consent,
      status: c.status,
      callResolvedAt: c.callResolvedAt,
      isSample: c.isSample,
      derived,
    };
  });
}

export function getCustomerById(db: AppDatabase, id: string) {
  return db.select().from(customers).where(eq(customers.id, id)).get();
}
