import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDb } from "../src/db/client.js";
import { createApp } from "../src/http/app.js";
import { business, drafts, emailAssets } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import {
  defaultDesign,
  renderEmail,
  designSchema,
} from "../src/email/design.js";
import {
  hashDraftContent,
  approveDraft,
  editDraft,
} from "../src/domain/drafts.js";
import { _registerAdapterForTests } from "../src/adapters/email/registry.js";
import { agentboxdAdapter } from "../src/adapters/email/agentboxd.js";
import { openMailAdapter } from "../src/adapters/email/openmail.js";
let handle: ReturnType<typeof openDb>,
  server: ReturnType<ReturnType<typeof createApp>["listen"]>,
  base: string,
  dir: string;
let delivered: { text: string; html?: string }[] = [];
async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "starlly-email-"));
  handle = openDb(path.join(dir, "test.db"));
  _registerAdapterForTests({
    id: "email-studio",
    label: "HTML capture",
    configFields: [],
    capabilities: { html: true, replyTo: false, headers: false },
    test: async () => ({ ok: true }),
    send: async (_cfg, msg) => {
      delivered.push(msg);
      return { status: "accepted" };
    },
  });
  const ts = new Date().toISOString();
  handle.db
    .insert(business)
    .values({
      id: 1,
      name: "Email Business",
      ownerEmail: "owner@example.test",
      ownerName: "Owner",
      emailAdapterId: "email-studio",
      setupCompletedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: business.id,
      set: {
        name: "Email Business",
        ownerEmail: "owner@example.test",
        emailAdapterId: "email-studio",
        setupCompletedAt: ts,
      },
    })
    .run();
  server = createApp({
    db: handle.db,
    config: {
      port: 0,
      dataDir: dir,
      dbPath: path.join(dir, "test.db"),
      publicBaseUrl: "https://mail.example",
    },
  }).listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/api`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
describe("email layouts", () => {
  it("renders four distinct email-safe layouts and escapes owner/customer content", () => {
    const html = new Set<string>();
    for (const preset of [
      "branded",
      "letter",
      "spotlight",
      "compact",
    ] as const) {
      const email = renderEmail({
        body: "Hello {{customer}}\n{{link}}",
        design: defaultDesign(preset),
        vars: {
          business: "A & B",
          customer: "<script>alert(1)</script>",
          link: "https://mail.example/c/token",
        },
        imageUrl: () => null,
      });
      expect(email.html).toContain('role="presentation"');
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
      expect(email.html).toContain('href="https://mail.example/c/token"');
      expect(email.text).toContain("https://mail.example/c/token");
      html.add(email.html);
    }
    expect(html.size).toBe(4);
  });
  it("keeps the message and rejects duplicate blocks or injected colors", () => {
    const d = defaultDesign();
    expect(
      designSchema.safeParse({
        ...d,
        blocks: d.blocks.filter((b) => b.type !== "message"),
      }).success,
    ).toBe(false);
    expect(
      designSchema.safeParse({ ...d, blocks: [...d.blocks, d.blocks[0]] })
        .success,
    ).toBe(false);
    expect(
      designSchema.safeParse({ ...d, accent: "red;position:absolute" }).success,
    ).toBe(false);
  });
  it("invalidates approval when only the design changes", () => {
    const a = defaultDesign(),
      b = defaultDesign("letter");
    const state = approveDraft(
      { status: "draft", approvedAt: null, contentHash: "" },
      "Subject",
      "Body",
      "now",
      a,
    );
    expect(editDraft(state, "Subject", "Body", a).status).toBe("approved");
    expect(editDraft(state, "Subject", "Body", b).status).toBe("draft");
    expect(hashDraftContent("Subject", "Body")).not.toBe(
      hashDraftContent("Subject", "Body", a),
    );
  });
  it("stores resized assets and layouts, serves only images publicly, survives reopen and export/import", async () => {
    const data = (
      await sharp({
        create: {
          width: 1200,
          height: 400,
          channels: 4,
          background: "#7350dc",
        },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    const upload = await api("POST", "/email/assets", {
      name: "Our banner",
      data,
    });
    expect(upload.status).toBe(201);
    const a = upload.body.asset;
    expect(a.width).toBe(1200);
    expect(a).not.toHaveProperty("data");
    const image = await fetch(base.replace(/\/api$/, "") + a.url);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    const d = defaultDesign();
    d.blocks.find((b) => b.type === "banner")!.assetId = a.id;
    const layout = await api("POST", "/email/layouts", {
      name: "My branded email",
      design: d,
    });
    expect(layout.status).toBe(201);
    const snapshot = await api("GET", "/data/export");
    expect(snapshot.body.tables.emailAssets).toHaveLength(1);
    expect(snapshot.body.tables.emailLayouts).toHaveLength(1);
    expect((await api("DELETE", `/email/assets/${a.id}`)).status).toBe(409);
    const second = openDb(path.join(dir, "test.db"));
    expect(second.db.select().from(emailAssets).all()).toHaveLength(1);
    second.close();
    expect((await api("POST", "/data/delete")).status).toBe(200);
    expect((await api("GET", "/email/assets")).body.assets).toHaveLength(0);
    expect((await api("POST", "/data/import", snapshot.body)).status).toBe(200);
    expect((await api("GET", "/email/assets")).body.assets).toHaveLength(1);
    expect(
      (
        await api("POST", "/email/assets", {
          name: "not an image",
          data: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"),
        })
      ).status,
    ).toBe(400);
  });
  it("previews exactly the uploaded assets and sends HTML through the persisted outbox", async () => {
    const assets = (await api("GET", "/email/assets")).body.assets;
    const d = defaultDesign();
    d.blocks.find((b) => b.type === "banner")!.assetId = assets[0].id;
    // Restore profile following delete/import; sending settings intentionally remain local.
    await api("PUT", "/business", {
      name: "Email Business",
      ownerName: "Owner",
      ownerEmail: "owner@example.test",
      city: "Town",
      googleReviewUrl: "https://g.page/email",
    });
    const created = await api("POST", "/drafts", {
      kind: "follow_up",
      subject: "Hello",
      body: "Hi {{customer}}. {{link}}",
      emailDesign: d,
    });
    const id = created.body.id;
    const preview = await api("POST", `/drafts/${id}/preview`, {});
    expect(preview.body.html).toContain(assets[0].url);
    expect((await api("POST", `/drafts/${id}/test-send`)).body.outcome).toBe(
      "accepted",
    );
    expect(delivered.at(-1)!.html).toContain(
      "https://mail.example/api/public/email-assets/",
    );
    expect((await api("POST", `/drafts/${id}/test-send`)).body.outcome).toBe(
      "duplicate",
    );
    await api("POST", `/drafts/${id}/approve`);
    const patch = await api("PATCH", `/drafts/${id}`, {
      emailDesign: defaultDesign("letter"),
    });
    expect(patch.body.approvalInvalidated).toBe(true);
    const before = delivered.length;
    expect((await api("POST", `/drafts/${id}/test-send`)).body.outcome).toBe(
      "accepted",
    );
    expect(delivered.length).toBe(before + 1);
    expect((await api("POST", `/drafts/${id}/send`)).status).toBe(409);
    const row = handle.db.select().from(drafts).where(eq(drafts.id, id)).get()!;
    expect(row.emailDesign?.preset).toBe("letter");
  });
  it("blocks nonexistent images and image delivery without a public HTTPS address", async () => {
    const d = defaultDesign();
    d.blocks[0]!.assetId = "missing-image";
    expect(
      (
        await api("POST", "/drafts", {
          kind: "follow_up",
          subject: "Missing",
          body: "Hello",
          emailDesign: d,
        })
      ).status,
    ).toBe(400);
    const assets = (await api("GET", "/email/assets")).body.assets;
    d.blocks[0]!.assetId = assets[0].id;
    const row = await api("POST", "/drafts", {
      kind: "follow_up",
      subject: "Images",
      body: "Hello {{link}}",
      emailDesign: d,
    });
    const local = createApp({
      db: handle.db,
      config: { port: 0, dataDir: dir, dbPath: path.join(dir, "test.db") },
    }).listen(0);
    await new Promise<void>((r) => local.once("listening", r));
    const addr = local.address();
    try {
      const r = await fetch(
        `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/drafts/${row.body.id}/test-send`,
        { method: "POST" },
      );
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: "public_url_required" });
    } finally {
      local.closeAllConnections();
      await new Promise<void>((r) => local.close(() => r()));
    }
  });
  it("sends approved customer HTML once, with the canonical request link and all custom text checked", async () => {
    const c = await api("POST", "/customers", {
      name: "Customer",
      contact: "customer@example.test",
      serviceType: "visit",
      consent: true,
    });
    const d = defaultDesign("compact");
    d.blocks.splice(2, 0, {
      id: "custom-copy",
      type: "text",
      text: "We appreciate your time.",
      assetId: null,
      alt: "",
    });
    const created = await api("POST", "/drafts", {
      kind: "review_request",
      customerId: c.body.id,
      subject: "Your visit",
      body: "Hi {{customer}}. Tell us what you think: {{link}}",
      emailDesign: d,
    });
    await api("POST", `/drafts/${created.body.id}/approve`);
    const before = delivered.length,
      result = await api("POST", `/drafts/${created.body.id}/send`);
    expect(result.body.outcome).toBe("accepted");
    expect(delivered.at(-1)!.html).toContain(`href="${result.body.link}"`);
    expect(delivered.at(-1)!.text).toContain("We appreciate your time.");
    expect(
      (await api("POST", `/drafts/${created.body.id}/send`)).body.outcome,
    ).toBe("duplicate");
    expect(delivered.length).toBe(before + 1);
    const bad = defaultDesign();
    bad.blocks.splice(2, 0, {
      id: "bad-copy",
      type: "text",
      text: "Leave a five-star review and get a discount",
      assetId: null,
      alt: "",
    });
    const badDraft = await api("POST", "/drafts", {
      kind: "review_request",
      customerId: c.body.id,
      subject: "Your visit",
      body: "Hello {{link}}",
      emailDesign: bad,
    });
    await api("POST", `/drafts/${badDraft.body.id}/approve`);
    expect((await api("POST", `/drafts/${badDraft.body.id}/send`)).status).toBe(
      422,
    );
  });
  it("maps HTML and plain text to Agentboxd and OpenMail request bodies", async () => {
    const original = globalThis.fetch,
      bodies: any[] = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ id: "id", messageId: "id", status: "queued" }),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const msg = {
        to: "customer@example.test",
        subject: "Hello",
        text: "Plain",
        html: "<p>Rich</p>",
      };
      await agentboxdAdapter.send({ apiKey: "FAKE", inboxId: "inbox" }, msg, {
        idempotencyKey: "test",
      });
      await openMailAdapter.send({ apiKey: "FAKE", inboxId: "inbox" }, msg, {
        idempotencyKey: "test",
      });
      expect(bodies[0]).toMatchObject({ text: "Plain", html: "<p>Rich</p>" });
      expect(bodies[1]).toMatchObject({
        body: "Plain",
        bodyHtml: "<p>Rich</p>",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
  it("rejects unsafe imported designs without replacing existing data and protects the owner asset library", async () => {
    const before = (await api("GET", "/email/assets")).body.assets;
    const snapshot = (await api("GET", "/data/export")).body;
    snapshot.tables.drafts[0].emailDesign = {
      ...defaultDesign(),
      accent: "red;position:absolute",
    };
    expect((await api("POST", "/data/import", snapshot)).status).toBe(400);
    expect((await api("GET", "/email/assets")).body.assets).toHaveLength(
      before.length,
    );
    expect(
      (await api("POST", "/auth/setup", { password: "email-test-password" }))
        .status,
    ).toBe(200);
    expect((await api("GET", "/email/assets")).status).toBe(401);
    const image = await fetch(base.replace(/\/api$/, "") + before[0].url);
    expect(image.status).toBe(200);
  });
});
