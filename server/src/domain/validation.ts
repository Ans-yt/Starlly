// Input validation (spec §4.4): nothing from nowhere is accepted. The client
// may pre-check, but the server re-validates everything through this module.
// Pure domain — no DB, no HTTP.

export type ValidationSeverity = "error" | "confirm";

export interface FieldIssue {
  severity: ValidationSeverity;
  message: string;
}

export interface FieldResult {
  /** error  → invalid, must be fixed. */
  /** confirm → shape unrecognized: allowed only after the owner confirms. */
  issues: FieldIssue[];
}

export interface ProfileInput {
  name?: string;
  ownerName?: string;
  ownerEmail?: string;
  city?: string;
  googleReviewUrl?: string;
  googleReviewUrlConfirmed?: boolean;
  website?: string;
  socialLinks?: Record<string, string>;
}

export interface ProfileValidation {
  /** field -> blocking error. */
  fieldErrors: Record<string, string>;
  /** field -> warning shown with a confirm control ("This is a heuristic link check"). */
  fieldWarnings: Record<string, string>;
}

// ── Primitives ──────────────────────────────────────────────────────────────

export function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pragmatic email check: one @, non-empty local part, domain with a dot, no spaces. */
export function isValidEmail(value: string): boolean {
  const email = trimmed(value);
  if (email.length < 6 || email.length > 254) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(email)) return false;
  if (!local || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(trimmed(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(trimmed(value)).protocol === "https:";
  } catch {
    return false;
  }
}

// ── Google review link (V3) ────────────────────────────────────────────────

const GOOGLE_HOSTS = new Set(["g.page", "goo.gl", "maps.app.goo.gl"]);

function isGoogleHost(host: string): boolean {
  const host_ = host.toLowerCase();
  if (GOOGLE_HOSTS.has(host_)) return true;
  if (host_.endsWith(".google.com") || host_ === "google.com") return true;
  return false;
}

/**
 * Heuristic check for the one Google review link. Never proves the link works:
 * "confirm" means the shape was unrecognized and the owner must look at it
 * (via "Open link") and explicitly confirm it.
 */
export function validateGoogleReviewUrl(
  rawUrl: string,
  confirmed = false,
): FieldResult {
  const value = trimmed(rawUrl);
  if (!value) return { issues: [{ severity: "error", message: "A Google review link is required — every customer gets the same one." }] };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { issues: [{ severity: "error", message: "That is not a valid URL." }] };
  }
  if (url.protocol !== "https:") {
    return { issues: [{ severity: "error", message: "The link must start with https://." }] };
  }
  if (!isGoogleHost(url.hostname)) {
    return {
      issues: [
        {
          severity: "error",
          message: "The host must be a Google host (google.com, g.page, maps.app.goo.gl, goo.gl).",
        },
      ],
    };
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);

  // Short links (g.page/..., maps.app.goo.gl/..., goo.gl/...) are accepted shapes.
  if (host === "g.page" || host === "maps.app.goo.gl" || host === "goo.gl") {
    return { issues: [] };
  }

  // google.com hosts: the known listing shape is /maps/place/<identifier>…
  if (segments[0] === "maps" && segments[1] === "place") {
    const identifier = segments.slice(2).find((s) => s.length > 0 && !s.startsWith("@"));
    if (!identifier) {
      return {
        issues: [
          {
            severity: "error",
            message:
              "This URL opens Google Maps without a place — paste the link from your Business Profile's “Ask for reviews” button instead.",
          },
        ],
      };
    }
    return { issues: [] };
  }

  // Any other google.com shape: not provably wrong, but not recognized either —
  // require the owner to open it and confirm.
  if (confirmed) return { issues: [] };
  return {
    issues: [
      {
        severity: "confirm",
        message:
          "We couldn't recognize this link shape. Open it and check it shows your business's review page — then confirm it is correct.",
      },
    ],
  };
}

// ── Whole business profile (V1–V4) ─────────────────────────────────────────

/**
 * Validates the effective (merged) profile. `name`, `ownerName`, `ownerEmail`,
 * `city` and `googleReviewUrl` are required; website and social links are
 * validated only when present. The client is never trusted — the server runs
 * this on every business write.
 */
export function validateBusinessProfile(input: ProfileInput): {
  fieldErrors: Record<string, string>;
  fieldWarnings: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const fieldWarnings: Record<string, string> = {};

  if (!trimmed(input.name)) fieldErrors.name = "Company name is required.";
  if (!trimmed(input.ownerName)) fieldErrors.ownerName = "Owner name is required.";
  if (!trimmed(input.city)) fieldErrors.city = "City or address is required.";

  if (!trimmed(input.ownerEmail)) {
    fieldErrors.ownerEmail = "Your email is required — test emails are sent to it.";
  } else if (!isValidEmail(input.ownerEmail ?? "")) {
    fieldErrors.ownerEmail = "Enter a valid email address.";
  }

  const link = validateGoogleReviewUrl(input.googleReviewUrl ?? "", input.googleReviewUrlConfirmed === true);
  for (const issue of link.issues) {
    if (issue.severity === "error") fieldErrors.googleReviewUrl = issue.message;
    else fieldWarnings.googleReviewUrl = issue.message;
  }

  if (trimmed(input.website) && !isHttpsUrl(input.website ?? "")) {
    fieldErrors.website = "Website must be a valid https:// URL.";
  }
  for (const [key, value] of Object.entries(input.socialLinks ?? {})) {
    if (trimmed(value) && !isHttpsUrl(value)) {
      fieldErrors[`socialLinks.${key}`] = `${key} must be a valid https:// URL.`;
    }
  }

  return { fieldErrors, fieldWarnings };
}

/** True when the profile satisfies the gate (V1–V4) with no unconfirmed warnings. */
export function isBusinessProfileComplete(input: ProfileInput): boolean {
  const { fieldErrors, fieldWarnings } = validateBusinessProfile(input);
  return Object.keys(fieldErrors).length === 0 && Object.keys(fieldWarnings).length === 0;
}
