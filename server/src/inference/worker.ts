// Inference worker (ADR-0003): Transformers.js in a worker thread so model
// loading and embedding never block API requests. The pipeline loads lazily on
// the first embed request; model files cache under ./models (git-ignored).
import { parentPort } from "node:worker_threads";

type EmbedRequest =
  | { kind: "embed"; id: number; texts: string[] }
  | { kind: "ping"; id: number };

import { MODEL_ID } from "./model.js";
export { MODEL_ID } from "./model.js";

let initializing: Promise<(texts: string[]) => Promise<number[][]>> | null =
  null;
let embedFn: ((texts: string[]) => Promise<number[][]>) | null = null;

async function getEmbedFn(): Promise<(texts: string[]) => Promise<number[][]>> {
  if (embedFn) return embedFn;
  if (initializing) return initializing;
  initializing = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = "./models";
    const extractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
    });
    embedFn = async (texts: string[]) => {
      const output = await extractor(texts, {
        pooling: "mean",
        normalize: true,
      });
      return output.tolist() as number[][];
    };
    return embedFn;
  })().catch((err) => {
    initializing = null;
    throw err;
  });
  return initializing;
}

if (parentPort) {
  const port = parentPort;
  port.on("message", async (msg: EmbedRequest) => {
    if (msg.kind === "ping") {
      port.postMessage({ kind: "pong", id: msg.id });
      return;
    }
    if (msg.kind !== "embed") return;
    try {
      const fn = await getEmbedFn();
      const vectors = await fn(msg.texts);
      port.postMessage({ kind: "embedded", id: msg.id, vectors });
    } catch (err) {
      port.postMessage({
        kind: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
