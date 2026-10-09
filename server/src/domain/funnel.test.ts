import { describe, expect, it } from "vitest";
import { computeFunnel } from "./funnel.js";

describe("funnel computation (GLOSSARY: last step is 'Clicked Google link', never more)", () => {
  it("counts requests, not raw events — duplicate loads don't inflate 'Opened'", () => {
    const events = [
      { requestId: "r1", type: "opened" as const, createdAt: "t1" },
      { requestId: "r1", type: "opened" as const, createdAt: "t2" }, // duplicate load
      { requestId: "r1", type: "rated" as const, value: "5", createdAt: "t3" },
      { requestId: "r2", type: "opened" as const, createdAt: "t4" },
      { requestId: "r3", type: "opened" as const, createdAt: "t5" },
      { requestId: "r3", type: "rated" as const, value: "2", createdAt: "t6" },
      { requestId: "r3", type: "google_click" as const, createdAt: "t7" },
    ];
    const funnel = computeFunnel(["r1", "r2", "r3"], events);
    expect(funnel.map((f) => f.count)).toEqual([3, 3, 2, 1]);
    expect(funnel.map((f) => f.label)).toEqual(["Sent", "Opened", "Rated", "Clicked Google link"]);
  });

  it("never claims a review was posted", () => {
    const funnel = computeFunnel(["r1"], []);
    const labels = funnel.map((f) => f.label).join(" ");
    expect(labels).not.toContain("Left a review");
    expect(labels).not.toContain("Review posted");
  });

  it("returns zeros for empty data", () => {
    const funnel = computeFunnel([], []);
    expect(funnel.map((f) => f.count)).toEqual([0, 0, 0, 0]);
  });
});
