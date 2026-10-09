# ADR-0005: Public customer pages — configurable HTTPS base URL, token lifecycle, rate limits

- **Status:** Accepted
- **Context:** Real customers must be able to open links (spec §10 said tunnels were "out of scope" for the demo; the owner overruled: real links are in scope, localhost stays a preview option).
- **Decision:**
  - Customer links are `{PUBLIC_BASE_URL}/c/{token}`. The owner configures the public HTTPS base URL (deploy or tunnel to the running backend); README documents that a locally hosted instance must stay online for links to work.
  - Only customer-page routes are public: `GET/POST /api/public/requests/:token/...`. Everything else requires owner auth; settings are owner-only.
  - Tokens: cryptographically random, expire after a configurable period, revocable per request; revoked/expired tokens render a plain expired page.
  - Public routes are rate-limited (per token and per IP); customer-page events are persisted with the request id.
  - The Google review button is always present with the same link and prominence (spec §5.2); low-rating extras appear beside it, never instead.
- **Consequences:** Deploying needs one public URL; no separate page-hosting service. Security review focuses on one small public surface.