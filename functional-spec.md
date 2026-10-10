# Starlly: Functional Specification

Track: AI + Business (ForgeHacks 2026). License: Apache 2.0.
Scope: what the app does and how. Colors, fonts and visuals are not specified here. Screens and layout are in `design.md`.

---

## 1. Summary

Starlly helps a small local business collect more Google reviews from happy customers and learn from all the feedback. The owner sends one review request per finished job, sees ratings and what customers keep praising or complaining about, and gets a short list of what to fix first and who to contact next. The AI drafts; the owner approves.

**Principles**
1. **Same Google link for every customer.** No review gating, no incentives, no hiding the link behind a rating.
2. **No insight without evidence.** Every theme, count, and recommendation links to the real reviews behind it.
3. **The owner stays in control.** Nothing is sent without approval.
4. **Setup is a gate.** First run requires business details, a working AI provider, and an email provider (Copy only counts) before anything else. Google Places can be skipped only by choosing to paste/import reviews instead. Exa is optional.
5. **Honest about data.** The real app contains no fake data. Demo data loads only by an explicit owner action, is labeled "Sample data," and is removable; it never overwrites real data without confirmation.

## 2. Goals and non-goals

**Goals**
- Turn finished jobs into review requests with minimal effort.
- Turn reviews and feedback into ranked, evidence-backed improvements.
- Predict who is likely to need service again and who needs a call.
- Be easy to download, configure, and run locally.

**Non-goals (demo scope)**
- Scaling to many businesses or high-volume sending.
- Reading all Google reviews live (the Places API returns rating and review count and a few reviews only; full reviews come from import or paste).
- Posting reviews, replying on Google automatically, or buying or incentivizing reviews.
- Accounts, billing, multi-tenant hosting.
- Legal compliance work for messaging laws (not researched; noted in README).

## 3. Users

- **Owner/manager** of a small local business (HVAC, dental, cleaning, salon, etc.).
- **Customer** who receives a request and opens a link on their phone. No account.
- **Evaluator** who downloads the repo or watches the demo video.

## 4. Configuration and first run

### 4.1 First-run behavior
- The app starts **empty**. A blocking setup gate (4.2) redirects every route to `/setup` until setup is complete — no dashboard, no fake counts.
- Demo data is never auto-loaded; it exists only behind the explicit "Load demo data" action in Settings (§11).

### 4.2 Setup gate (blocking, ordered — this overrides any earlier "every step can be skipped" text)
1. **Business:** company name, owner, city/address, Google review link (validated, §4.4). Optional: website, Instagram, Discord/other links.
2. **AI provider (REQUIRED):** style (Anthropic Messages or OpenAI-style Chat Completions), base URL, model ID, API key. **Setup cannot continue until Test connection passes.**
3. **Email provider (REQUIRED):** dropdown (agentboxd, OpenMail/openmail.sh, Copy only). Fields come from the selected adapter. **Cannot continue until Test connection passes.** Copy only needs no keys and counts as complete.
4. **Google Places API key:** required in the form. Used for rating and review count. The only skip is the explicit "I'll paste or import my reviews instead" choice. After lookup, the owner confirms "Is this you?" on the matched listing.
5. **Exa API key:** optional (it also works keyless on a rate-limited free plan).
6. **Send a test email to the owner** (skipped for Copy only).

Each item shows a "Where do I get this?" link and a **Test connection** button with a clear pass or fail. Per-item status: **Not set** / **Saved, not tested** / **Connected** (with the last successful test time). Only a passing test shows Connected. The loading animation uses `starlly-hero.mp4` (skipped under reduced motion). Optional files and Exa research become post-setup enrichment flows, not gate steps.

### 4.4 Validation (client and server — nothing from nowhere is accepted)
- Company name, owner, city: required, trimmed, non-empty.
- Emails: valid format.
- Google review link: HTTPS only; the host must be a Google host (google.com subdomains, g.page, maps.app.goo.gl, goo.gl); a bare maps/place path with no place identifier is rejected; an "Open link" check button lets the owner inspect it; an unrecognized shape shows a clear warning and requires explicit owner confirmation. This is a heuristic — it never claims the link works.
- Website and social links: valid HTTPS URLs.
- The server re-validates everything; the client is never trusted.

