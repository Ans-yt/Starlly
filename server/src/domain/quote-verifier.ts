// Quote verifier (spec §7.4): every quoted review text must exist in the
// corpus. Insights whose quotes fail verification are dropped. Pure code.
// Matching is deliberately tolerant of formatting (whitespace runs, Unicode
// normalization) but not of altered words.

export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ") // collapse all whitespace runs (incl. NBSP, newlines)
    .trim()
    .toLowerCase();
}

export interface CorpusReview {
  id: string;
  text: string;
}

export interface QuoteVerification {
  quote: string;
  reviewId: string | null; // the claimed source review, if any
  verified: boolean;
}

/**
 * Verify one quote against the corpus. If reviewId is given, the quote must
 * appear in that review; otherwise it must appear in at least one review.
 */
export function verifyQuote(quote: string, corpus: CorpusReview[], reviewId?: string | null): QuoteVerification {
  const normalized = normalizeForQuote(quote);
  if (!normalized) return { quote, reviewId: reviewId ?? null, verified: false };

  const candidates = reviewId ? corpus.filter((r) => r.id === reviewId) : corpus;
  if (reviewId && candidates.length === 0) {
    return { quote, reviewId, verified: false }; // claimed review does not exist
  }
  const found = candidates.some((r) => normalizeForQuote(r.text).includes(normalized));
  return { quote, reviewId: reviewId ?? null, verified: found };
}

export interface QuoteCheckResult {
  allVerified: boolean;
  checks: QuoteVerification[];
  droppedCount: number;
}

/** Verify all quotes of an insight; unverified quotes are reported for dropping. */
export function verifyInsightQuotes(
  quotes: { reviewId?: string | null; quote: string }[],
  corpus: CorpusReview[],
): QuoteCheckResult {
  const checks = quotes.map((q) => verifyQuote(q.quote, corpus, q.reviewId));
  const droppedCount = checks.filter((c) => !c.verified).length;
  return { allVerified: droppedCount === 0, checks, droppedCount };
}
