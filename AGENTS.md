# AGENTS.md — conventions for agents working in this repo

One rule per topic; details live in the pointed-at docs, not here.

## Validation before "done"

A ticket is done when, from the repo root: `npm run build` passes, `npm test` passes, and the app boots with `npm run dev`. Report what you ran, not what you assume. (`AGENTS.md` completion criteria = build + test + boot.)

## Secrets

- Keys/config live in `.env` (never committed) or the local settings store. `.env.example` documents every variable; placeholders only.
- Secrets never reach the frontend bundle, never appear in API responses (mask on read), never appear in logs.
- All provider calls happen in `server/` only.

## Database

- Schema changes go through Drizzle migrations (`npm run db:generate`, then commit the generated SQL). Never hand-edit the SQLite file; never `ALTER` outside a migration.
- Sample data enters only through the seed/import mechanism (`server/src/db/seed/`), never ad-hoc scripts.

## Sending

- Every outbound email goes through a persisted send job (`server/src/sending/`). No direct adapter calls from routes.
- Ambiguous timeouts are never auto-retried; they surface for owner decision.

## Testing

- Domain logic and integration: Vitest (`*.test.ts` beside the code or under `server/tests/`). Browser flows: Playwright (`web/tests/`).
- Priority coverage: approval enforcement (edit-after-approval invalidates), duplicate-send prevention, persistence across restart, customer events, policy checks, quote verification, public/private route boundaries.
- Write the failing test first when fixing a bug (regression test proves it).

## Domain language

Use `GLOSSARY.md` terms exactly. If a name fights you, fix the glossary or the code — do not invent a synonym.

## Specs

`functional-spec.md` is behavior; `design.md` is layout; `docs/decisions/` are binding ADRs. When they conflict, ADRs win, then the spec; update the stale doc in the same change.

## Completion criteria

1. `npm run build` — clean.
2. `npm test` — green.
3. Boot check: server starts, dashboard loads, no console errors.
4. Docs touched if behavior or terms changed (README, GLOSSARY, spec).
5. No secrets, no sample-data numbers hardcoded in logic.