import { describe, expect, it } from "vitest";
import { detectRatingDrop, detectThemeSpikes, windowIndexFor } from "./trends.js";

describe("theme spike detection (spec §7.3: numbers shown)", () => {
  it("flags 1 per week to 4 per week", () => {
    const alerts = detectThemeSpikes([
      { themeId: "t1", themeName: "Phone access", counts: [1, 1, 1, 4] },
    ]);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.kind).toBe("theme_spike");
    expect(alerts[0]!.text).toBe("Phone access: 1 per week to 4 per week.");
  });

  it("does not flag stable series", () => {
    expect(detectThemeSpikes([{ themeId: "t1", themeName: "X", counts: [1, 1, 1, 1] }])).toEqual([]);
  });

  it("does not flag a 0 to 1 blip", () => {
    expect(detectThemeSpikes([{ themeId: "t1", themeName: "X", counts: [0, 0, 0, 1] }])).toEqual([]);
  });

  it("needs at least 4 windows", () => {
    expect(detectThemeSpikes([{ themeId: "t1", themeName: "X", counts: [1, 1, 4] }])).toEqual([]);
  });

  it("handles zero-variance baselines (constant 2/week then 5)", () => {
    const alerts = detectThemeSpikes([{ themeId: "t", themeName: "Punctuality", counts: [2, 2, 2, 5] }]);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.text).toContain("2 per week to 5 per week");
  });
});

describe("rating drop detection", () => {
  it("flags a drop from a stable 4.5 to 3.8", () => {
    const alert = detectRatingDrop([4.5, 4.6, 4.4, 3.8]);
    expect(alert?.kind).toBe("rating_drop");
    expect(alert?.text).toContain("Average rating: 4.5 to 3.8");
  });

  it("does not flag normal variation", () => {
    expect(detectRatingDrop([4.5, 4.6, 4.4, 4.5])).toBeNull();
  });

  it("needs enough history", () => {
    expect(detectRatingDrop([4.5, 3.0])).toBeNull();
  });
});

describe("rolling window bucketing", () => {
  it("assigns recent dates to the newest window and old dates to the oldest", () => {
    const now = new Date("2026-06-30T12:00:00Z").getTime();
    const weeks = 4;
    // 1 day ago → newest window (index 3)
    expect(windowIndexFor("2026-06-29T12:00:00Z", weeks, now)).toBe(3);
    // 8 days ago → window index 2
    expect(windowIndexFor("2026-06-22T12:00:00Z", weeks, now)).toBe(2);
    // 26 days ago → oldest window (index 0)
    expect(windowIndexFor("2026-06-04T12:00:00Z", weeks, now)).toBe(0);
    // 40 days ago → outside the window set
    expect(windowIndexFor("2026-05-21T12:00:00Z", weeks, now)).toBe(-1);
  });
});
