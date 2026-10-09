# Starlly: Design

**Visual source of truth:** the owner's hand-built dashboard mock-up (HTML) in `/assets` — ported as-is for layout, spacing, and styling; do not redesign it. Real assets from `/assets` replace all placeholders: `logo-a-arc-orbit.svg` / `logo-c-wordmark-dots.svg`, `orb-loop.webm` (`orb-still.png` as fallback and for prefers-reduced-motion), `favicon.ico`, `icon-512.png`, `og-image-1200x630.png`, `icons.svg` sprite, `starlly-hero.mp4` (loading animation). A missing asset is reported, never substituted — currently there are **no "glass star" PNGs in /assets** (flagged as missing).

**Layout target:** the dashboard fits one screen with **no page scroll** at 1280x720 and above — `100dvh` grid, `html/body` `overflow:hidden`. Long content (themes list, reviews feed) scrolls **inside its own card** with a visible scrollbar and a fade at the bottom. Below 1280x720 a scroll fallback is acceptable; never at or above it. Tablet keeps the same layout; mobile is lower priority.

---

## 1. Global layout (desktop)

Shell: `100dvh`, no page scroll at or above 1280x720; cards scroll internally where long.

**Top bar (92px)**
- Left: brand (real logo mark + "starlly."), hamburger toggles the rail's compact mode.
- Center: **assistant trigger** — the real orb (`orb-loop.webm`; `orb-still.png` for reduced motion or as fallback) in a pill with "Ask Starlly anything…" and a ⌘K hint. Opens the chat panel.
- Right: notifications, avatar/profile menu (Settings, Customer preview, Export sample data).

**Right rail (five buttons, top to bottom, icon above label, fixed far right)**
1. Overview
2. Customers
3. Messages
4. Insights
5. Settings

Active item is clearly marked (background + right bar marker, never color alone). Order is the same on every screen. **The Overview item is fully visible — never cut off at the top.** Icons use explicit sizes from the sprite.

**Content area:** page head (eyebrow, title, subtitle, period select, Customer preview button) + view.

**Sample-data tag:** a visible "Sample data" badge whenever demo data is loaded.

## 2. Overview (dashboard — one screen, from the mock-up)

Grid: hero spans two columns; action card beside it; themes card spans two rows on the left; chart and funnel in the middle; reviews feed column on the right.

| Card | Content |
|---|---|
| Hero (wide) | Business icon, name, "city · Est. year", large rating (e.g. "4.4") with stars and review count + monthly trend, badges: "Sample data" (when demo data is loaded) and "Email connected ✓" (**only after a passing test connection**) |
| Action | Spark icon (explicitly sized — never oversized), "A good moment to ask.", "{N} customers waiting", **Send review requests** button |
| What customers say (tall) | Segmented filter: All themes / Praise / To improve. Rows with "+" or "−" symbol, name, sub-line, mini progress track, mention count. **Scrolls inside the card with a visible scrollbar and a bottom fade.** Footer: **View source reviews** |
| Rating over time | Segmented 7D/30D/90D, big average + trend vs. previous period, SVG line chart from stored records |
| From hello to feedback (funnel) | Sent, Opened, Rated, Clicked Google link with counts and bars. Note: "A Google click doesn't confirm a posted review." |
| Recent reviews (right column) | Filters All / Needs reply / 1–3 ★. Rows: avatar initials, name, time, stars, snippet, source badge, **Draft a reply**. **Scrolls inside the card with a visible scrollbar and a bottom fade.** |

Bottom: two insight nudges ("Your next little improvement", "{N} conversations worth having").

Notes:
- Every number is computed from stored records; empty states show a real next step ("No reviews yet. Import or paste reviews.") — never fake counts.
- Use the "+" and "−" symbols plus text, not color alone.
- The funnel's last step is "Clicked Google link" because posting a review cannot be observed.

## 3. AI chat panel

- Opens from the orb or pill as a panel that appears to drop from the orb, overlapping the cards, slightly see-through.
- Header: orb and "Starlly assistant", close button.
- Messages: user bubbles on the right, assistant on the left.
- Under assistant answers: a small source label such as "Based on 9 reviews" that opens the source reviews.
- Suggestion chips: "Who needs a call?", "Draft a reply to Priya", "Summarize this month".
- Input field with placeholder "Ask about your reviews…" and a send button.
- Small line under the input: "Drafts need your approval before anything is sent."
- Empty state: three suggestion chips only.

## 4. Setup gate (blocking — every route redirects to /setup until complete)

Single centered column with a step indicator and per-item status chips: **Not set** / **Saved, not tested** / **Connected** (with last test time; only a passing test shows Connected). Steps are ordered; steps 2 and 3 cannot be passed without a working Test connection.

