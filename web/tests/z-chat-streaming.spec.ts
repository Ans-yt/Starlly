import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/setup", {
    data: { password: "e2e-flow-password" },
  });
  await page.request.post("/api/auth/login", {
    data: { password: "e2e-flow-password" },
  });
  await page.request.put("/api/business", {
    data: {
      name: "Chat Business",
      ownerName: "Owner",
      ownerEmail: "owner@chat.test",
      city: "Town",
      googleReviewUrl: "https://g.page/chat",
    },
  });
  await page.request.put("/api/settings", {
    data: {
      aiStyle: "openai",
      aiBaseUrl: "http://127.0.0.1:8791/v1",
      aiModel: "test-chat",
      aiApiKey: "test-key",
      emailAdapterId: "copy-only",
    },
  });
  await page.request.post("/api/settings/test-ai");
  await page.request.post("/api/setup/places-skip");
  await page.request.post("/api/setup/complete");
  await page.goto("/");
  await page.locator(".assistant-trigger").click();
});
test("streams a reply and keeps reasoning collapsed until opened", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("textbox", { name: "Message the assistant" })
    .fill("Who needs a call?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop reply" })).toBeVisible();
  await expect(page.locator(".bubble").last()).toContainText("Your business");
  await expect(page.locator(".bubble").last()).toHaveText(
    "Your business has saved records.",
  );
  const reasoning = page.locator(".chat-reasoning");
  await expect(reasoning).not.toHaveAttribute("open");
  await expect(reasoning.locator("div")).not.toBeVisible();
  await reasoning.locator("summary").click();
  await expect(reasoning.locator("div")).toHaveText(
    "Checking the saved business records.",
  );
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("connection errors keep the chat usable", async ({ page }) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: "ai_failed",
        message: "Provider unavailable. Please try again.",
      },
    }),
  );
  await page
    .getByRole("textbox", { name: "Message the assistant" })
    .fill("Help me");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Provider unavailable. Please try again.",
  );
  await expect(
    page.getByRole("textbox", { name: "Message the assistant" }),
  ).toBeVisible();
});
