import { z } from "zod";

export const blockSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum([
    "logo",
    "banner",
    "image",
    "heading",
    "text",
    "message",
    "button",
    "divider",
    "spacer",
    "footer",
  ]),
  text: z.string().max(5000).default(""),
  assetId: z.string().max(100).nullable().default(null),
  alt: z.string().max(200).default(""),
});
export const designSchema = z
  .object({
    preset: z.enum(["branded", "letter", "spotlight", "compact", "custom"]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    blocks: z.array(blockSchema).min(1).max(30),
  })
  .superRefine((d, ctx) => {
    if (d.blocks.filter((b) => b.type === "message").length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Keep exactly one message block.",
      });
    if (d.blocks.reduce((n, b) => n + b.text.length + b.alt.length, 0) > 30000)
      ctx.addIssue({
        code: "custom",
        message: "Keep custom layout text below 30,000 characters.",
      });
    if (new Set(d.blocks.map((b) => b.id)).size !== d.blocks.length)
      ctx.addIssue({ code: "custom", message: "Block IDs must be unique." });
  });
export type EmailDesign = z.infer<typeof designSchema>;
export type EmailBlock = EmailDesign["blocks"][number];
export function defaultDesign(
  preset: EmailDesign["preset"] = "branded",
): EmailDesign {
  const types: Record<string, EmailBlock["type"][]> = {
    branded: ["logo", "banner", "heading", "message", "button", "footer"],
    letter: ["logo", "message", "button", "divider", "footer"],
    spotlight: ["banner", "logo", "heading", "message", "button", "footer"],
    compact: ["logo", "heading", "message", "button", "footer"],
  };
  return {
    preset,
    accent: "#7350dc",
    background: preset === "letter" ? "#ffffff" : "#f5f4f8",
    blocks: (types[preset] ?? types.branded!).map((type, i) => ({
      id: `block-${i}`,
      type,
      text:
        type === "heading"
          ? "A little feedback goes a long way."
          : type === "button"
            ? "Share your feedback"
            : "",
      assetId: null,
      alt: "",
    })),
  };
}
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => vars[key] ?? match,
  );
}
export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function designText(body: string, design: EmailDesign | null): string {
  if (!design) return body;
  return design.blocks
    .map((b) =>
      b.type === "message"
        ? body
        : ["heading", "text", "button", "footer"].includes(b.type)
          ? b.text
          : b.assetId
            ? b.alt
            : "",
    )
    .filter(Boolean)
    .join("\n\n");
}
export function renderEmail(input: {
  body: string;
  design: EmailDesign | null;
  vars: Record<string, string>;
  imageUrl: (id: string) => string | null;
}): { text: string; html: string } {
  const d = input.design ?? defaultDesign();
  const t = (s: string) =>
    escapeHtml(substitute(s, input.vars)).replace(/\n/g, "<br>");
  const accent = d.accent,
    dark = d.preset === "spotlight";
  const rgb = [1, 3, 5]
    .map((i) => parseInt(accent.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  const buttonInk = luminance > 0.179 ? "#000000" : "#ffffff";
  const messageHtml = input.body
    .split("{{link}}")
    .map(t)
    .join(
      input.vars.link && /^https?:\/\//i.test(input.vars.link)
        ? `<a href="${escapeHtml(input.vars.link)}" style="color:#5131b1;text-decoration:underline">${escapeHtml(input.vars.link)}</a>`
        : t("{{link}}"),
    );
  const rows = d.blocks
    .map((b) => {
      if (["logo", "banner", "image"].includes(b.type)) {
        const src = b.assetId ? input.imageUrl(b.assetId) : null;
        if (!src)
          return b.type === "logo"
            ? `<tr><td style="padding:24px 32px;font-size:20px;font-weight:bold;color:${dark ? "#ffffff" : "#23212e"};background:${dark ? "#23212e" : "#ffffff"}">${t(input.vars.business ?? "")}</td></tr>`
            : "";
        return `<tr><td style="padding:${b.type === "logo" ? "24px 32px" : "0"};background:${dark && b.type === "logo" ? "#23212e" : "#ffffff"}"><img src="${escapeHtml(src)}" alt="${t(b.alt)}" width="${b.type === "logo" ? 96 : 600}" style="display:block;border:0;max-width:100%;height:auto;${b.type === "logo" ? "max-height:96px;width:auto" : "width:100%"}"></td></tr>`;
      }
      if (b.type === "divider")
        return '<tr><td style="padding:16px 32px"><hr style="border:0;border-top:1px solid #e5e3eb"></td></tr>';
      if (b.type === "spacer")
        return '<tr><td height="24" style="height:24px;font-size:1px">&nbsp;</td></tr>';
      if (b.type === "button") {
        const link = input.vars.link;
        if (!link || !/^https?:\/\//i.test(link)) return "";
        return `<tr><td style="padding:16px 32px 28px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="${accent}" style="border-radius:8px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;font-size:16px;font-weight:bold;color:${buttonInk};text-decoration:none">${t(b.text || "Share your feedback")}</a></td></tr></table></td></tr>`;
      }
      const text =
        b.type === "message"
          ? input.body
          : b.type === "footer"
            ? b.text || input.vars.business || ""
            : b.text;
      return `<tr><td style="padding:${b.type === "heading" ? "28px 32px 12px" : "12px 32px"};font-size:${b.type === "heading" ? "26" : b.type === "footer" ? "12" : "16"}px;line-height:1.6;color:${b.type === "footer" ? "#696572" : "#23212e"};${b.type === "heading" ? "font-weight:bold;" : ""}">${b.type === "message" ? messageHtml : t(text)}</td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 8px;background:${d.background};font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:${d.preset === "compact" ? 480 : 600}px;background:#ffffff;border-radius:${d.preset === "letter" ? 0 : 12}px;overflow:hidden">${rows}<tr><td height="20"></td></tr></table></td></tr></table></body></html>`;
  return {
    text: substitute(designText(input.body, input.design), input.vars),
    html,
  };
}
