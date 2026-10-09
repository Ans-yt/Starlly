// Shared domain vocabulary — see GLOSSARY.md. Pure types only; no I/O.

export type ProfileSource = "typed" | "file" | "web";

export interface ProfileField {
  key: string;
  value: string;
  source: ProfileSource;
}

export type FieldSourceMap = Record<string, ProfileSource>;

/** Where a review text came from (GLOSSARY: public review vs private feedback). */
export type ReviewSource = "google_import" | "pasted" | "private_feedback";

/** Customer-page observations (GLOSSARY: "google_click" never means "posted a review"). */
export type EventType =
  | "opened"
  | "rated"
  | "google_click"
  | "feedback_submitted"
  | "call_requested";

export type DraftKind = "review_request" | "follow_up" | "review_reply";

/** GLOSSARY: any content edit while approved invalidates approval (ADR-0004, ticket 006). */
export type DraftStatus = "draft" | "approved" | "sent";

export type SendJobStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "failed_permanent"
  | "failed_temporary"
  | "ambiguous";

export type CustomerStatus = "active" | "do_not_contact";

/** Normalized email failure classes (ADR-0004). */
export type EmailErrorKind = "auth" | "validation" | "rate_limit" | "temporary" | "permanent";

export type Sentiment = "positive" | "negative" | "neutral";

/** Funnel steps in order; the last one is "Clicked Google link" and never more (GLOSSARY). */
export const FUNNEL_STEPS = ["sent", "opened", "rated", "google_click"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelRow {
  step: FunnelStep;
  label: string;
  count: number;
}
