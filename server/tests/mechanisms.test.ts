import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db/client.js";
import { createApp } from "../src/http/app.js";
import { _registerAiAdapterForTests } from "../src/adapters/ai/registry.js";
import { _registerAdapterForTests } from "../src/adapters/email/registry.js";
import {
  _setRawEmbedderForTests,
  embedCached,
} from "../src/inference/embedder.js";
import {
  reviews,
  reviewThemes,
  sendJobs,
  drafts,
  requests,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import * as outbox from "../src/sending/outbox.js";
let dir: string,
  handle: ReturnType<typeof openDb>,
  server: ReturnType<ReturnType<typeof createApp>["listen"]>,
  base: string;
let completion = "{}",
  throws = false,
  accept = false;
let delivered: string[] = [];
async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600),
  });
  return { status: res.status, body: (await res.json()) as any };
}
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "starlly-mechanisms-"));
  handle = openDb(path.join(dir, "audit.db"));
  _registerAiAdapterForTests("openai", {
    style: "openai",
    test: async () => ({ ok: true }),
    chat: async () => {
      if (throws) throw new Error("network failed");
      return { text: completion };
    },
  });
  _registerAdapterForTests({
    id: "mechanisms",
    label: "Stub",
    configFields: [],
    capabilities: { html: false, replyTo: false, headers: false },
    test: async () => ({ ok: true }),
    send: async (_cfg, msg) => {
      delivered.push(msg.text);
      return accept
        ? { status: "accepted" }
        : {
            status: "failed",
            error: { kind: "temporary", message: "failure", retryable: true },
          };
    },
  });
  _setRawEmbedderForTests(async (texts) =>
    texts.map((t) => (t.startsWith("unmatched") ? [0, 1] : [1, 0])),
  );
  server = createApp({
    db: handle.db,
    config: {
      port: 0,
      dataDir: dir,
      dbPath: path.join(dir, "audit.db"),
      publicBaseUrl: "https://audit.example",
    },
  }).listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api`;
  await api("PUT", "/business", {
    name: "Audit",
    ownerName: "Owner",
    ownerEmail: "owner@audit.test",
    city: "Town",
    googleReviewUrl: "https://g.page/audit",
  });
  await api("PUT", "/settings", {
    aiStyle: "openai",
    aiBaseUrl: "https://stub.test",
    aiModel: "stub",
    aiApiKey: "FAKE_AUDIT_KEY",
    emailAdapterId: "copy-only",
  });
  await api("POST", "/settings/test-ai");
  await api("POST", "/setup/places-skip");
  expect((await api("POST", "/setup/complete")).status).toBe(200);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  handle.close();
  _setRawEmbedderForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
describe("mechanism regressions", () => {
  it("does not export credentials", async () => {
    const snapshot = await api("GET", "/data/export");
    expect(JSON.stringify(snapshot.body)).not.toContain("FAKE_AUDIT_KEY");
  });
  it("retry requires fresh approval after edits", async () => {
    const c = await api("POST", "/customers", {
      name: "Customer",
      contact: "customer@audit.test",
      consent: true,
    });
    const d = await api("POST", "/drafts", {
      kind: "review_request",
      customerId: c.body.id,
      subject: "Feedback",
      body: "Feedback: {{link}}",
    });
    await api("PUT", "/settings", { emailAdapterId: "mechanisms" });
    await api("POST", `/drafts/${d.body.id}/approve`);
    expect((await api("POST", `/drafts/${d.body.id}/send`)).body.outcome).toBe(
      "failed",
    );
    await api("PATCH", `/drafts/${d.body.id}`, { body: "Changed: {{link}}" });
    accept = true;
    expect((await api("POST", `/drafts/${d.body.id}/retry`)).status).toBe(409);
    expect(delivered).toHaveLength(1);
  });
  it("finishes AI requests with errors on exceptions and malformed completions", async () => {
    throws = true;
    try {
      expect(
        (await api("POST", "/chat", { message: "How is service?" })).status,
      ).toBe(502);
    } finally {
      throws = false;
    }
    completion = JSON.stringify({ subject: 123, body: "Body" });
    expect(
      (await api("POST", "/drafts/ai-draft", { kind: "follow_up" })).status,
    ).toBe(502);
  });
  it("records no-match tagging and invalidates it on theme changes", async () => {
    const theme = await api("POST", "/themes", { name: "Theme A" });
    await api("POST", "/reviews", { text: "unmatched review" });
    expect((await api("POST", "/insights/tag")).body.tagged).toBe(1);
    expect((await api("POST", "/insights/tag")).body.tagged).toBe(0);
    await api("PATCH", `/themes/${theme.body.id}`, {
      description: "New definition",
    });
    expect((await api("POST", "/insights/tag")).body.tagged).toBe(1);
  });
  it("rejects fabricated citations and saves/restores/deletes summaries", async () => {
    const theme = (await api("GET", "/themes")).body.themes[0];
    const review = await api("POST", "/reviews", {
      text: "Excellent service.",
      rating: 5,
    });
    await api("POST", "/insights/tag");
    completion = JSON.stringify({
      answer: "Invented claim",
      quotes: [{ reviewId: review.body.id, quote: "Never said this" }],
    });
    expect(
      (await api("POST", "/chat", { message: "How is service?" })).status,
    ).toBe(422);
    completion = JSON.stringify({
      summary: "Excellent service.",
      quotes: [{ reviewId: review.body.id, quote: "Excellent service." }],
    });
    expect(
      (await api("POST", "/insights/summarize", { themeId: theme.id })).status,
    ).toBe(200);
    const snapshot = await api("GET", "/data/export");
    expect(snapshot.body.tables.insightSummaries).toHaveLength(1);
    expect((await api("POST", "/data/import", snapshot.body)).status).toBe(200);
    expect((await api("DELETE", `/themes/${theme.id}`)).status).toBe(200);
    expect((await api("POST", "/data/delete")).status).toBe(200);
    expect((await api("GET", "/customers")).body.customers).toHaveLength(0);
  });
  it("recovers interrupted sends without dispatching them again", async () => {
    const c = await api("POST", "/customers", {
      name: "Recovery Customer",
      contact: "recover@audit.test",
      consent: true,
    });
    const d = await api("POST", "/drafts", {
      kind: "review_request",
      customerId: c.body.id,
      subject: "Feedback",
      body: "Feedback: {{link}}",
    });
    await api("POST", `/drafts/${d.body.id}/approve`);
    expect((await api("POST", `/drafts/${d.body.id}/send`)).body.outcome).toBe(
      "accepted",
    );
    handle.db
      .update(sendJobs)
      .set({ status: "sending" })
      .where(eq(sendJobs.draftId, d.body.id))
      .run();
    const count = delivered.length;
    outbox.recoverSendJobs(handle.db);
    expect(
      handle.db
        .select()
        .from(sendJobs)
        .where(eq(sendJobs.draftId, d.body.id))
        .get()?.status,
    ).toBe("ambiguous");
    expect(delivered.length).toBe(count);
    handle.db
      .update(sendJobs)
      .set({ status: "accepted" })
      .where(eq(sendJobs.draftId, d.body.id))
      .run();
    handle.db
      .update(drafts)
      .set({ status: "approved" })
      .where(eq(drafts.id, d.body.id))
      .run();
    handle.db
      .update(requests)
      .set({ status: "pending", sentAt: null })
      .where(eq(requests.draftId, d.body.id))
      .run();
    outbox.recoverSendJobs(handle.db);
    outbox.recoverSendJobs(handle.db);
    expect(
      handle.db.select().from(drafts).where(eq(drafts.id, d.body.id)).get()
        ?.status,
    ).toBe("sent");
    expect(
      handle.db
        .select()
        .from(requests)
        .where(eq(requests.draftId, d.body.id))
        .get()?.status,
    ).toBe("sent");
    expect(delivered.length).toBe(count);
  });
  it("deduplicates embedding cache misses and rejects invalid vectors", async () => {
    const batches: string[][] = [];
    _setRawEmbedderForTests(async (texts) => {
      batches.push(texts);
      return texts.map(() => [1, 0]);
    });
    expect(
      await embedCached(handle.db, ["duplicate-vector", "duplicate-vector"]),
    ).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(batches).toEqual([["duplicate-vector"]]);
    _setRawEmbedderForTests(async () => [[NaN, 0]]);
    await expect(embedCached(handle.db, ["invalid-vector"])).rejects.toThrow();
  });
});
