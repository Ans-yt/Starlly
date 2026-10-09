// Rebooking baseline (ADR-0007): rule over service intervals FIRST and only.
// The output is a clearly labeled rule-based recommendation — never a
// probability. A learned model is gated behind sufficient real labeled
// history, which the app does not fabricate.
export const DEFAULT_INTERVAL_MONTHS = 12;
/** "Who to contact this week" = due within this many days (or overdue). */
export const CONTACT_WINDOW_DAYS = 30;

export const SERVICE_INTERVALS: { pattern: RegExp; months: number }[] = [
  { pattern: /quarterly/i, months: 3 },
  { pattern: /clean(ing)?|seasonal/i, months: 6 },
  { pattern: /annual|yearly|tune[- ]?up|inspection|check[- ]?up|service/i, months: 12 },
  { pattern: /install|repair|replacement/i, months: 24 },
];

export function serviceIntervalMonths(serviceType: string): number {
  for (const entry of SERVICE_INTERVALS) {
    if (entry.pattern.test(serviceType)) return entry.months;
  }
  return DEFAULT_INTERVAL_MONTHS;
}

export interface RebookingInput {
  serviceType: string;
  lastJobDate: string | null;
  now?: string;
}

export interface RebookingRecommendation {
  /** Has the history needed to reason at all. */
  eligible: boolean;
  intervalMonths: number;
  /** Days until due (negative = overdue); null when not eligible. */
  dueInDays: number | null;
  due: boolean;
  overdueDays: number;
  /** Plain-language reasons, e.g. "12 months since annual check-up". */
  reasons: string[];
  source: "rule-baseline";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function recommendRebooking(input: RebookingInput): RebookingRecommendation {
  const intervalMonths = serviceIntervalMonths(input.serviceType || "");
  const base: RebookingRecommendation = {
    eligible: false,
    intervalMonths,
    dueInDays: null,
    due: false,
    overdueDays: 0,
    reasons: [],
    source: "rule-baseline",
  };
  if (!input.lastJobDate) return base;

  const now = input.now ? new Date(input.now).getTime() : Date.now();
  const last = new Date(input.lastJobDate).getTime();
  if (!Number.isFinite(last)) return base;

  const intervalDays = Math.round(intervalMonths * 30.44);
  const dueAt = last + intervalDays * DAY_MS;
  const dueInDays = Math.ceil((dueAt - now) / DAY_MS);

  const eligible = true;
  const reasons: string[] = [];
  const serviceLabel = input.serviceType || "last service";
  const monthsSince = Math.max(0, Math.round((now - last) / DAY_MS / 30.44));
  reasons.push(`${intervalMonths} months is the typical interval for ${serviceLabel}; last service was ${monthsSince} month${monthsSince === 1 ? "" : "s"} ago.`);

  const overdueDays = dueInDays < 0 ? -dueInDays : 0;
  if (overdueDays > 0) {
    reasons.push(`${overdueDays} day${overdueDays === 1 ? "" : "s"} past the typical ${intervalMonths}-month interval.`);
  }

  return {
    eligible,
    intervalMonths,
    dueInDays,
    due: dueInDays <= CONTACT_WINDOW_DAYS,
    overdueDays,
    reasons,
    source: "rule-baseline",
  };
}

/** Gate for the learned model: requires real labeled history (ADR-0007). */
export function learnedModelGate(params: { customersWithHistory: number; customersWithOutcomeLabels: number }): {
  enabled: boolean;
  requiredHistory: number;
  note: string;
} {
  const requiredHistory = 50;
  const enabled =
    params.customersWithHistory >= requiredHistory && params.customersWithOutcomeLabels >= requiredHistory;
  return {
    enabled,
    requiredHistory,
    note: enabled
      ? "Learned rebooking model enabled (evaluated on real labeled history)."
      : `Learned model disabled: needs ${requiredHistory} customers with real service history and outcome labels; the rule baseline is shown instead.`,
  };
}
