<p align="center">
  <img src="assets/og-image-1200x630.png" alt="Starlly" width="720">
</p>

# Starlly

Starlly helps a small local business collect Google reviews and learn from them. When a job is finished, Starlly sends the customer a branded message on a schedule, tracks what they do with it, and turns the ratings and feedback that come back into a dashboard and a ranked list of what to fix first.

Self-hosted, one business per install, Apache 2.0. Built for ForgeHacks 2026 (AI + Business track).

## The problem

When two local businesses do equally good work, customers tend to call the one with more Google reviews. Most happy customers never leave one, because nobody asked or the link was hard to find. The reviews that do arrive usually sit unread, so the owner never learns what customers keep complaining about.

## What it does

1. **Set up.** Business details, an AI provider, an email provider and a Google Places key. Each connection is tested, and the dashboard stays locked until setup is finished.
2. **Design the message card.** A visual editor for the message customers receive: place the business logo and banner, position text blocks and the review button, pick colors. Text can contain tags that are filled in per customer (see below). The AI can draft the wording, and the result is one reusable template.
3. **Add customers.** By hand or by CSV, with service type and job date. Only customers marked as having agreed to be contacted receive messages.
4. **Automatic requests.** When a job is marked complete, Starlly waits the configured delay and sends the card inside the allowed sending hours. Customers who have not rated get reminders on a schedule. Customers who are due for another service get a follow-up, based on service type and time since the last visit. Delay, hours, reminder schedule and follow-up intervals are set in Settings.
5. **Customer page.** The customer picks one to five stars. The Google review button is visible from the start and identical for every rating. For one to three stars, a private feedback form and a "call me" option appear next to it.
6. **Insights.** Public reviews and private feedback are tagged by theme and sentiment. Every theme count links to the reviews behind it.
7. **Follow-ups.** A list of customers who asked for a call, customers who may be due for another service, and drafted replies to reviews, which the owner copies and posts.

### Card tags

Tags in the card are replaced with each customer's details when the message is sent.

| Tag | Filled with |
|---|---|
| `{{customer_first_name}}` | Customer's first name |
| `{{customer_last_name}}` | Customer's family name |
| `{{business_name}}` | Business name |
| `{{owner_name}}` | Owner name |
| `{{service}}` | Service performed |
| `{{job_date}}` | Date of the job |
| `{{customer_page_link}}` | The customer's personal link to the star page |
| `{{google_review_link}}` | The business's Google review link |

If the email provider cannot send HTML, the card is sent as plain text with the same tags filled in.

## How the AI is used

| Job | Method | Runs |
|---|---|---|
| Theme and sentiment tagging | Sentence embeddings compared with theme descriptions, plus a small classifier (Transformers.js) | Locally, on the server |
| Theme counts and trends | Counting and simple statistics over tagged records | Locally |
| Rebooking signals | Rule-based baseline from service type and time since last visit | Locally |
| Card wording and message templates | Language model | Your AI provider |
| Theme summaries and review-reply drafts | Language model, given the tagged reviews | Your AI provider |
| Template and rule check | Rules written as code | Locally |
| Quote check on insights | Code that confirms each quoted review exists in the data | Locally |

Counts come from the tagger and not from a language model, so they do not change between runs. Every generated insight cites review IDs, and the quote check drops any insight whose quotes cannot be found. Reviews, uploaded files, web results and email replies are treated as data, and instructions inside them are ignored.

## Google's review policy

