// Email adapter contract (ADR-0004). Business code imports this interface, never a concrete adapter.
import type { EmailErrorKind } from "../../domain/types.js";

export interface EmailConfigField {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder?: string;
  /** "Where do I get this?" link shown in Settings. */
  docsUrl?: string;
}

export interface EmailCapabilities {
  html: boolean;
  replyTo: boolean;
  headers: boolean;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface NormalizedEmailError {
  /** auth | validation | rate_limit | temporary | permanent (ADR-0004). */
  kind: EmailErrorKind;
  /** Safe for UI display. Must never contain secrets. */
  message: string;
  retryable: boolean;
}

export type EmailTestResult =
  | { ok: true; note?: string }
  | { ok: false; error: NormalizedEmailError };

export type EmailSendResult =
  | { status: "accepted"; providerMessageId?: string }
  | { status: "failed"; error: NormalizedEmailError };

export interface SendMeta {
  /** Providers honouring idempotency keys must reuse the same key across retries of the same job. */
  idempotencyKey?: string;
}

export interface EmailAdapter {
  id: string;
  label: string;
  capabilities: EmailCapabilities;
  configFields: EmailConfigField[];
  test(config: Record<string, string>): Promise<EmailTestResult>;
  send(config: Record<string, string>, message: OutgoingEmail, meta?: SendMeta): Promise<EmailSendResult>;
}

export function normalizeError(kind: EmailErrorKind, message: string, retryable: boolean): NormalizedEmailError {
  return { kind, message, retryable };
}

/** Strip anything that looks like a secret from provider error text before persisting it. */
export function sanitizeErrorText(text: string): string {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|om_[A-Za-z0-9_-]{8,}|mr_[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/gi, "[redacted]")
    .slice(0, 500);
}
