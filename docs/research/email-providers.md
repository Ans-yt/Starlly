# Email provider research: Agentboxd & OpenMail

Verified against each vendor's official documentation and OpenAPI spec (primary sources only).
Research date: verified from live docs pages — see [Sources](#sources) for the exact URLs.
Purpose: implement a REST-only (no MCP) TypeScript adapter `send(config, { to, subject, text, html? })`.

---

## 1. Agentboxd

Official docs: **https://agentboxd.com/docs/api** (every docs page also available as Markdown by adding `.md`; full machine-readable spec at **https://agentboxd.com/openapi.json**, OpenAPI 3.1, generated from the routes).
Base URL: `https://api.agentboxd.com`. The endpoints in the task brief are **confirmed**: `GET /v1/inboxes/{id}/messages` exists (list messages) and the send endpoint is `POST /v1/inboxes/{id}/messages/send`.

### Authentication

`Authorization: Bearer <api_key>` on every `/v1` route (docs: "All `/v1` routes need `Authorization: Bearer <api_key>`"). The OpenAPI security scheme is `http bearer`; keys are prefixed `mr_…`. Keys have a **scope** (workspace-wide or one inbox) and **permissions**; sending needs the `messages:send` permission (the `send_read` preset includes it). Auth failures: `401 unauthorized` (missing/revoked key), `401 api_key_expired` (past `expires_at`).

### Send endpoint

- **Method + path:** `POST /v1/inboxes/{id}/messages/send`
- Optional header: `Idempotency-Key` — send, reply, draft-create and draft-send honour it, so retries never send twice.
- Permission: `messages:send`.

### Request body schema (from openapi.json, `additionalProperties: false`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `to` | string or array of strings (max 50) | **required** | |
| `subject` | string, maxLength 998 | **required** | |
| `text` | string | required* | *One of `text`, `html` or `data` is required. |
| `html` | string | required* | |
| `cc`, `bcc` | string or array (max 50 each) | optional | |
| `attachments` | array of `{ filename, content_type, content_base64 }`, max 50 | optional | |
| `labels` | array of strings (max 50) | optional | |
| `send_at` | ISO 8601 date-time | optional | 1 min–30 days ahead; creates a scheduled draft instead of sending now |
| `data` | any (JSON, ≤ 64 KB) with `type` (`message`/`task`/`event`) | optional | agent-to-agent messages |
| `agent_signature` | string (≤ 16 384 chars) | optional | author signature; not with `send_at` |

**html:** supported (`html` field) — verified.
**reply_to / In-Reply-To:** **no `reply_to` field on send.** Threading is done by `POST /v1/inboxes/{id}/messages/{messageId}/reply` (`{ text?, html?, attachments?, reply_all?, ... }`), which sets `In-Reply-To`/`References` and adds `Re:`. For the adapter's `reply_to`-shaped need: unverified whether arbitrary custom `Reply-To`/`In-Reply-To` headers can be set on a new send — no such field is documented.
**Custom headers:** **no custom-headers field on send** — unverified/unsupported at send time (the message object *carries* `headers`, but the send body schema has no headers input).

### Response schema

`202 Accepted` with `status: "queued"`, plus `channel` and `delivery`. The docs reference `status: "queued"` explicitly and the message object includes `id`, `thread_id`-style fields (the message object has `id`, `status`, `text`, `html`, `headers`, `labels`, …). The send response's exact full field list is documented as a message object; treat the returned message `id` as the provider message id. Delivery is asynchronous: `queued` → `sent`/`delivered`/`bounced`/`failed` (status tracked on the message object, ~48 h retry loop for deferred delivery).

### Errors

Always: `{ "error": { "code", "message", "details"? } }`; a refused send also carries `docs_url`. Distinguish by HTTP status + stable `code`:

| Class | Status & codes |
| --- | --- |
| Auth | `401 unauthorized`, `401 api_key_expired` |
| Permission | `403 insufficient_permissions` (with `details.required`) |
| Validation | `400 invalid_request`, `400 invalid_data`, `422 recipient_not_found`, `413 data_too_large` |
| Policy/recipient | `422 recipient_suppressed`, `422 recipient_blocked`, `423 inbox_paused`, `423 workspace_stopped`, `403 sending_paused`, `403 org_suspended` |
| Rate/plan limits | `429 rate_limited` (per-key per-minute, or burst `sends_per_5min` with `Retry-After` + `details.retry_after_seconds`), `429 daily_send_limit_exceeded`, `429 org_daily_limit_exceeded`, `402 plan_limit_emails` |

### Documented rate limits (Free plan; beta — paid plans open later)

- Sends per 5 minutes (burst): **20** (per workspace; Builder 200, Team 1,000)
- Sends per day: **100** per workspace (per-inbox daily limit also exists: `429 daily_send_limit_exceeded`)
- Monthly emails in+out: **3,000** (beta is free)
- New workspaces: 20 sends/day for the first 3 days

### Capabilities table

| Capability | Status |
| --- | --- |
| `html` body | **verified** (`html` request field) |
| `text` body | **verified** |
| reply-to (set `Reply-To` on a new send) | **unverified** — no documented field; reply flow is the separate `reply` endpoint |
| custom headers on send | **unverified** — no documented field in the send schema |
| returns message id | **verified** (202 + message object with `id`, `status: "queued"`) |
| idempotency | **verified** (`Idempotency-Key` header) |

---

## 2. OpenMail (openmail.sh)

Official docs: **https://docs.openmail.sh** (Mintlify-hosted; API reference at `/api-reference/introduction`, machine-readable spec at **https://api.openmail.sh/openapi.json**, OpenAPI 3.0.3).
API base URL: `https://api.openmail.sh` (note: different host from the marketing site).

### Authentication

`Authorization: Bearer om_your_api_key_here` (docs: "All API requests require a Bearer token in the `Authorization` header"; keys prefixed `om_`). Three key scopes: account-wide, pod-scoped, inbox-scoped. Auth failure: `401` with body `{ "error": "unauthorized", "message": "Missing or invalid Authorization header" }`.

### Send endpoint

- **Method + path:** `POST /v1/inboxes/{id}/send` (operationId `sendEmail` — **not** `/messages/send`)
- Optional header: `idempotency-key` (repeat within 24 h returns the original message instead of resending; generated server-side if omitted).

### Request body schema (JSON or multipart/form-data)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `to` | string (email) | **required** | single address |
| `body` | string, 1–100 000 chars | **required** | plain text **or** HTML — HTML auto-detected, plain-text fallback generated |
| `subject` | string, 1–998 chars | required for new threads; optional when `threadId` set | |
| `bodyHtml` | string ≤ 500 000 chars | optional | only when plain-text and HTML versions must differ |
| `replyTo` | string (email) | optional | sets the `Reply-To` MIME header. Free plan: must be an OpenMail inbox you own; Pro+: any address (else `403 feature_requires_paid_plan`) |
| `cc`, `bcc` | array of emails | optional | |
| `threadId` | string | optional | reply in thread; `includeQuote` boolean appends quoted copy |
| `attachments` | multipart files | optional | max 25 MB total |

**html:** verified — either put HTML in `body` (auto-detected) or pass separate `bodyHtml` alongside `body`.
**reply-to:** **verified** (`replyTo` field).
**Custom headers:** **unverified** — no custom-headers field exists in the send schema.

### Response schema

`200` with `{ messageId, threadId, providerMessageId, status }` where `status` ∈ `pending | sent | failed`. **Yes — returns a provider message id** (`providerMessageId`, plus API-level `messageId`).

### Errors

Shape: `{ "error": string, "message": string }` (`error` is the machine-readable code). Distinctions:

| Class | Status & codes |
| --- | --- |
| Auth | `401 unauthorized` |
| Validation | `400` — missing body, invalid `to`/`replyTo`/`cc`/`bcc`, missing subject when required |
| Policy | `403 recipient_not_permitted` (refused address in `recipient`), `403 feature_requires_paid_plan`, `403 account_banned`, `403 reputation_suspended` |
| Pause/limit | `402 spend_cap_paused` |
| Content/domain | `422 unsafe_content`, `422 phishing_detected`, `422 no_mx_records` (domain in `domain`), `422 recipient_suppressed`, `409 domain_sending_pending` (check `Retry-After`) |
| Rate limit | `429 rate_limit_exceeded` / `429 cold_outreach_limit` — always with `Retry-After`; cold-outreach 429 also carries `scope` (`inbox`/`domain`/`customer`), `limit`, `resetsAt` |
| Not found | `404` inbox or thread not found |

### Documented rate limits

- Per-inbox burst: **10 sends/minute**
- Per-inbox daily: **200 sends/day**
- Cold-outreach cap (new recipients per UTC day): Free inbox 20/day first 30 days then 200/day; Pro inbox 20/day during 7-day warm-up, then no cold cap (200/day send limit applies); domain and account caps scale with tiers.
- Inbox creation: 100/day per account. 429s include `Retry-After`; caps reset at midnight UTC.

### Capabilities table

| Capability | Status |
| --- | --- |
| `html` body | **verified** (`body` auto-detect, or `bodyHtml`) |
| `text` body | **verified** (`body`) |
| reply-to | **verified** (`replyTo`; plan-restricted on Free) |
| custom headers on send | **unverified** — no documented field |
| returns message id | **verified** (`messageId` + `providerMessageId`) |
| idempotency | **verified** (`idempotency-key` header, 24 h window) |

---

## Code-ready notes for the adapter

Target signature: `send(config, { to, subject, text, html? })`. All calls server-side only (repo rule: provider calls happen in `server/`), through a persisted send job; ambiguous timeouts are never auto-retried.

```ts
// Shared result shape both adapters should normalize to:
// { providerMessageId: string | null, raw: unknown }
// Auth errors (401/403-with-auth-code) -> surface for owner decision, never retry.
// 429 -> respect Retry-After; do NOT auto-retry unless policy allows.
// 4xx validation (400/422) -> fail the send job permanently with the code.
```

**Agentboxd adapter (`POST https://api.agentboxd.com/v1/inboxes/{inboxId}/messages/send`):**

- Headers: `Authorization: Bearer ${config.apiKey}`, `Content-Type: application/json`, optional `Idempotency-Key: <uuid>` (persist it with the send job so retries are safe).
- Body: `{ to: params.to, subject: params.subject, text: params.text, ...(params.html ? { html: params.html } : {}) }` — `subject` is always required here (unlike OpenMail), `to` may be a string or array. Note: one of text/html/data required; NUL (U+0000) in any text field → `400 invalid_request`.
- Success: expect **202** (not 200) with the message object (`id`, `status: "queued"`). Treat non-2xx per the `{ error: { code, message, details } }` shape; log `error.code` as the failure reason.
- There is no `reply_to` param: if the caller needs threading, that is a separate call (`POST .../messages/{messageId}/reply`) — out of scope for the simple `send()` adapter.
- 429 handling: burst errors carry `details.retry_after_seconds` + `Retry-After`; `daily_send_limit_exceeded`/`org_daily_limit_exceeded` reset at 00:00 UTC (do not spin-retry).

**OpenMail adapter (`POST https://api.openmail.sh/v1/inboxes/{inboxId}/send`):**

- Headers: `Authorization: Bearer ${config.apiKey}`, `Content-Type: application/json`, optional `idempotency-key`.
- Body mapping: `{ to: params.to, subject: params.subject, body: params.text }`; when `params.html` differs from text: `{ body: params.text, bodyHtml: params.html }` (or simply put the HTML in `body` — it is auto-detected — but the explicit pair is clearer and keeps the plain-text fallback).
- `replyTo` is supported but on the Free plan must be an inbox the account owns — gate it: only pass it through on paid plans or when it matches an owned inbox, else expect `403 feature_requires_paid_plan`.
- Success: expect **200** with `{ messageId, threadId, providerMessageId, status }`; store `providerMessageId ?? messageId`.
- 429 handling: read `Retry-After`; a `cold_outreach_limit` 429 includes `resetsAt` (midnight UTC) — park the send until then, another inbox on the same domain will not help when `scope === "domain"`.

**Divergences worth a test each:** Agentboxd returns 202/queued (async), OpenMail returns 200/pending-or-sent (also async but different status vocabulary) — the adapter result should normalize to "accepted" vs "rejected with code", not final delivery. Subject is required on Agentboxd sends, conditionally on OpenMail. Neither provider documents custom send headers, so the adapter's config should not expose a `headers` option yet.

## Recommendation

Implement the OpenMail adapter first — its send contract (`replyTo`, explicit `bodyHtml`, single documented response schema with `providerMessageId`) is the most fully specified and maps 1:1 onto the adapter signature — then Agentboxd.

## Sources

- Agentboxd — API reference: https://agentboxd.com/docs/api (fetched as https://agentboxd.com/docs/api.md)
- Agentboxd — OpenAPI 3.1 spec: https://agentboxd.com/openapi.json (auth scheme, send request schema, Error schema)
- Agentboxd — Plans and limits: https://agentboxd.com/docs/plans (fetched as https://agentboxd.com/docs/plans.md)
- Agentboxd — Send refusals (error catalogue): https://agentboxd.com/docs/send-refusals (referenced from the API reference)
- OpenMail — Documentation home: https://docs.openmail.sh
- OpenMail — API reference introduction: https://docs.openmail.sh/api-reference/introduction
- OpenMail — Send email (embedded OpenAPI): https://docs.openmail.sh/api-reference/messages/send-email.md
- OpenMail — Authentication: https://docs.openmail.sh/api-reference/authentication.md
- OpenMail — Rate limits: https://docs.openmail.sh/concepts/rate-limits.md