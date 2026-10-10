# Starlly decisions log

One line per decision made while the owner is away. Newest first. Conservative
default when unsure: keep existing behavior and note why.

- D-003 (cycle 3) — Owner's override "sending is automatic" (no per-message approval step anywhere) is ACCEPTED but gets its own cycle: it touches the approval domain, Messages UI, specs and several passing tests. Doing it mid-cycle 3 would leave the approval logic half-migrated. The intro screen is already free of approval language.
- D-002 (cycle 3) — The WorksWheel ring/drum intro is REPLACED by the owner's sketch flight + cycling carousel (pass A). The old wheel spec (`00-loading-wheel.spec.ts`) was deleted — it asserted behavior pass A explicitly supersedes; keeping both would mean dead code and two sources of truth.
- D-001 (cycle 3) — GitHub pushes authenticate with the owner's PAT stored at `.git/push-token.txt` (inside `.git/`, never committed, never printed; push output is filtered). Remote URL stays clean; history is secret-scanned before every push.
