# ADR-0004: Email adapter contract — capabilities, normalized errors, persisted send jobs

- **Status:** Accepted
- **Context:** Spec §4.3 sketched `fields / test() / send()` but left errors, delivery semantics, and duplicate-send safety open. agentboxd is the default; "Copy only" must work with zero keys; OpenMail is openmail.sh (per owner).
- **Decision:**
  - Adapters live in `server/src/adapters/email/` and implement one interface:
    - `id`, `configFields` (drives the settings form), `capabilities` (`{ html, replyTo, headers }` — only what the provider's docs verify),
    - `test(config)` → connection check,
    - `send(config, { to, subject, text, html? })` → result.
  - All errors normalize to: `auth` | `validation` | `rate_limit` | `temporary` | `permanent`, with retryability.
  - `send` returns provider **acceptance** and a provider message ID if given. Acceptance ≠ confirmed delivery; the UI never claims delivery.
  - Plain text is always supported; HTML/reply-to/headers only when the adapter's capabilities say so.
  - Every send goes through a persisted **send job** (`server/src/sending/`): job row created before the provider call, unique per draft; ambiguous timeouts flip the job to `ambiguous` and are surfaced for owner decision — never auto-retried, so duplicate sends are impossible even across restarts.
  - Implemented first: `copy-only` and `agentboxd`. OpenMail and Gmail-via-Composio follow only after their current docs are verified; no invented capabilities, no silent provider substitution.
- **Consequences:** Provider outages degrade to visible job states, not lost mail. Adding a provider touches one directory.