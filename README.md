<p align="center">  <img src="assets/og-image-1200x630.png" alt="Starlly" width="720"></p>
# Starlly

Starlly helps a small local business collect more Google reviews from happy customers and learn from all the feedback. The owner sends one review request per finished job, sees ratings and themes, and gets a ranked list of what to fix first. **The AI drafts; the owner approves.**

Self-hosted, single-business, Apache 2.0. Works with zero API keys (sample data + Copy only); keys unlock live sending and enrichment.

## Quick start

```bash
npm install
npm run build
npm run dev        # starts server + web app; http://localhost:8787
```

Copy `.env.example` to `.env` and set `PUBLIC_BASE_URL` before sending real links (see below). First run loads sample data, labeled "Sample data" — every feature works without keys.

## Configuration

All keys stay on this machine: in `.env` or entered in Settings (stored in the local database, never returned unmasked by the API, never logged, never sent to the frontend).

| Setting | Purpose |
|---|---|
| `PORT` | Server port (default 8787) |
| `DATA_DIR` | SQLite database + backups location |
| `PUBLIC_BASE_URL` | Public HTTPS base URL used to build customer-page links |
| `AGENTBOXD_*` | Default email provider (API key, inbox ID, base URL) |
| `AI_PROVIDER_STYLE`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Drafting/summaries/chat (Anthropic Messages or OpenAI-style) |
| `GOOGLE_PLACES_API_KEY` | Business rating + review count lookup |
| `EXA_API_KEY` | Optional business-profile web research |

## Real workflows

1. **Set up** — business profile (fields carry source labels), optional file upload and web research, confirm findings.
2. **Add customers** — manually or CSV import, with consent confirmation. No consent → no message.
3. **Send review requests** — the AI drafts; the owner previews, runs **Check policy**, sends a test to self, then **Approve and send**. Every customer receives the same Google review link with a unique customer-page token.
4. **Customer page** — five stars, then a always-visible **Leave a Google review** button; low ratings add private-feedback and call-request options beside it (never instead of it).
5. **Insights** — imported public reviews + private feedback are tagged with themes and sentiment; every count links to source reviews; dashboards are computed from stored records.
6. **Follow-ups** — needs-a-call list, rebooking signals (rule-based baseline), review-reply drafts the owner copies.

## Public customer links (deployment)

Customer links are `{PUBLIC_BASE_URL}/c/{token}`. For real customers, that URL must be publicly reachable over HTTPS — deploy the app, or run a tunnel to the server (e.g. `cloudflared tunnel --url http://localhost:8787` and set `PUBLIC_BASE_URL` accordingly). **A locally hosted instance must stay online for links to work.** Localhost remains a preview option. Only the customer-page routes are public; owner routes and settings require login.

## Backups

- The SQLite file lives under `DATA_DIR` — stop the server and copy it for a point-in-time backup.
- **Export/Import:** Settings → *Export data* writes a JSON snapshot; *Import* restores it. *Delete my data* wipes all local records after confirmation.

## What works and what doesn't

Works: sample data with zero keys, business profile, customers + CSV import, drafting → approval → send (agentboxd and Copy only adapters), customer pages with persisted events, theme/sentiment tagging (local Transformers.js), policy check, quote-verified insights, backups/export, delete-my-data, blocking setup gate (AI Test connection + email test must pass; Google Places key required or an explicit paste/import choice), one-screen dashboard at 1280×720 / 1440×900 / 1920×1080 with in-card scrolling for long lists, loading screen (hero video + intro cards) honoring prefers-reduced-motion.

Doesn't (yet or by design): OpenMail/Composio adapters (pending verified docs — HTML capability is documented, not verified end-to-end), Google Places lookup/confirm flow (unverified without a real key), posting or replying on Google automatically, observing whether a review was posted (we see **Clicked Google link** only), multi-business hosting, learned rebooking probabilities without real labeled history, messaging-law compliance (not researched — review local regulations before sending at volume).

Demo models/data are synthetic and labeled; Google listing totals are shown separately from counts over imported reviews and private feedback.

## Development

- `docs/architecture.md` — module map and boundaries
- `docs/decisions/` — binding ADRs
- `GLOSSARY.md` — domain vocabulary
- `AGENTS.md` — conventions for agents working here
- `npm test` — Vitest (domain + integration); `npm run test:e2e` — Playwright flows

## License

Apache 2.0 — see [LICENSE](LICENSE).

AI provider testing in Settings saves the current AI fields before testing.
Failures stay on the page with a readable message. Changing the AI connection
fields or failing a later test clears its Connected status until a fresh test
passes. Minimal OpenAI-style connection probes support token-limited reasoning
models; normal chat still requires answer text. Keys remain masked on reads.


### AI reliability and streaming chat

Chat now streams replies from OpenAI-compatible Chat Completions and Anthropic
Messages providers. Provider-supplied reasoning is separate from the answer and
collapsed by default. Stop cancels the upstream request; closing chat also cancels
it. The last twelve completed conversation messages provide bounded context.
Providers that return ordinary JSON despite a streaming request still work.
Network failures, truncated streams and invalid completion fields show a usable
error instead of leaving the request waiting. A two-minute deadline covers the
whole AI response, including its body. Generation allows 4,096 output tokens so
reasoning models have room to produce an answer.

Review quotations are checked against the evidence actually supplied to the
model. Entirely fabricated quotations reject the answer. Citation labels count
verified review sources; responses without citations are labelled as business
records. This checks quotation provenance, not the truth of every narrative claim.
Chat evidence is capped at eight reviews of 2,000 characters each; summaries use
the forty newest tagged reviews, capped at 2,000 characters each. Chat retrieval
combines keywords and matching theme assignments. Model accuracy still needs the
real evaluation corpus; passing deterministic tests is not an accuracy benchmark.

Local embedding work is serialized into batches of at most 32 texts. Cache keys
include the model and preprocessing version, cache misses are deduplicated, and
vectors are validated. A failed or timed-out worker is discarded so later work
can start a replacement. Successful tagging records a theme/model version even
when no theme matches. Editing themes makes existing classifications eligible
for recomputation. Re-tagging computes replacements before removing old labels.

The new migration adds review tagging versions and send-job payload fingerprints.
Startup applies migrations automatically. Retries require current approval and
policy checks; a previously attempted job cannot reuse its idempotency key for
different content or a different provider. Create a new draft for such changes.
Older attempted jobs without a fingerprint require a new draft for retry.
Interrupted send jobs become ambiguous on startup and require an owner decision;
they are never automatically re-sent. Provider acceptance and related draft/request
updates are persisted together, and startup reconciles older acceptance gaps.

Exported backups omit provider credentials and include insight summaries. Restore
keeps the current local provider settings. Data deletion is transactional and
removes dependent summaries first. Theme/review changes invalidate stored summary
evidence. Review CSV import supports quoted commas, escaped quotes and multiline
fields, with text/rating validation.

Protocol references: [Chat Completions streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
and [Anthropic Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

### Customer email designs

In Messages, choose Branded, Letter, Spotlight or Compact. Select blocks to edit them, drag the handles to reorder, or add text, headings, images, buttons, dividers and space. Save layout to reuse your design; Save edit persists it on the draft. Changing any design removes approval.

Open Assets to upload images, crop/resize them, and drag saved images into the email. Logo, banner and photo formats are included. Set `PUBLIC_BASE_URL` to the app’s public HTTPS address before sending emails containing images. Both Agentboxd and OpenMail receive HTML plus a text fallback. Copy only can download the HTML email. Assets and saved layouts are included in backups.
