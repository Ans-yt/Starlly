// Pure policy checker (spec §8, ticket 010). Plain reason strings for the UI.
export type PolicyRule = "gating" | "hidden_link" | "incentive" | "pressure" | "link_consistency";

export interface PolicyIssue {
  rule: PolicyRule;
  message: string;
  excerpt?: string;
}

export interface DraftPolicyInput {
  subject: string;
  body: string;
  /** The one canonical Google review link configured for the business. */
  googleReviewUrl?: string;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[0]);
}

/** Links that look like Google review links. */
function isGoogleReviewLink(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("google.com/maps") ||
    u.includes("search.google.com/local/writereview") ||
    u.includes("g.page") ||
    u.includes("goo.gl")
  );
}

const INCENTIVE_PATTERNS: { re: RegExp; message: string }[] = [
  {
    re: /\b(in exchange for|in return for)\b[^.!?]{0,80}\b(review|rating|stars)\b/i,
    message: "This draft offers something in exchange for a review, which is not allowed.",
  },
  {
    re: /\b(review|rating|stars)\b[^.!?]{0,80}\b(discount|voucher|gift card|free service|on us|credit)\b/i,
    message: "This draft offers something in exchange for a review, which is not allowed.",
  },
  {
    re: /\b(discount|voucher|gift card|free service|on us|credit)\b[^.!?]{0,80}\b(review|rating|stars)\b/i,
    message: "This draft offers something in exchange for a review, which is not allowed.",
  },
];

const PRESSURE_PATTERNS: { re: RegExp; message: string }[] = [
  {
    re: /\b(please )?(give|leave|rate|post)\b[^.!?]{0,30}\b(5|five)[- ]?star/i,
    message: "Pressure language: asking for a 5-star rating is not allowed.",
  },
  {
    re: /\b(5|five)[- ]?star (review|rating)s? (only|please)\b/i,
    message: "Pressure language: asking for a 5-star rating is not allowed.",
  },
];

const GATING_PATTERNS: { re: RegExp; message: string }[] = [
  {
    re: /\b(if you (are|'re|were) (happy|satisfied|pleased))\b[^.!?]{0,120}\b(link|review|google)\b/i,
    message: "Gating: the review link must be offered to every customer, not only happy ones.",
  },
  {
    re: /\b(after you (rate|rated)|once you('ve| have) (rated|scored))\b[^.!?]{0,120}\b(link|google)\b/i,
    message: "Gating: the Google link must not be delayed behind a rating.",
  },
  {
    re: /\b(less than|below|unless)\b[^.!?]{0,40}\b(stars?|rating)\b[^.!?]{0,60}\b(instead|don't send|no link|private)\b/i,
    message: "Gating: low ratings must not redirect customers away from the Google link.",
  },
];

function findExcerpt(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  if (!m || m.index === undefined) return undefined;
  return text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim();
}

export function checkDraftPolicy(input: DraftPolicyInput): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const text = `${input.subject}\n${input.body}`;

  for (const { re, message } of INCENTIVE_PATTERNS) {
    if (re.test(text)) issues.push({ rule: "incentive", message, excerpt: findExcerpt(text, re) });
  }
  for (const { re, message } of PRESSURE_PATTERNS) {
    if (re.test(text)) issues.push({ rule: "pressure", message, excerpt: findExcerpt(text, re) });
  }
  for (const { re, message } of GATING_PATTERNS) {
    if (re.test(text)) issues.push({ rule: "gating", message, excerpt: findExcerpt(text, re) });
  }

  // Link consistency: every Google-review-looking link in the draft must be the one canonical link.
  const urls = extractUrls(text).filter(isGoogleReviewLink);
  const distinct = new Set(urls.map((u) => u.replace(/[,.;]$/, "")));
  if (distinct.size > 1) {
    issues.push({
      rule: "link_consistency",
      message: "Multiple different Google review links found. Every customer must get the same link.",
    });
  }
  if (input.googleReviewUrl && distinct.size === 1) {
    const only = [...distinct][0];
    if (only !== input.googleReviewUrl) {
      issues.push({
        rule: "link_consistency",
        message: "The Google review link in this draft does not match the business's configured review link.",
        excerpt: only,
      });
    }
  }
  return issues;
}

/** Customer-page settings check: the Google button may never vary by rating (spec §5.2). */
export interface PageSettingsPolicyInput {
  hideGoogleLinkBelowRating?: number | null;
  delayGoogleLinkForLowRatings?: boolean;
  googleLinkByRating?: Record<string, string> | null;
}

export function checkPageSettings(input: PageSettingsPolicyInput): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (input.hideGoogleLinkBelowRating != null) {
    issues.push({
      rule: "hidden_link",
      message: `The Google link would be hidden below ${input.hideGoogleLinkBelowRating} stars. It must be visible for every rating.`,
    });
  }
  if (input.delayGoogleLinkForLowRatings) {
    issues.push({
      rule: "hidden_link",
      message: "The Google link must not be delayed for any rating.",
    });
  }
  if (input.googleLinkByRating) {
    const distinct = new Set(Object.values(input.googleLinkByRating));
    if (distinct.size > 1) {
      issues.push({
        rule: "link_consistency",
        message: "Different Google links per rating are not allowed. Every rating gets the same link.",
      });
    }
  }
  return issues;
}
