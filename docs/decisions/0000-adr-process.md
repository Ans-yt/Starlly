# ADR-0000: Decisions are recorded as ADRs; ADRs win over specs

- **Status:** Accepted
- **Context:** The owner supplied 19 binding decisions (session record, 2026). `functional-spec.md` and `design.md` predate some of them.
- **Decision:** Every irreversible or cross-cutting choice gets a numbered ADR under `docs/decisions/`. When docs conflict, precedence is: ADRs → `functional-spec.md` → `design.md`. The stale doc is updated in the same change (per `AGENTS.md`).
- **Consequences:** Agents resolve conflicts by lookup, not by re-asking. Glossary terms in `GLOSSARY.md` are the shared vocabulary for all of them.