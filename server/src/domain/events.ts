export type EventType =
  | "opened"
  | "rated"
  | "google_click"
  | "feedback_submitted"
  | "call_requested";

export interface EventRecord {
  requestId: string;
  type: EventType;
  value?: string | null;
  createdAt: string;
}

export const RATING_VALUES = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATING_VALUES)[number];

export function isValidRating(value: unknown): value is Rating {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (RATING_VALUES as readonly number[]).includes(value)
  );
}

/** Low ratings add extra options beside the Google link — never instead of it (spec §5.2). */
export function isLowRating(rating: Rating): boolean {
  return rating <= 3;
}
