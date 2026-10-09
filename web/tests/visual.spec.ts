// Dashboard visual verification (rubric D1/D2): screenshots at the three
// viewports with the no-page-scroll assertion, against a fresh database.
import { expect, test } from "@playwright/test";
// Same server + database as flows.spec.ts (serial) — same password.
const PASSWORD = "e2e-flow-password";

// The dashboard is gated behind real setup completion (S1) — no back door.
// AI "Test connection" passes honestly against the OpenAI-compatible stub
// that playwright.config starts on :8791.
async function completeSetupGate(request: import("@playwright/test").APIRequestContext) {
  const status = await (await request.get("/api/setup/status")).json();
  if (status.setupComplete) return;

  await request.put("/api/business", {
    data: {
      name: "Visual Check Business",
      ownerName: "Visual Owner",
      ownerEmail: "owner@visual.test",
      city: "Checkville",
      googleReviewUrl: "https://g.page/visual-check/review",
      googleRating: 4.4,
      googleReviewCount: 126,
      fieldSources: { name: "typed", ownerName: "typed", ownerEmail: "typed", city: "typed", googleReviewUrl: "typed" },
    },
  });
  await request.put("/api/settings", {
    data: { aiStyle: "openai", aiBaseUrl: "http://127.0.0.1:8791/v1", aiModel: "visual-model", aiApiKey: "visual-key" },
  });
  const aiTest = await (await request.post("/api/settings/test-ai")).json();
  if (!aiTest.ok) throw new Error(`AI stub test failed: ${JSON.stringify(aiTest)}`);
  await request.put("/api/settings", { data: { emailAdapterId: "copy-only" } });
  await request.post("/api/settings/test-email");
  await request.post("/api/setup/places-skip");
  await request.post("/api/setup/complete");
}

test.beforeEach(async ({ request }) => {
  // Password first (auth/setup needs to run before the gate completes).
  await request.post("/api/auth/setup", { data: { password: PASSWORD } });
  await completeSetupGate(request);
});

async function loginInPage(page: import("@playwright/test").Page) {
  // Log in inside the browser context so the session cookie sticks to it.
  await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
}

for (const [width, height] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`dashboard fits one screen at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await loginInPage(page);
    await page.goto("/");
    await page.waitForSelector(".dashboard", { timeout: 15_000 });
    await page.waitForTimeout(600); // let the orb video and charts settle

    const fits = await page.evaluate(() => {
      const main = document.querySelector(".main");
      const pageFits = document.documentElement.scrollHeight <= window.innerHeight;
      // D1 is honest only if the WHOLE dashboard (including funnel + nudges)
      // is visible: the main column must not scroll internally either.
      const mainFits = !main || main.scrollHeight <= main.clientHeight + 1;
      return { pageFits, mainFits, mainScroll: main ? main.scrollHeight - main.clientHeight : 0 };
    });
    // Save the evidence either way — the screenshot shows the truth.
    await page.screenshot({ path: `screenshots/dashboard-${width}x${height}.png`, fullPage: false });
    expect(fits.pageFits, `documentElement.scrollHeight must fit ${height}px`).toBe(true);
    expect(fits.mainFits, `.main must not scroll internally at ${height}px (overflow ${fits.mainScroll}px)`).toBe(true);
  });
}

test("empty dashboard shows real empty states, not fake counts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginInPage(page);
  // Flows run first on the shared database and create real records; wipe them
  // (the setup latch stays set) so this test genuinely verifies empty states.
  // Must run AFTER login — the endpoint is owner-guarded.
  const del = await page.request.post("/api/data/delete");
  if (del.status() !== 200) throw new Error(`data/delete failed: ${del.status()}`);
  await page.goto("/");
  await page.waitForSelector(".dashboard", { timeout: 15_000 });
  await expect(page.getByText("No reviews yet")).toBeVisible();
  await expect(page.getByText("No themes yet")).toBeVisible();
  await page.screenshot({ path: "screenshots/dashboard-empty-1440x900.png" });
});
