// Who to contact this week (ticket 017): the rule baseline over service
// intervals, clearly labeled — no learned probabilities without real labeled
// history (ADR-0007).
import { Router } from "express";
import type { AppServices } from "../app.js";
import { customers, requests } from "../../db/schema.js";
import { learnedModelGate, recommendRebooking } from "../../domain/rebooking.js";

export function rebookingRouter(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  router.get("/rebooking", (_req, res) => {
    const now = new Date().toISOString();
    const rows = db.select().from(customers).all();
    const sentRequests = db.select().from(requests).all();
    const hasHistory = (id: string) => sentRequests.some((r) => r.customerId === id);

    const recommendations = [];
    for (const customer of rows) {
      if (customer.status !== "active" || !customer.consent) continue;
      if (customer.rebookingSnoozedUntil && customer.rebookingSnoozedUntil > now) continue;
      const rec = recommendRebooking({ serviceType: customer.serviceType, lastJobDate: customer.lastJobDate, now });
      if (!rec.eligible || !rec.due) continue;
      recommendations.push({
        customerId: customer.id,
        name: customer.name,
        contact: customer.contact,
        serviceType: customer.serviceType,
        lastJobDate: customer.lastJobDate,
        dueInDays: rec.dueInDays,
        overdueDays: rec.overdueDays,
        intervalMonths: rec.intervalMonths,
        reasons: rec.reasons,
        source: rec.source, // "rule-baseline" — the UI labels it
      });
    }
    recommendations.sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0));

    const gate = learnedModelGate({
      customersWithHistory: rows.filter((c) => c.lastJobDate && hasHistory(c.id)).length,
      // Outcome labels (did the customer actually rebook?) are not tracked yet,
      // so the learned model stays closed until real labeled history exists.
      customersWithOutcomeLabels: 0,
    });

    res.json({ recommendations, learnedModel: gate });
  });

  return router;
}
