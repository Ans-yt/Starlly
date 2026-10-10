import crypto from "node:crypto";
import { eq, desc } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { asyncRouter } from "../async-router.js";
import type { AppServices } from "../app.js";
import { emailAssets, emailLayouts } from "../../db/schema.js";
import { designSchema } from "../../email/design.js";

export function publicEmailAssetsRouter({ db }: AppServices) {
  const router = asyncRouter();
  router.get("/email-assets/:token", (req, res) => {
    const row = db
      .select()
      .from(emailAssets)
      .where(eq(emailAssets.token, req.params.token))
      .get();
    if (!row || !["image/png", "image/jpeg", "image/webp"].includes(row.mime)) {
      res.sendStatus(404);
      return;
    }
    res
      .set({
        "Content-Type": row.mime,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400",
        "Content-Security-Policy": "default-src 'none'",
      })
      .send(Buffer.from(row.data, "base64"));
  });
  return router;
}
export function emailStudioRouter(services: AppServices) {
  const { db } = services,
    router = asyncRouter();
  const view = (a: typeof emailAssets.$inferSelect) => ({
    id: a.id,
    name: a.name,
    width: a.width,
    height: a.height,
    mime: a.mime,
    url: `/api/public/email-assets/${a.token}`,
    createdAt: a.createdAt,
  });
  router.get("/email/assets", (_req, res) =>
    res.json({
      assets: db
        .select()
        .from(emailAssets)
        .orderBy(desc(emailAssets.createdAt))
        .all()
        .map(view),
      publicBaseUrl: services.config.publicBaseUrl ?? null,
    }),
  );
  router.post("/email/assets", async (req, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120),
        data: z
          .string()
          .max(1450000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation",
        message:
          "Upload a PNG, JPEG or WebP image smaller than 1 MB after resizing.",
      });
      return;
    }
    if (
      db.select({ id: emailAssets.id }).from(emailAssets).all().length >= 40
    ) {
      res.status(409).json({
        error: "asset_limit",
        message: "Your library holds 40 images. Remove an unused image first.",
      });
      return;
    }
    try {
      const bytes = Buffer.from(parsed.data.data, "base64");
      if (bytes.length > 1024 * 1024) throw Error("size");
      const image = sharp(bytes, { limitInputPixels: 16777216 });
      const meta = await image.metadata();
      if (
        !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
        !meta.width ||
        !meta.height ||
        meta.width > 4096 ||
        meta.height > 4096 ||
        (meta.pages ?? 1) > 1
      )
        throw Error("format");
      // Re-encode: remove metadata and reject SVG/HTML masquerading as images.
      const output = await image
        .rotate()
        .toFormat(meta.format as "png" | "jpeg" | "webp")
        .toBuffer({ resolveWithObject: true });
      if (output.data.length > 1024 * 1024) {
        res.status(400).json({
          error: "image_size",
          message:
            "This image is still too large. Choose a smaller format or lower the output size.",
        });
        return;
      }
      const row = {
        id: crypto.randomUUID(),
        name: parsed.data.name,
        token: crypto.randomBytes(24).toString("base64url"),
        data: output.data.toString("base64"),
        mime: `image/${meta.format === "jpeg" ? "jpeg" : meta.format}`,
        width: output.info.width,
        height: output.info.height,
        createdAt: new Date().toISOString(),
      };
      db.insert(emailAssets).values(row).run();
      res.status(201).json({ asset: view(row) });
    } catch {
      res.status(400).json({
        error: "image_invalid",
        message:
          "That image could not be read. Use a PNG, JPEG or WebP under 4096 pixels.",
      });
    }
  });
  router.delete("/email/assets/:id", (req, res) => {
    // Existing emails may refer to these URLs. Deleting an image is therefore
    // explicit, and blocked while a draft or saved layout references it.
    const id = req.params.id;
    const draftRefs = db.query.drafts
      .findMany()
      .sync()
      .some((d) => d.emailDesign?.blocks.some((b) => b.assetId === id));
    const layoutRefs = db
      .select()
      .from(emailLayouts)
      .all()
      .some((d) => d.design.blocks.some((b) => b.assetId === id));
    if (draftRefs || layoutRefs) {
      res.status(409).json({
        error: "asset_in_use",
        message:
          "This image is used in an email or saved layout. Keep it so those images continue to load.",
      });
      return;
    }
    db.delete(emailAssets).where(eq(emailAssets.id, id)).run();
    res.json({ ok: true });
  });
  router.get("/email/layouts", (_req, res) =>
    res.json({
      layouts: db
        .select()
        .from(emailLayouts)
        .orderBy(desc(emailLayouts.createdAt))
        .all(),
    }),
  );
  router.post("/email/layouts", (req, res) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80), design: designSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation",
        message: "Give this layout a name and keep its message block.",
      });
      return;
    }
    if (
      parsed.data.design.blocks.some(
        (b) =>
          b.assetId &&
          !db
            .select({ id: emailAssets.id })
            .from(emailAssets)
            .where(eq(emailAssets.id, b.assetId))
            .get(),
      )
    ) {
      res
        .status(400)
        .json({
          error: "asset_missing",
          message:
            "Choose an image from your asset library before saving this layout.",
        });
      return;
    }
    if (db.select().from(emailLayouts).all().length >= 30) {
      res.status(409).json({
        error: "layout_limit",
        message: "Remove an unused saved layout first (maximum 30).",
      });
      return;
    }
    const row = {
      id: crypto.randomUUID(),
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };
    db.insert(emailLayouts).values(row).run();
    res.status(201).json({ layout: row });
  });
  router.delete("/email/layouts/:id", (req, res) => {
    db.delete(emailLayouts).where(eq(emailLayouts.id, req.params.id)).run();
    res.json({ ok: true });
  });
  return router;
}
