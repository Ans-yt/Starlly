// Evaluation core (ADR-0007): theme tagging and sentiment evaluated separately;
// runs on versioned JSONL records; evaluation data is separate from app data.
import type { Sentiment } from "../domain/types.js";
import { classifySentiment, SENTIMENT_ANCHORS, tagThemes, themeText, type EmbedFn } from "./embedder-bridge.js";

export interface EvalTheme {
  id: string;
  name: string;
  description: string;
}

export interface EvalRecord {
  text: string;
  language?: string;
  themes: string[]; // theme NAMES, matched case-insensitively
  sentiment: Sentiment;
  provenance?: string;
}

export interface ThemeEvalRow {
  theme: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalReport {
  total: number;
  perTheme: ThemeEvalRow[];
  sentimentAccuracy: number;
  sentimentTotal: number;
  // Plain counts, reported honestly (spec §12).
  themeMisses: { text: string; expected: string[]; got: string[] }[];
  sentimentMisses: { text: string; expected: string; got: string }[];
}

export async function runEval(records: EvalRecord[], themes: EvalTheme[], embed: EmbedFn): Promise<EvalReport> {
  const themeTexts = themes.map((t) => themeText(t.name, t.description));
  const anchorTexts = SENTIMENT_ANCHORS.map((a) => a.text);
  const vectors = await embed([...themeTexts, ...anchorTexts, ...records.map((r) => r.text)]);

  const themeVectors = themes.map((t, i) => ({ id: t.id, name: t.name, vector: vectors[i]! }));
  const anchorVectors = SENTIMENT_ANCHORS.map((a, i) => ({
    label: a.label,
    vector: vectors[themeTexts.length + i]!,
  }));
  const reviewVectors = vectors.slice(themeTexts.length + anchorTexts.length);

  const stats = new Map<string, { tp: number; fp: number; fn: number }>(
    themes.map((t) => [t.name.toLowerCase(), { tp: 0, fp: 0, fn: 0 }]),
  );
  const themeMisses: EvalReport["themeMisses"] = [];
  const sentimentMisses: EvalReport["sentimentMisses"] = [];
  let sentimentCorrect = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const matches = tagThemes(reviewVectors[i]!, themeVectors);
    const got = matches.map((m) => m.name.toLowerCase());
    const expected = record.themes.map((t) => t.toLowerCase());

    for (const theme of got) {
      const stat = stats.get(theme);
      if (stat) {
        if (expected.includes(theme)) stat.tp++;
        else stat.fp++;
      }
    }
    for (const theme of expected) {
      const stat = stats.get(theme);
      if (stat && !got.includes(theme)) stat.fn++;
    }
    if (got.length !== expected.length || got.some((g) => !expected.includes(g))) {
      themeMisses.push({ text: record.text.slice(0, 80), expected: record.themes, got: matches.map((m) => m.name) });
    }

    const sentiment = classifySentiment(reviewVectors[i]!, anchorVectors);
    if (sentiment.label === record.sentiment) sentimentCorrect++;
    else sentimentMisses.push({ text: record.text.slice(0, 80), expected: record.sentiment, got: sentiment.label });
  }

  const perTheme: ThemeEvalRow[] = [...stats.entries()].map(([theme, { tp, fp, fn }]) => {
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    return {
      theme,
      tp,
      fp,
      fn,
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1: precision + recall === 0 ? 0 : Math.round((2 * precision * recall) / (precision + recall) * 100) / 100,
    };
  });

  return {
    total: records.length,
    perTheme,
    sentimentAccuracy: records.length === 0 ? 0 : Math.round((sentimentCorrect / records.length) * 100) / 100,
    sentimentTotal: records.length,
    themeMisses,
    sentimentMisses,
  };
}
