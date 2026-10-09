// agentboxd adapter — implemented strictly per docs/research/email-providers.md
// (official docs https://agentboxd.com/docs/api + vendor OpenAPI 3.1 spec).
// Send: POST /v1/inboxes/{id}/messages/send → 202 with message object (id, status:"queued").
// Errors: { error: { code, message, details? } } — 401 auth, 400/422/413 validation,
// 402/403/423 permanent, 429 rate_limit (burst Retry-After; daily limits reset 00:00 UTC).
import { providerFetch } from "./fetch.js";
import {
  normalizeError,
  sanitizeErrorText,
  type EmailAdapter,
  type EmailSendResult,
  type EmailTestResult,
  type NormalizedEmailError,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.agentboxd.com";

interface AgentboxdErrorBody {
  error?: { code?: string; message?: string };
}

function classify(status: number, code: string): { kind: NormalizedEmailError["kind"]; retryable: boolean } {
  if (status === 401) return { kind: "auth", retryable: false };
  if (status === 400 || status === 422 || status === 413) return { kind: "validation", retryable: false };
  if (status === 402 || status === 403 || status === 423) return { kind: "permanent", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  return { kind: "temporary", retryable: true };
}

async function requestOnce(
  config: Record<string, string>,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return providerFetch(`${base}${path}`, init);
}

function authHeaders(config: Record<string, string>, idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function parseErrorWith(response: Response, fallbackCode: string): Promise<{ code: string; message: string }> {
  let code = fallbackCode;
  let message = `agentboxd request failed (HTTP ${response.status}).`;
  try {
    const parsed = (await response.json()) as AgentboxdErrorBody;
    if (parsed.error?.code) code = parsed.error.code;
    if (parsed.error?.message) message = sanitizeErrorText(parsed.error.message);
  } catch {
    // non-JSON error body
  }
  return { code, message };
}

export const agentboxdAdapter: EmailAdapter = {
  id: "agentboxd",
  label: "agentboxd",
  capabilities: { html: true, replyTo: false, headers: false }, // reply-to/headers: unverified per docs
  configFields: [
    { key: "apiKey", label: "API key", type: "password", required: true, docsUrl: "https://agentboxd.com/docs/api" },
    { key: "inboxId", label: "Inbox ID", type: "text", required: true, docsUrl: "https://agentboxd.com/docs/api" },
    { key: "baseUrl", label: "Base URL", type: "text", required: false, placeholder: DEFAULT_BASE_URL },
  ],
  async test(config): Promise<EmailTestResult> {
    if (!config.apiKey) return { ok: false, error: normalizeError("auth", "Missing API key.", false) };
    if (!config.inboxId) return { ok: false, error: normalizeError("validation", "Missing inbox ID.", false) };
    // GET /v1/inboxes/{id}/messages is the verified read endpoint for a connection test.
    const response = await requestOnce(config, `/v1/inboxes/${encodeURIComponent(config.inboxId)}/messages`, {
      method: "GET",
      headers: authHeaders(config),
    });
    if (response.ok) return { ok: true };
    const { code, message } = await parseErrorWith(response, "request_failed");
    if (response.status === 401) return { ok: false, error: normalizeError("auth", `${code}: ${message}`, false) };
    if (response.status === 403) {
      // Key authenticated but lacks list permission — sending may still work (separate permission).
      return { ok: true, note: "API reachable and key valid, but it lacks the messages list permission." };
    }
    const { kind, retryable } = classify(response.status, code);
    return { ok: false, error: normalizeError(kind, `${code}: ${message}`, retryable) };
  },
  async send(config, message, meta): Promise<EmailSendResult> {
    if (!config.apiKey) return { status: "failed", error: normalizeError("auth", "Missing API key.", false) };
    if (!config.inboxId) return { status: "failed", error: normalizeError("validation", "Missing inbox ID.", false) };
    if (!message.subject.trim()) {
      return { status: "failed", error: normalizeError("validation", "agentboxd requires a subject.", false) };
    }
    const body: Record<string, unknown> = {
      to: message.to,
      subject: message.subject.slice(0, 998), // maxLength 998 per OpenAPI
      text: message.text,
    };
    if (message.html) body.html = message.html;

    const response = await requestOnce(config, `/v1/inboxes/${encodeURIComponent(config.inboxId)}/messages/send`, {
      method: "POST",
      headers: authHeaders(config, meta?.idempotencyKey),
      body: JSON.stringify(body),
    });

    if (response.ok) {
      // 202 Accepted with the message object; treat message id as provider message id.
      const data = (await response.json()) as { id?: string };
      return { status: "accepted", providerMessageId: data.id ?? undefined };
    }
    const { code, message: errMsg } = await parseErrorWith(response, "request_failed");
    const { kind, retryable } = classify(response.status, code);
    return { status: "failed", error: normalizeError(kind, `${code}: ${errMsg}`, retryable) };
  },
};
