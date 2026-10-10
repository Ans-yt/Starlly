// Pure draft/approval state machine (GLOSSARY: Approval; ticket 006).
import crypto from "node:crypto";
import type { DraftStatus } from "./types.js";

export function hashDraftContent(
  subject: string,
  body: string,
  design?: unknown,
): string {
  return crypto
    .createHash("sha256")
    .update(
      `${subject}\n\n${body}${design ? "\n\n" + JSON.stringify(design) : ""}`,
    )
    .digest("hex");
}

export interface DraftState {
  status: DraftStatus;
  approvedAt: string | null;
  contentHash: string;
}

export class InvalidTransition extends Error {}

export function approveDraft(
  state: DraftState,
  subject: string,
  body: string,
  now: string,
  design?: unknown,
): DraftState {
  if (state.status === "sent") {
    throw new InvalidTransition("A sent draft cannot be re-approved.");
  }
  return {
    status: "approved",
    approvedAt: now,
    contentHash: hashDraftContent(subject, body, design),
  };
}

/**
 * Any content edit while approved invalidates the approval (GLOSSARY rule 2).
 * Sent drafts are immutable.
 */
export function editDraft(
  state: DraftState,
  subject: string,
  body: string,
  design?: unknown,
): DraftState {
  if (state.status === "sent") {
    throw new InvalidTransition("A sent draft cannot be edited.");
  }
  const contentHash = hashDraftContent(subject, body, design);
  if (state.status === "approved" && contentHash !== state.contentHash) {
    return { status: "draft", approvedAt: null, contentHash };
  }
  return { ...state, contentHash };
}

/** Sending requires an active approval of the current content. */
export function canSend(state: DraftState): boolean {
  return state.status === "approved";
}

/** Test sends go to the owner only and never require approval. */
export function canTestSend(state: DraftState): boolean {
  return state.status !== "sent";
}
