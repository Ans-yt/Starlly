# Starlly
Fair, evidence-backed Google review requests and insights for small businesses. Local-first, bring your own keys.

#

Starlly helps a small local business ask its customers for Google reviews, and then makes use of what comes back. The owner sends a review request after each job, sees ratings and recurring themes in one dashboard, and gets a ranked list of what to fix first. The AI drafts messages and summaries. The owner approves everything that gets sent.

Built for ForgeHacks 2026, AI + Business track. Licensed under Apache 2.0.

**Demo video:** <!-- ADD LINK BEFORE SUBMITTING --> (link)

![Dashboard](docs/screenshots/dashboard.png) <!-- ADD SCREENSHOTS: dashboard, customer page, message approval -->

## The problem

When two local businesses do equally good work, customers tend to call the one with more Google reviews. Most happy customers never leave one, because nobody asked or the link was hard to find. The owners we looked at had the opposite problem with the reviews they did get: nobody had time to read them and work out what customers kept complaining about.

Existing review tools mostly solve the first half, and some do it in a way Google's policy forbids (see "Staying inside Google's rules"). Starlly does both halves and shows its evidence.

## What it does

1. **Set up.** Enter the business details, connect an AI provider and an email provider, and test both. The dashboard stays locked until setup is complete, so nothing on it is ever made up.
2. **Add customers.** By hand or from a CSV. Each customer needs a consent confirmation. No consent means no message.
3. **Send review requests.** The AI drafts a message. The owner previews it, runs the policy check, sends a test to themselves, then approves. Each customer gets a unique link.
4. **Customer page.** The customer picks one to five stars. The **Leave a Google review** button is visible from the start and looks the same for every rating. For one to three stars, a private feedback form and a "call me" option appear next to it, never in place of it.
5. **Insights.** Public reviews and private feedback are tagged by theme and sentiment. Each theme count links back to the reviews behind it.
6. **Follow-ups.** A list of customers who asked for a call, customers who may be due for another service, and drafted replies to reviews that the owner copies and posts themselves.

## How the AI is used

Different jobs use different tools, and the language model does less than you might expect.

| Job | Method | Where it runs |
|---|---|---|
| Theme and sentiment tagging | Sentence embeddings compared with theme descriptions, plus a small classifier (Transformers.js) | Locally, on the server |
| Theme counts and trends | Plain counting and simple statistics over the tagged records | Locally |
| Rebooking signals | Rule-based baseline using service type and time since last visit | Locally |
| Drafting requests, follow-ups and review replies | Language model, using the business profile | Your AI provider |
| Writing the summary of a theme | Language model, given the tagged reviews | Your AI provider |
| Policy check on drafts | Rules written as code | Locally |
| Quote check on insights | Code that confirms every quoted review exists in the data | Locally |

The reason for the split: counts should not change between runs, so they come from the tagger and not from a model asked to estimate them. Every generated insight must cite review IDs, and the quote check drops any insight whose quotes cannot be found. <!-- VERIFY: tagger model name and that trend alerts are implemented -->

Reviews, uploaded files, web results and email replies are treated as data. Text inside them is never followed as an instruction.

## Staying inside Google's rules

Google bans "review gating," which means asking only happy customers to review, or hiding the review link from unhappy ones. Starlly is built so the same link goes to everyone:

- The review link in every request is identical.
- The customer page shows the Google button for every rating, at the same size and position, without delay.
- Low ratings add options beside the button, not instead of it.
- The policy check flags drafts that send the link only after a high rating, hide or delay it, offer something in exchange for a review, use pressure wording ("please give 5 stars"), or use different links across variants.

The policy check is a set of rules, not a legal opinion, and Google can change its policy. Read Google's current review policy before you send at volume.

## Quick start

You need Node.js 20 or newer <!-- VERIFY version -->.

```bash
git clone <this repo>
cd starlly
npm install
npm run build
npm run dev          # http://localhost:8787
```

Copy `.env.example` to `.env` if you want to preset keys. Otherwise enter them on the setup screen. Setup asks for:

| Item | Required | Notes |
|---|---|---|
| Business details | Yes | Name, owner, city, Google review link |
| AI provider | Yes | Anthropic Messages or OpenAI-style Chat Completions: base URL, model ID, API key |
| Email provider | Yes | agentboxd (API key, inbox ID) or Copy only, which needs no keys |
| Google Places API key | Yes, or choose to import reviews instead | Used for the listing's rating and review count |
| Exa API key | No | Business research during setup. Exa also has a limited keyless mode |

