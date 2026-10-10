import { resolveEmailSettings } from "../../adapters/email/resolve.js";
import {
  designSchema,
  designText,
  renderEmail,
  type EmailDesign,
} from "../../email/design.js";
import { emailAssets } from "../../db/schema.js";
import { asyncRouter } from "../async-router.js";
// Drafts → approval → send (ticket 006). The approval state machine lives in
// domain/drafts.ts; this route layer enforces it and drives the outbox.
// Rule: any edit after approval invalidates the approval before sending.
import { Router } from "express";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppServices } from "../app.js";
import {
  drafts,
  requests,
  sendJobs,
  events as eventsTable,
  business as businessTable,
} from "../../db/schema.js";
import { getBusinessRow } from "../../storage/business.js";
import { getCustomerById } from "../../storage/customer-views.js";
import {
  canMessageCustomer,
  consentRefusalReason,
} from "../../domain/consent.js";
import {
  canSend,
  canTestSend,
  approveDraft,
  editDraft,
  hashDraftContent,
  InvalidTransition,
} from "../../domain/drafts.js";
import { checkDraftPolicy } from "../../domain/policy.js";
import { dispatchSend, resolveAmbiguousJob } from "../../sending/outbox.js";

const now = () => new Date().toISOString();

export const TOKEN_TTL_DAYS = 90;

export function buildCustomerLink(
  services: AppServices,
  token: string,
): string {
  const base =
    services.config.publicBaseUrl ?? `http://localhost:${services.config.port}`;
  return `${base}/c/${token}`;
}

export function renderTemplate(
  body: string,
  vars: Record<string, string>,
): string {
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function draftState(row: typeof drafts.$inferSelect) {
  return {
    status: row.status as "draft" | "approved" | "sent",
    approvedAt: row.approvedAt,
    contentHash: row.contentHash,
  };
}

function jobSummary(job: typeof sendJobs.$inferSelect | undefined) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    provider: job.provider,
    providerMessageId: job.providerMessageId,
    attempts: job.attempts,
    lastError: job.lastError,
    isTest: job.isTest,
    acceptedAt: job.acceptedAt,
  };
}

/** On acceptance of the real (non-test) send: draft → sent, request → sent. */
function markAccepted(services: AppServices, draftId: string): void {
  const ts = now();
  services.db
    .update(drafts)
    .set({ status: "sent", updatedAt: ts })
    .where(eq(drafts.id, draftId))
    .run();
  services.db
    .update(requests)
    .set({ status: "sent", sentAt: ts })
    .where(eq(requests.draftId, draftId))
    .run();
}

