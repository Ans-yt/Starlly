// Pure funnel computation (GLOSSARY: Funnel). Counts requests, not raw events:
// multiple page loads must not inflate "Opened".
import type { EventRecord } from "./events.js";

export const FUNNEL_LABELS = {
  sent: "Sent",
  opened: "Opened",
  rated: "Rated",
  google_click: "Clicked Google link", // never "Left a review" (GLOSSARY)
} as const;

export interface FunnelRow {
  step: keyof typeof FUNNEL_LABELS;
  label: string;
  count: number;
}

export function computeFunnel(sentRequestIds: string[], events: EventRecord[]): FunnelRow[] {
  const seen = new Map<string, Set<string>>();
  for (const event of events) {
    let set = seen.get(event.requestId);
    if (!set) {
      set = new Set();
      seen.set(event.requestId, set);
    }
    set.add(event.type);
  }
  let opened = 0;
  let rated = 0;
  let clicked = 0;
  for (const id of sentRequestIds) {
    const set = seen.get(id);
    if (!set) continue;
    if (set.has("opened")) opened++;
    if (set.has("rated")) rated++;
    if (set.has("google_click")) clicked++;
  }
  return [
    { step: "sent", label: FUNNEL_LABELS.sent, count: sentRequestIds.length },
    { step: "opened", label: FUNNEL_LABELS.opened, count: opened },
    { step: "rated", label: FUNNEL_LABELS.rated, count: rated },
    { step: "google_click", label: FUNNEL_LABELS.google_click, count: clicked },
  ];
}
