// Business profile + settings routes. Secrets are masked on read (AGENTS rule)
// and never appear in logs or error messages.
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { business, customers, reviews } from "../../db/schema.js";
import { getBusinessRow, profileInputOf } from "../../storage/business.js";
import { validateBusinessProfile } from "../../domain/validation.js";
import { listEmailAdapters, getEmailAdapter } from "../../adapters/email/registry.js";
import { resolveEmailSettings } from "../../adapters/email/resolve.js";
import { resolveAiSettings } from "../../adapters/ai/registry.js";
import { sanitizeAiErrorText } from "../../adapters/ai/types.js";

/** Mask a secret for display: presence + last 4 characters only. */
export function maskSecret(value: string | null | undefined): { set: boolean; masked: string } {
  if (!value) return { set: false, masked: "" };
  const tail = value.length > 8 ? value.slice(-4) : "";
  return { set: true, masked: `••••••••${tail}` };
}

function maskedAdapterConfig(adapterId: string, config: Record<string, string>) {
  const adapter = getEmailAdapter(adapterId);
  const out: Record<string, { set: boolean; masked: string }> = {};
  for (const field of adapter?.configFields ?? []) {
    out[field.key] = maskSecret(config[field.key]);
  }
  return out;
}

export function businessRouter(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  const businessPut = z.object({
    name: z.string().optional(),
    ownerName: z.string().optional(),
    ownerEmail: z.string().optional(),
    city: z.string().optional(),
    sinceDate: z.string().nullable().optional(),
    googleReviewUrl: z.string().optional(),
    /** Owner confirmed an unrecognized-but-inspected Google link shape. */
    googleReviewUrlConfirmed: z.boolean().optional(),
    website: z.string().optional(),
    socialLinks: z.record(z.string()).optional(),
    fieldSources: z.record(z.enum(["typed", "file", "web"])).optional(),
    profileFields: z
      .array(z.object({ key: z.string(), value: z.string(), source: z.enum(["typed", "file", "web"]) }))
      .optional(),
    placeId: z.string().nullable().optional(),
    googleRating: z.number().nullable().optional(),
    googleReviewCount: z.number().nullable().optional(),
    isSample: z.boolean().optional(),
  });

  router.get("/business", (_req, res) => {
    const row = getBusinessRow(db);
    res.json({
      name: row.name,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      city: row.city,
      sinceDate: row.sinceDate,
      googleReviewUrl: row.googleReviewUrl,
      website: row.website,
      socialLinks: row.socialLinks,
      fieldSources: row.fieldSources,
      profileFields: row.profileFields,
      placeId: row.placeId,
      googleRating: row.googleRating,
      googleReviewCount: row.googleReviewCount,
      isSample: row.isSample,
    });
  });

  router.put("/business", (req, res) => {
    const parsed = businessPut.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    // Server re-validates the MERGED profile — the client is never trusted (V5).
    const current = getBusinessRow(db);
    const merged = profileInputOf(current, {
      name: parsed.data.name,
      ownerName: parsed.data.ownerName,
      ownerEmail: parsed.data.ownerEmail,
      city: parsed.data.city,
      googleReviewUrl: parsed.data.googleReviewUrl,
      googleReviewUrlConfirmed: parsed.data.googleReviewUrlConfirmed,
      website: parsed.data.website,
      socialLinks: parsed.data.socialLinks,
    });
    const { fieldErrors, fieldWarnings } = validateBusinessProfile(merged);
    if (Object.keys(fieldErrors).length > 0 || Object.keys(fieldWarnings).length > 0) {
      res.status(400).json({
        error: "validation",
        fieldErrors,
        fieldWarnings,
        message: Object.values(fieldErrors)[0] ?? Object.values(fieldWarnings)[0],
      });
      return;
    }
    const { googleReviewUrlConfirmed: _confirmed, ...patchData } = parsed.data;
    db.update(business)
      .set({ ...patchData, updatedAt: new Date().toISOString() })
      .where(eq(business.id, 1))
      .run();
    res.json({ ok: true });
  });

  router.get("/settings", (_req, res) => {
    const row = getBusinessRow(db);
    const { adapterId, config } = resolveEmailSettings(row);
    // sampleLoaded mirrors the dashboard's derivation (sample rows anywhere).
    const sampleLoaded =
      row.isSample ||
      db.select({ isSample: customers.isSample }).from(customers).all().some((c) => c.isSample) ||
      db.select({ isSample: reviews.isSample }).from(reviews).all().some((r) => r.isSample);
    res.json({
      emailAdapterId: row.emailAdapterId,
      emailAdapters: listEmailAdapters(),
      emailConfig: maskedAdapterConfig(adapterId, config),
      emailLastTestAt: row.emailLastTestAt ?? null,
      aiLastTestAt: row.aiLastTestAt ?? null,
      aiStyle: row.aiStyle,
      aiBaseUrl: row.aiBaseUrl,
      aiModel: row.aiModel,
      aiApiKey: maskSecret(row.aiApiKey),
      exaApiKey: maskSecret(row.exaApiKey),
      googlePlacesApiKey: maskSecret(row.googlePlacesApiKey),
      publicBaseUrl: services.config.publicBaseUrl ?? null,
      sampleLoaded,
    });
  });

  const settingsPut = z.object({
    emailAdapterId: z.string().optional(),
    // Secret convention: missing key => unchanged; empty string => clear; value => set.
    emailConfig: z.record(z.string()).optional(),
    aiStyle: z.enum(["anthropic", "openai"]).nullable().optional(),
    aiBaseUrl: z.string().optional(),
    aiModel: z.string().optional(),
    aiApiKey: z.string().optional(),
    exaApiKey: z.string().optional(),
    googlePlacesApiKey: z.string().optional(),
  });

  router.put("/settings", (req, res) => {
    const parsed = settingsPut.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const row = getBusinessRow(db);
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (data.emailAdapterId !== undefined) {
      if (data.emailAdapterId !== "copy-only" && !getEmailAdapter(data.emailAdapterId)) {
        res.status(400).json({ error: "validation", message: "Unknown email adapter." });
        return;
      }
      patch.emailAdapterId = data.emailAdapterId;
    }
    if (data.emailConfig !== undefined) {
      const merged: Record<string, string> = { ...row.emailConfig };
      for (const [key, value] of Object.entries(data.emailConfig)) {
        if (value === "") delete merged[key];
        else merged[key] = value;
      }
      patch.emailConfig = merged;
    }
    const aiChanged = (data.aiStyle !== undefined && data.aiStyle !== row.aiStyle)
      || (data.aiBaseUrl !== undefined && data.aiBaseUrl !== row.aiBaseUrl)
      || (data.aiModel !== undefined && data.aiModel !== row.aiModel)
      || (data.aiApiKey !== undefined && data.aiApiKey !== row.aiApiKey);
    if (aiChanged) patch.aiLastTestAt = null;
    if (data.aiStyle !== undefined) patch.aiStyle = data.aiStyle ?? null;
    if (data.aiBaseUrl !== undefined) patch.aiBaseUrl = data.aiBaseUrl;
    if (data.aiModel !== undefined) patch.aiModel = data.aiModel;
    if (data.aiApiKey !== undefined) patch.aiApiKey = data.aiApiKey; // "" clears
    if (data.exaApiKey !== undefined) patch.exaApiKey = data.exaApiKey;
    if (data.googlePlacesApiKey !== undefined) patch.googlePlacesApiKey = data.googlePlacesApiKey;

    db.update(business).set(patch).where(eq(business.id, 1)).run();
    res.json({ ok: true });
  });

  router.post("/settings/test-email", async (_req, res) => {
    const row = getBusinessRow(db);
    const { adapterId, config } = resolveEmailSettings(row);
    const adapter = getEmailAdapter(adapterId);
    if (!adapter) {
      res
        .status(400)
        .json({ ok: false, error: { kind: "validation", message: "Unknown email adapter.", retryable: false } });
      return;
    }
    const missing = adapter.configFields.filter((f) => f.required && !config[f.key]).map((f) => f.label);
    if (missing.length > 0) {
      res.json({
        ok: false,
        error: { kind: "validation", message: `Missing: ${missing.join(", ")}`, retryable: false },
      });
      return;
    }
    try {
      const result = await adapter.test(config);
      // Only a PASSING test records "Connected" (S5): the timestamp is what
      // the dashboard's "Email connected ✓" badge and the gate chip derive from.
      if (result.ok) {
        db.update(business)
          .set({ emailLastTestAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          .where(eq(business.id, 1))
          .run();
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      res.json({ ok: false, error: { kind: "temporary", message, retryable: true } });
    }
  });

  router.post("/settings/test-ai", async (_req, res) => {
    const row = getBusinessRow(db);
    const resolved = resolveAiSettings(row);
    if (!resolved) {
      db.update(business).set({ aiLastTestAt: null }).where(eq(business.id, 1)).run();
      res.status(400).json({
        ok: false,
        error: { kind: "validation", message: "AI provider not configured — style, model, and key are required.", retryable: false },
      });
      return;
    }
    try {
      const result = await resolved.adapter.test(resolved.config);
      db.update(business)
        .set({ aiLastTestAt: result.ok ? new Date().toISOString() : null, updatedAt: new Date().toISOString() })
        .where(eq(business.id, 1))
        .run();
      res.json(result);
    } catch (err) {
      db.update(business).set({ aiLastTestAt: null }).where(eq(business.id, 1)).run();
      const message = sanitizeAiErrorText(err instanceof Error ? err.message : "Network error");
      res.json({ ok: false, error: { kind: "temporary", message, retryable: true } });
    }
  });

  // ── Google Places (gate step 4 / Settings): lookup + "Is this you?" confirm ──
  router.post("/settings/places-lookup", async (req, res) => {
    const row = getBusinessRow(db);
    const key = row.googlePlacesApiKey || "";
    if (!key) {
      res.status(400).json({ ok: false, error: { kind: "validation", message: "Paste your Google Places API key first." } });
      return;
    }
    const query = typeof req.body?.query === "string" && req.body.query.trim()
      ? req.body.query.trim()
      : [row.name, row.city].filter(Boolean).join(" ");
    if (!query) {
      res.status(400).json({ ok: false, error: { kind: "validation", message: "Nothing to search for — set your business name first." } });
      return;
    }
    try {
      // Places API (New) Text Search. Server-side only; the key never leaves the backend.
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 3 }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        const message = body?.error?.message ?? `Places lookup failed (HTTP ${response.status}).`;
        res.json({ ok: false, error: { kind: "temporary", message } });
        return;
      }
      const data = (await response.json()) as {
        places?: { id: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }[];
      };
      const places = (data.places ?? []).map((p) => ({
        placeId: p.id,
        name: p.displayName?.text ?? "",
        address: p.formattedAddress ?? "",
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
      }));
      res.json({ ok: true, places });
    } catch (err) {
      res.json({ ok: false, error: { kind: "temporary", message: err instanceof Error ? err.message : "Network error" } });
    }
  });

  // "Is this you?" confirm: re-resolves the chosen place server-side and stores
  // its listing stats. Never trusts client-supplied rating numbers.
  router.post("/settings/places-confirm", async (req, res) => {
    const row = getBusinessRow(db);
    const key = row.googlePlacesApiKey || "";
    const placeId = typeof req.body?.placeId === "string" ? req.body.placeId : "";
    if (!key || !placeId) {
      res.status(400).json({ ok: false, error: { kind: "validation", message: "A Places API key and a place are required." } });
      return;
    }
    try {
      const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,rating,userRatingCount",
        },
      });
      if (!response.ok) {
        const message = `Places lookup failed (HTTP ${response.status}).`;
        res.json({ ok: false, error: { kind: "temporary", message } });
        return;
      }
      const p = (await response.json()) as {
        id: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
      };
      const ts = new Date().toISOString();
      db.update(business)
        .set({
          placeId: p.id,
          googleRating: typeof p.rating === "number" ? p.rating : null,
          googleReviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          placesLastTestAt: ts,
          placesMode: "places",
          updatedAt: ts,
        })
        .where(eq(business.id, 1))
        .run();
      res.json({
        ok: true,
        place: {
          placeId: p.id,
          name: p.displayName?.text ?? "",
          address: p.formattedAddress ?? "",
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? null,
        },
      });
    } catch (err) {
      res.json({ ok: false, error: { kind: "temporary", message: err instanceof Error ? err.message : "Network error" } });
    }
  });

  return router;
}
