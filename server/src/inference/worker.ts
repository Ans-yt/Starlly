// Inference worker (ADR-0003): Transformers.js in a worker thread so model
// loading and embedding never block API requests. The pipeline loads lazily on
// the first embed request; model files cache under ./models (git-ignored).
import { parentPort } from "node:worker_threads";

type EmbedRequest = { kind: "embed"; id: number; texts: string[] } | { kind: "ping"; id: number };

export const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let embedFn: ((texts: string[]) => Promise<number[][]>) | null = null;

async function getEmbedFn(): Promise<(texts: string[]) => Promise<number[][]>> {
  if (embedFn) return embedFn;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = "./models";
  const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
  embedFn = async (texts: string[]) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  };
  return embedFn;
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
