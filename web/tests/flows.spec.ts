// Browser flows (ADR-0006, ticket 022), serial over one server + database:
// 1. Real setup gate: loading screen → business → mid-setup redirect check →
//    AI Test connection (passes against the local OpenAI-compatible stub on
//    :8791) → Copy-only email → Places choice-skip → Exa → test email
//    (skipped) → password → dashboard. No sample-data shortcut exists any
//    more — this replaces the old skip-path.
// 2. Draft → approve → send (Copy only) with copy modal
// 3. Customer page: rate 2★ → Google button + low-rating extras (DOM order) → feedback
import { expect, test } from "@playwright/test";

// Shared with visual.spec.ts (one server + database, serial flows).
export const PASSWORD = "e2e-flow-password";

test.describe.configure({ mode: "serial" });

test("flow 1: setup gate — loading screen → business → AI test (stub passes)", async ({ page }) => {
  await page.goto("/");

  // Step 0: the loading screen — hero video (0–4 s), intro card flight
  // (4–7.5 s), then controls fade in. The Start button only becomes
  // interactive in the settled phase.
  await expect(page.locator(".loading-screen")).toBeVisible();
  await page.waitForSelector('.intro-sequence[data-phase="ready"]', { timeout: 20_000 });
  await expect(page.locator(".loading-start")).toContainText("Start setup");
  await page.locator(".loading-start").click();

  // Step 1: business details.
  await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
  await page.locator("#ob-name").fill("E2E Dental");
  await page.locator("#ob-owner").fill("Alex Owner");
  await page.locator("#ob-email").fill("owner@e2e-dental.test");
  await page.locator("#ob-city").fill("Springfield");
  await page.locator("#ob-glink").fill("https://g.page/e2e-dental/review");
  await page.getByRole("button", { name: "Continue" }).click();

  // Mid-setup, every owner route is still gated (S1): /customers cannot open.
  await page.goto("/customers");
  await expect(page.locator(".setup-card")).toBeVisible();

  // Step 2: AI provider — Test connection must PASS before Continue unlocks.
  await expect(page.getByRole("heading", { name: "AI provider" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test connection must pass first" })).toBeDisabled();
  await page.locator("#ob-ai-style").selectOption("openai");
  await page.locator("#ob-ai-url").fill("http://127.0.0.1:8791/v1");
  await page.locator("#ob-ai-model").fill("e2e-model");
  await page.locator("#ob-ai-key").fill("e2e-key");
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.locator(".ok-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 3: email provider — Copy only passes keyless (auto-connected).
  await expect(page.getByRole("heading", { name: "Email provider" })).toBeVisible();
  await page.locator("#ob-adapter").selectOption("copy-only");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 4: Google Places — the explicit choice-skip (no silent default).
  await expect(page.getByRole("heading", { name: "Google Places" })).toBeVisible();
  await page.getByRole("button", { name: "I'll paste or import my reviews instead" }).click();

  // Step 5: Exa — optional, continue without a key.
  await expect(page.getByRole("heading", { name: "Exa" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 6: test email — skipped for Copy only.
  await expect(page.getByRole("heading", { name: "Test email" })).toBeVisible();
  await expect(page.getByText("Copy only is your email provider")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 7: password, then the dashboard unlocks.
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await page.locator("#ob-final-pass").fill(PASSWORD);
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 20_000 });
});

test("flow 2: add customer → draft → approve → send (Copy only) with copy modal", async ({ page }) => {
  await page.goto("/");
  // Fresh browser context: log in with the password set in flow 1.
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 15_000 });

  // Add a consented customer.
  await page.getByRole("link", { name: "Customers" }).click();
  await page.getByRole("button", { name: "Add customer" }).first().click();
  const modal = page.locator(".modal");
  await modal.locator("#c-name").fill("E2E Customer");
  await modal.locator("#c-contact").fill("e2e@example.test");
  await modal.locator("#c-service").fill("annual check-up");
  await modal.locator('input[type="checkbox"]').check();
  await modal.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("E2E Customer")).toBeVisible();

  // Draft a review request from the customer row.
  await page
    .getByRole("button", { name: "Send request" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/messages\//);

  // Approve, then send. Copy only → copy modal with the final text + link.
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved. Sending is now enabled.")).toBeVisible();
  await page.getByRole("button", { name: "Approve and send →" }).click();
  const copyModal = page.getByRole("dialog", { name: "Copy your email" });
  await expect(copyModal).toBeVisible();
  const link = copyModal.locator("code");
  await expect(link).toBeVisible();
  const token = (await link.textContent())?.trim().split("/c/")[1] ?? "";
  expect(token.length).toBeGreaterThan(10);
  await copyModal.getByRole("button", { name: "Close" }).click();
});

test("flow 3: customer page — rate 2★, Google button always first, feedback works", async ({ page }) => {
  // Log in so the draft/send API is reachable from page context.
  await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
  await page.goto("/");
  await page.waitForSelector(".topbar", { timeout: 15_000 });
  // The owner session in this context can replay the send endpoint: it returns
  // the existing request's link (outcome "duplicate", never a second send).
  const linkFromApi = await page.evaluate(async () => {
    const draftsRes = await fetch("/api/drafts", { credentials: "include" });
    const draftsBody = await draftsRes.json();
    const drafts = draftsBody?.drafts ?? [];
    const sent = drafts.find((d: any) => d.kind === "review_request" && d.status === "sent");
    if (!sent) return null;
    const res = await fetch(`/api/drafts/${sent.id}/send`, { method: "POST", credentials: "include" });
    const body = await res.json();
    return (body.link as string) ?? null;
  });
  if (!linkFromApi) {
    const diag = await page.evaluate(async () => {
      const draftsBody = await (await fetch("/api/drafts", { credentials: "include" })).json().catch(() => null);
      return draftsBody ? (draftsBody.drafts ?? []).map((d: { id: string; status: string }) => `${d.id.slice(0, 6)}:${d.status}`).join(", ") : "unauthenticated";
    });
    throw new Error(`flow 3 could not resolve the link. drafts: ${diag}`);
  }

  // Open the customer page (public, no owner session needed).
  await page.goto(linkFromApi!);
  await expect(page.getByText("How did we do?")).toBeVisible();

  // The Google review button is visible BEFORE any rating is given.
  const googleButton = page.getByRole("link", { name: "Leave a Google review" });
  await expect(googleButton).toBeVisible();

  // Rate 2 stars — low rating.
  await page.getByRole("radio", { name: "2 stars" }).click();
  // The rating round-trips (POST + reload) before the extras block appears.
  await page.locator(".low-rating-extra").waitFor({ timeout: 10_000 });

  // DOM order: the Google button must come BEFORE the low-rating extras.
  const orderOk = await page.evaluate(() => {
    const google = document.querySelector(".google-btn");
    const extras = document.querySelector(".low-rating-extra");
    if (!google || !extras) return false;
    return (google.compareDocumentPosition(extras) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(orderOk).toBe(true);

  // The Google link is still enabled with the same href.
  await expect(googleButton).toBeEnabled();

  // Submit private feedback.
  await page.locator("#feedback").fill("The visit ran late and nobody explained the invoice.");
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.getByText("Thanks — we got your feedback.")).toBeVisible();
});