Google does not allow review gating, meaning asking only happy customers for a review or hiding the link from unhappy ones. In Starlly every customer gets the same Google link, the button looks the same for every rating, and low ratings add options beside it. Templates and automation rules are checked when saved, and the check flags a link that appears only after a high rating, a hidden or delayed link, incentives, pressure wording, and different links across variants. It is a rule set and not legal advice, and Google can change its policy.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone <this repo>
cd starlly
npm install
npm run build
npm run dev          # http://localhost:8787
```

Copy `.env.example` to `.env` to preset keys, or enter them on the setup screen.

| Item | Required | Notes |
|---|---|---|
| Business details | Yes | Name, owner, city, Google review link |
| AI provider | Yes | Anthropic Messages or OpenAI-style Chat Completions: base URL, model ID, API key |
| Email provider | Yes | agentboxd (API key, inbox ID) or Copy only, which needs no keys |
| Google Places API key | Yes, or import reviews instead | Rating and review count for the listing |
| Exa API key | No | Business research during setup |

Each provider has a **Test connection** button, and a provider shows as connected only after a passing test. **Settings → Load demo data** loads a made-up business with reviews, customers and request history, marked as sample data. **Remove demo data** takes it out again.

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 8787) |
| `DATA_DIR` | SQLite database and backups |
| `PUBLIC_BASE_URL` | Public HTTPS address used to build customer links |
| `AGENTBOXD_API_KEY`, `AGENTBOXD_INBOX_ID`, `AGENTBOXD_BASE_URL` | Email through agentboxd |
| `AI_PROVIDER_STYLE`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Templates, summaries, replies |
| `GOOGLE_PLACES_API_KEY` | Rating and review count lookup |
| `EXA_API_KEY` | Optional research |

`.env.example` has the full list. Keys stay on your machine, are never returned to the browser and are never logged.

### Customer links

Links look like `{PUBLIC_BASE_URL}/c/{token}`. For real customers the address must be reachable over HTTPS: deploy the app or run a tunnel such as `cloudflared tunnel --url http://localhost:8787` and set `PUBLIC_BASE_URL` to its address. A locally run instance must stay online for links to work. Without `PUBLIC_BASE_URL`, links point to localhost and only work on your own computer. Only the customer-page routes are public. <!-- VERIFY: owner login -->

### Backups

The database is a SQLite file under `DATA_DIR`. Stop the server and copy it to back it up, or use **Settings → Export data** for a JSON snapshot that **Import** restores. **Delete my data** removes all business data.

## What works and what doesn't

<!-- VERIFY every line against the final build, including the card designer and automation rules -->

Works:
- Setup gate with validation and connection tests
- Customers, CSV import, consent flag
- Card designer with tags, saved templates, preview
- Automatic sending after job completion, reminders and follow-ups
- Customer page with stored events: opened, rated, Google link click, feedback, call request
- Theme and sentiment tagging, evidence links, quote check
- Dashboard numbers computed from stored records
- Export, import, delete my data, demo data

Limits:
- **No view of whether a review was posted.** Starlly sees clicks on the Google link, so the funnel's last step is "Clicked Google link".
- **Google data is limited.** The Places API gives the rating, the review count and a few reviews. The rest of the reviews come from import or paste. Starlly does not scrape Google.
- **No posting to Google.** Review replies are drafted for you to copy.
- **Rebooking is a rule-based baseline.** There is no learned model, because there is no real labeled history to train one.
- **OpenMail** is in the provider list but has not been checked against the live service. **Gmail through Composio** is not implemented.
- **HTML email** depends on the provider. Until confirmed for a provider, treat it as plain text.
- **One business per install.**
- **Messaging law is not covered.** Rules for contacting customers differ by country and sector, so check them before sending at volume.
- **Demo data is synthetic,** so accuracy measured on it says little about real reviews.

## Project layout

- `docs/architecture.md`: module map
- `docs/decisions/`: architecture decision records
- `GLOSSARY.md`: review, feedback, rating, request, draft and message, defined
- `AGENTS.md`: conventions for coding agents
- `assets/`: logos (`logo-a-arc-orbit.svg`, `logo-c-wordmark-dots.svg`), `icons.svg`, favicon, `icon-512.png`, `og-image-1200x630.png`, the AI orb animation (`orb-loop.webm`, `orb-still.png`) and the loading-screen video

Stack: TypeScript, Node, Express, React, Vite, SQLite with Drizzle, Vitest, Playwright.

```bash
npm test             # domain and integration tests
npm run test:e2e     # browser flows
```

## Credits

Headings and logo use Gloock (SIL Open Font License). Embeddings run through Transformers.js, email through agentboxd, optional research through Exa.

## License

Apache 2.0. See [LICENSE](LICENSE).