### 4.3 Settings and providers
All keys are stored only on the user's machine (local `.env` or local settings file), are never committed, and are never called from browser code.

**Email provider (dropdown, adapter per provider)**
| Provider | Fields | Notes |
|---|---|---|
| agentboxd (default) | API key, Inbox ID, Base URL (default `https://api.agentboxd.com`) | REST. `GET /v1/inboxes/{id}/messages`, `POST /v1/inboxes/{id}/messages/send`. Plain text confirmed; check docs for HTML, reply-to, headers. |
| openmail.sh (OpenMail) | API key, base URL (default `https://openmail.sh`) | Owner confirmed: OpenMail means openmail.sh. Verify current official docs before building; implement after agentboxd and Copy only. |
| Gmail via Composio | Composio API key, connected Gmail account | Verify current docs and sending limits. |
| Copy only | none | Starlly writes the email, the owner copies it. Works with zero keys. |

Adapter interface (same for every provider): `fields`, `test()`, `send({to, subject, text, html?})`. The settings form is drawn from the selected adapter's `fields`.

Use REST, not MCP, inside the app. The send step must happen only on owner approval, in app code. MCP may be documented as an optional extra for read-only use.

**Settings parity:** the Settings page shows the same fields as the gate — including the Google Places key and the Exa key — each with its per-item status (§4.2). Keys are write-only: stored server-side, never sent back to the browser (the form shows an "unchanged" placeholder), never logged.

**Capability honesty:** capability claims require a verified, passing test. For agentboxd, only plain-text sending is confirmed; HTML, reply-to, and custom headers display as "unverified" until a verified test passes.

**AI provider (dropdown)**
- Style: Anthropic Messages, OpenAI-style Chat Completions, others later.
- Fields: base URL, API key, model ID.
- **Test connection** button.

**Other keys:** Google Places API key (rating and count), Exa API key (optional).

## 5. Core flows

### 5.1 Send review requests
1. Owner adds customers (manual, CSV import) with name, contact, service type, job date, consent confirmation.
2. Owner selects customers and opens **Messages**. The AI drafts the request using the business profile. The owner edits, previews, runs **Check policy**, sends a test to self, then **Approve and send**.
3. Each customer receives a unique link (random token).
4. Demo scale: send one at a time with a short delay. Larger batches are out of scope.

### 5.2 Customer page (the link)
- Opened from the email on a phone.
- Shows the business name and asks "How did we do?" with five star buttons.
- **For every rating, 1 to 5:** the **Leave a Google review** button is shown with the same prominence and the same link. For 1 to 3 stars, additional options appear beside it (never instead of it, never delayed): **Send private feedback** and **Request a call**.
- Layout and timing do not change with the rating.
- Events recorded: opened, rated (value), clicked Google link, feedback submitted, call requested.
- Links carry a token that expires after a configurable period and can be revoked; public routes are rate-limited (ADR-0005).
- Starlly can see clicks on the Google link, **not** whether a review was posted. The funnel labels this step "Clicked Google link."

### 5.3 Insights
1. Reviews come from: pasted text, CSV upload, private feedback, and the few reviews from the Places API if available.
2. Each review is tagged with themes and sentiment (see 7.1).
3. The dashboard shows counts per theme, rating trend, funnel, and a ranked "what to fix first" list.
4. Every item links to **View source reviews**.

### 5.4 Follow-ups
- **Needs a call:** private feedback and low ratings. Owner marks called, resolved, adds a note.
- **Who to contact this week:** customers predicted to be due for service (see 7.2). The AI drafts a message; the owner approves.
- **Review replies:** the AI drafts replies to reviews for the owner to copy. Starlly does not post to Google.

