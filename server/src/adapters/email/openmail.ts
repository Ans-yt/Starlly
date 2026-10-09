// OpenMail adapter — implemented strictly per docs/research/email-providers.md
// (official docs https://docs.openmail.sh; API base https://api.openmail.sh).
// Send: POST /v1/inboxes/{id}/send → 200 { messageId, threadId, providerMessageId, status }.
// Errors: { error: "<code>", message } — 401 auth, 400/404 validation, 402/403/422 permanent,
// 429 rate_limit (Retry-After), 5xx temporary.
import { providerFetch } from "./fetch.js";
import {
  normalizeError,
  sanitizeErrorText,
  type EmailAdapter,
  type EmailSendResult,
  type EmailTestResult,
  type NormalizedEmailError,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openmail.sh";

interface OpenMailErrorBody {
  error?: string;
  message?: string;
}

function classify(status: number, code: string): { kind: NormalizedEmailError["kind"]; retryable: boolean } {
  if (status === 401) return { kind: "auth", retryable: false };
  if (status === 400 || status === 404) return { kind: "validation", retryable: false };
  if (status === 402 || status === 403) return { kind: "permanent", retryable: false };
  if (status === 422 || status === 409) return { kind: "permanent", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  return { kind: "temporary", retryable: true };
}

async function sendRequest(
  config: Record<string, string>,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
): Promise<EmailSendResult> {
  const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const inboxId = config.inboxId;
  if (!config.apiKey) return { status: "failed", error: normalizeError("auth", "Missing API key.", false) };
  if (!inboxId) return { status: "failed", error: normalizeError("validation", "Missing inbox ID.", false) };

  const response = await providerFetch(`${base}/v1/inboxes/${encodeURIComponent(inboxId)}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    const data = (await response.json()) as { messageId?: string; providerMessageId?: string };
    return { status: "accepted", providerMessageId: data.providerMessageId ?? data.messageId ?? undefined };
  }

  let code = "unknown";
  let message = `OpenMail request failed (HTTP ${response.status}).`;
  try {
    const parsed = (await response.json()) as OpenMailErrorBody;
    if (parsed.error) code = parsed.error;
    if (parsed.message) message = sanitizeErrorText(parsed.message);
  } catch {
    // non-JSON error body — keep the generic message
  }
  const { kind, retryable } = classify(response.status, code);
  return { status: "failed", error: normalizeError(kind, `${code}: ${message}`, retryable) };
}

export const openMailAdapter: EmailAdapter = {
  id: "openmail",
  label: "OpenMail (openmail.sh)",
  capabilities: { html: true, replyTo: true, headers: false },
  configFields: [
    { key: "apiKey", label: "API key", type: "password", required: true, docsUrl: "https://docs.openmail.sh/api-reference/authentication" },
    { key: "inboxId", label: "Inbox ID", type: "text", required: true, docsUrl: "https://docs.openmail.sh" },
    { key: "baseUrl", label: "Base URL", type: "text", required: false, placeholder: DEFAULT_BASE_URL },
  ],
  async test(config): Promise<EmailTestResult> {
    // No documented read endpoint, so the test is a send attempt to an RFC 2606
    // reserved .invalid address: undeliverable by construction, but a non-401
    // response proves the key is valid and the API is reachable.
    const result = await sendRequest(
      config,
      {
        to: "starlly-connection-check@connection-check.invalid",
        subject: "Starlly connection check",
        body: "Starlly connection check. This address is reserved and cannot receive mail.",
      },
      undefined,
    );
    if (result.status === "accepted") return { ok: true };
    if (result.error.kind === "auth") return { ok: false, error: result.error };
    // Any other rejection (validation/policy/rate limit) still proves authentication.
    return { ok: true, note: "API reachable and key accepted (check used a reserved .invalid address; nothing was delivered)." };
  },
  async send(config, message, meta) {
    const body: Record<string, unknown> = {
      to: message.to,
      subject: message.subject,
      body: message.text,
    };
    if (message.html) body.bodyHtml = message.html;
    if (message.replyTo) body.replyTo = message.replyTo; // Free plan: must be an owned inbox
    return sendRequest(config, body, meta?.idempotencyKey);
  },
};
