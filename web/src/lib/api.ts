// Typed API client. The frontend holds no secrets and never calls providers —
// it only talks to our backend (architecture rules 1–2).

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    const nestedMessage = body?.error?.message;
    const message =
      typeof nestedMessage === "string"
        ? nestedMessage
        : typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : `Request failed (${status})`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    // non-JSON (e.g., static file)
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
};

// ── Shared response shapes (subset of server routes) ───────────────────────

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

export interface Business {
  name: string;
  ownerName: string;
  ownerEmail: string;
  city: string;
  sinceDate: string | null;
  googleReviewUrl: string;
  website: string;
  socialLinks: Record<string, string>;
  fieldSources: Record<string, string>;
  profileFields: { key: string; value: string; source: string }[];
  placeId: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  isSample: boolean;
}

export interface AdapterDescription {
  id: string;
  label: string;
  capabilities: { html: boolean; replyTo: boolean; headers: boolean };
  configFields: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    docsUrl?: string;
  }[];
}

export interface SecretState {
  set: boolean;
  masked: string;
}

export interface Settings {
  emailAdapterId: string;
  emailAdapters: AdapterDescription[];
  emailConfig: Record<string, SecretState>;
  emailLastTestAt: string | null;
  aiLastTestAt: string | null;
  aiStyle: string | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiApiKey: SecretState;
  exaApiKey: SecretState;
  googlePlacesApiKey: SecretState;
  publicBaseUrl: string | null;
  sampleLoaded: boolean;
}

export interface CustomerRow {
  id: string;
  name: string;
  contact: string;
  serviceType: string;
  lastJobDate: string | null;
  consent: boolean;
  status: string;
  callResolvedAt: string | null;
  isSample: boolean;
  derived: "waiting" | "requested" | "needs_call" | null;
}

export interface SendJobSummary {
  id: string;
  status: string;
  provider: string;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  isTest: boolean;
  acceptedAt: string | null;
}

export interface DraftRow {
  emailDesign: import("../components/EmailStudio.js").EmailDesign | null;
  id: string;
  kind: string;
  customerId: string | null;
  requestId: string | null;
  subject: string;
  body: string;
  status: "draft" | "approved" | "sent";
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sendJob: SendJobSummary | null;
  testJob: SendJobSummary | null;
}

export interface FunnelRow {
  step: string;
  label: string;
  count: number;
}

export interface Dashboard {
  company: {
    name: string;
    ownerName: string;
    city: string;
    sinceDate: string | null;
    googleRating: number | null;
    googleReviewCount: number | null;
    emailConnected: boolean;
    emailConnectedAt: string | null;
    emailAdapter: string;
    isSample: boolean;
  };
  waitingCount: number;
  funnel: FunnelRow[];
  ratingTrend: { date: string; average: number; count: number }[];
  themes: { id: string; name: string; positive: number; negative: number }[];
  needsCall: { id: string; name: string; contact: string }[];
  recentReviews: {
    id: string;
    source: string;
    author: string;
    rating: number | null;
    date: string;
    snippet: string;
    replied: boolean;
    sentiment: string | null;
  }[];
  sampleLoaded: boolean;
}

export interface SendResponse {
  outcome: "duplicate" | "accepted" | "failed" | "ambiguous";
  job: SendJobSummary;
  link?: string;
  copyText?: string;
  copyHtml?: string;
}
