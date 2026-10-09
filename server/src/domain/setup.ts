// Setup-gate evaluation (spec §4.2, rubric S1–S5). Pure logic: given the
// stored facts, which gate items are done, and what the per-item status chip
// shows. Only a PASSING test may show "Connected".
import { isBusinessProfileComplete, type ProfileInput } from "./validation.js";

export type ItemStatus = "not_set" | "saved" | "connected";

export interface SetupFacts {
  business: ProfileInput;
  /** The stored business row passes validation with no unconfirmed warnings. */
  businessComplete: boolean;
  aiConfigured: boolean;
  aiLastTestAt: string | null;
  emailAdapterId: string;
  emailConfigured: boolean;
  emailLastTestAt: string | null;
  /** Explicit "I'll paste or import my reviews instead" choice. */
  placesMode: string | null;
  /** A confirmed Places lookup ("Is this you?" answered). */
  placeId: string | null;
  placesLastTestAt: string | null;
  /** Last accepted test send to the owner (step 6). */
  testEmailSentAt: string | null;
}

export interface GateItem {
  done: boolean;
  status: ItemStatus;
  lastTestAt: string | null;
  note?: string;
}

export interface SetupEvaluation {
  setupComplete: boolean;
  /** Ordered human-readable blockers for the UI. */
  blocked: string[];
  items: {
    business: GateItem;
    ai: GateItem;
    email: GateItem;
    places: GateItem;
    exa: GateItem;
    testEmail: GateItem;
  };
}

/** Status chip: Connected only from a passing test (S5). */
export function itemStatus(configured: boolean, lastTestAt: string | null): ItemStatus {
  if (lastTestAt) return "connected";
  return configured ? "saved" : "not_set";
}

export function evaluateSetup(facts: SetupFacts): SetupEvaluation {
  const businessDone = facts.businessComplete === true;

  const aiConnected = Boolean(facts.aiLastTestAt);
  const copyOnly = facts.emailAdapterId === "copy-only";
  const emailConnected = Boolean(facts.emailLastTestAt);
  const emailDone = copyOnly || emailConnected;
  const placesDone = facts.placesMode === "import" || Boolean(facts.placeId);
  // Copy only has nothing to send — the test-email step is skipped for it.
  const testEmailDone = copyOnly || Boolean(facts.testEmailSentAt);

  const items: SetupEvaluation["items"] = {
    business: {
      done: businessDone,
      status: businessDone ? "connected" : facts.business.name || facts.business.ownerName ? "saved" : "not_set",
      lastTestAt: null,
      note: businessDone ? undefined : "Company name, owner, city, email and a valid Google review link.",
    },
    ai: {
      done: aiConnected,
      status: itemStatus(facts.aiConfigured, facts.aiLastTestAt),
      lastTestAt: facts.aiLastTestAt,
      note: aiConnected ? undefined : "Test connection must pass before continuing.",
    },
    email: {
      done: emailDone,
      status: copyOnly ? "connected" : itemStatus(facts.emailConfigured, facts.emailLastTestAt),
      lastTestAt: facts.emailLastTestAt,
      note: copyOnly
        ? "Copy only needs no keys."
        : emailConnected
          ? undefined
          : "Test connection must pass before continuing.",
    },
    places: {
      done: placesDone,
      status: facts.placesMode === "import" ? "connected" : itemStatus(Boolean(facts.placesLastTestAt) || Boolean(facts.placeId), facts.placesLastTestAt),
      lastTestAt: facts.placesLastTestAt,
      note: facts.placesMode === "import" ? "Paste or import chosen." : placesDone ? undefined : "Or choose “I'll paste or import my reviews instead”.",
    },
    exa: {
      done: true, // optional — never blocks
      status: "not_set",
      lastTestAt: null,
      note: "Optional; Exa also works keyless on a rate-limited free plan.",
    },
    testEmail: {
      done: testEmailDone,
      status: testEmailDone ? "connected" : "not_set",
      lastTestAt: facts.testEmailSentAt,
      note: copyOnly ? "Skipped for Copy only." : testEmailDone ? undefined : "Send a test email to yourself.",
    },
  };

  const labels: Record<keyof SetupEvaluation["items"], string> = {
    business: "Business details",
    ai: "AI provider (Test connection must pass)",
    email: "Email provider (Test connection must pass, or Copy only)",
    places: "Google Places key or “I'll paste or import my reviews instead”",
    exa: "Exa key (optional)",
    testEmail: "Send a test email to the owner",
  };
  const blocked = (Object.keys(items) as (keyof typeof items)[])
    .filter((key) => !items[key].done)
    .map((key) => labels[key]);

  return { setupComplete: blocked.length === 0, blocked, items };
}
