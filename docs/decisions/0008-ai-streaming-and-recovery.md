# ADR-0008: Streaming AI, validated evidence and recoverable processing

- Status: Accepted (owner requested the audit fixes and streaming chat).
- Decision: Keep provider calls server-side. Support optional streaming in the
  AI adapter contract; the owner chat API uses NDJSON events for answer updates,
  provider reasoning, completion and errors. Non-streaming JSON clients remain
  compatible. Validate completion shapes at runtime and retain quotation checks.
  Reasoning is provider-supplied, separate and collapsed in the interface.
- Bound provider requests, evidence size and embedding batches. Model/preprocessing
  versions join the text hash in cache keys. Successful no-match tagging has a
  persistent theme/model version, independent of theme links.
- Every retry enforces approval and policy. Persist a fingerprint of the exact
  payload; a provider idempotency key cannot be reused for changed content/provider.
  Startup converts interrupted sends into owner-resolvable ambiguity, never an
  automatic resend. Acceptance updates are atomic with draft/request state.
- Portable backups include summaries and omit credentials. Delete/restore handles
  summary dependencies; data deletion is transactional.
- Consequences: Two nullable columns require migration. Existing classifications
  are recomputed on the next tagging run; old cache rows are bypassed. Older
  attempted send jobs without payload fingerprints cannot be safely retried with
  potentially changed content; owners can resolve ambiguity or create a new draft.
  Quote provenance does not prove every narrative claim. Semantic retrieval and
  classifier accuracy improvements require separate relevance/accuracy evaluation.
