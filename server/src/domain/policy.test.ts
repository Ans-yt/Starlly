import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkDraftPolicy, checkPageSettings, type PolicyRule } from "./policy.js";

const fixtureDir = path.resolve(process.cwd(), "../fixtures/policy");
const readFixture = (name: string) => readFileSync(path.join(fixtureDir, name), "utf-8");

const SUBJECT = "How did we do?";

describe("policy checker on fixture drafts (ticket 010)", () => {
  const cases: { file: string; expected: PolicyRule[] }[] = [
    { file: "compliant.txt", expected: [] },
    { file: "incentive.txt", expected: ["incentive"] },
    { file: "pressure.txt", expected: ["pressure"] },
    { file: "gating.txt", expected: ["gating"] },
  ];

  for (const { file, expected } of cases) {
    it(`${file}: ${expected.length === 0 ? "passes" : `flags ${expected.join(", ")}`}`, () => {
      const issues = checkDraftPolicy({ subject: SUBJECT, body: readFixture(file) });
      const rules = [...new Set(issues.map((i) => i.rule))];
      for (const rule of expected) {
        expect(rules).toContain(rule);
      }
      expect(rules).toEqual(expected); // nothing extra, nothing missing
      for (const issue of issues) {
        expect(issue.message.length).toBeGreaterThan(10); // plain, displayable reasons
      }
    });
  }

  it("flags a Google review link that differs from the configured one", () => {
    const issues = checkDraftPolicy({
      subject: SUBJECT,
      body: "Review us here: https://g.page/some-other-place",
      googleReviewUrl: "https://g.page/coppervale",
    });
    expect(issues.map((i) => i.rule)).toContain("link_consistency");
  });

  it("flags multiple different Google links in one draft", () => {
    const issues = checkDraftPolicy({
      subject: SUBJECT,
      body: "A: https://g.page/one — B: https://search.google.com/local/writereview?placeid=X",
    });
    expect(issues.map((i) => i.rule)).toContain("link_consistency");
  });

  it("accepts the configured Google link", () => {
    const issues = checkDraftPolicy({
      subject: SUBJECT,
      body: "Review us here: https://g.page/coppervale",
      googleReviewUrl: "https://g.page/coppervale",
    });
    expect(issues).toEqual([]);
  });
});

describe("policy checker on customer-page settings", () => {
  it("flags hiding the Google link below a rating", () => {
    const issues = checkPageSettings({ hideGoogleLinkBelowRating: 4 });
    expect(issues.map((i) => i.rule)).toContain("hidden_link");
  });

  it("flags delaying the Google link for low ratings", () => {
    const issues = checkPageSettings({ delayGoogleLinkForLowRatings: true });
    expect(issues.map((i) => i.rule)).toContain("hidden_link");
  });

  it("flags different Google links per rating", () => {
    const issues = checkPageSettings({
      googleLinkByRating: { "1": "https://g.page/a", "5": "https://g.page/b" },
    });
    expect(issues.map((i) => i.rule)).toContain("link_consistency");
  });

  it("passes compliant page settings (same link for every rating)", () => {
    expect(checkPageSettings({})).toEqual([]);
  });
});
