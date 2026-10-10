import { asyncRouter } from "../async-router.js";
// Customers API (ticket 004): CRUD + CSV import. Consent is enforced in the
// domain (consent.ts) — the send path refuses customers without it.
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { customers, notes } from "../../db/schema.js";
import { listCustomersWithStatus } from "../../storage/customer-views.js";

const now = () => new Date().toISOString();

const customerPost = z.object({
  name: z.string().min(1),
  contact: z.string().min(3), // email address
  serviceType: z.string().optional(),
  lastJobDate: z.string().nullable().optional(),
  consent: z.boolean(),
});

export function customersRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  router.get("/customers", (req, res) => {
    const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
    const all = listCustomersWithStatus(db);
    if (filter === "all" || filter === "") {
      res.json({ customers: all });
      return;
    }
    res.json({ customers: all.filter((c) => c.derived === filter) });
  });

  router.post("/customers", (req, res) => {
    const parsed = customerPost.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const ts = now();
    const id = crypto.randomUUID();
    db.insert(customers)
      .values({
        id,
        name: data.name,
        contact: data.contact,
        serviceType: data.serviceType ?? "",
        lastJobDate: data.lastJobDate ?? null,
        consent: data.consent,
        consentAt: data.consent ? ts : null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    res.json({ id });
  });

  const customerPatch = z.object({
    name: z.string().min(1).optional(),
    contact: z.string().min(3).optional(),
    serviceType: z.string().optional(),
    lastJobDate: z.string().nullable().optional(),
    consent: z.boolean().optional(),
    status: z.enum(["active", "do_not_contact"]).optional(),
    callResolvedAt: z.string().nullable().optional(),
    rebookingSnoozedUntil: z.string().nullable().optional(),
  });

  router.patch("/customers/:id", (req, res) => {
    const customerId = req.params.id ?? "";
    const parsed = customerPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const row = db.select().from(customers).where(eq(customers.id, customerId)).get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: now() };
    if (parsed.data.consent !== undefined && parsed.data.consent !== row.consent) {
      patch.consentAt = parsed.data.consent ? now() : null;
    }
    db.update(customers).set(patch).where(eq(customers.id, row.id)).run();
    res.json({ ok: true });
  });

  router.post("/customers/:id/notes", (req, res) => {
    const customerId = req.params.id ?? "";
    const parsed = z.object({ text: z.string().min(1), kind: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const row = db.select().from(customers).where(eq(customers.id, customerId)).get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const id = crypto.randomUUID();
    db.insert(notes)
      .values({
        id,
        customerId: row.id,
        kind: parsed.data.kind ?? "call_outcome",
        text: parsed.data.text,
        createdAt: now(),
      })
      .run();
    res.json({ id });
  });

  router.post("/customers/import", (req, res) => {
    const parsed = z.object({ csv: z.string().min(1).max(2_000_000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const result = importCustomersCsv(services, parsed.data.csv);
    res.json(result);
  });

  return router;
}

// ── CSV import ─────────────────────────────────────────────────────────────
// Header: name, contact, serviceType, lastJobDate, consent (consent: yes/no/true/false/1/0)

/** Minimal RFC-4180-style splitter: handles quoted fields and embedded commas/quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === "") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseConsent(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["yes", "true", "1", "y", "consented"].includes(v)) return true;
  if (["no", "false", "0", "n", ""].includes(v)) return false;
  return null;
}

export interface CsvImportResult {
  imported: number;
  errors: { line: number; message: string }[];
}

export function importCustomersCsv(services: AppServices, csv: string): CsvImportResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: { line: number; message: string }[] = [];
  if (lines.length === 0) return { imported: 0, errors: [{ line: 1, message: "Empty CSV." }] };

  const header = splitCsvLine(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const required = ["name", "contact", "consent"];
  const missingHeaders = required.filter((r) => !header.includes(r));
  if (missingHeaders.length > 0) {
    return { imported: 0, errors: [{ line: 1, message: `Missing required columns: ${missingHeaders.join(", ")}` }] };
  }
  const idx = (name: string) => header.indexOf(name);

  let imported = 0;
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i] ?? "");
    const get = (name: string) => (idx(name) >= 0 ? (fields[idx(name)] ?? "").trim() : "");
    const name = get("name");
    const contact = get("contact");
    const consent = parseConsent(get("consent"));
    const lineNo = i + 1;
    if (!name) {
      errors.push({ line: lineNo, message: "Missing name." });
      continue;
    }
    if (!contact || !contact.includes("@")) {
      errors.push({ line: lineNo, message: "Missing or invalid contact email." });
      continue;
    }
    if (consent === null) {
      errors.push({ line: lineNo, message: `Invalid consent value "${get("consent")}" (use yes/no).` });
      continue;
    }
    const ts = now();
    try {
      services.db
        .insert(customers)
        .values({
          id: crypto.randomUUID(),
          name,
          contact,
          serviceType: get("servicetype"),
          lastJobDate: get("lastjobdate") || null,
          consent,
          consentAt: consent ? ts : null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      imported++;
    } catch (err) {
      errors.push({ line: lineNo, message: err instanceof Error ? err.message : "Insert failed." });
    }
  }
  return { imported, errors };
}
