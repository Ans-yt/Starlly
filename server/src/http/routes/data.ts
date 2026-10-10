import { designSchema } from "../../email/design.js";
import sharp from "sharp";
import { asyncRouter } from "../async-router.js";
// Backup/export/import + Delete my data (tickets 019/002, ADR-0001).
// Export is a JSON snapshot of every table; import validates and restores.
// Delete wipes all business data — owner auth is kept so the owner can still log in.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { getBusinessRow } from "../../storage/business.js";
import { loadSampleData, unloadSampleData } from "../../db/seed/load-sample.js";
import {
  business,
  emailAssets,
  emailLayouts,
  customers,
  requests,
  events,
  reviews,
  themes,
  reviewThemes,
  drafts,
  sendJobs,
  notes,
  embedCache,
  insightSummaries,
} from "../../db/schema.js";

function portableBusiness(
  row: ReturnType<typeof getBusinessRow>,
): Record<string, unknown> {
  const fields = [
    "name",
    "ownerName",
    "ownerEmail",
    "city",
    "sinceDate",
    "googleReviewUrl",
    "website",
    "socialLinks",
    "fieldSources",
    "profileFields",
    "placeId",
    "googleRating",
    "googleReviewCount",
    "isSample",
  ] as const;
  return Object.fromEntries(fields.map((key) => [key, row[key]]));
}

const SNAPSHOT_VERSION = 1;

// Data tables in dependency order for import (parents before children).
const DATA_TABLES = {
  emailAssets,
  emailLayouts,
  customers,
  requests,
  events,
  reviews,
  themes,
  reviewThemes,
  drafts,
  sendJobs,
  notes,
  insightSummaries,
} as const;

type DataTable = (typeof DATA_TABLES)[keyof typeof DATA_TABLES];

function applySnapshot(
  db: AppServices["db"],
  snapshot: {
    business?: Record<string, unknown>;
    tables: Record<string, unknown[]>;
  },
): void {
  // requests.draftId → drafts AND drafts.requestId → requests form a cycle;
  // SQLite cannot insert that shape row-by-row with FKs on, so enforcement is
  // deferred for the restore and a foreign_key_check runs inside the transaction.
  db.run(sql.raw("PRAGMA foreign_keys = OFF"));
  try {
    db.transaction((tx) => {
      const order: DataTable[] = [
        DATA_TABLES.insightSummaries,
        DATA_TABLES.notes,
        DATA_TABLES.sendJobs,
        DATA_TABLES.drafts,
        DATA_TABLES.reviewThemes,
        DATA_TABLES.themes,
        DATA_TABLES.reviews,
        DATA_TABLES.events,
        DATA_TABLES.requests,
        DATA_TABLES.customers,
        DATA_TABLES.emailLayouts,
        DATA_TABLES.emailAssets,
      ];
      for (const table of order) tx.delete(table).run();
      tx.delete(embedCache).run();
      if (snapshot.business) {
        const b = snapshot.business;
        tx.update(business)
          .set({
            name: String(b.name ?? ""),
            ownerName: String(b.ownerName ?? ""),
            ownerEmail: String(b.ownerEmail ?? ""),
            city: String(b.city ?? ""),
            sinceDate: b.sinceDate != null ? String(b.sinceDate) : null,
            googleReviewUrl: String(b.googleReviewUrl ?? ""),
            website: String(b.website ?? ""),
            socialLinks: (b.socialLinks as never) ?? {},
            fieldSources: (b.fieldSources as never) ?? {},
            profileFields: (b.profileFields as never) ?? [],
            placeId: b.placeId != null ? String(b.placeId) : null,
            googleRating:
              b.googleRating != null ? Number(b.googleRating) : null,
            googleReviewCount:
              b.googleReviewCount != null ? Number(b.googleReviewCount) : null,
            isSample: Boolean(b.isSample),
            updatedAt: new Date().toISOString(),
          })
          .run();
      }
      const insertOrder: [string, DataTable][] = [
        ["emailAssets", DATA_TABLES.emailAssets],
        ["emailLayouts", DATA_TABLES.emailLayouts],
        ["customers", DATA_TABLES.customers],
        ["requests", DATA_TABLES.requests],
        ["drafts", DATA_TABLES.drafts],
        ["sendJobs", DATA_TABLES.sendJobs],
        ["events", DATA_TABLES.events],
        ["reviews", DATA_TABLES.reviews],
        ["themes", DATA_TABLES.themes],
        ["reviewThemes", DATA_TABLES.reviewThemes],
        ["notes", DATA_TABLES.notes],
        ["insightSummaries", DATA_TABLES.insightSummaries],
      ];
      for (const [name, table] of insertOrder) {
        const rows = snapshot.tables[name];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          tx.insert(table)
            .values(row as never)
            .run();
        }
      }
      // Integrity gate: rollback if the snapshot would violate referential integrity.
      const violations = tx.all(sql.raw("PRAGMA foreign_key_check"));
      if (violations.length > 0) {
        throw new Error(
          "Snapshot violates referential integrity — restore aborted.",
        );
      }
    });
  } finally {
    db.run(sql.raw("PRAGMA foreign_keys = ON"));
  }
}

