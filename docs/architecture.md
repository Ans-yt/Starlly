# Starlly Architecture

How the modules fit, where the seams are, and what each boundary forbids. Domain vocabulary: `GLOSSARY.md`. Binding decisions: `docs/decisions/`.

## Layer map

```
web/  (React + Vite)                server/  (Node + Express + TS)
┌────────────────────────┐          ┌─────────────────────────────────────────┐
│ UI: pages + components │  HTTP/JS │ http/  routes + middleware              │
│ No keys. No direct     │ ───────► │ auth: owner session | public: token     │
│ provider calls.        │          │ domain/  business rules (pure TS)       │
└────────────────────────┘          │ storage/ Drizzle + better-sqlite3       │
                                    │ adapters/email/  adapters/ai/           │
                                    │ sending/  send jobs (persist, no dupes) │
                                    │ inference/ tagger in a worker thread    │
                                    └─────────────────────────────────────────┘
```

## Modules and their seams

| Module | Path | Owns | Forbidden to it |
|---|---|---|---|
| **http** | `server/src/http/` | Routing, auth, validation, rate limiting, error mapping to HTTP | Business rules, SQL, provider calls |
| **domain** | `server/src/domain/` | Approval state machine, policy check, quote verification, rebooking baseline, funnel/dashboard computation | I/O: no DB, no HTTP, no providers — pure functions over plain types |
| **storage** | `server/src/db/` | Drizzle schema, migrations, queries, backup/export, seed/import | Business rules; knows tables, not policies |
| **adapters/email** | `server/src/adapters/email/` | Per-provider config fields, capabilities, `test()`, `send()`, normalized errors | Approval logic, scheduling, persistence of jobs |
| **adapters/ai** | `server/src/adapters/ai/` | Chat-completions/Messages-style calls for drafting, summaries, chat | Sending anything without an approval record |
| **sending** | `server/src/sending/` | Send-job lifecycle: create → queued → sending → accepted / failed / ambiguous; duplicate prevention | Editing drafts, deciding approvals |
| **inference** | `server/src/inference/` | Transformers.js worker: embeddings, theme tagging, sentiment; model + embedding caches | Blocking the request thread; presenting similarity as probability |
| **web** | `web/src/` | All owner UI + the public customer page (mobile-first) | Holding secrets, calling providers, computing business results locally |

## Boundary rules (enforceable in review)

1. **Frontend never sees secrets.** Settings API returns masked values; Vite gets only `VITE_API_BASE`.
2. **Domain is pure.** Anything a test can't run without a database doesn't belong in `domain/`.
3. **One seam per provider.** Swapping agentboxd for OpenMail touches only `adapters/email/`. Business code imports the interface, never a concrete adapter.
4. **Every send is a job first.** The send-job row exists before the adapter call; the adapter call has a unique job id; ambiguous outcomes flip the job to `ambiguous` for owner review.
5. **Approval is a state, not a flag in transit.** `draft → approved → sent`; any content edit while `approved` flips it back to `draft` and clears the approval timestamp.
6. **Public surface is minimal.** Only `/api/public/*` (token routes) is exposed without owner auth; tokens expire and are revocable; public routes are rate-limited.
7. **Dashboards compute from records.** If a number can't be recomputed from the DB, it's hardcoded — which is a bug. Google listing stats stay in their own fields, separate from corpus statistics.
8. **Untrusted text never becomes instructions.** Review/feedback/file/web text enters prompts as quoted data only; the quote verifier re-checks every quote against the corpus.

## Key flows

**Tracer path (first vertical slice):** business setup → customer created → request drafted → approved → send job accepted → customer opens link → rates + clicks Google link → events persisted → dashboard recomputes.

**Approval/send:** draft edited → invalidated approval (domain) → owner approves (http) → send job created (sending) → adapter sends (adapters/email) → provider message id persisted (storage).

**Customer page:** token lookup (http, rate-limited) → request + business name (storage) → rating/feedback/call-request events (domain validates, storage persists) → Google button always visible with the same link.

**Tagging:** review text → worker queue → embeddings (cached by text hash) → similarity to theme embeddings + classifier → themes + sentiment persisted → counts come from the tagger, never the LLM.

## Where "sample data" plugs in

`storage/seed/` loads the owner-supplied sample set through the same writes real data uses, tagged sample, deletable as a unit. No feature branch reads sample data directly.