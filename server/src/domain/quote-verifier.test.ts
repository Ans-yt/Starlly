import { describe, expect, it } from "vitest";
import { normalizeForQuote, verifyInsightQuotes, verifyQuote, type CorpusReview } from "./quote-verifier.js";

const corpus: CorpusReview[] = [
  { id: "r1", text: "The technician arrived on time and fixed the furnace quickly. Great phone access when I called." },
  { id: "r2", text: "Café service was wonderful — the crème brûlée was perfect." },
  { id: "r3", text: "Everything went smoothly from booking to billing." },
];

describe("quote verifier (spec §7.4: no insight without evidence)", () => {
  it("verifies a verbatim quote", () => {
    const check = verifyQuote("arrived on time and fixed the furnace quickly", corpus, "r1");
    expect(check.verified).toBe(true);
  });

  it("rejects an altered quote (changed word)", () => {
    const check = verifyQuote("arrived on time and fixed the air conditioner quickly", corpus, "r1");
    expect(check.verified).toBe(false);
  });

  it("tolerates whitespace and newline differences", () => {
    const check = verifyQuote("The technician arrived   on time\n\nand fixed the furnace quickly.", corpus, "r1");
    expect(check.verified).toBe(true);
  });

  it("tolerates Unicode normalization differences (NFC vs NFD)", () => {
    // "crème brûlée" with combining accents (NFD) vs precomposed (NFC)
    const nfd = "Cafe\u0301 service was wonderful — the cre\u0300me bru\u0302le\u0301e was perfect.";
    const check = verifyQuote(nfd, corpus, "r2");
    expect(check.verified).toBe(true);
  });

  it("rejects a quote attributed to the wrong review", () => {
    const check = verifyQuote("arrived on time and fixed the furnace quickly", corpus, "r3");
    expect(check.verified).toBe(false);
  });

  it("rejects a quote claiming a review that does not exist", () => {
    const check = verifyQuote("anything at all", corpus, "no-such-review");
    expect(check.verified).toBe(false);
  });

  it("searches the whole corpus when no reviewId is claimed", () => {
    const check = verifyQuote("Everything went smoothly from booking to billing.", corpus);
    expect(check.verified).toBe(true);
  });

  it("rejects an empty quote", () => {
    const check = verifyQuote("   ", corpus, "r1");
    expect(check.verified).toBe(false);
  });

  it("verifyInsightQuotes reports dropped quotes and allVerified", () => {
    const result = verifyInsightQuotes(
      [
        { reviewId: "r1", quote: "arrived on time" },
        { reviewId: "r1", quote: "totally fabricated words" },
        { reviewId: "missing", quote: "arrived on time" },
      ],
      corpus,
    );
    expect(result.allVerified).toBe(false);
    expect(result.droppedCount).toBe(2);
    expect(result.checks[0]?.verified).toBe(true);
    expect(result.checks[1]?.verified).toBe(false);
    expect(result.checks[2]?.verified).toBe(false);
  });
});
