// Pure tagging math (ADR-0003). Similarity scores are NEVER probabilities —
// the UI labels them as similarity. Counts come from the tagger, not the LLM.
import type { Sentiment } from "../domain/types.js";

/** Cosine similarity above this → the review mentions the theme. Tunable. */
export const THEME_THRESHOLD = 0.4;
/** Best anchor similarity below this → neutral. Tunable. */
export const SENTIMENT_THRESHOLD = 0.3;

/** Anchor phrases for the sentiment classifier (separate from themes). */
export const SENTIMENT_ANCHORS: { label: Sentiment; text: string }[] = [
  {
    label: "positive",
    text: "Excellent happy satisfied wonderful great service, everything went perfectly, highly recommend",
  },
  {
    label: "neutral",
    text: "The service was carried out as expected, an ordinary routine visit, nothing unusual to report",
  },
  {
    label: "negative",
    text: "Terrible awful disappointed angry broken failed, a problem occurred, poor service, not satisfied",
  },
];

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  if (a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) throw new Error("Incompatible embedding vectors.");
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface ThemeVector {
  id: string;
  name: string;
  vector: number[];
}

/** Themes whose similarity clears the threshold; sorted best-first. */
export function tagThemes(
  reviewVector: number[],
  themes: ThemeVector[],
  threshold: number = THEME_THRESHOLD,
): { id: string; name: string; similarity: number }[] {
  return themes
    .map((t) => ({ id: t.id, name: t.name, similarity: cosineSimilarity(reviewVector, t.vector) }))
    .filter((t) => t.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

export interface SentimentVector {
  label: Sentiment;
  vector: number[];
}

/** Nearest anchor wins; below SENTIMENT_THRESHOLD → neutral. */
export function classifySentiment(
  reviewVector: number[],
  anchors: SentimentVector[],
  threshold: number = SENTIMENT_THRESHOLD,
): { label: Sentiment; similarity: number } {
  let best: { label: Sentiment; similarity: number } = { label: "neutral", similarity: -1 };
  for (const anchor of anchors) {
    const similarity = cosineSimilarity(reviewVector, anchor.vector);
    if (similarity > best.similarity) {
      best = { label: anchor.label, similarity };
    }
  }
  if (best.similarity < threshold) return { label: "neutral", similarity: best.similarity };
  return best;
}

/** The text whose embedding represents a theme. */
export function themeText(name: string, description: string): string {
  return description ? `${name}: ${description}` : name;
}
