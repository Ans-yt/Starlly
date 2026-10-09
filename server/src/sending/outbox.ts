// Send-job outbox (ADR-0004, ticket 006). Every outbound email goes through a
// persisted job; the job row exists before the adapter call; ambiguous
// outcomes are surfaced for owner decision and never auto-retried.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../http/app.js";
import { sendJobs } from "../db/schema.js";
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

const now = () => new Date().toISOString();

function loadJob(db: AppDatabase, draftId: string, isTest: boolean): SendJobRow | undefined {
  return db
    .select()
    .from(sendJobs)
    .where(and(eq(sendJobs.draftId, draftId), eq(sendJobs.isTest, isTest)))
    .get();
}

function updateJob(db: AppDatabase, id: string, patch: Partial<SendJobRow>): SendJobRow {
  db.update(sendJobs)
    .set({ ...patch, updatedAt: now() })
    .where(eq(sendJobs.id, id))
    .run();
  return db.select().from(sendJobs).where(eq(sendJobs.id, id)).get() as SendJobRow;
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
          attempts: 0,
          createdAt: now(),
          updatedAt: now(),
        })
        .run();
    } catch {
      // UNIQUE(draft_id, is_test) violation: another dispatcher created the job
      // first. Never create a second one.
      const existing = loadJob(db, input.draftId, input.isTest);
      if (!existing) throw new Error("Send job disappeared after unique violation");
      return { outcome: "duplicate", job: existing };
    }
    job = loadJob(db, input.draftId, input.isTest) as SendJobRow;
  } else {
    // Duplicate prevention: accepted/sending jobs are never re-dispatched.
    // Ambiguous jobs may only be re-run through an explicit owner retry.
    const locked = job.status === "sending" || job.status === "accepted";
    const ambiguous = job.status === "ambiguous";
    if (locked || (ambiguous && !options.ownerRetry)) {
      return { outcome: "duplicate", job };
    }
  }

  const attempts = job.attempts + 1;
  job = updateJob(db, job.id, { status: "sending", attempts, to: input.to, lastError: null });

  const message: OutgoingEmail = {
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  };

  let result: Awaited<ReturnType<typeof adapter.send>>;
  try {
    result = await adapter.send(config, message, { idempotencyKey: job.idempotencyKey ?? undefined });
  } catch (err: unknown) {
    // AbortController timeout: the request may have landed — the outcome is
    // unknown, so the job is ambiguous, never auto-retried (ADR-0004).
    const isTimeout = err instanceof Error && err.name === "AbortError";
    if (isTimeout) {
      const updated = updateJob(db, job.id, {
        status: "ambiguous",
        lastError:
          "Timed out waiting for the provider. The message may or may not have been sent — decide: mark as sent, or retry.",
      });
      return { outcome: "ambiguous", job: updated };
    }
    const message_ = err instanceof Error ? err.message : "unknown error";
    const updated = updateJob(db, job.id, {
      status: "failed_temporary",
      lastError: `Network error: ${message_}`.slice(0, 500),
    });
    return { outcome: "failed", job: updated };
  }

  if (result.status === "accepted") {
    const updated = updateJob(db, job.id, {
      status: "accepted",
      providerMessageId: result.providerMessageId ?? null,
      acceptedAt: now(),
      lastError: null,
    });
    return { outcome: "accepted", job: updated };
  }

  const status = result.error.retryable ? "failed_temporary" : "failed_permanent";
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
export function resolveAmbiguousJob(db: AppDatabase, input: JobDecisionInput): SendJobRow | undefined {
  const job = db.select().from(sendJobs).where(eq(sendJobs.id, input.jobId)).get();
  if (!job || job.status !== "ambiguous") return undefined;
  const patch: Partial<SendJobRow> =
    input.decision === "sent"
      ? { status: "accepted", acceptedAt: now(), lastError: null }
      : { status: "failed_permanent", lastError: "Owner marked this send as not delivered." };
  return updateJob(db, job.id, patch);
}
