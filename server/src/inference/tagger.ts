// Tagger orchestration: embeds (cache-first) and tags untagged reviews with
// themes + sentiment. Counts stay in the DB, produced by the tagger (ADR-0003).
import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  insightSummaries,
  embedCache,
  reviewThemes,
  reviews,
  themes,
} from "../db/schema.js";
import type { Sentiment } from "../domain/types.js";
import { embedCached, sha256, EMBEDDING_VERSION } from "./embedder.js";
import {
  classifySentiment,
  SENTIMENT_ANCHORS,
  tagThemes,
  themeText,
} from "./tagging.js";

export class TaggerError extends Error {}

export interface TagRunResult {
  tagged: number;
  skipped: number;
  themeCount: number;
}

const now = () => new Date().toISOString();
function themeVersion(
  rows: { id: string; name: string; description: string }[],
): string {
  return sha256(
    EMBEDDING_VERSION +
      JSON.stringify(
        rows
          .map((t) => [t.id, t.name, t.description])
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
  );
}

/** Tag every review that has no theme rows yet (or no sentiment). Idempotent. */
export async function tagUntaggedReviews(
  db: AppDatabase,
  forceIds?: string[],
): Promise<TagRunResult> {
  const themeRows = db.select().from(themes).all();
  if (themeRows.length === 0) {
    throw new TaggerError(
      "No themes defined yet. Add themes before tagging reviews.",
    );
  }
  const reviewRows = db.select().from(reviews).all();
  const version = themeVersion(themeRows);
  const pending = reviewRows.filter((r) =>
    forceIds ? forceIds.includes(r.id) : r.taggingVersion !== version,
  );
  if (pending.length === 0) {
    return { tagged: 0, skipped: 0, themeCount: themeRows.length };
  }

  // One embedding batch: theme descriptions, sentiment anchors, review texts.
  const themeTexts = themeRows.map((t) => themeText(t.name, t.description));
  const anchorTexts = SENTIMENT_ANCHORS.map((a) => a.text);
  const reviewTexts = pending.map((r) => r.text);
  const vectors = await embedCached(db, [
    ...themeTexts,
    ...anchorTexts,
    ...reviewTexts,
  ]);

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

  if (themeVersion(db.select().from(themes).all()) !== version)
    throw new TaggerError(
      "Themes changed while tagging. Please run tagging again.",
    );
  let tagged = 0;
  const ts = now();
  for (let i = 0; i < pending.length; i++) {
    const review = pending[i]!;
    const vector = reviewVectors[i]!;
    const matches = tagThemes(vector, themeVectors);
    const sentiment = classifySentiment(vector, anchorVectors);

    db.transaction((tx) => {
      tx.delete(insightSummaries).run();
      tx.delete(reviewThemes).where(eq(reviewThemes.reviewId, review.id)).run();
      for (const match of matches) {
        tx.insert(reviewThemes)
          .values({
            reviewId: review.id,
            themeId: match.id,
            similarity: match.similarity,
          })
          .onConflictDoNothing()
          .run();
      }
      tx.update(reviews)
        .set({
          sentiment: sentiment.label,
          taggingVersion: version,
          // Similarity, NOT a calibrated probability (ADR-0003).
          sentimentConfidence: Math.round(sentiment.similarity * 1000) / 1000,
        })
        .where(eq(reviews.id, review.id))
        .run();
    });
    tagged++;
  }
  return {
    tagged,
    skipped: pending.length - tagged,
    themeCount: themeRows.length,
  };
}

/** Re-tag: clears existing theme rows for the given reviews (owner action). */
export async function reTagReviews(
  db: AppDatabase,
  reviewIds: string[],
): Promise<TagRunResult> {
  if (!reviewIds.length)
    return {
      tagged: 0,
      skipped: 0,
      themeCount: db.select().from(themes).all().length,
    };
  return tagUntaggedReviews(db, reviewIds);
}

/** True when the local model environment is unusable (install hint in route). */
export function isTransformersMissingError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Cannot find package '@huggingface\/transformers'/.test(err.message)
  );
}
