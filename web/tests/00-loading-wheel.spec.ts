import { expect, test } from "@playwright/test";

// Loading-screen wheel (owner's WorksWheel, ported). Runs BEFORE flows.spec
// (file sorts first) because it needs a setup-incomplete database: the loading
// screen only renders while the setup gate is open.
//
// Turn positions: 0 = closed ring; 1..3 front cards 0..2. At rest card 0 is
// already aria-selected, so "opened" proofs assert the ring transform moved.

const ringTransform = (page: import("@playwright/test").Page) =>
  page.locator(".wheel-ring").evaluate((el) => el.style.transform);

test("keyboard advances through every intro card (no dead stop)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });
  await page.locator(".wheel-stage").focus();
  const closed = await ringTransform(page);

  await page.keyboard.press("ArrowDown"); // first input: ring opens, card 1 fronts
  await page.waitForTimeout(900);
  const open = await ringTransform(page);
  expect(open).not.toBe(closed); // the drum actually opened
  await expect(page.locator(".wheel-card").nth(0)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown"); // card 2
  await page.waitForTimeout(900);
  await expect(page.locator(".wheel-card").nth(1)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown"); // card 3 must be reachable
  await page.waitForTimeout(900);
  await expect(page.locator(".wheel-card").nth(2)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowUp"); // and back
  await page.waitForTimeout(900);
  await expect(page.locator(".wheel-card").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("mouse wheel advances the intro cards", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });
  await page.locator(".wheel-stage").focus();
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 900); // WHEEL_UNITS = one card
  await page.waitForTimeout(1_200);
  await expect(page.locator(".wheel-card").nth(0)).toHaveAttribute("aria-selected", "true");
  const open = await ringTransform(page);
  expect(open).not.toBe("translateZ(0px)");
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1_200);
  await expect(page.locator(".wheel-card").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("drag opens the drum and settles on a card", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });
  const closed = await ringTransform(page);
  // The pointerdown must land ON the stage; drag up ~500px (> DRAG_UNITS).
  const box = await page.locator(".wheel-stage").boundingBox();
  expect(box).not.toBeNull();
  const startY = box!.y + box!.height * 0.75;
  await page.mouse.move(box!.x + box!.width / 2, startY);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, startY - 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1_200);
  const open = await ringTransform(page);
  expect(open).not.toBe(closed);
  await expect(page.locator(".wheel-card").nth(0)).toHaveAttribute("aria-selected", "true");
});

test("hero video is the loading background and honors reduced motion", async ({ browser }) => {
  const page = await browser.newContext().then((c) => c.newPage());
  const responses: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("starlly-hero")) responses.push(r.status());
  });
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });
  await page.waitForSelector("video.loading-bg", { timeout: 15_000 });
  expect(responses.length).toBeGreaterThan(0);
  expect(responses.every((s) => s >= 200 && s < 300)).toBe(true);

  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const p2 = await ctx.newPage();
  await p2.goto("/");
  await p2.waitForSelector(".loading-screen", { timeout: 15_000 });
  await expect(p2.locator(".loading-bg-still")).toBeVisible();
  await ctx.close();
});
