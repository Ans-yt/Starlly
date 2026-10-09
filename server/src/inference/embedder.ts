// Embedding client: cache-first (embed_cache table, ADR-0003), backed by the
// worker thread in production (dist) or an in-process fallback under tsx dev.
// Tests inject a stub via _setRawEmbedderForTests — no model is ever loaded
// under Vitest.
import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { embedCache } from "../db/schema.js";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

let override: EmbedFn | null = null;
let workerState: {
  worker: Worker;
  nextId: number;
  pending: Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>;
} | null = null;
let inProcessImpl: EmbedFn | null = null;

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function startWorker() {
  if (process.env.VITEST) return null; // never spawn/load heavy deps in tests
  const file = fileURLToPath(new URL("./worker.js", import.meta.url));
  if (!fs.existsSync(file)) return null; // tsx dev without a built worker.js
  const worker = new Worker(file);
  const state = {
    worker,
    nextId: 1,
    pending: new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>(),
  };
  worker.on("message", (msg: { kind: string; id: number; vectors?: number[][]; message?: string }) => {
    const entry = state.pending.get(msg.id);
    if (!entry) return;
    state.pending.delete(msg.id);
    if (msg.kind === "embedded" && msg.vectors) entry.resolve(msg.vectors);
    else if (msg.kind === "error") entry.reject(new Error(msg.message ?? "worker error"));
  });
  worker.on("error", (err) => {
    for (const entry of state.pending.values()) entry.reject(err);
    state.pending.clear();
  });
  return state;
}

async function embedInProcess(texts: string[]): Promise<number[][]> {
  if (!inProcessImpl) {
    // Dev fallback (worker.js not built yet) — same model, same cache dir.
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = "./models";
    const { MODEL_ID } = await import("./worker.js");
    const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    inProcessImpl = async (t) => {
      const output = await extractor(t, { pooling: "mean", normalize: true });
      return output.tolist() as number[][];
    };
  }
  return inProcessImpl(texts);
}

async function embedViaWorker(texts: string[]): Promise<number[][]> {
  if (!workerState) workerState = startWorker();
  if (!workerState) return embedInProcess(texts);
  const id = workerState.nextId++;
  const promise = new Promise<number[][]>((resolve, reject) => {
    workerState!.pending.set(id, { resolve, reject });
  });
  workerState.worker.postMessage({ kind: "embed", id, texts });
  return promise;
}

/** Raw embed — test override first, then worker/in-process. */
export async function embedRaw(texts: string[]): Promise<number[][]> {
  if (override) return override(texts);
  return embedViaWorker(texts);
}

/** Test-only: replace the raw embedder (deterministic vectors, no model). */
export function _setRawEmbedderForTests(fn: EmbedFn | null): void {
  override = fn;
}

/** Cache-first embedding: sha256(text) → vector, missing entries computed once. */
export async function embedCached(db: AppDatabase, texts: string[]): Promise<number[][]> {
  const hashes = texts.map(sha256);
  const rows = db.select().from(embedCache).where(inArray(embedCache.hash, hashes)).all();
  const byHash = new Map(rows.map((r) => [r.hash, r.vector]));

  const misses: { index: number; text: string }[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!byHash.has(hashes[i]!)) misses.push({ index: i, text: texts[i]! });
  }
  if (misses.length > 0) {
    const vectors = await embedRaw(misses.map((m) => m.text));
    const ts = new Date().toISOString();
    for (let i = 0; i < misses.length; i++) {
      const hash = hashes[misses[i]!.index]!;
      const vector = vectors[i]!;
      db.insert(embedCache).values({ hash, vector, createdAt: ts }).onConflictDoNothing().run();
      byHash.set(hash, vector);
    }
  }
  return hashes.map((h) => byHash.get(h) as number[]);
}