### 5.5 Chat assistant
- Orb in the top bar opens a panel with a droplet-style animation.
- Answers questions about the business data ("What should I fix first?", "Who needs a call?").
- Answers cite the reviews or records used ("Based on 9 reviews").
- Read-only by default. Any email it drafts goes to Messages for approval. It cannot send.
- Reviews and replies are untrusted text. Instructions inside them are ignored.

## 6. Features

### Must have
1. Blocking setup gate with per-item connection status (§4.2).
2. Business profile (editable, with a source label per field: typed, file, web).
3. Customer list, CSV import, consent confirmation.
4. Message drafting, preview, policy check, test send, approve and send.
5. Customer page with the compliant star flow and event tracking.
6. Dashboard: company card, rating and review count, themes list, rating trend, request funnel, recent reviews feed — one screen, no page scroll (design.md §1–2).
7. Evidence view for every insight.
8. Needs-a-call list and notes.
9. Email provider dropdown with adapters (agentboxd plus Copy only at minimum).
10. AI provider settings with test connection.
11. Demo data: explicit "Load demo data" / "Remove demo data" in Settings (§11), never overwriting real data without confirmation.
12. Delete my data.

### Should have
- Who-to-contact-this-week predictions.
- Trend alerts.
- Review reply drafts.
- Chat assistant.
- Exa enrichment and Places lookup.
- OpenMail and Gmail/Composio adapters.

### Nice to have
- Orb droplet animation, themed hero video, tablet and mobile layouts.

## 7. AI components

| Component | Type | Job | Where it runs |
|---|---|---|---|
| Theme and sentiment tagger | Neural embeddings plus a small classifier | Tag every review with themes and sentiment, count mentions | Local backend, worker thread (ADR-0003) |
| Rebooking predictor | Rule baseline over service intervals; learned model only with real labeled history (ADR-0007) | Probability a customer is due for and likely to book another service | Local |
| Trend and anomaly alerts | Statistics | Flag rating drops and theme spikes | Local |
| Near-duplicate detector | Embedding similarity | Flag unusually similar reviews for the owner to look at (flag only, no accusation) | Local |
| Message and reply drafting | LLM | Draft requests, follow-ups, review replies from the business profile | Remote API |
| Theme summaries | LLM | Write the plain-language summary of tagged reviews, quoting them | Remote API |
| Profile extraction | LLM | Turn uploaded text and web findings into profile fields | Remote API |
| Chat assistant | LLM with retrieval | Answer from the business data with citations | Remote API |
| Policy checker | Rules (plain code) | Check drafts for gating, incentives, pressure wording, link consistency | Local |
| Quote verifier | Plain code | Confirm every quoted review text exists in the data | Local |

