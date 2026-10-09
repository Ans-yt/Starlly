// Tagger orchestration: embeds (cache-first) and tags untagged reviews with
// themes + sentiment. Counts stay in the DB, produced by the tagger (ADR-0003).
import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { embedCache, reviewThemes, reviews, themes } from "../db/schema.js";
import type { Sentiment } from "../domain/types.js";
import { embedCached } from "./embedder.js";
import { classifySentiment, SENTIMENT_ANCHORS, tagThemes, themeText } from "./tagging.js";

export class TaggerError extends Error {}

export interface TagRunResult {
  tagged: number;
  skipped: number;
  themeCount: number;
}

const now = () => new Date().toISOString();

/** Tag every review that has no theme rows yet (or no sentiment). Idempotent. */
export async function tagUntaggedReviews(db: AppDatabase): Promise<TagRunResult> {
  const themeRows = db.select().from(themes).all();
  if (themeRows.length === 0) {
    throw new TaggerError("No themes defined yet. Add themes before tagging reviews.");
  }
  const reviewRows = db.select().from(reviews).all();
  const taggedReviewIds = new Set(db.select().from(reviewThemes).all().map((rt) => rt.reviewId));
  const pending = reviewRows.filter((r) => !taggedReviewIds.has(r.id));
  if (pending.length === 0) {
    return { tagged: 0, skipped: 0, themeCount: themeRows.length };
  }

  // One embedding batch: theme descriptions, sentiment anchors, review texts.
  const themeTexts = themeRows.map((t) => themeText(t.name, t.description));
  const anchorTexts = SENTIMENT_ANCHORS.map((a) => a.text);
  const reviewTexts = pending.map((r) => r.text);
  const vectors = await embedCached(db, [...themeTexts, ...anchorTexts, ...reviewTexts]);

  const themeVectors = themeRows.map((t, i) => ({
    id: t.id,
    name: t.name,
    vector: vectors[i]!,
  }));
  const anchorVectors = SENTIMENT_ANCHORS.map((a, i) => ({
    label: a.label,
    vector: vectors[themeTexts.length + i]!,
  }));
  const reviewVectors = vectors.slice(themeTexts.length + anchorTexts.length);

  let tagged = 0;
  const ts = now();
  for (let i = 0; i < pending.length; i++) {
    const review = pending[i]!;
    const vector = reviewVectors[i]!;
    const matches = tagThemes(vector, themeVectors);
    const sentiment = classifySentiment(vector, anchorVectors);

    db.transaction((tx) => {
      for (const match of matches) {
        tx.insert(reviewThemes)
          .values({ reviewId: review.id, themeId: match.id, similarity: match.similarity })
          .onConflictDoNothing()
          .run();
      }
      tx.update(reviews)
        .set({
          sentiment: sentiment.label,
          // Similarity, NOT a calibrated probability (ADR-0003).
          sentimentConfidence: Math.round(sentiment.similarity * 1000) / 1000,
        })
        .where(eq(reviews.id, review.id))
        .run();
    });
    tagged++;
  }
  return { tagged, skipped: pending.length - tagged, themeCount: themeRows.length };
}

/** Re-tag: clears existing theme rows for the given reviews (owner action). */
export async function reTagReviews(db: AppDatabase, reviewIds: string[]): Promise<TagRunResult> {
  const rows = db.select().from(reviews).where(inArray(reviews.id, reviewIds)).all();
  db.delete(reviewThemes).where(inArray(reviewThemes.reviewId, reviewIds)).run();
  db.update(reviews).set({ sentiment: null, sentimentConfidence: null }).where(inArray(reviews.id, reviewIds)).run();
  void rows;
  return tagUntaggedReviews(db);
}

/** True when the local model environment is unusable (install hint in route). */
export function isTransformersMissingError(err: unknown): boolean {
  return err instanceof Error && /Cannot find package '@huggingface\/transformers'/.test(err.message);
}
