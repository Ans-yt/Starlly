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
      name: "Email Business",
      ownerName: "Owner",
      ownerEmail: "owner@email.test",
      city: "Town",
      googleReviewUrl: "https://g.page/email",
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
});
test("four layouts, crop/upload, drag assets and blocks, save and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const draft = await (
    await page.request.post("/api/drafts", {
      data: {
        kind: "follow_up",
        subject: "A quick hello",
        body: "Hi {{customer}},\nTell us how it went: {{link}}",
      },
    })
  ).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/messages/${draft.id}`);
  await expect(page.locator(".email-preset")).toHaveCount(4);
  for (const name of ["Letter", "Spotlight", "Compact", "Branded"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(
      page.locator(`.email-canvas.${name.toLowerCase()}`),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Edit banner block 2" }).click();
  await page.getByRole("button", { name: "Upload & resize" }).click();
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 700;
    c.height = 500;
    const x = c.getContext("2d")!;
    x.fillStyle = "#9a76d0";
    x.fillRect(0, 0, 700, 500);
    x.fillStyle = "#fff";
    x.fillRect(80, 80, 200, 200);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Upload email image").setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(
    page.getByRole("dialog", { name: "Fit your image" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save to assets" }).click();
  await expect(page.locator(".email-block.banner img")).toBeVisible();
  await expect(page.locator(".email-canvas.branded")).toBeVisible();
  await page.getByRole("button", { name: /^Assets/ }).click();
  await expect(page.locator(".email-asset small")).toHaveText("1200 × 400");
  await page
    .locator(".email-asset")
    .first()
    .dragTo(page.locator(".email-block.message"));
  await page
    .locator(".email-asset-drawer")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".email-block.image img")).toBeVisible();
  const before = await page
    .locator(".email-block")
    .evaluateAll((nodes) => nodes.map((n) => n.className));
  await page
    .getByRole("button", { name: "Drag heading block" })
    .dragTo(page.locator(".email-block.logo"));
  expect(
    await page
      .locator(".email-block")
      .evaluateAll((nodes) => nodes.map((n) => n.className)),
  ).not.toEqual(before);
  await page.getByLabel("Layout name").fill("My campaign");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Layout saved");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save edit", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.locator(".email-block.banner img")).toBeVisible();
  await expect(page.locator(".email-canvas.branded")).toBeVisible();
  await page
    .getByRole("button", { name: "Preview email", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Customer email preview"]')
      .getByRole("link", { name: "Share your feedback" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit layout", exact: true }).click();
  await page.locator(".email-builder").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "C:/Users/Administrateur/Documents/Codex/2026-10-10/hey-2/outputs/email-editor-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".email-preset").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "C:/Users/Administrateur/Documents/Codex/2026-10-10/hey-2/outputs/email-editor-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Assets/ }).click();
  await page
    .locator(".email-asset")
    .first()
    .getByRole("button", { name: "Resize", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Fit your image" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .locator(".email-asset-drawer")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(errors).toEqual([]);
});
test("failed saves stop test sending, and dirty designs cannot be sent", async ({
  page,
}) => {
  const draft = await (
    await page.request.post("/api/drafts", {
      data: {
        kind: "follow_up",
        subject: "Approval test",
        body: "Hi {{customer}} {{link}}",
      },
    })
  ).json();
  await page.request.post(`/api/drafts/${draft.id}/approve`);
  await page.goto(`/messages/${draft.id}`);
  await page.getByRole("button", { name: /^Letter/ }).click();
  await expect(
    page.getByRole("button", { name: "Approve and send" }),
  ).toBeDisabled();
  let called = false;
  await page.route(`**/api/drafts/${draft.id}/test-send`, (route) => {
    called = true;
    return route.fulfill({ json: { outcome: "accepted" } });
  });
  await page.route(`**/api/drafts/${draft.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 400,
          json: { message: "Please fix this draft." },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Send test to me" }).click();
  await expect(page.getByRole("alert")).toHaveText("Please fix this draft.");
  expect(called).toBe(false);
});
