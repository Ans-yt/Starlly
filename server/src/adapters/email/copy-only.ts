// Copy only (spec 4.3): Starlly writes the email, the owner copies it.
// Works with zero keys. Nothing is dispatched; the send job is marked accepted
// and the UI surfaces the final text (plus the customer link) for copying.
import type { EmailAdapter } from "./types.js";

export const copyOnlyAdapter: EmailAdapter = {
  id: "copy-only",
  label: "Copy only",
  capabilities: { html: false, replyTo: false, headers: false },
  configFields: [],
  async test() {
    return { ok: true };
  },
  async send() {
    return { status: "accepted" };
  },
};