1. **Loading animation** (`starlly-hero.mp4`, skipped under reduced motion).
2. **Business:** company name, owner, city/address, Google review link (validated) with an **Open link** check button. Optional: website, Instagram, Discord.
3. **AI provider (required):** style, base URL, model ID, API key, **Test connection**. No continue until it passes.
4. **Email provider (required):** dropdown (agentboxd, OpenMail, Copy only), fields from the adapter, **Test connection**. Copy only needs none and passes.
5. **Google Places:** key field (required in the form) + lookup with "Is this you?" confirmation. The only skip: **I'll paste or import my reviews instead.**
6. **Exa (optional).**
7. **Send a test email to the owner** (skipped for Copy only). **Preview customer page**.
8. **Done:** dashboard.

Each item has a "Where do I get this?" link. Keys are masked with a note: "Stored only on this computer." The files drop zone and Exa research are post-setup enrichment flows, not gate steps.

## 5. Customer page (opened from the email, mobile-first)

Top to bottom:
1. Business name (and logo if available).
2. Question: "How did we do?"
3. Five star buttons in a row.
4. **Leave a Google review** button. Always visible from the start, same size and position for every rating, never disabled.
5. After a rating of 1 to 3, a message appears below (for example "Sorry it wasn't right. We'd like to make it right.") with **Send private feedback** and **Request a call**, placed **beside or below** the Google button.
6. Feedback form: text box and **Submit feedback**, then a thank-you state.

Rule: the layout does not change between ratings except for the extra message and options. The Google button is never hidden, shrunk, moved, or delayed.

## 6. Customers

- Header actions: **Add customer**, **Import list**.
- Filter chips: **All**, **Waiting**, **Requested**, **Needs a call**. ("Requested" = a review request was sent; Starlly cannot observe whether a review was posted, so there is no "Reviewed" status.)
- Table rows: name, contact, service, last job date, status, consent check.
- Row actions: **Send request**, **Mark as called**.
- Empty state: "No customers yet" with **Add customer** and **Use sample data**.

## 7. Messages

- Left: list of drafts (kind, recipient, status).
- Right: editor with subject and body.
- Buttons: **Edit message**, **Preview**, **Check policy**, **Send test to me**, **Approve and send**.
- **Check policy** shows a pass or a list of issues (link consistency, wording).
- Status flow: Draft, Approved, Sent. Approve is a deliberate, separate step.
- A line above the send button: "Every customer gets the same Google link."

## 8. Insights

- **What customers say:** full list of themes with counts, trend arrow, and **View source reviews**.
- **What to fix first:** ranked list with the reason and the evidence count.
- **Alerts:** trend notices with the numbers ("Phone complaints: 1 per week to 4 per week").
- **Who to contact this week:** customers with a likelihood and the main reasons, **Draft email**, **Snooze**, **Dismiss**.
- **Needs a call:** list with **Call**, **Mark resolved**, **Add note**.
- **Evidence panel:** opens to show the source reviews with the exact text used. **Mark as fixed**, **Regenerate summary**.

## 9. Settings

- Business profile (editable fields with a source label each), with the same validation as the gate.
- Email provider (dropdown, fields from the selected provider, **Test connection**). Capabilities shown honestly: only what a verified test confirms; the rest labeled "unverified".
- AI provider (style, base URL, key, model ID, **Test connection**).
- Google Places key and Exa key — same fields as the gate, with per-item status chips.
- **Save**.
- **Load demo data** (confirmation required; never overwrites real data silently) and **Remove demo data**.
- **Delete my data** with a confirmation step.

## 10. States to design for every screen
- Empty (no data yet) with a clear next step — never fake counts.
- Loading with a stable layout.
- Error with a plain message and **Try again**.
- Setup gate: every route redirects to /setup until setup is complete.
- Sample data tag.
- Keyboard focus and large tap targets.
- Respect the "reduce motion" setting for the orb (orb-loop.webm → orb-still.png), droplet, and hero animation.

## 11. Responsive notes
- **One screen:** no page scroll at 1280x720 and above; scroll fallback acceptable below 1280x720 only.
- **Tablet:** same layout as desktop.
- **Mobile:** hamburger moves to the top, compressed. The right rail becomes a bottom dock with the same five items. Cards stack in one column, the reviews feed below.

## 12. Button reference
Setup: Where do I get this?, Test connection, Open link, I'll paste or import my reviews instead, Send a test email, Go to dashboard.
Navigation: Overview, Customers, Messages, Insights, Settings.
Overview: Send review requests, 7D, 30D, 90D, All themes, Praise, To improve, View source reviews, Draft a reply, Customer preview.
Customers: Add customer, Import list, All, Waiting, Requested, Needs a call, Send request, Mark as called.
Messages: Edit message, Preview, Check policy, Send test to me, Approve and send.
Insights: View source reviews, Draft a reply, Copy, Mark as fixed, Regenerate summary, Draft email, Snooze, Dismiss, Call, Mark resolved, Add note.
Settings: Test connection, Save, Load demo data, Remove demo data, Delete my data.
Customer page: Star 1 to 5, Leave a Google review, Send private feedback, Request a call, Submit feedback.
