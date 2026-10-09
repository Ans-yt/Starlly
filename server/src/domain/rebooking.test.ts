import { describe, expect, it } from "vitest";
import { learnedModelGate, recommendRebooking, serviceIntervalMonths } from "./rebooking.js";

const NOW = "2026-06-01T00:00:00.000Z";

describe("service intervals (rule baseline)", () => {
  it("maps service types to intervals", () => {
    expect(serviceIntervalMonths("annual check-up")).toBe(12);
    expect(serviceIntervalMonths("Quarterly inspection")).toBe(3);
    expect(serviceIntervalMonths("Deep cleaning")).toBe(6);
    expect(serviceIntervalMonths("furnace install")).toBe(24);
    expect(serviceIntervalMonths("something new")).toBe(12); // default
  });
});

describe("recommendRebooking (ADR-0007: rule-based, labeled, no probability)", () => {
  it("marks a customer overdue when past the interval", () => {
    // Last service 2025-05-01, evaluated 2026-06-01 → 13 months, 12-month interval.
    const r = recommendRebooking({ serviceType: "annual check-up", lastJobDate: "2025-05-01", now: NOW });
    expect(r.eligible).toBe(true);
    expect(r.due).toBe(true);
    expect(r.overdueDays).toBeGreaterThan(25); // ~31 days overdue
    expect(r.reasons[0]).toContain("12 months is the typical interval");
    expect(r.source).toBe("rule-baseline");
  });

  it("marks due-within-window but not overdue", () => {
    // Last service 11.5 months ago → due in ~2 weeks, inside the 30-day window.
    const r = recommendRebooking({ serviceType: "annual check-up", lastJobDate: "2025-06-15", now: NOW });
    expect(r.due).toBe(true);
    expect(r.overdueDays).toBe(0);
    expect(r.dueInDays).toBeLessThanOrEqual(30);
    expect(r.dueInDays).toBeGreaterThan(0);
  });

  it("marks not-due well inside the interval", () => {
    const r = recommendRebooking({ serviceType: "annual check-up", lastJobDate: "2026-05-01", now: NOW });
    expect(r.due).toBe(false);
    expect(r.overdueDays).toBe(0);
  });

  it("uses the shorter interval for quarterly services", () => {
    // Last service 2026-03-01, evaluated 2026-06-01 → 3 months elapsed → at the 3-month interval.
    const r = recommendRebooking({ serviceType: "quarterly pest control", lastJobDate: "2026-03-01", now: NOW });
    expect(r.intervalMonths).toBe(3);
    expect(r.due).toBe(true); // due now / overdue by days
  });

  it("is not eligible without a last job date", () => {
    const r = recommendRebooking({ serviceType: "cleaning", lastJobDate: null, now: NOW });
    expect(r.eligible).toBe(false);
    expect(r.due).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("never exposes a probability — only the labeled source", () => {
    const r = recommendRebooking({ serviceType: "annual check-up", lastJobDate: "2025-05-01", now: NOW });
    const asJson = JSON.stringify(r);
    expect(asJson).not.toContain("probability");
    expect(r.source).toBe("rule-baseline");
  });
});

describe("learned model gate", () => {
  it("stays closed without real labeled history", () => {
    const gate = learnedModelGate({ customersWithHistory: 10, customersWithOutcomeLabels: 0 });
    expect(gate.enabled).toBe(false);
    expect(gate.note).toContain("rule baseline");
  });

  it("opens only with sufficient real labeled history", () => {
    const gate = learnedModelGate({ customersWithHistory: 60, customersWithOutcomeLabels: 55 });
    expect(gate.enabled).toBe(true);
  });
});