### 7.1 Theme and sentiment tagger
- Input: review text. Output: themes (from the business's theme list, which the LLM can propose and the owner edits), sentiment, confidence.
- Method: sentence embeddings compared to theme descriptions, plus a small classifier on top. A neural network (the embedding model) does the language understanding; the classifier makes counts consistent and cheap.
- Counts come from the tagger, not from the LLM, so numbers do not drift.
- Evaluated on a held-out labeled set of synthetic reviews (accuracy per theme, reported plainly).

### 7.2 Rebooking predictor
- Features: service type, days since last service, number of past visits, last rating, typical interval for the service type.
- Output: probability of needing service soon and the main reasons ("12 months since annual check-up").
- A plain rule baseline (service interval only) is shown beside the model.
- **Limit, stated in the app and README:** the demo model is trained on synthetic data, so it proves the pipeline, not real accuracy. Real use needs the owner's own history.

### 7.3 Trend alerts
- Weekly rating average and theme counts.
- Flags a change when it exceeds a simple statistical threshold (for example, a z-score on weekly counts), with the numbers shown.
- Text: "Phone-access complaints: 1 per week to 4 per week."

### 7.4 Grounding rule for the LLM
- Every generated insight must include review IDs. The verifier checks that quoted text appears in those reviews. If not, the insight is dropped.
- Review text, uploaded files, web results, and inbound email replies are untrusted data. They never act as instructions.

## 8. Policy check (rules)
Flag any draft or customer-page setting that:
- Shows or sends the Google link only to some customers, or only after a high rating.
- Delays, hides, or shrinks the Google link for low ratings.
- Offers anything in exchange for a review.
- Uses pressure language ("please give 5 stars").
- Uses different Google links across variants.

## 9. Data model (local)
- **business:** name, owner, city, review link, place ID, rating, review count, links, profile fields (with source).
- **customer:** id, name, contact, service type, job date, consent, status.
- **request:** id, customer id, token, sent time, status.
- **event:** request id, type (opened, rated, google_click, feedback, call_request), value, time.
- **review:** id, source (google_import, pasted, private_feedback), author, rating, date, text, themes, sentiment, replied.
- **draft:** id, kind, text, status (draft, approved, sent).
- **note:** call outcomes.
Storage: SQLite via Drizzle ORM + better-sqlite3, with migrations and backup/export (ADR-0001). **Delete my data** wipes it.

## 10. Privacy and security
- Keys live in the user's local config only; `.env.example` is provided; `.env` is git-ignored.
- Customer contact data stays local. Only the minimum text needed for a drafting task goes to the AI provider.
- Uploaded files and web results are used as data, never as commands.
- The customer page needs a public HTTPS base URL for real customers (deploy or tunnel to the running backend; ADR-0005). Localhost is a preview option; a locally hosted instance must stay online for links to work.
- Only message people who agreed to be contacted (consent confirmation in the customer list).
- **Owner login:** a single-user password (set during the gate, stored hashed locally) protects owner routes and settings so that only customer-page routes are public (ADR-0005). It is not an account system — no email, no multi-user, no server.

## 11. Demo data (owner-supplied, explicit, removable)
- Files in `/sample-data`: `business.json`, `customers.json`, `reviews.json`, `feedback.json`, `requests.json`, `themes.json`, `trend_weekly.json`. The owner supplies the content; the repo ships only the loader with schema validation.
- Loaded ONLY via the explicit **Load demo data** action in Settings. Loading asks for confirmation and never overwrites real data without it; a pre-load snapshot lets **Remove demo data** restore the previous state exactly.
- While loaded, a visible **Sample data** tag appears everywhere. Dashboard numbers are computed from the loaded records — never hardcoded.

## 12. Evaluation
- Theme tagger accuracy on held-out labeled reviews.
- Rebooking model versus the interval-only baseline on held-out synthetic customers.
- Policy checker on a small set of compliant and non-compliant drafts.
- Quote verification: percent of insights whose quotes verify.
- Report plain counts and list failures.

## 13. Known limitations (README)
- Demo data and models are synthetic.
- Live Google data is limited to rating, count, and a few reviews; the rest is imported.
- Funnel cannot see whether a review was posted.
- Exa free access is rate limited and shared.
- Customer page needs a public URL for real use.
- Messaging-law compliance not researched.
- Provider adapters other than agentboxd may be untested.

## 14. Repo basics
- Apache 2.0 `LICENSE`, `README` (quick start, what works and what doesn't), `.env.example`, sample data, tests for the policy checker and quote verifier.

## 15. Priorities for the deadline
1. Setup gate and validation (§4.2, §4.4).
2. One-screen dashboard per the owner's mock-up (design.md §1–2).
3. Customer page with events.
4. Message drafting with approval and Copy only.
5. Theme tagger and evidence view.
6. agentboxd and OpenMail adapters, AI provider settings.
7. Demo data load/remove (§11).
8. Rebooking predictor and trend alerts.
9. Chat assistant. Files and Exa enrichment are post-setup flows.

## Email design (ADR-0009)

Messages supports four default HTML layouts, ordered drag-and-drop blocks, reusable custom layouts, and a persistent asset drawer with image crop/resize. Preview, test and send share a renderer. Design edits invalidate approval. The message block and existing customer-page link remain authoritative. Assets are backed up and deleted with business data; referenced images remain available. Image delivery requires a public HTTPS app address.
