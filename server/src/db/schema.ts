import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { EmailDesign } from "../email/design.js";
import type { FieldSourceMap, ProfileField } from "../domain/types.js";

/** Single-business app: this row always has id = 1 (GLOSSARY: Business). */
export const business = sqliteTable("business", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default(""),
  ownerName: text("owner_name").notNull().default(""),
  ownerEmail: text("owner_email").notNull().default(""),
  city: text("city").notNull().default(""),
  sinceDate: text("since_date"),
  googleReviewUrl: text("google_review_url").notNull().default(""),
  website: text("website").notNull().default(""),
  socialLinks: text("social_links", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  // Per-field provenance (spec 4.2: typed | file | web)
  fieldSources: text("field_sources", { mode: "json" })
    .$type<FieldSourceMap>()
    .notNull()
    .default({}),
  profileFields: text("profile_fields", { mode: "json" })
    .$type<ProfileField[]>()
    .notNull()
    .default([]),
  // Google listing stats — separate columns, never blended into corpus statistics (ADR-0001)
  placeId: text("place_id"),
  googleRating: real("google_rating"),
  googleReviewCount: integer("google_review_count"),
  // Settings (masked on read; secrets never returned to the frontend)
  emailAdapterId: text("email_adapter_id").notNull().default("copy-only"),
  emailConfig: text("email_config", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  aiStyle: text("ai_style"), // 'anthropic' | 'openai'
  aiBaseUrl: text("ai_base_url"),
  aiModel: text("ai_model"),
  aiApiKey: text("ai_api_key"),
  exaApiKey: text("exa_api_key"),
  googlePlacesApiKey: text("google_places_api_key"),
  // Setup gate (spec §4.2): completion flag + last PASSING test per item.
  // Only a passing test writes these timestamps; "Connected" is derived from them.
  setupCompletedAt: text("setup_completed_at"),
  aiLastTestAt: text("ai_last_test_at"),
  emailLastTestAt: text("email_last_test_at"),
  placesLastTestAt: text("places_last_test_at"),
  /** 'places' (key + confirmed lookup) or 'import' ("I'll paste or import my reviews instead"). */
  placesMode: text("places_mode"),
  /** Last accepted test send to the owner (gate step 6). */
  testEmailSentAt: text("test_email_sent_at"),
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  serviceType: text("service_type").notNull().default(""),
  lastJobDate: text("last_job_date"),
  consent: integer("consent", { mode: "boolean" }).notNull().default(false),
  consentAt: text("consent_at"),
  status: text("status").notNull().default("active"), // CustomerStatus
  /** "Mark resolved" on the needs-a-call list; re-qualifying events after this re-open it. */
  callResolvedAt: text("call_resolved_at"),
  /** Owner snoozed the rebooking recommendation until this date. */
  rebookingSnoozedUntil: text("rebooking_snoozed_until"),
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** A review request: one outbound ask + one unique customer-page token (GLOSSARY). */
export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    draftId: text("draft_id"),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"), // pending | sent
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    sentAt: text("sent_at"),
    isSample: integer("is_sample", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("requests_token_idx").on(t.token),
    index("requests_customer_idx").on(t.customerId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id),
    type: text("type").notNull(), // EventType
    value: text("value"), // e.g. "4" for rated
    isSample: integer("is_sample", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("events_request_idx").on(t.requestId),
    index("events_type_idx").on(t.type),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(), // ReviewSource
    author: text("author").notNull().default(""),
    rating: integer("rating"),
    reviewDate: text("review_date"),
    text: text("text").notNull(),
    requestId: text("request_id"), // links private feedback to its request
    sentiment: text("sentiment"),
    taggingVersion: text("tagging_version"),
    sentimentConfidence: real("sentiment_confidence"),
    replied: integer("replied", { mode: "boolean" }).notNull().default(false),
    isSample: integer("is_sample", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("reviews_source_idx").on(t.source)],
);

/** Owner-curated theme list (GLOSSARY: Theme); LLM may propose, owner edits. */
export const themes = sqliteTable("themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const reviewThemes = sqliteTable(
  "review_themes",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id),
    themeId: text("theme_id")
      .notNull()
      .references(() => themes.id),
    similarity: real("similarity"),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.themeId] })],
);

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // DraftKind
  customerId: text("customer_id"),
  requestId: text("request_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  emailDesign: text("email_design", { mode: "json" }).$type<EmailDesign>(),
  status: text("status").notNull().default("draft"), // DraftStatus
  approvedAt: text("approved_at"),
  /** Hash of subject+body at approval time; mismatch on edit invalidates approval. */
  contentHash: text("content_hash").notNull().default(""),
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Persisted before any provider call (ADR-0004); guarantees no duplicate sends. */
export const sendJobs = sqliteTable(
  "send_jobs",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id),
    to: text("to").notNull(),
    provider: text("provider").notNull(),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    /** Same key reused across retries of this job — providers dedupe on it (both verified). */
    idempotencyKey: text("idempotency_key"),
    providerMessageId: text("provider_message_id"),
    payloadHash: text("payload_hash"),
    status: text("status").notNull().default("queued"), // SendJobStatus
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // At most one real send and one test send per draft.
  (t) => [uniqueIndex("send_jobs_draft_test_idx").on(t.draftId, t.isTest)],
);

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  kind: text("kind").notNull().default("call_outcome"),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Owner login (single user). Row id = 1 created at setup; absent => first-run setup mode. */
export const appAuth = sqliteTable("app_auth", {
  id: integer("id").primaryKey().default(1),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  sessionSecret: text("session_secret").notNull(),
  createdAt: text("created_at").notNull(),
});

/** LLM theme summaries — quotes verified before persisting (spec §7.4). */
export const insightSummaries = sqliteTable("insight_summaries", {
  id: text("id").primaryKey(),
  themeId: text("theme_id")
    .notNull()
    .references(() => themes.id),
  summary: text("summary").notNull(),
  quotes: text("quotes", { mode: "json" })
    .$type<{ reviewId: string; quote: string }[]>()
    .notNull(),
  droppedQuotes: integer("dropped_quotes").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

/** Embedding cache keyed by sha256(text) — ADR-0003. */
export const embedCache = sqliteTable("embed_cache", {
  hash: text("hash").primaryKey(),
  vector: text("vector", { mode: "json" }).$type<number[]>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const emailAssets = sqliteTable("email_assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  data: text("data").notNull(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: text("created_at").notNull(),
});
export const emailLayouts = sqliteTable("email_layouts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  design: text("design", { mode: "json" }).$type<EmailDesign>().notNull(),
  createdAt: text("created_at").notNull(),
});
