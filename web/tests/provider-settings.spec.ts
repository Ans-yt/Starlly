import { expect, test } from "@playwright/test";
const PASSWORD = "e2e-flow-password";
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


test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/setup", { data: { password: PASSWORD } });
  await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
  await completeSetupGate(page.request);
});

test("AI test failures show a message without blanking Settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/settings/test-ai", route => route.fulfill({
    status: 400,
    json: { ok: false, error: { kind: "validation", message: "AI provider not configured — style, model, and key are required.", retryable: false } },
  }));
  await page.goto("/settings");
  const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "AI provider", exact: true }) });
  await card.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("AI provider not configured");
  await expect(page.locator("#s-aimodel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("AI Test saves current inputs before calling the provider and refreshes status", async ({ page }) => {
  await page.goto("/settings");
  await page.locator("#s-aistyle").selectOption("openai");
  await page.locator("#s-aibase").fill("http://127.0.0.1:8791/v1");
  await page.locator("#s-aimodel").fill("unsaved-model");
  await page.locator("#s-aikey").fill("unsaved-test-key");
  // Keep an unrelated unsaved field intact while refreshing the status chip.
  await page.locator("#s-name").fill("Unsaved business edit");
  let savedModelAtTest: string | undefined;
  await page.route("**/api/settings/test-ai", async route => {
    const settings = await (await page.request.get("/api/settings")).json();
    savedModelAtTest = settings.aiModel;
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.continue();
  });
  const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "AI provider", exact: true }) });
  await card.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(card.getByRole("button", { name: "Testing…" })).toBeDisabled();
  await expect(page.locator(".ok-banner")).toHaveText("Connection works.");
  expect(savedModelAtTest).toBe("unsaved-model");
  await expect(card.locator(".setup-chip")).toContainText("Connected");
  await expect(page.locator("#s-aikey")).toHaveValue("");
  await expect(page.locator("#s-name")).toHaveValue("Unsaved business edit");
});
