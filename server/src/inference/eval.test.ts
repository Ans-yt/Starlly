// Eval core test with a crafted stub embedder: deterministic keyword vectors
// make the expected tagger output known, so precision/recall math is verified.
import { describe, expect, it } from "vitest";
import { runEval, type EvalRecord, type EvalTheme } from "./eval.js";
import type { EmbedFn } from "./embedder.js";

const norm = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

// Keyword → direction mapping. Theme texts embed to their own axis.
const stubEmbed: EmbedFn = async (texts) =>
  texts.map((t) => {
    const s = t.toLowerCase();
    if (s.includes("punctuality") || s.includes("on time")) return norm([1, 0, 0, 0]);
    if (s.includes("pricing") || s.includes("expensive")) return norm([0, 1, 0, 0]);
    if (s.includes("quality") || s.includes("excellent")) return norm([0, 0, 1, 0]);
    if (s.includes("communication") || s.includes("phone")) return norm([0, 0, 0, 1]);
    if (s.includes("terrible") || s.includes("awful")) return norm([-1, 0, 0, 0]); // negative-ish
    if (s.includes("happy") || s.includes("great")) return norm([0.9, 0, 0, 0.1]);
    return norm([0, 0.05, 0.05, 0.05]); // near-orthogonal (neutral-ish)
  });

const themes: EvalTheme[] = [
  { id: "t1", name: "Punctuality", description: "arriving on time, punctuality" },
  { id: "t2", name: "Pricing", description: "pricing, expensive, cost" },
];

describe("eval core (ADR-0007: themes and sentiment reported separately)", () => {
  it("computes per-theme precision/recall/f1 and sentiment accuracy", async () => {
    const records: EvalRecord[] = [
      { text: "They were on time", themes: ["Punctuality"], sentiment: "positive" },
      { text: "Very on time again", themes: ["Punctuality"], sentiment: "positive" },
      { text: "Too expensive", themes: ["Pricing"], sentiment: "negative" },
      { text: "The work was excellent", themes: [], sentiment: "positive" }, // near-orthogonal → no theme tags
    ];
    const report = await runEval(records, themes, stubEmbed);

    // Punctuality: both records tagged (on time), no false positives → perfect.
    const punctuality = report.perTheme.find((t) => t.theme === "punctuality")!;
    expect(punctuality.tp).toBe(2);
    expect(punctuality.fp).toBe(0);
    expect(punctuality.fn).toBe(0);
    expect(punctuality.f1).toBe(1);

    // Pricing: tagged once (expensive), correct.
    const pricing = report.perTheme.find((t) => t.theme === "pricing")!;
    expect(pricing.tp).toBe(1);
    expect(pricing.f1).toBe(1);

    // Sentiment is evaluated separately and reported as a plain fraction.
    expect(report.sentimentTotal).toBe(4);
    expect(report.sentimentAccuracy).toBeGreaterThanOrEqual(0.25);
    expect(report.sentimentAccuracy).toBeLessThanOrEqual(1);
  });

  it("records theme misses with expected vs got lists", async () => {
    const records: EvalRecord[] = [
      { text: "on time", themes: ["Pricing"], sentiment: "positive" }, // deliberate mismatch
    ];
    const report = await runEval(records, themes, stubEmbed);
    expect(report.themeMisses.length).toBe(1);
    expect(report.themeMisses[0]!.expected).toEqual(["Pricing"]);
    expect(report.themeMisses[0]!.got).toEqual(["Punctuality"]);
  });
});
