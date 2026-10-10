// Send-job outbox (ADR-0004, ticket 006). Every outbound email goes through a
// persisted job; the job row exists before the adapter call; ambiguous
// outcomes are surfaced for owner decision and never auto-retried.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../http/app.js";
import { sendJobs, drafts, requests } from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import { getEmailAdapter } from "../adapters/email/registry.js";
import { resolveEmailSettings } from "../adapters/email/resolve.js";
import type { OutgoingEmail } from "../adapters/email/types.js";
import { getBusinessRow } from "../storage/business.js";

export type SendJobRow = typeof sendJobs.$inferSelect;

export interface DispatchInput {
  draftId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  isTest: boolean;
}

export type SendDispatchResult =
  | { outcome: "duplicate"; job: SendJobRow }
  | { outcome: "accepted"; job: SendJobRow }
  | { outcome: "failed"; job: SendJobRow }
  | { outcome: "ambiguous"; job: SendJobRow };

export interface DispatchOptions {
  /** Owner-initiated retry (also resolves an ambiguous job): reuses the same
   * idempotency key so providers that honour it cannot deliver twice. */
  ownerRetry?: boolean;
}

export class SendPayloadConflict extends Error {}
const now = () => new Date().toISOString();
export function recoverSendJobs(db: AppDatabase): void {
  db.transaction((tx) => {
    tx.update(sendJobs)
      .set({
        status: "ambiguous",
        lastError:
          "The app stopped while sending. Confirm delivery before retrying.",
        updatedAt: now(),
      })
      .where(eq(sendJobs.status, "sending"))
      .run();
    for (const job of tx
      .select()
      .from(sendJobs)
      .where(eq(sendJobs.status, "accepted"))
      .all()) {
      if (job.isTest) continue;
      tx.update(drafts)
        .set({ status: "sent", updatedAt: job.acceptedAt ?? now() })
        .where(eq(drafts.id, job.draftId))
        .run();
      tx.update(requests)
        .set({ status: "sent", sentAt: job.acceptedAt ?? now() })
        .where(eq(requests.draftId, job.draftId))
        .run();
    }
  });
}
function payloadHash(input: DispatchInput): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([input.to, input.subject, input.text, input.html ?? null]),
    )
    .digest("hex");
}

function loadJob(
  db: AppDatabase,
  draftId: string,
  isTest: boolean,
): SendJobRow | undefined {
  return db
    .select()
    .from(sendJobs)
    .where(and(eq(sendJobs.draftId, draftId), eq(sendJobs.isTest, isTest)))
    .get();
}

function updateJob(
  db: AppDatabase,
  id: string,
  patch: Partial<SendJobRow>,
): SendJobRow {
  db.update(sendJobs)
    .set({ ...patch, updatedAt: now() })
    .where(eq(sendJobs.id, id))
    .run();
  return db
    .select()
    .from(sendJobs)
    .where(eq(sendJobs.id, id))
    .get() as SendJobRow;
}

