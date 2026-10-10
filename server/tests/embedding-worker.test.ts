import { it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
const state = vi.hoisted(() => ({ created: 0, mode: "error" }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        state.created++;
      }
      ref() {}
      unref() {}
      terminate() {
        return Promise.resolve(0);
      }
      postMessage(msg: { id: number; texts: string[] }) {
        if (state.mode === "error")
          queueMicrotask(() => this.emit("error", new Error("worker failed")));
        if (state.mode === "success")
          queueMicrotask(() =>
            this.emit("message", {
              kind: "embedded",
              id: msg.id,
              vectors: msg.texts.map(() => [1, 0]),
            }),
          );
      }
    },
  };
});
import { embedRaw } from "../src/inference/embedder.js";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("replaces failed workers, times out hung inference, then accepts later work", async () => {
  vi.stubEnv("VITEST", "");
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
  await expect(embedRaw(["first"])).rejects.toThrow("worker failed");
  state.mode = "hang";
  vi.useFakeTimers();
  const pending = embedRaw(["hung"]);
  const rejection = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(120001);
  await rejection;
  state.mode = "success";
  expect(await embedRaw(["recovered"])).toEqual([[1, 0]]);
  expect(state.created).toBe(3);
});
