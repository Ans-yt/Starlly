# ADR-0002: TypeScript monorepo — React + Vite frontend, Node + Express backend

- **Status:** Accepted
- **Context:** Keys must never be called from browser code (spec §4.3), so a backend is mandatory. The product stays self-hosted and single-business; "real app" does not mean multi-tenant SaaS.
- **Decision:**
  - TypeScript throughout. `server/` (Express + Node) owns provider calls, secrets, database access, and sending. `web/` (React + Vite) is the owner UI plus the public customer page; it holds no secrets and calls no providers.
  - npm workspaces at the repo root; shared domain types live in `server/src/domain/types.ts` and are re-exported for the frontend via a generated/typed client layer in `web/src/lib/api.ts`.
  - Express serves the built frontend and the public customer routes from one process; the public base URL (`PUBLIC_BASE_URL`) is configuration.
- **Consequences:** One language, one test runner, one deploy unit. Multi-tenancy is explicitly out of scope.