Each provider has a **Test connection** button. A provider is shown as connected only after a test has passed.

To look around with example data, use **Settings → Load demo data**. It loads a made-up business ("Coppervale Heating & Air") with reviews, customers and request history, and tags everything as sample data. **Remove demo data** takes it out again. Demo data never replaces real data without a confirmation.

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 8787) |
| `DATA_DIR` | Where the SQLite database and backups live |
| `PUBLIC_BASE_URL` | Public HTTPS address used to build customer links |
| `AGENTBOXD_API_KEY`, `AGENTBOXD_INBOX_ID`, `AGENTBOXD_BASE_URL` | Email via agentboxd |
| `AI_PROVIDER_STYLE`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Drafting, summaries and chat |
| `GOOGLE_PLACES_API_KEY` | Rating and review count lookup |
| `EXA_API_KEY` | Optional research |

`.env.example` has the full list. Keys are stored only on your machine. The API never returns a saved key to the browser, and keys are not logged.

### Customer links

Links look like `{PUBLIC_BASE_URL}/c/{token}`. For real customers that address must be reachable over HTTPS, so deploy the app or put a tunnel in front of it, for example `cloudflared tunnel --url http://localhost:8787`, then set `PUBLIC_BASE_URL` to the tunnel address. A locally run instance has to stay online for the links to work. Without `PUBLIC_BASE_URL`, links point at localhost and only work on your own computer. Only the customer-page routes are public. <!-- VERIFY: the owner login described in the old draft; say what it is and why it exists -->

### Backups and your data

The database is a SQLite file under `DATA_DIR`. To back it up, stop the server and copy the file. **Settings → Export data** writes a JSON snapshot that **Import** can restore. **Delete my data** removes all business data after a confirmation.

## What works and what doesn't

Works, and covered by tests or a manual check <!-- VERIFY each line against the final build before submitting -->:
- Setup gate with validation and connection tests
- Customers, CSV import, consent check
- Draft, policy check, test send, approval, send through agentboxd or Copy only
- Customer page with persisted events: opened, rated, Google link click, feedback, call request
- Theme and sentiment tagging, evidence links, quote check
- Dashboard numbers computed from stored records
- Export, import, delete my data, demo data load and removal

Does not work, or only partly:
- **We cannot see whether a review was posted.** Starlly records clicks on the Google link, and the funnel's last step is labeled "Clicked Google link" for that reason.
- **Google data is limited.** The Places API gives the rating, the review count and a few reviews. The rest of the reviews come from import or paste. Starlly does not scrape Google.
- **No posting to Google.** Review replies are drafted for the owner to copy.
- **Rebooking is a rule-based baseline.** There is no learned model, because there is no real labeled history to train one.
- **OpenMail** appears in the provider list but has not been checked against the live service. <!-- VERIFY -->
- **Gmail through Composio** is not implemented.
- **Plain-text email only** for agentboxd until HTML support is confirmed. <!-- VERIFY -->
- **One business per install.** No multi-business hosting.
- **Messaging law is not covered.** Rules for contacting customers differ by country and sector. Check them before using this for real customers.
- **The demo data is synthetic.** Its theme counts, ratings and funnel were generated to look realistic, and any model accuracy measured on it says little about real reviews.

## Project layout

- `docs/architecture.md`: module map and boundaries
- `docs/decisions/`: the architecture decision records
- `GLOSSARY.md`: what we mean by review, feedback, rating, request, draft and message
- `AGENTS.md`: conventions for coding agents working in this repo
- `assets/`: logo, icons, the loading-screen video and the AI orb animation

Stack: TypeScript, Node, Express, React, Vite, SQLite with Drizzle, Vitest, Playwright <!-- VERIFY stack -->.

```bash
npm test             # domain and integration tests (Vitest)
npm run test:e2e     # browser flows (Playwright)
```

## Credits

- Logo and headings use Gloock (SIL Open Font License).
- Embeddings run through Transformers.js. Email through agentboxd. Optional research through Exa.

## License

Apache 2.0. See [LICENSE](LICENSE).
