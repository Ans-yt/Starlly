import { describe, expect, it } from "vitest";
import { approveDraft, canSend, editDraft, hashDraftContent, InvalidTransition } from "./drafts.js";

const base = { status: "draft" as const, approvedAt: null, contentHash: "" };

describe("draft approval state machine (GLOSSARY: any edit after approval invalidates it)", () => {
  it("approves and allows sending", () => {
    const approved = approveDraft(base, "Subject", "Body", "2026-01-01T00:00:00.000Z");
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(approved.contentHash).toBe(hashDraftContent("Subject", "Body"));
    expect(canSend(approved)).toBe(true);
  });

  it("invalidates approval on any content edit", () => {
    const approved = approveDraft(base, "Subject", "Body", "t1");
    const after = editDraft(approved, "Subject", "Body with a change");
    expect(after.status).toBe("draft");
    expect(after.approvedAt).toBeNull();
    expect(canSend(after)).toBe(false);
  });

  it("keeps approval when the edit produces identical content", () => {
    const approved = approveDraft(base, "Subject", "Body", "t1");
    const after = editDraft(approved, "Subject", "Body");
    expect(after.status).toBe("approved");
    expect(canSend(after)).toBe(true);
  });

  it("refuses to edit or re-approve a sent draft", () => {
    const sent = { status: "sent" as const, approvedAt: "t", contentHash: "h" };
    expect(() => editDraft(sent, "Subject", "Body")).toThrow(InvalidTransition);
    expect(() => approveDraft(sent, "Subject", "Body", "t2")).toThrow(InvalidTransition);
  });
});
