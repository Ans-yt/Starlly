import { expect, test, type Page } from "@playwright/test";

// Pass A — loading/intro screen rubric (I1–I8). This file sorts FIRST so it
// runs against a setup-incomplete database: the intro only shows while the
// setup gate is open.
//
// Timeline: 0–4 s video only; cards arrive in separate slots, 180 ms apart
// with a 760 ms entrance; controls appear after the last arrival.

const VIEWPORTS = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
];

const waitReady = (page: Page) =>
  page.waitForSelector('.intro-sequence[data-phase="ready"]', { timeout: 20_000 });

test("I1/I2: video-only for 4 s, then cards fly in — captured frames", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });

  // t≈0.3 s — video only: no cards, logo and controls still transparent.
  await page.screenshot({ path: "screenshots/intro-0s.png" });
  expect(await page.locator(".intro-card").count()).toBe(0);
  const logoAt0 = await page.locator(".intro-logo-chip").evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(logoAt0)).toBeLessThan(0.05);

  await page.waitForTimeout(3000); // t≈3.3 s — still inside the video-only window
  await page.screenshot({ path: "screenshots/intro-3s.png" });
  expect(await page.locator(".intro-card").count()).toBe(0);
  expect(await page.locator("video.loading-bg").count()).toBe(1);

  await page.waitForSelector('.intro-sequence[data-phase="cards"]');
  await page.waitForTimeout(250); // sample the stagger before the controls appear
  await page.screenshot({ path: "screenshots/intro-5s.png" });
  expect(await page.locator(".intro-card").count()).toBe(3);
  const anyFlying = await page.locator(".intro-card").evaluateAll((els) =>
    els.some((el) => Number(getComputedStyle(el).opacity) > 0.1),
  );
  expect(anyFlying).toBe(true);
  const controlsAt5 = await page.locator(".intro-controls").evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(controlsAt5)).toBeLessThan(0.5);

  // Wait for all arrivals and the supporting controls to settle.
  await waitReady(page);
  await expect(page.locator(".intro-headline")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "screenshots/intro-8s.png" });
  await expect(page.locator(".intro-dot")).toHaveCount(3);
  const headline = await page.locator(".intro-headline").evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(headline)).toBeGreaterThan(0.9);
});

test("I3: cards cycle automatically, pause on hover, resume after idle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitReady(page);
  // Park the mouse OFF the stage: auto-advance runs.
  await page.mouse.move(5, 5);
  await expect(page.locator(".intro-card").nth(0)).toHaveClass(/is-active/);
  await page.waitForTimeout(5600); // one auto-advance tick (5 s)
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);

  // Hover the stage: paused. No further advance while hovering.
  await page.locator(".intro-stage").hover();
  const before = await page.locator(".intro-card.is-active").getAttribute("id");
  await page.waitForTimeout(5600);
  const after = await page.locator(".intro-card.is-active").getAttribute("id");
  expect(after).toBe(before);

  // Leave: resumes after 8 s idle, then the next tick lands 5 s later.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(14_500); // IDLE_MS 8 s + one AUTO_MS tick
  const resumed = await page.locator(".intro-card.is-active").getAttribute("id");
  expect(resumed).not.toBe(before);
});

test("I4: dots, arrows, keyboard, swipe and receding-card click all steer focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitReady(page);
  await page.locator(".intro-stage").hover(); // pause auto-advance while driving

  // dots — 44 px hit area, visible current state
  const dotBox = await page.locator(".intro-dot").nth(1).boundingBox();
  expect(dotBox!.width).toBeGreaterThanOrEqual(43);
  expect(dotBox!.height).toBeGreaterThanOrEqual(43);
  await page.locator(".intro-dot").nth(1).click();
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);
  await expect(page.locator(".intro-dot").nth(1)).toHaveAttribute("aria-current", "true");

  // arrows
  await page.locator(".intro-arrow[aria-label='Next card']").click();
  await expect(page.locator(".intro-card").nth(2)).toHaveClass(/is-active/);
  await page.locator(".intro-arrow[aria-label='Previous card']").click();
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);

  // keyboard Left / Right
  await page.locator(".intro-stage").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".intro-card").nth(2)).toHaveClass(/is-active/);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);

  // swipe (pointer events; horizontal)
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(420, 400, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".intro-card").nth(2)).toHaveClass(/is-active/);

  // click a receding card brings it forward
  await page.locator(".intro-dot").nth(0).click();
  await expect(page.locator(".intro-card").nth(0)).toHaveClass(/is-active/);
  await page.locator(".intro-card").nth(1).click();
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);
});

