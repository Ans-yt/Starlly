import { describe, expect, it } from "vitest";
import { classifySentiment, cosineSimilarity, tagThemes } from "./tagging.js";

const norm = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

describe("tagging math (ADR-0003)", () => {
  it("cosine similarity: identical → 1, orthogonal → 0, opposite → -1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("tags only themes above the threshold, best first", () => {
    const themes = [
      { id: "a", name: "Alpha", vector: norm([1, 0]) },
      { id: "b", name: "Beta", vector: norm([0, 1]) },
      { id: "c", name: "Gamma", vector: norm([1, 1]) },
    ];
    const review = norm([0.95, 0.05]);
    const matches = tagThemes(review, themes, 0.4);
    // a ≈ 0.999 (match), c ≈ 0.707 (match), b ≈ 0.05 (below threshold)
    expect(matches.map((m) => m.id)).toEqual(["a", "c"]);
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(matches[1]!.similarity);
  });

  it("multi-theme tagging when several themes clear the threshold", () => {
    const themes = [
      { id: "a", name: "Alpha", vector: norm([1, 0]) },
      { id: "c", name: "Gamma", vector: norm([1, 1]) },
    ];
    const matches = tagThemes(norm([1, 0.9]), themes, 0.4);
    expect(matches.map((m) => m.id)).toContain("a");
    expect(matches.map((m) => m.id)).toContain("c");
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(matches[1]!.similarity);
  });

  it("returns no themes when everything is below the threshold", () => {
    const themes = [{ id: "a", name: "Alpha", vector: norm([1, 0]) }];
    expect(tagThemes(norm([-1, 0]), themes, 0.4)).toEqual([]);
  });

  it("classifies sentiment by nearest anchor", () => {
    const anchors = [
      { label: "positive" as const, vector: norm([1, 0, 0]) },
      { label: "neutral" as const, vector: norm([0, 1, 0]) },
      { label: "negative" as const, vector: norm([0, 0, 1]) },
    ];
    expect(classifySentiment(norm([0.95, 0.05, 0]), anchors, 0.3).label).toBe("positive");
    expect(classifySentiment(norm([0.05, 0.95, 0]), anchors, 0.3).label).toBe("neutral");
    expect(classifySentiment(norm([0, 0, 0.95]), anchors, 0.3).label).toBe("negative");
  });

  it("falls back to neutral when the best anchor is below the threshold", () => {
    const anchors = [
      { label: "positive" as const, vector: norm([1, 0]) },
      { label: "negative" as const, vector: norm([-1, 0]) },
    ];
    // Orthogonal to both anchors: similarity 0 → neutral despite low match.
    const result = classifySentiment(norm([0, 1]), anchors, 0.3);
    expect(result.label).toBe("neutral");
    expect(result.similarity).toBeCloseTo(0);
  });
});
