import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { embedCache } from "../db/schema.js";
import { MODEL_ID, EMBEDDING_VERSION } from "./model.js";
export { EMBEDDING_VERSION } from "./model.js";
export type EmbedFn = (texts: string[]) => Promise<number[][]>;
type Pending = {
  resolve(v: number[][]): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
let override: EmbedFn | null = null;
let workerState: {
  worker: Worker;
  nextId: number;
  pending: Map<number, Pending>;
} | null = null;
let inProcessPromise: Promise<EmbedFn> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const BATCH_SIZE = 32;
const DEADLINE_MS = 120000;
export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
function startWorker() {
  if (process.env.VITEST) return null;
  const file = fileURLToPath(new URL("./worker.js", import.meta.url));
  if (!fs.existsSync(file)) return null;
  const state = {
    worker: new Worker(file),
    nextId: 1,
    pending: new Map<number, Pending>(),
  };
  const fail = (err: Error) => {
    if (workerState === state) workerState = null;
    for (const entry of state.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    state.pending.clear();
    void state.worker.terminate();
  };
  state.worker.on(
    "message",
    (msg: {
      kind: string;
      id: number;
      vectors?: number[][];
      message?: string;
    }) => {
      const entry = state.pending.get(msg.id);
      if (!entry) return;
      state.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.kind === "embedded" && msg.vectors) entry.resolve(msg.vectors);
      else entry.reject(new Error("Local embedding failed. Please try again."));
      if (!state.pending.size) state.worker.unref();
    },
  );
  state.worker.on("error", () =>
    fail(new Error("Local embedding worker failed. Please try again.")),
  );
  state.worker.on("exit", () =>
    fail(new Error("Local embedding worker stopped. Please try again.")),
  );
  return state;
}
async function inProcess(texts: string[]): Promise<number[][]> {
  inProcessPromise ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = "./models";
    const extractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
    });
    return async (t: string[]) =>
      (
        await extractor(t, { pooling: "mean", normalize: true })
      ).tolist() as number[][];
  })().catch((err) => {
    inProcessPromise = null;
    throw err;
  });
  return (await inProcessPromise)(texts);
}
async function batch(texts: string[]): Promise<number[][]> {
  if (override) return override(texts);
  workerState ??= startWorker();
  if (!workerState) return inProcess(texts);
  const state = workerState,
    id = state.nextId++;
  state.worker.ref();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (workerState === state) workerState = null;
      for (const entry of state.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Local embedding timed out. Please try again."));
      }
      state.pending.clear();
      void state.worker.terminate();
    }, DEADLINE_MS);
    state.pending.set(id, { resolve, reject, timer });
    try {
      state.worker.postMessage({ kind: "embed", id, texts });
    } catch (err) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(err);
    }
  });
}
export function validateVectors(vectors: number[][], count: number): void {
  if (!Array.isArray(vectors) || vectors.length !== count)
    throw new Error("Invalid embedding count.");
  const dimension = vectors[0]?.length;
  if (
    count &&
    (!dimension ||
      vectors.some(
        (v) =>
          !Array.isArray(v) ||
          v.length !== dimension ||
          !v.every(Number.isFinite),
      ))
  )
    throw new Error("Invalid embedding vectors.");
}
export async function embedRaw(texts: string[]): Promise<number[][]> {
  const run = queue
    .catch(() => undefined)
    .then(async () => {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const input = texts.slice(i, i + BATCH_SIZE);
        const output = await batch(input);
        validateVectors(output, input.length);
        vectors.push(...output);
      }
      validateVectors(vectors, texts.length);
      return vectors;
    });
  queue = run;
  return run;
}
export function _setRawEmbedderForTests(fn: EmbedFn | null): void {
  override = fn;
}
export async function embedCached(
  db: AppDatabase,
  texts: string[],
): Promise<number[][]> {
  if (!texts.length) return [];
  const keys = texts.map((t) => sha256(EMBEDDING_VERSION + "\n" + t));
  const found = new Map<string, number[]>();
  const uniqueKeys = [...new Set(keys)];
  for (let i = 0; i < uniqueKeys.length; i += 400)
    for (const row of db
      .select()
      .from(embedCache)
      .where(inArray(embedCache.hash, uniqueKeys.slice(i, i + 400)))
      .all())
      found.set(row.hash, row.vector);
  const missing = new Map<string, string>();
  texts.forEach((t, i) => {
    if (!found.has(keys[i]!)) missing.set(keys[i]!, t);
  });
  const entries = [...missing.entries()];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const group = entries.slice(i, i + BATCH_SIZE),
      vectors = await embedRaw(group.map(([, t]) => t));
    db.transaction((tx) => {
      group.forEach(([key], j) => {
        const vector = vectors[j]!;
        tx.insert(embedCache)
          .values({ hash: key, vector, createdAt: new Date().toISOString() })
          .onConflictDoNothing()
          .run();
        found.set(key, vector);
      });
    });
  }
  const result = keys.map((key) => found.get(key)!);
  validateVectors(result, texts.length);
  return result;
}
