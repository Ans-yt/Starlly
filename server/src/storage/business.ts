// Storage helpers for the single business row (GLOSSARY: Business).
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { business } from "../db/schema.js";
import { isBusinessProfileComplete, type ProfileInput } from "../domain/validation.js";
import type { SetupFacts } from "../domain/setup.js";

export type BusinessRow = typeof business.$inferSelect;
export type BusinessInsert = typeof business.$inferInsert;

export function getBusinessRow(db: AppDatabase): BusinessRow {
  const row = db.select().from(business).where(eq(business.id, 1)).get();
  if (row) return row;
  const now = new Date().toISOString();
  db.insert(business).values({ id: 1, createdAt: now, updatedAt: now }).run();
  return db.select().from(business).where(eq(business.id, 1)).get() as BusinessRow;
}

/** The editable profile fields as validation input (V1–V4). */
export function profileInputOf(row: BusinessRow, overrides: ProfileInput = {}): ProfileInput {
  return {
    name: overrides.name ?? row.name,
    ownerName: overrides.ownerName ?? row.ownerName,
    ownerEmail: overrides.ownerEmail ?? row.ownerEmail,
    city: overrides.city ?? row.city,
    googleReviewUrl: overrides.googleReviewUrl ?? row.googleReviewUrl,
    googleReviewUrlConfirmed: overrides.googleReviewUrlConfirmed ?? false,
    website: overrides.website ?? row.website,
    socialLinks: overrides.socialLinks ?? row.socialLinks,
  };
}

/** Is the stored business profile valid with no unconfirmed warnings? */
export function isStoredProfileComplete(row: BusinessRow): boolean {
  return isBusinessProfileComplete(profileInputOf(row));
}

/** Gather the stored facts the setup gate evaluates (server-side only). */
export function setupFactsOf(row: BusinessRow): SetupFacts {
  return {
    business: profileInputOf(row),
    businessComplete: isStoredProfileComplete(row),
    aiConfigured: Boolean(row.aiStyle || row.aiModel || row.aiApiKey),
    aiLastTestAt: row.aiLastTestAt ?? null,
    emailAdapterId: row.emailAdapterId || "copy-only",
    emailConfigured: Object.keys(row.emailConfig ?? {}).length > 0,
    emailLastTestAt: row.emailLastTestAt ?? null,
    placesMode: row.placesMode ?? null,
    placeId: row.placeId ?? null,
    placesLastTestAt: row.placesLastTestAt ?? null,
    testEmailSentAt: row.testEmailSentAt ?? null,
  };
}