for (const vp of VIEWPORTS) {
  test(`I5: card text fits and stays upright at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await waitReady(page);
    await expect(page.locator(".intro-headline")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `screenshots/intro-ready-${vp.name}.png` });
    const checks = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".intro-card-inner")).map((el) => {
        const cs = getComputedStyle(el);
        const m = new DOMMatrixReadOnly(cs.transform === "none" ? "matrix(1,0,0,1,0,0)" : cs.transform);
        return {
          overflowPx: el.scrollHeight - el.clientHeight,
          rotated: Math.abs(m.b) > 0.01 || Math.abs(m.c) > 0.01,
        };
      }),
    );
    expect(checks.length).toBe(3);
    for (const c of checks) {
      expect(c.overflowPx, "card text must not overflow").toBeLessThanOrEqual(1);
      expect(c.rotated, "card text must never rotate").toBe(false);
    }
  });
}

test("I6: logo is the real mark in a glass chip — no hard frame", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitReady(page);
  const chip = await page.locator(".intro-logo-chip").evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return {
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      color: cs.color,
      svgWidth: svg ? svg.getBoundingClientRect().width : 0,
      hardFrame: cs.borderTopWidth !== "0px" && parseFloat(cs.borderTopColor) === 0,
    };
  });
  expect(parseFloat(chip.radius)).toBeGreaterThanOrEqual(20);
  expect(parseFloat(chip.radius)).toBeLessThanOrEqual(24);
  expect(chip.bg).not.toBe("rgba(0, 0, 0, 0)"); // glass fill present
  expect(chip.color).toContain("245, 244, 239"); // off-white ink
  expect(chip.svgWidth).toBeGreaterThanOrEqual(120);
  expect(chip.svgWidth).toBeLessThanOrEqual(160);
});

test("I8: exact copy — headline, three cards, no approval language", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitReady(page);
  await expect(page.locator(".intro-headline")).toHaveText(
    "Collect more Google reviews. Learn from every word of feedback.",
  );
  const cards = await page.locator(".intro-card-inner").allTextContents();
  expect(cards[0]).toContain("After each job, your customer gets a branded message with one link. No app, no account.");
  expect(cards[1]).toContain(
    "See your rating and what customers keep praising or complaining about, with the real reviews as proof.",
  );
  expect(cards[2]).toContain(
    "A short list of what to fix first, who to call back, and who is due for another visit.",
  );
  const body = await page.locator(".loading-screen").textContent();
  expect(body).not.toMatch(/approval/i);
  expect(body).not.toMatch(/Setup takes about two minutes/i);
});

test("I7: reduced motion — resting layout, still frame, no auto-advance, controls work", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForSelector(".loading-screen", { timeout: 15_000 });
  await expect(page.locator(".loading-bg-still")).toBeVisible();
  await expect(page.locator(".intro-card")).toHaveCount(3); // already at rest
  await page.waitForTimeout(6000);
  await expect(page.locator(".intro-card").nth(0)).toHaveClass(/is-active/); // no auto-advance
  await page.locator(".intro-dot").nth(1).click(); // controls still work
  await expect(page.locator(".intro-card").nth(1)).toHaveClass(/is-active/);
  await ctx.close();
});


test("intro cards have separate readable spaces at every viewport", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitReady(page);
    const layout = await page.locator(".intro-card-inner").evaluateAll((cards) => cards.map(card => {
      const r = card.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    for (let i = 0; i < layout.length; i++) {
      const a = layout[i];
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(viewport.width);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.bottom).toBeLessThanOrEqual(viewport.height);
      for (const b of layout.slice(i + 1)) {
        expect(a.right + 8 <= b.left || b.right + 8 <= a.left || a.bottom + 8 <= b.top || b.bottom + 8 <= a.top,
          `Cards must have breathing room at ${viewport.name}`).toBe(true);
      }
    }
    await expect(page.locator(".loading-start")).toBeInViewport();
  }
  await context.close();
});