export function dataRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  router.get("/data/export", (_req, res) => {
    const businessRow = getBusinessRow(db);
    const tables: Record<string, unknown[]> = {};
    for (const [name, table] of Object.entries(DATA_TABLES)) {
      tables[name] = db
        .select()
        .from(table as DataTable)
        .all();
    }
    res.json({
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      business: portableBusiness(businessRow),
      tables,
    });
  });

  router.post("/data/import", async (req, res) => {
    const parsed = z
      .object({
        version: z.literal(SNAPSHOT_VERSION),
        business: z.record(z.unknown()).optional(),
        tables: z.record(z.unknown()),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation",
        message: `Snapshot must be version ${SNAPSHOT_VERSION} from /api/data/export.`,
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const tables = parsed.data.tables;
      for (const row of [
        ...(Array.isArray(tables.drafts) ? tables.drafts : []),
        ...(Array.isArray(tables.emailLayouts) ? tables.emailLayouts : []),
      ] as Record<string, unknown>[]) {
        const design = row.emailDesign ?? row.design;
        if (design != null) designSchema.parse(design);
      }
      const assets = Array.isArray(tables.emailAssets)
        ? (tables.emailAssets as Record<string, unknown>[])
        : [];
      if (assets.length > 40)
        throw Error("The asset library holds at most 40 images.");
      for (const a of assets) {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(String(a.mime)) ||
          typeof a.data !== "string" ||
          a.data.length > 1450000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) ||
          !/^[A-Za-z0-9_-]{32}$/.test(String(a.token))
        )
          throw Error("Invalid image asset in this backup.");
        const bytes = Buffer.from(a.data, "base64"),
          meta = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
        if (
          bytes.length > 1048576 ||
          !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
          !meta.width ||
          !meta.height ||
          meta.width > 4096 ||
          meta.height > 4096 ||
          (meta.pages ?? 1) > 1
        )
          throw Error("Invalid image dimensions or format in this backup.");
      }
      applySnapshot(db, {
        business: parsed.data.business as Record<string, unknown> | undefined,
        tables: parsed.data.tables as Record<string, unknown[]>,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: "import_failed",
        message: err instanceof Error ? err.message : "Import failed.",
      });
    }
  });

  router.post("/data/delete", (_req, res) => {
    const order: DataTable[] = [
      DATA_TABLES.insightSummaries,
      DATA_TABLES.notes,
      DATA_TABLES.sendJobs,
      DATA_TABLES.drafts,
      DATA_TABLES.reviewThemes,
      DATA_TABLES.themes,
      DATA_TABLES.reviews,
      DATA_TABLES.events,
      DATA_TABLES.requests,
      DATA_TABLES.customers,
    ];
    db.transaction((tx) => {
      for (const table of order) tx.delete(table).run();
      tx.delete(embedCache).run();
      // Reset the business profile but keep provider settings and owner login.
      tx.delete(emailLayouts).run();
      tx.delete(emailAssets).run();
      tx.update(business)
        .set({
          name: "",
          ownerName: "",
          ownerEmail: "",
          city: "",
          sinceDate: null,
          googleReviewUrl: "",
          website: "",
          socialLinks: {},
          fieldSources: {},
          profileFields: [],
          placeId: null,
          googleRating: null,
          googleReviewCount: null,
          isSample: false,
          updatedAt: new Date().toISOString(),
        })
        .run();
    });
    res.json({ ok: true });
  });

  // ── Sample data (ticket 020): isolated load/unload, flagged isSample ──────
  // A pre-load snapshot (only when real data exists) lets Remove demo data
  // restore the exact previous state (spec §11).
  const snapshotPath = () =>
    path.join(services.config.dataDir, "sample-restore.json");

  const countReal = () => ({
    customers: db
      .select()
      .from(customers)
      .all()
      .filter((c) => !c.isSample).length,
    reviews: db
      .select()
      .from(reviews)
      .all()
      .filter((r) => !r.isSample).length,
  });

  router.post("/sample-data/load", (req, res) => {
    const parsed = z
      .object({
        data: z.record(z.unknown()),
        confirmOverwrite: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation",
        message: "Body must be { data: <sample object> }.",
      });
      return;
    }
    const real = countReal();
    const hasReal = real.customers > 0 || real.reviews > 0;
    if (hasReal && parsed.data.confirmOverwrite !== true) {
      res.status(409).json({
        error: "real_data_present",
        message:
          "You have real data. Loading demo data would mix it with sample records — confirm to overwrite anyway.",
        ...real,
      });
      return;
    }
    if (hasReal) {
      // Snapshot the real state first so Remove demo data can restore it.
      const tables: Record<string, unknown[]> = {};
      for (const [name, table] of Object.entries(DATA_TABLES)) {
        tables[name] = db
          .select()
          .from(table as DataTable)
          .all();
      }
      const snapshot = {
        version: SNAPSHOT_VERSION,
        savedAt: new Date().toISOString(),
        business: portableBusiness(getBusinessRow(db)),
        tables,
      };
      try {
        fs.writeFileSync(snapshotPath(), JSON.stringify(snapshot), "utf-8");
      } catch {
        res.status(500).json({
          error: "snapshot_failed",
          message:
            "Could not save a restore snapshot — demo data was NOT loaded.",
        });
        return;
      }
    }
    const result = loadSampleData(db, parsed.data.data, {
      confirmOverwrite: parsed.data.confirmOverwrite === true,
    });
    if (!result.ok) {
      // The load failed validation: drop the just-written snapshot so a later
      // Remove demo data cannot restore a state nobody loaded.
      fs.rmSync(snapshotPath(), { force: true });
    }
    if (result.overwriteBlocked) {
      res.status(409).json({
        error: "real_data_present",
        message:
          "You have real data. Loading demo data would mix it with sample records — confirm to overwrite anyway.",
        ...result.overwriteBlocked,
      });
      return;
    }
    if (!result.ok) {
      res.status(400).json({ error: "sample_invalid", errors: result.errors });
      return;
    }
    res.json(result);
  });

  router.post("/sample-data/unload", (_req, res) => {
    const removed = unloadSampleData(db);
    let restoredSnapshot = false;
    const file = snapshotPath();
    if (fs.existsSync(file)) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(file, "utf-8")) as {
          business?: Record<string, unknown>;
          tables: Record<string, unknown[]>;
        };
        applySnapshot(db, snapshot);
        restoredSnapshot = true;
      } catch {
        res.status(500).json({
          error: "restore_failed",
          message:
            "The restore failed. Your restore snapshot was kept so you can try again.",
        });
        return;
      }
      fs.rmSync(file, { force: true });
    }
    res.json({ ...removed, restoredSnapshot });
  });

  return router;
}