export async function dispatchSend(
  services: AppServices,
  input: DispatchInput,
  options: DispatchOptions = {},
): Promise<SendDispatchResult> {
  const db = services.db;
  const businessRow = getBusinessRow(db);
  const { adapterId, config } = resolveEmailSettings(businessRow);
  const adapter = getEmailAdapter(adapterId);
  if (!adapter) {
    throw new Error(`Unknown email adapter "${adapterId}"`);
  }

  let job = loadJob(db, input.draftId, input.isTest);

  if (!job) {
    const id = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    try {
      db.insert(sendJobs)
        .values({
          id,
          draftId: input.draftId,
          to: input.to,
          provider: adapterId,
          isTest: input.isTest,
          idempotencyKey,
          status: "queued",
          payloadHash: payloadHash(input),
          attempts: 0,
          createdAt: now(),
          updatedAt: now(),
        })
        .run();
    } catch {
      // UNIQUE(draft_id, is_test) violation: another dispatcher created the job
      // first. Never create a second one.
      const existing = loadJob(db, input.draftId, input.isTest);
      if (!existing)
        throw new Error("Send job disappeared after unique violation");
      return { outcome: "duplicate", job: existing };
    }
    job = loadJob(db, input.draftId, input.isTest) as SendJobRow;
  } else {
    if (
      input.isTest &&
      !["sending", "ambiguous"].includes(job.status) &&
      (job.payloadHash !== payloadHash(input) || job.provider !== adapterId)
    ) {
      job = updateJob(db, job.id, {
        status: "queued",
        provider: adapterId,
        to: input.to,
        idempotencyKey: crypto.randomUUID(),
        payloadHash: payloadHash(input),
        attempts: 0,
        acceptedAt: null,
        providerMessageId: null,
        lastError: null,
      });
    }
    // Duplicate prevention: accepted/sending jobs are never re-dispatched.
    // Ambiguous jobs may only be re-run through an explicit owner retry.
    const locked = job.status === "sending" || job.status === "accepted";
    const ambiguous = job.status === "ambiguous";
    if (locked || (ambiguous && !options.ownerRetry)) {
      return { outcome: "duplicate", job };
    }
  }

  if (
    (job.attempts > 0 && !job.payloadHash) ||
    (job.payloadHash && job.payloadHash !== payloadHash(input)) ||
    job.provider !== adapterId
  ) {
    throw new SendPayloadConflict(
      "This job belongs to different content or a different provider. Create a new approved draft to send the changed message.",
    );
  }
  const attempts = job.attempts + 1;
  job = updateJob(db, job.id, {
    status: "sending",
    attempts,
    to: input.to,
    payloadHash: payloadHash(input),
    lastError: null,
  });

  const message: OutgoingEmail = {
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  };

  let result: Awaited<ReturnType<typeof adapter.send>>;
  try {
    result = await adapter.send(config, message, {
      idempotencyKey: job.idempotencyKey ?? undefined,
    });
  } catch {
    // A thrown transport error may follow delivery. Never automatically retry.
    const updated = updateJob(db, job.id, {
      status: "ambiguous",
      lastError:
        "The provider connection stopped. Delivery is unknown — confirm delivery before retrying.",
    });
    return { outcome: "ambiguous", job: updated };
  }

  if (result.status === "accepted") {
    const updated = db.transaction((tx) => {
      const accepted = updateJob(tx as AppDatabase, job.id, {
        status: "accepted",
        providerMessageId: result.providerMessageId ?? null,
        acceptedAt: now(),
        lastError: null,
      });
      if (!input.isTest) {
        tx.update(drafts)
          .set({ status: "sent", updatedAt: accepted.acceptedAt! })
          .where(eq(drafts.id, input.draftId))
          .run();
        tx.update(requests)
          .set({ status: "sent", sentAt: accepted.acceptedAt! })
          .where(eq(requests.draftId, input.draftId))
          .run();
      }
      return accepted;
    });
    return { outcome: "accepted", job: updated };
  }

  const status = result.error.retryable
    ? "failed_temporary"
    : "failed_permanent";
  const updated = updateJob(db, job.id, {
    status,
    lastError: `${result.error.kind}: ${result.error.message}`.slice(0, 500),
  });
  return { outcome: "failed", job: updated };
}

export interface JobDecisionInput {
  jobId: string;
  decision: "sent" | "failed";
}

/** Owner resolves an ambiguous job manually (ADR-0004: surfaced, never automatic). */
export function resolveAmbiguousJob(
  db: AppDatabase,
  input: JobDecisionInput,
): SendJobRow | undefined {
  const job = db
    .select()
    .from(sendJobs)
    .where(eq(sendJobs.id, input.jobId))
    .get();
  if (!job || job.status !== "ambiguous") return undefined;
  const patch: Partial<SendJobRow> =
    input.decision === "sent"
      ? { status: "accepted", acceptedAt: now(), lastError: null }
      : {
          status: "failed_permanent",
          lastError: "Owner marked this send as not delivered.",
        };
  return db.transaction((tx) => {
    const updated = updateJob(tx as AppDatabase, job.id, patch);
    if (input.decision === "sent" && !job.isTest) {
      tx.update(drafts)
        .set({ status: "sent", updatedAt: updated.acceptedAt! })
        .where(eq(drafts.id, job.draftId))
        .run();
      tx.update(requests)
        .set({ status: "sent", sentAt: updated.acceptedAt! })
        .where(eq(requests.draftId, job.draftId))
        .run();
    }
    return updated;
  });
}
