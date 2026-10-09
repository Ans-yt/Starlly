// Setup-gate tests (rubric S1–S5): the gate blocks until every mandatory item
// is done; only a passing test shows "Connected"; Copy only passes email and
// the test-email step without keys.
import { describe, expect, it } from "vitest";
import { evaluateSetup, itemStatus, type SetupFacts } from "./setup.js";

const doneFacts: SetupFacts = {
  business: {
    name: "Coppervale Heating & Air",
    ownerName: "Dana",
    ownerEmail: "dana@coppervale.test",
    city: "Springfield",
    googleReviewUrl: "https://g.page/coppervale/review",
  },
  businessComplete: true,
  aiConfigured: true,
  aiLastTestAt: "2026-01-01T10:00:00.000Z",
  emailAdapterId: "agentboxd",
  emailConfigured: true,
  emailLastTestAt: "2026-01-01T10:05:00.000Z",
  placesMode: null,
  placeId: "place-123",
  placesLastTestAt: "2026-01-01T10:06:00.000Z",
  testEmailSentAt: "2026-01-01T10:07:00.000Z",
};

describe("setup gate", () => {
  it("is complete when every mandatory item passed", () => {
    const r = evaluateSetup(doneFacts);
    expect(r.setupComplete).toBe(true);
    expect(r.blocked).toEqual([]);
  });

  it("blocks the dashboard before setup is done (S1)", () => {
    const fresh: SetupFacts = {
      business: {},
      businessComplete: false,
      aiConfigured: false,
      aiLastTestAt: null,
      emailAdapterId: "agentboxd", // a real provider: both email and test-email block
      emailConfigured: false,
      emailLastTestAt: null,
      placesMode: null,
      placeId: null,
      placesLastTestAt: null,
      testEmailSentAt: null,
    };
    const r = evaluateSetup(fresh);
    expect(r.setupComplete).toBe(false);
    expect(r.blocked).toContain("Business details");
    expect(r.blocked).toContain("AI provider (Test connection must pass)");
    expect(r.blocked).toContain("Email provider (Test connection must pass, or Copy only)");
    expect(r.blocked).toContain("Google Places key or “I'll paste or import my reviews instead”");
    expect(r.blocked).toContain("Send a test email to the owner");
    expect(r.blocked).not.toContain("Exa key (optional)"); // S4: optional never blocks
  });

  it("does not complete when the AI provider was saved but never tested (S2)", () => {
    const r = evaluateSetup({ ...doneFacts, aiLastTestAt: null });
    expect(r.setupComplete).toBe(false);
    expect(r.items.ai.status).toBe("saved"); // Saved, not tested
 expect(r.blocked.join(" ")).toMatch(/AI provider/);
  });

  it("does not complete when the email provider was saved but never tested (S2)", () => {
    const r = evaluateSetup({ ...doneFacts, emailLastTestAt: null });
    expect(r.setupComplete).toBe(false);
    expect(r.items.email.status).toBe("saved");
  });

  it("Copy only completes email and the test-email step with zero keys (S2)", () => {
    const r = evaluateSetup({
      ...doneFacts,
      emailAdapterId: "copy-only",
      emailConfigured: false,
      emailLastTestAt: null,
      testEmailSentAt: null,
    });
    expect(r.setupComplete).toBe(true);
    expect(r.items.email.done).toBe(true);
    expect(r.items.testEmail.done).toBe(true);
    expect(r.items.testEmail.note).toMatch(/Skipped for Copy only/);
  });

  it("Places passes either via a confirmed listing or the explicit import choice (S3)", () => {
    const withPlace = evaluateSetup({ ...doneFacts, placeId: "place-1", placesLastTestAt: null });
    expect(withPlace.setupComplete).toBe(true);
    const viaImport = evaluateSetup({ ...doneFacts, placeId: null, placesMode: "import", placesLastTestAt: null });
    expect(viaImport.setupComplete).toBe(true);
    expect(viaImport.items.places.note).toMatch(/Paste or import/);
    const withoutEither = evaluateSetup({ ...doneFacts, placeId: null, placesMode: null, placesLastTestAt: null });
    expect(withoutEither.setupComplete).toBe(false);
  });

  it("shows per-item status chips honestly (S5)", () => {
    expect(itemStatus(false, null)).toBe("not_set");
    expect(itemStatus(true, null)).toBe("saved");
    expect(itemStatus(true, "2026-01-01T10:00:00.000Z")).toBe("connected");
  });

  it("status is Connected only with a last-test time (S5)", () => {
    const untested = evaluateSetup({ ...doneFacts, aiLastTestAt: null });
    expect(untested.items.ai.status).not.toBe("connected");
  });
});
