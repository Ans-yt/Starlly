# ADR-0006: Testing — Vitest for domain/integration, Playwright for key browser flows

- **Status:** Accepted
- **Context:** Spec §14 promised tests for the policy checker and quote verifier; the owner set broader priorities.
- **Decision:**
  - Vitest for domain logic and API integration tests (`*.test.ts` near code; server integration tests boot the Express app against a temp SQLite DB).
  - Playwright for important browser flows (onboarding skip-path, draft → approve → send, customer page rating).
  - Priority coverage, in order: approval enforcement (edit-after-approval invalidates approval before sending), duplicate-send prevention (including ambiguous timeouts), persistence across restart, customer events, policy checks, quote verification, public/private route boundaries.
  - Bug fixes start with a failing regression test.
- **Consequences:** `npm test` covers everything without a browser; Playwright runs explicitly via `npm run test:e2e`.