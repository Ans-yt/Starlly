// Trend alerts (spec §7.3): weekly rating averages and theme counts; a change
// is flagged when it exceeds a simple statistical threshold (z-score on weekly
// counts), with the numbers shown. Pure code.
export const PRIOR_WEEKS_REQUIRED = 3;
export const Z_THRESHOLD = 2;

export interface TrendAlert {
  kind: "theme_spike" | "rating_drop";
  text: string; // "Punctuality: 1 per week to 4 per week."
  numbers: Record<string, number | string>;
}

export interface ThemeSeries {
  themeId: string;
  themeName: string;
  /** Weekly counts, oldest window first. */
  counts: number[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Flag themes whose latest weekly count is an outlier vs the prior weeks.
 * "Weekly" = rolling 7-day windows; counts are oldest → newest.
 */
export function detectThemeSpikes(series: ThemeSeries[]): TrendAlert[] {
  const alerts: TrendAlert[] = [];
  for (const s of series) {
    if (s.counts.length < PRIOR_WEEKS_REQUIRED + 1) continue;
    const prior = s.counts.slice(0, -1);
    const last = s.counts[s.counts.length - 1]!;
    const m = Math.round(mean(prior) * 100) / 100;
    const sigma = std(prior);
    const isSpike = sigma === 0 ? last > m : last - m >= Z_THRESHOLD * sigma;
    // Require real volume, not a 0→1 blip.
    if (!isSpike || last < 2) continue;
    alerts.push({
      kind: "theme_spike",
      text: `${s.themeName}: ${m} per week to ${last} per week.`,
      numbers: { themeId: s.themeId, themeName: s.themeName, priorMean: m, latest: last },
    });
  }
  return alerts;
}

/** Flag a rating drop in the latest weekly average vs prior weeks. */
export function detectRatingDrop(averages: number[]): TrendAlert | null {
  if (averages.length < PRIOR_WEEKS_REQUIRED + 1) return null;
  const prior = averages.slice(0, -1).filter((a) => a > 0);
  const last = averages[averages.length - 1]!;
  if (prior.length < PRIOR_WEEKS_REQUIRED || last <= 0) return null;
  const m = Math.round(mean(prior) * 100) / 100;
  const sigma = std(prior);
  const isDrop = sigma === 0 ? m - last >= 0.5 : m - last >= Z_THRESHOLD * sigma;
  if (!isDrop) return null;
  return {
    kind: "rating_drop",
    text: `Average rating: ${m} to ${Math.round(last * 100) / 100}.`,
    numbers: { priorMean: m, latest: Math.round(last * 100) / 100 },
  };
}

/** Bucket a timestamp into a rolling-window index (0 = oldest window of `weeks`). */
export function windowIndexFor(dateIso: string, weeks: number, nowMs = Date.now()): number {
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return -1;
  const daysAgo = (nowMs - t) / (24 * 60 * 60 * 1000);
  const window = Math.floor((weeks * 7 - daysAgo) / 7); // 0 = oldest, weeks-1 = current
  if (window < 0 || window >= weeks) return -1;
  return window;
}
