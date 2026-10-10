import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, ApiError } from "../lib/api.js";
import { Modal, ErrorBanner } from "./ui.js";

export type BlockType =
  | "logo"
  | "banner"
  | "image"
  | "heading"
  | "text"
  | "message"
  | "button"
  | "divider"
  | "spacer"
  | "footer";
export interface EmailBlock {
  id: string;
  type: BlockType;
  text: string;
  assetId: string | null;
  alt: string;
}
export interface EmailDesign {
  preset: "branded" | "letter" | "spotlight" | "compact" | "custom";
  accent: string;
  background: string;
  blocks: EmailBlock[];
}
interface Asset {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  mime: string;
}
interface Layout {
  id: string;
  name: string;
  design: EmailDesign;
}
const presets = [
  { id: "branded", name: "Branded", hint: "Logo, banner & a warm welcome" },
  { id: "letter", name: "Letter", hint: "Personal, simple & spacious" },
  { id: "spotlight", name: "Spotlight", hint: "A bold banner & dark header" },
  { id: "compact", name: "Compact", hint: "A short, focused invitation" },
] as const;
export function defaultEmailDesign(
  preset: EmailDesign["preset"] = "branded",
): EmailDesign {
  const types: Record<string, BlockType[]> = {
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
function message(err: unknown) {
  return err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : "Please try again.";
}

interface CropSource {
  url: string;
  name: string;
  target: string | null;
  format: "logo" | "banner" | "photo";
}
function ImageFormatter({
  source,
  onClose,
  onSave,
}: {
  source: CropSource;
  onClose: () => void;
  onSave: (name: string, data: string, target: string | null) => Promise<void>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null),
    [format, setFormat] = useState(source.format),
    [mode, setMode] = useState<"fit" | "fill">(
      source.format === "logo" ? "fit" : "fill",
    ),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [name, setName] = useState(source.name);
  const [width, height] =
    format === "logo"
      ? [400, 400]
      : format === "banner"
        ? [1200, 400]
        : [1200, 800];
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setImage(img);
    };
    img.onerror = () => {
      if (active)
        setError("This image could not be opened. Choose a PNG, JPEG or WebP.");
    };
    img.src = source.url;
    return () => {
      active = false;
    };
  }, [source.url]);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx || !image) return;
    c.width = width;
    c.height = height;
    ctx.clearRect(0, 0, width, height);
    if (format !== "logo") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    const scale =
      (mode === "fit"
        ? Math.min(width / image.width, height / image.height)
        : Math.max(width / image.width, height / image.height)) * zoom;
    const w = image.width * scale,
      h = image.height * scale;
    ctx.drawImage(
      image,
      ((width - w) * x) / 100,
      ((height - h) * y) / 100,
      w,
      h,
    );
  }, [image, width, height, format, mode, zoom, x, y]);
  return (
    <Modal title="Fit your image" onClose={busy ? () => {} : onClose}>
      <p className="card-sub">
        Crop a banner, keep your whole logo, or resize a photo. The formatted
        image stays in your asset library.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="email-crop-preview">
        <canvas
          ref={canvas}
          aria-label="Formatted image preview"
          style={{ aspectRatio: `${width}/${height}` }}
        />
      </div>
      <div className="email-crop-fields">
        <label>
          Asset name
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Format
          <select
            value={format}
            onChange={(e) => {
              const v = e.target.value as typeof format;
              setFormat(v);
              setMode(v === "logo" ? "fit" : "fill");
              setZoom(1);
              setX(50);
              setY(50);
            }}
          >
            <option value="logo">Logo · 400 × 400</option>
            <option value="banner">Banner · 1200 × 400</option>
            <option value="photo">Photo · 1200 × 800</option>
          </select>
        </label>
        <label>
          How it fits
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="fill">Crop to fill</option>
            <option value="fit">Keep the whole image</option>
          </select>
        </label>
        <label>
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <label>
          Horizontal position
          <input
            type="range"
            min="0"
            max="100"
            value={x}
            onChange={(e) => setX(Number(e.target.value))}
          />
        </label>
        <label>
          Vertical position
          <input
            type="range"
            min="0"
            max="100"
            value={y}
            onChange={(e) => setY(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="email-toolbar">
        <button className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !image || !name.trim()}
          onClick={async () => {
            if (!canvas.current) return;
            setBusy(true);
            setError(null);
            try {
              const data = canvas.current
                .toDataURL(format === "logo" ? "image/png" : "image/jpeg", 0.85)
                .split(",")[1]!;
              await onSave(name.trim(), data, source.target);
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving image…" : "Save to assets"}
        </button>
      </div>
    </Modal>
  );
}

export function EmailPreview({
  draftId,
  body,
  design,
}: {
  draftId: string;
  body: string;
  design: EmailDesign | null;
}) {
  const [html, setHtml] = useState(""),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    const timer = setTimeout(() => {
      void api
        .post<{ html: string }>(`/api/drafts/${draftId}/preview`, {
          body,
          emailDesign: design,
        })
        .then((r) => {
          if (active) setHtml(r.html);
        })
        .catch((err) => {
          if (active) setError(message(err));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draftId, body, design]);
  return error ? (
    <ErrorBanner message={error} />
  ) : (
    <iframe
      className="email-rendered-preview"
      title="Customer email preview"
      sandbox=""
      srcDoc={html}
    />
  );
}

export default function EmailStudio({
  draftId,
  body,
  design,
  onChange,
  disabled,
}: {
  draftId: string;
  body: string;
  design: EmailDesign | null;
  onChange: (d: EmailDesign) => void;
  disabled: boolean;
}) {
  const d = design ?? defaultEmailDesign();
  const [assets, setAssets] = useState<Asset[]>([]),
    [layouts, setLayouts] = useState<Layout[]>([]),
    [drawer, setDrawer] = useState(false),
    [target, setTarget] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [crop, setCrop] = useState<CropSource | null>(null),
    [error, setError] = useState<string | null>(null),
    [layoutName, setLayoutName] = useState(""),
    [note, setNote] = useState(""),
    [preview, setPreview] = useState(false),
    [publicUrl, setPublicUrl] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      if (crop) URL.revokeObjectURL(crop.url);
    },
    [crop],
  );
  useEffect(() => {
    if (!drawer || crop) return;
    const before = document.activeElement as HTMLElement | null;
    drawerClose.current?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !crop) {
        setDrawer(false);
        before?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer, crop]);
  useEffect(() => {
    void Promise.all([
      api.get<{ assets: Asset[]; publicBaseUrl: string | null }>(
        "/api/email/assets",
      ),
      api.get<{ layouts: Layout[] }>("/api/email/layouts"),
    ])
      .then(([a, l]) => {
        setAssets(a.assets);
        setPublicUrl(a.publicBaseUrl);
        setLayouts(l.layouts);
      })
      .catch((err) => setError(message(err)));
  }, []);
  useEffect(() => {
    setSelected(null);
    setError(null);
    setNote("");
  }, [draftId]);
  const change = (blocks: EmailBlock[]) => {
    if (!disabled) onChange({ ...d, blocks });
  };
  const update = (id: string, patch: Partial<EmailBlock>) =>
    change(d.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const add = (
    type: BlockType,
    assetId: string | null = null,
    at = d.blocks.length - 1,
  ) => {
    if (disabled || d.blocks.length >= 30) return;
    const asset = assets.find((a) => a.id === assetId),
      b: EmailBlock = {
        id: crypto.randomUUID(),
        type,
        text:
          type === "heading"
            ? "Your heading"
            : type === "text"
              ? "Add your own message here."
              : type === "button"
                ? "Share your feedback"
                : "",
        assetId,
        alt: asset?.name ?? "",
      };
    const blocks = [...d.blocks];
    blocks.splice(Math.max(0, at), 0, b);
    change(blocks);
    setSelected(b.id);
  };
  const move = (id: string, at: number) => {
    const blocks = [...d.blocks],
      from = blocks.findIndex((b) => b.id === id);
    if (from < 0) return;
    const [b] = blocks.splice(from, 1);
    blocks.splice(Math.max(0, Math.min(at, blocks.length)), 0, b!);
    change(blocks);
  };
  const attach = (id: string, where: string | null) => {
    const a = assets.find((a) => a.id === id),
      b = d.blocks.find((b) => b.id === where);
    if (b && ["logo", "banner", "image"].includes(b.type))
      update(b.id, { assetId: id, alt: a?.name ?? "" });
    else add("image", id, b ? d.blocks.indexOf(b) + 1 : undefined);
  };
  const openFile = (file: File, where: string | null) => {
    if (disabled) return;
    setError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Choose an image smaller than 15 MB, then resize it here.");
      return;
    }
    const type = d.blocks.find((b) => b.id === where)?.type;
    setCrop({
      url: URL.createObjectURL(file),
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
      target: where,
      format: type === "logo" ? "logo" : type === "banner" ? "banner" : "photo",
    });
  };
  const drop = (e: DragEvent, where: string | null) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const block = e.dataTransfer.getData("application/x-starlly-block"),
      asset = e.dataTransfer.getData("application/x-starlly-asset");
    if (block)
      move(
        block,
        where ? d.blocks.findIndex((b) => b.id === where) : d.blocks.length - 1,
      );
    else if (asset) attach(asset, where);
    else if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0], where);
  };
  const rgb = [1, 3, 5]
    .map((i) => parseInt(d.accent.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const buttonInk =
    0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! > 0.179
      ? "#000000"
      : "#ffffff";
  const chosen = d.blocks.find((b) => b.id === selected);
  return (
    <div className="email-studio">
      <div className="email-studio-heading">
        <div>
          <h3>Email design</h3>
          <p>Start with a layout. Make it yours.</p>
        </div>
        <div className="email-toolbar">
          <button
            type="button"
            className="btn"
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Edit layout" : "Preview email"}
          </button>
          <button
            type="button"
            className="btn email-assets-trigger"
            onClick={() => {
              setTarget(null);
              setDrawer(true);
            }}
          >
            Assets <span>{assets.length}</span>
          </button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {note && (
        <p className="email-note" role="status">
          {note}
        </p>
      )}
      <div className="email-presets" aria-label="Default email layouts">
        {presets.map((p) => (
          <button
            type="button"
            className={`email-preset ${d.preset === p.id ? "active" : ""}`}
            key={p.id}
            disabled={disabled}
            aria-pressed={d.preset === p.id}
            onClick={() => {
              const next = defaultEmailDesign(p.id);
              for (const block of next.blocks) {
                const old = d.blocks.find(
                  (b) => b.type === block.type && b.assetId,
                );
                if (old) {
                  block.assetId = old.assetId;
                  block.alt = old.alt;
                }
              }
              onChange(next);
              setSelected(null);
            }}
          >
            <span className={`email-miniature ${p.id}`} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <strong>{p.name}</strong>
            <small>{p.hint}</small>
          </button>
        ))}
      </div>
      <div className="email-custom-layouts">
        <label>
          Saved layouts
          <select
            disabled={disabled}
            value=""
            onChange={(e) => {
              const l = layouts.find((l) => l.id === e.target.value);
              if (l) onChange(l.design);
            }}
          >
            <option value="">Choose your own layout…</option>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Layout name"
          placeholder="Name your layout"
          value={layoutName}
          maxLength={80}
          disabled={disabled}
          onChange={(e) => setLayoutName(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={disabled || !layoutName.trim()}
          onClick={async () => {
            try {
              const r = await api.post<{ layout: Layout }>(
                "/api/email/layouts",
                { name: layoutName.trim(), design: d },
              );
              setLayouts([r.layout, ...layouts]);
              setLayoutName("");
              setNote("Layout saved. It is ready to use in another email.");
            } catch (err) {
              setError(message(err));
            }
          }}
        >
          Save layout
        </button>
      </div>
      {preview ? (
        <EmailPreview draftId={draftId} body={body} design={design} />
      ) : (
        <div className="email-builder">
          <div
            className="email-canvas-wrap"
            style={{ background: d.background }}
            onDragOver={(e) => {
              if (!disabled) e.preventDefault();
            }}
            onDrop={(e) => drop(e, null)}
          >
            <div
              className={`email-canvas ${d.preset}`}
              aria-label="Email layout canvas"
            >
              {d.blocks.map((b, i) => {
                const a = assets.find((a) => a.id === b.assetId),
                  isImage = ["logo", "banner", "image"].includes(b.type);
                return (
                  <div
                    key={b.id}
                    className={`email-block ${b.type} ${selected === b.id ? "selected" : ""}`}
                    onDragOver={(e) => {
                      if (!disabled) e.preventDefault();
                    }}
                    onDrop={(e) => drop(e, b.id)}
                  >
                    <button
                      type="button"
                      className="email-block-select"
                      aria-label={`Edit ${b.type} block ${i + 1}`}
                      onClick={() => setSelected(b.id)}
                    >
                      {isImage ? (
                        a ? (
                          <img src={a.url} alt={b.alt || a.name} />
                        ) : (
                          <span className="email-image-placeholder">
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              aria-hidden="true"
                            >
                              <rect x="3" y="3" width="18" height="18" rx="3" />
                              <circle cx="9" cy="9" r="2" />
                              <path d="m3 17 6-5 4 3 4-6 4 7" />
                            </svg>
                            <strong>
                              {b.type === "logo"
                                ? "Your logo"
                                : b.type === "banner"
                                  ? "Your banner"
                                  : "Your image"}
                            </strong>
                            <small>Drop an image or choose from Assets</small>
                          </span>
                        )
                      ) : b.type === "divider" ? (
                        <hr />
                      ) : b.type === "spacer" ? (
                        <span className="email-spacer">Space</span>
                      ) : b.type === "button" ? (
                        <span
                          className="email-cta"
                          style={{ background: d.accent, color: buttonInk }}
                        >
                          {b.text || "Share your feedback"}
                        </span>
                      ) : b.type === "message" ? (
                        <span className="email-message-text">{body}</span>
                      ) : b.type === "footer" ? (
                        <span>
                          {b.text ||
                            "Your business · A little more clarity, every day."}
                        </span>
                      ) : (
                        <span>{b.text}</span>
                      )}
                    </button>
                    {!disabled && (
                      <button
                        type="button"
                        className="email-drag-handle"
                        draggable
                        aria-label={`Drag ${b.type} block`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-starlly-block",
                            b.id,
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => setSelected(b.id)}
                      >
                        <svg
                          width="14"
                          height="20"
                          viewBox="0 0 14 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          {[5, 10, 15].map((y) => (
                            <g key={y}>
                              <circle cx="4" cy={y} r="1.1" />
                              <circle cx="10" cy={y} r="1.1" />
                            </g>
                          ))}
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="email-canvas-caption">
              Drag blocks to reorder. Drop images into the email.
            </p>
          </div>
          <aside className="email-inspector">
            <h4>{chosen ? `Edit ${chosen.type}` : "Make it yours"}</h4>
            {chosen ? (
              <>
                {["logo", "banner", "image"].includes(chosen.type) ? (
                  <>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => {
                        setTarget(chosen.id);
                        setDrawer(true);
                      }}
                    >
                      Choose image
                    </button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => {
                        setTarget(chosen.id);
                        input.current?.click();
                      }}
                    >
                      Upload & resize
                    </button>
                    <label>
                      Image description
                      <input
                        disabled={disabled}
                        value={chosen.alt}
                        onChange={(e) =>
                          update(chosen.id, { alt: e.target.value })
                        }
                        maxLength={200}
                      />
                    </label>
                    {chosen.assetId && (
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() =>
                          update(chosen.id, { assetId: null, alt: "" })
                        }
                      >
                        Remove image
                      </button>
                    )}
                  </>
                ) : chosen.type === "message" ? (
                  <p className="card-sub">
                    Edit the body above. The customer link is kept in this
                    message.
                  </p>
                ) : ["heading", "text", "button", "footer"].includes(
                    chosen.type,
                  ) ? (
                  <label>
                    {chosen.type === "button" ? "Button label" : "Text"}
                    <textarea
                      rows={4}
                      maxLength={5000}
                      disabled={disabled}
                      value={chosen.text}
                      onChange={(e) =>
                        update(chosen.id, { text: e.target.value })
                      }
                    />
                  </label>
                ) : null}
                <div className="email-toolbar">
                  <button
                    className="btn"
                    aria-label="Move block up"
                    disabled={disabled || d.blocks.indexOf(chosen) === 0}
                    onClick={() =>
                      move(chosen.id, d.blocks.indexOf(chosen) - 1)
                    }
                  >
                    Move up
                  </button>
                  <button
                    className="btn"
                    aria-label="Move block down"
                    disabled={
                      disabled ||
                      d.blocks.indexOf(chosen) === d.blocks.length - 1
                    }
                    onClick={() =>
                      move(chosen.id, d.blocks.indexOf(chosen) + 1)
                    }
                  >
                    Move down
                  </button>
                </div>
                {chosen.type !== "message" && (
                  <button
                    className="btn"
                    disabled={disabled}
                    onClick={() => {
                      change(d.blocks.filter((b) => b.id !== chosen.id));
                      setSelected(null);
                    }}
                  >
                    Remove block
                  </button>
                )}
              </>
            ) : (
              <p className="card-sub">
                Select a block to edit its content or image. Your message is
                always included.
              </p>
            )}
            <div className="email-add-blocks">
              <h4>Add a block</h4>
              {(
                [
                  "heading",
                  "text",
                  "image",
                  "button",
                  "divider",
                  "spacer",
                ] as BlockType[]
              ).map((type) => (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || d.blocks.length >= 30}
                  key={type}
                  onClick={() => add(type)}
                >
                  {type === "spacer"
                    ? "Space"
                    : type[0]!.toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            <label>
              Button color
              <input
                type="color"
                value={d.accent}
                disabled={disabled}
                onChange={(e) => onChange({ ...d, accent: e.target.value })}
              />
            </label>
            <label>
              Email background
              <input
                type="color"
                value={d.background}
                disabled={disabled}
                onChange={(e) => onChange({ ...d, background: e.target.value })}
              />
            </label>
          </aside>
        </div>
      )}
      <input
        className="email-file-input"
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload email image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f, target);
          e.target.value = "";
        }}
      />
      {drawer && (
        <>
          <button
            className="email-drawer-backdrop"
            aria-label="Close asset drawer"
            onClick={() => setDrawer(false)}
          />
          <aside className="email-asset-drawer" aria-label="Email assets">
            <div className="email-studio-heading">
              <div>
                <h3>Your assets</h3>
                <p>Images ready for your next email.</p>
              </div>
              <button
                ref={drawerClose}
                className="btn"
                onClick={() => setDrawer(false)}
              >
                Close
              </button>
            </div>
            <button
              className="email-upload-zone"
              disabled={disabled}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                if (!disabled) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) openFile(f, target);
              }}
            >
              <strong>Drop an image here</strong>
              <span>or browse your files</span>
              <small>PNG, JPEG, WebP · up to 15 MB</small>
            </button>
            {!publicUrl && assets.length > 0 && (
              <p className="email-asset-help">
                For images to load in a customer’s inbox, set a public website
                address for this app (PUBLIC_BASE_URL).
              </p>
            )}
            {assets.length === 0 ? (
              <p className="email-asset-help">
                Add your logo, a banner or a photo. Each image is resized before
                it is saved here.
              </p>
            ) : (
              <div className="email-asset-list">
                {assets.map((a) => (
                  <div
                    className="email-asset"
                    key={a.id}
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-starlly-asset",
                        a.id,
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <img src={a.url} alt={a.name} />
                    <strong title={a.name}>{a.name}</strong>
                    <small>
                      {a.width} × {a.height}
                    </small>
                    <div className="email-toolbar">
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => {
                          attach(a.id, target);
                          setDrawer(false);
                        }}
                      >
                        Use image
                      </button>
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={async () => {
                          try {
                            const blob = await (await fetch(a.url)).blob();
                            setCrop({
                              url: URL.createObjectURL(blob),
                              name: a.name,
                              target,
                              format:
                                d.blocks.find((b) => b.id === target)?.type ===
                                "logo"
                                  ? "logo"
                                  : "banner",
                            });
                          } catch (err) {
                            setError(message(err));
                          }
                        }}
                      >
                        Resize
                      </button>
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={async () => {
                          try {
                            await api.delete(`/api/email/assets/${a.id}`);
                            setAssets(assets.filter((x) => x.id !== a.id));
                          } catch (err) {
                            setError(message(err));
                            setDrawer(false);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {layouts.length > 0 && (
              <details className="email-saved-manage">
                <summary>Manage saved layouts</summary>
                {layouts.map((l) => (
                  <div key={l.id}>
                    <span>{l.name}</span>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={async () => {
                        try {
                          await api.delete(`/api/email/layouts/${l.id}`);
                          setLayouts(layouts.filter((x) => x.id !== l.id));
                        } catch (err) {
                          setError(message(err));
                          setDrawer(false);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </details>
            )}
          </aside>
        </>
      )}
      {crop && (
        <ImageFormatter
          source={crop}
          onClose={() => setCrop(null)}
          onSave={async (name, data, where) => {
            const r = await api.post<{ asset: Asset }>("/api/email/assets", {
              name,
              data,
            });
            setAssets((prev) => [r.asset, ...prev]);
            const b = d.blocks.find((b) => b.id === where);
            if (b && ["logo", "banner", "image"].includes(b.type))
              update(b.id, { assetId: r.asset.id, alt: name });
            else if (where !== null) add("image", r.asset.id);
            setCrop(null);
            setNote("Image saved to your assets.");
          }}
        />
      )}
    </div>
  );
}
