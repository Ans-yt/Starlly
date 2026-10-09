# ADR-0001: Storage is SQLite with Drizzle ORM and better-sqlite3

- **Status:** Accepted
- **Context:** Spec said "a local database or JSON file" (§9). Starlly is self-hosted, single-business; JSON as the primary store cannot give us transactional send jobs, migration history, or safe concurrent event writes.
- **Decision:**
  - SQLite via `better-sqlite3`, accessed only through Drizzle ORM with generated SQL migrations committed to the repo.
  - Persistent records for: business profile, customers, requests, events, review corpus, drafts, send jobs, notes, themes.
  - Backup/export support: file-level backup plus JSON export/import (`storage/db/`).
  - JSON is used for imports, exports, and fixtures — never as the primary database.
  - Sample data enters only through the seed/import mechanism; dashboard values are always computed from stored records, and Google listing stats stay separate from corpus statistics.
- **Consequences:** No hosted-DB complexity; sends and events are atomic; schema changes require migrations (enforced in `AGENTS.md`).