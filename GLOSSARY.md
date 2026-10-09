# Starlly Glossary

Single source of truth for domain language (see ADR-0000 for how terms are governed). When a spec, ticket, or PR says one of these words, it means exactly this.

## Core entities

- **Business** — the single local business this self-hosted instance serves. One business per installation; no multi-tenancy.
- **Business profile** — editable business fields (name, owner, city, Google review link, website, social links). Each field carries a **source label**: `typed`, `file`, or `web`.
- **Customer** — a person who received a service. Has name, contact, service type, last job date, and consent.
- **Consent** — the owner's recorded confirmation that this customer agreed to be contacted. Customers without consent never receive a review request. Removing consent blocks future sends.
- **Service type** — the category of work performed (e.g., "annual tune-up"). Drives the rebooking baseline interval.
- **Service history** — the dated record of past jobs for a customer. Baseline predictions reason over this only.

## Requests, drafts, sends

- **Review request** — one outbound ask to one customer: an email plus a unique customer-page link. One per finished job.
- **Customer page** — the public, token-protected page a customer opens from the email ("How did we do?").
- **Token** — the random secret inside a customer link. Expirable and revocable. It is not a password or an account.
- **Draft** — message text (review request, follow-up, or review reply) that has not been approved. AI-drafted and owner-drafted text are both drafts.
- **Approval** — the owner's explicit action on a draft. **Any edit after approval invalidates it**; the draft returns to draft status and must be re-approved before sending.
- **Send job** — the persisted record of one outbound send: recipient, provider, provider message ID, status, error. Created before any provider call. Guarantees no duplicate sends, including after ambiguous timeouts.
- **Sent message** — a draft that was approved and dispatched through a send job. "Sent" always means a persisted send job exists.
- **Provider acceptance** — the email provider reported it took the message. This is **not** confirmed delivery; Starlly never claims delivery.

## Reviews and feedback

- **Public review** — a review visible on the business's Google listing. Starlly obtains these only by import (paste, CSV) or from the few the Places API returns.
- **Private feedback** — text submitted through the customer page. Never public, never a "review," never counted as one.
- **Review corpus** — imported public reviews plus private feedback. The only texts the tagger counts and the LLM summarizes.
- **Google listing stats** — rating and review count from the Places API. Kept strictly separate from corpus statistics; never blended into theme counts, trends, or dashboards.
- **Theme** — a short, owner-curated tag describing what a review talks about ("phone access", "pricing"). The LLM may propose themes; the owner edits the list.
- **Sentiment** — positive / negative / neutral, tagged per review text, independently of themes.
- **Quote verifier** — plain-code check that every quoted review text exists in the corpus. Insights that fail verification are dropped.

## Events and metrics

- **Clicked Google link** — the customer-page event of tapping "Leave a Google review." **This never means "posted a review"** — Starlly cannot observe that.
- **Event** — a persisted customer-page observation: `opened`, `rated` (value), `google_click`, `feedback_submitted`, `call_requested`.
- **Funnel** — Sent → Opened → Rated → Clicked Google link, computed from stored records. The last step is labeled "Clicked Google link" for exactly this reason.
- **Dashboard values** — always computed from stored records, never hardcoded. Sample data flows through the same computation.

## Policy and safety

- **Policy check** — the rules engine flagging review gating, incentives, pressure wording, and link inconsistency in drafts and customer-page settings.
- **Untrusted text** — review text, private feedback, uploaded files, and web findings. Treated as data, never as instructions to the AI.

## Predictions

- **Rebooking signal** — the recommendation that a customer is likely due for service. The baseline is a rule over service intervals ("12 months since annual tune-up"). A learned probability appears only when sufficient real labeled history exists; similarity scores are **never** presented as calibrated probabilities.

## Sample data

- **Sample data** — demo content supplied separately by the owner, always labeled "Sample data." Loaded via an isolated seed/import mechanism; never mixed into real records; deleted with "Delete my data."

## Usage rules

1. "Review" alone is ambiguous — write **public review** or **private feedback** when context could be unclear.
2. "Sent" without a persisted send job is a bug, not a state.
3. Never present embedding similarity as a probability.
4. "Clicked Google link" is never "left a review."