export function draftsRouter(services: AppServices): Router {
  const router = asyncRouter();
  const { db } = services;

  function canDeliverImages(
    row: typeof drafts.$inferSelect,
    res: import("express").Response,
  ): boolean {
    if (!row.emailDesign?.blocks.some((b) => b.assetId)) return true;
    if (!validAssets(row.emailDesign)) {
      res.status(422).json({
        error: "asset_missing",
        message: "One image is missing. Choose another image before sending.",
      });
      return false;
    }
    if (resolveEmailSettings(getBusinessRow(db)).adapterId === "copy-only")
      return true;
    const base = services.config.publicBaseUrl;
    let reachable = false;
    try {
      const url = new URL(base ?? "");
      reachable =
        url.protocol === "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {}
    if (!reachable) {
      res.status(422).json({
        error: "public_url_required",
        message:
          "Set PUBLIC_BASE_URL to this app’s public HTTPS address so images can load in your customer's inbox.",
      });
      return false;
    }
    return true;
  }
  function rendered(
    row: typeof drafts.$inferSelect,
    vars: Record<string, string>,
    preview = false,
  ) {
    const base =
      services.config.publicBaseUrl ??
      `http://localhost:${services.config.port}`;
    return renderEmail({
      body: row.body,
      design: row.emailDesign,
      vars,
      imageUrl: (id) => {
        const asset = db
          .select()
          .from(emailAssets)
          .where(eq(emailAssets.id, id))
          .get();
        return asset
          ? `${preview ? "" : base}/api/public/email-assets/${asset.token}`
          : null;
      },
    });
  }
  router.post("/drafts/:id/preview", (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.sendStatus(404);
      return;
    }
    const parsed = z
      .object({
        body: z.string().max(50000).optional(),
        emailDesign: designSchema.nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation" });
      return;
    }
    const b = getBusinessRow(db),
      customer = row.customerId
        ? getCustomerById(db, row.customerId)
        : undefined;
    res.json(
      rendered(
        { ...row, ...parsed.data },
        {
          link: buildCustomerLink(services, "preview"),
          customer: customer?.name ?? "you",
          business: b.name || "Your business",
          owner: b.ownerName || "",
        },
        true,
      ),
    );
  });

  router.get("/drafts", (req, res) => {
    const customerId =
      typeof req.query.customerId === "string"
        ? req.query.customerId
        : undefined;
    const rows = customerId
      ? db
          .select()
          .from(drafts)
          .where(eq(drafts.customerId, customerId))
          .orderBy(desc(drafts.createdAt))
          .all()
      : db.select().from(drafts).orderBy(desc(drafts.createdAt)).all();
    const result = rows.map((row) => {
      const job = db
        .select()
        .from(sendJobs)
        .where(and(eq(sendJobs.draftId, row.id), eq(sendJobs.isTest, false)))
        .get();
      const testJob = db
        .select()
        .from(sendJobs)
        .where(and(eq(sendJobs.draftId, row.id), eq(sendJobs.isTest, true)))
        .get();
      return { ...row, sendJob: jobSummary(job), testJob: jobSummary(testJob) };
    });
    res.json({ drafts: result });
  });

  function validAssets(design: EmailDesign | null | undefined): boolean {
    return (
      !design ||
      design.blocks.every(
        (b) =>
          !b.assetId ||
          !!db
            .select({ id: emailAssets.id })
            .from(emailAssets)
            .where(eq(emailAssets.id, b.assetId))
            .get(),
      )
    );
  }
  router.post("/drafts", (req, res) => {
    const parsed = z
      .object({
        kind: z.enum(["review_request", "follow_up", "review_reply"]),
        customerId: z.string().optional(),
        subject: z.string().min(1).max(998),
        body: z.string().min(1).max(40000),
        emailDesign: designSchema.nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    if (!validAssets(parsed.data.emailDesign)) {
      res.status(400).json({
        error: "asset_missing",
        message:
          "One image was removed from your library. Choose another image before saving.",
      });
      return;
    }
    const ts = now();
    const id = crypto.randomUUID();
    const contentHash = hashDraftContent(
      parsed.data.subject,
      parsed.data.body,
      parsed.data.emailDesign,
    );
    db.insert(drafts)
      .values({
        id,
        kind: parsed.data.kind,
        customerId: parsed.data.customerId ?? null,
        subject: parsed.data.subject,
        body: parsed.data.body,
        emailDesign: parsed.data.emailDesign ?? null,
        status: "draft",
        contentHash,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    res.json({ id });
  });

  router.patch("/drafts/:id", (req, res) => {
    const parsed = z
      .object({
        subject: z.string().min(1).max(998).optional(),
        body: z.string().min(1).max(40000).optional(),
        emailDesign: designSchema.nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const subject = parsed.data.subject ?? row.subject;
    const body = parsed.data.body ?? row.body;
    const emailDesign =
      parsed.data.emailDesign === undefined
        ? row.emailDesign
        : parsed.data.emailDesign;
    if (!validAssets(emailDesign)) {
      res.status(400).json({
        error: "asset_missing",
        message:
          "One image was removed from your library. Choose another image before saving.",
      });
      return;
    }
    try {
      const next = editDraft(draftState(row), subject, body, emailDesign);
      db.update(drafts)
        .set({
          subject,
          body,
          emailDesign,
          status: next.status,
          approvedAt: next.approvedAt,
          contentHash: next.contentHash,
          updatedAt: now(),
        })
        .where(eq(drafts.id, row.id))
        .run();
      res.json({
        status: next.status,
        approvalInvalidated:
          row.status === "approved" && next.status === "draft",
      });
    } catch (err) {
      if (err instanceof InvalidTransition) {
        res
          .status(409)
          .json({ error: "invalid_transition", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/drafts/:id/approve", (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      const next = approveDraft(
        draftState(row),
        row.subject,
        row.body,
        now(),
        row.emailDesign,
      );
      db.update(drafts)
        .set({
          status: next.status,
          approvedAt: next.approvedAt,
          contentHash: next.contentHash,
          updatedAt: now(),
        })
        .where(eq(drafts.id, row.id))
        .run();
      res.json({ status: next.status });
    } catch (err) {
      if (err instanceof InvalidTransition) {
        res
          .status(409)
          .json({ error: "invalid_transition", message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/drafts/:id/policy", (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const business = getBusinessRow(db);
    const issues = checkDraftPolicy({
      subject: row.subject,
      body: designText(row.body, row.emailDesign),
      googleReviewUrl: business.googleReviewUrl || undefined,
    });
    res.json({ issues });
  });

  router.post("/drafts/:id/test-send", async (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const business = getBusinessRow(db);
    if (!business.ownerEmail) {
      res.status(400).json({
        error: "validation",
        message: "Set your own email address in the business profile first.",
      });
      return;
    }
    if (!canTestSend(draftState(row))) {
      res.status(409).json({
        error: "invalid_transition",
        message: "Sent drafts cannot be re-tested.",
      });
      return;
    }
    const previewLink = `${services.config.publicBaseUrl ?? `http://localhost:${services.config.port}`}/c/preview`;
    const email = rendered(row, {
      link: previewLink,
      customer: "you",
      business: business.name || "your business",
      owner: business.ownerName || "",
    });
    if (!canDeliverImages(row, res)) return;
    const result = await dispatchSend(services, {
      draftId: row.id,
      to: business.ownerEmail,
      subject: renderTemplate(row.subject, { customer: "you" }),
      ...email,
      isTest: true,
    });
    // A test send that the provider accepted counts as gate step 6 (spec §4.2).
    if (result.outcome === "accepted") {
      const ts = now();
      services.db
        .update(businessTable)
        .set({ testEmailSentAt: ts, updatedAt: ts })
        .where(eq(businessTable.id, 1))
        .run();
    }
    res.json({ outcome: result.outcome, job: jobSummary(result.job) });
  });

  // Send an approved review-request draft: creates the request + token,
  // renders the customer link into the template, re-runs the policy check on
  // the final content, then dispatches through the outbox.
  router.post("/drafts/:id/send", async (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (row.status !== "sent" && !canSend(draftState(row))) {
      res.status(409).json({
        error: "approval_required",
        message: "Approve the draft before sending.",
      });
      return;
    }
    if (!row.customerId) {
      res
        .status(400)
        .json({ error: "validation", message: "Draft has no customer." });
      return;
    }
    const customer = getCustomerById(db, row.customerId);
    if (!customer) {
      res
        .status(404)
        .json({ error: "not_found", message: "Customer not found." });
      return;
    }
    const refusal = consentRefusalReason(customer);
    if (refusal) {
      res.status(409).json({ error: "consent_required", message: refusal });
      return;
    }
    if (row.kind === "review_request" && !row.body.includes("{{link}}")) {
      res.status(400).json({
        error: "validation",
        message:
          "A review request must include the {{link}} placeholder for the customer page.",
      });
      return;
    }

    const business = getBusinessRow(db);

    // Find or create the request (idempotent across retries).
    let request = db
      .select()
      .from(requests)
      .where(eq(requests.draftId, row.id))
      .get();
    if (!request) {
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(24).toString("base64url");
      const expiresAt = new Date(
        Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.insert(requests)
        .values({
          id,
          customerId: customer.id,
          draftId: row.id,
          token,
          status: "pending",
          expiresAt,
          createdAt: now(),
        })
        .run();
      request = db
        .select()
        .from(requests)
        .where(eq(requests.draftId, row.id))
        .get();
      if (!request) throw new Error("Request creation failed");
    }

    const link = buildCustomerLink(services, request.token);
    const email = rendered(row, {
      link,
      customer: customer.name,
      business: business.name || "your business",
      owner: business.ownerName || "",
    });

    const finalText = email.text;

    // Policy gate on the final content (enforcement at the boundary).
    const issues = checkDraftPolicy({
      subject: row.subject,
      body: finalText,
      googleReviewUrl: business.googleReviewUrl || undefined,
    });
    if (issues.length > 0) {
      res.status(422).json({ error: "policy_failed", issues });
      return;
    }

    if (!canDeliverImages(row, res)) return;
    const result = await dispatchSend(services, {
      draftId: row.id,
      to: customer.contact,
      subject: row.subject,
      ...email,
      isTest: false,
    });

    if (result.outcome === "accepted") {
      markAccepted(services, row.id);
    }

    res.json({
      outcome: result.outcome,
      job: jobSummary(result.job),
      link,
      // With Copy only, nothing is dispatched — surface the exact text to copy.
      copyHtml:
        result.job.provider === "copy-only" && result.outcome === "accepted"
          ? email.html
          : undefined,
      copyText:
        result.job.provider === "copy-only" && result.outcome === "accepted"
          ? finalText
          : undefined,
    });
  });

  // Owner-initiated retry after failure, or after an ambiguous timeout
  // (same idempotency key — providers that honour it cannot deliver twice).
  router.post("/drafts/:id/retry", async (req, res) => {
    const row = db
      .select()
      .from(drafts)
      .where(eq(drafts.id, req.params.id))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const job = db
      .select()
      .from(sendJobs)
      .where(and(eq(sendJobs.draftId, row.id), eq(sendJobs.isTest, false)))
      .get();
    if (
      !job ||
      !["failed_permanent", "failed_temporary", "ambiguous"].includes(
        job.status,
      )
    ) {
      res.status(409).json({
        error: "invalid_transition",
        message: "No failed or ambiguous send to retry.",
      });
      return;
    }
    if (!canSend(draftState(row))) {
      res.status(409).json({
        error: "approval_required",
        message: "Approve the current draft before retrying.",
      });
      return;
    }
    if (!row.customerId) {
      res
        .status(400)
        .json({ error: "validation", message: "Draft has no customer." });
      return;
    }
    const customer = getCustomerById(db, row.customerId);
    const request = db
      .select()
      .from(requests)
      .where(eq(requests.draftId, row.id))
      .get();
    if (!customer || !request) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const refusal = consentRefusalReason(customer);
    if (refusal) {
      res.status(409).json({ error: "consent_required", message: refusal });
      return;
    }
    const business = getBusinessRow(db);
    const link = buildCustomerLink(services, request.token);
    const email = rendered(row, {
      link,
      customer: customer.name,
      business: business.name || "your business",
      owner: business.ownerName || "",
    });

    const finalText = email.text;
    if (row.kind === "review_request" && !row.body.includes("{{link}}")) {
      res.status(409).json({
        error: "link_required",
        message: "The review request must include {{link}}.",
      });
      return;
    }
    const issues = checkDraftPolicy({
      subject: row.subject,
      body: finalText,
      googleReviewUrl: business.googleReviewUrl || undefined,
    });
    if (issues.length > 0) {
      res.status(409).json({ error: "policy_blocked", issues });
      return;
    }
    if (!canDeliverImages(row, res)) return;
    const result = await dispatchSend(
      services,
      {
        draftId: row.id,
        to: customer.contact,
        subject: row.subject,
        ...email,
        isTest: false,
      },
      { ownerRetry: true },
    );
    if (result.outcome === "accepted") {
      markAccepted(services, row.id);
    }
    res.json({ outcome: result.outcome, job: jobSummary(result.job), link });
  });

  // Revoke a customer link (ADR-0005: tokens are revocable per request).
  router.post("/requests/:id/revoke", (req, res) => {
    const row = db
      .select()
      .from(requests)
      .where(eq(requests.id, req.params.id ?? ""))
      .get();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (row.revokedAt) {
      res.status(409).json({
        error: "invalid_transition",
        message: "Link already revoked.",
      });
      return;
    }
    db.update(requests)
      .set({ revokedAt: now() })
      .where(eq(requests.id, row.id))
      .run();
    res.json({ ok: true });
  });

  // Resolve an ambiguous send job manually (ADR-0004: owner decides, never automatic).
  router.post("/send-jobs/:id/resolve", (req, res) => {
    const parsed = z
      .object({ decision: z.enum(["sent", "failed"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const job = resolveAmbiguousJob(db, {
      jobId: req.params.id,
      decision: parsed.data.decision,
    });
    if (!job) {
      res.status(409).json({
        error: "invalid_transition",
        message: "Job is not ambiguous.",
      });
      return;
    }
    if (parsed.data.decision === "sent" && !job.isTest) {
      markAccepted(services, job.draftId);
    }
    res.json({ job: jobSummary(job) });
  });

  return router;
}
