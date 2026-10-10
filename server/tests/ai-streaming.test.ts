import { describe, it, expect, vi, afterEach } from "vitest";
import {
  streamCompletion,
  partialAnswer,
  splitThinking,
} from "../src/adapters/ai/streaming.js";
import { openAiAdapter } from "../src/adapters/ai/openai.js";
import { anthropicAdapter } from "../src/adapters/ai/anthropic.js";
const config = {
  apiKey: "fake",
  model: "test",
  baseUrl: "https://stub.test/v1",
};
const messages = [
  { role: "system" as const, content: "Instructions" },
  { role: "user" as const, content: "Question" },
];
function fragmentedSse(frames: unknown[]) {
  const bytes = new TextEncoder().encode(
    frames.map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join("") +
      "data: [DONE]\n\n",
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("provider streaming", () => {
  it("assembles fragmented UTF-8 deltas and separates provider reasoning", async () => {
    const fetch = vi.fn(async () =>
      fragmentedSse([
        { choices: [{ delta: { reasoning_content: "Check records" } }] },
        {
          choices: [
            { delta: { content: '{"answer":"Bonjour 🌟","quotes":[]}' } },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const parts = [];
    for await (const delta of streamCompletion("openai", config, messages))
      parts.push(delta);
    expect(parts).toEqual([
      { reasoning: "Check records" },
      { text: '{"answer":"Bonjour 🌟","quotes":[]}' },
    ]);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).stream).toBe(
      true,
    );
  });
  it("keeps Anthropic system instructions out of messages and reads thinking deltas", async () => {
    const fetch = vi.fn(async () =>
      fragmentedSse([
        {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Check context" },
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Answer" },
        },
        { type: "message_stop" },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const parts = [];
    for await (const delta of streamCompletion("anthropic", config, messages))
      parts.push(delta);
    const sent = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(sent.system).toBe("Instructions");
    expect(sent.messages).toEqual([messages[1]]);
    expect(parts).toEqual([{ reasoning: "Check context" }, { text: "Answer" }]);
  });
  it("rejects incomplete streams instead of treating them as finished", async () => {
    vi.stubGlobal("fetch", async () =>
      fragmentedSse([
        { choices: [{ delta: { content: '{"answer":"Partial' } }] },
      ]),
    );
    await expect(
      (async () => {
        for await (const _part of streamCompletion(
          "openai",
          config,
          messages,
        )) {
        }
      })(),
    ).rejects.toThrow(/before the answer was complete/);
  });
  it("forwards cancellation to the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      (async () => {
        for await (const _part of streamCompletion("openai", config, messages, {
          signal: controller.signal,
        })) {
        }
      })(),
    ).rejects.toThrow("Aborted");
  });
  it("normalizes thrown network errors without exposing provider text", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("Bearer secret-value");
    });
    for (const adapter of [openAiAdapter, anthropicAdapter]) {
      const result = await adapter.chat(config, messages);
      expect(result).toHaveProperty("error.kind", "temporary");
      expect(JSON.stringify(result)).not.toContain("secret-value");
    }
  });
  it("decodes partial JSON strings without displaying escapes or think tags", () => {
    expect(partialAnswer('{"answer":"Hello\\nworld\\u00')).toBe("Hello\nworld");
    expect(partialAnswer('{"answer":"Quote: \\"yes\\""')).toBe('Quote: "yes"');
    expect(
      splitThinking('<think>Provider reasoning</think>{"answer":"Hi"}'),
    ).toEqual({ reasoning: "Provider reasoning", text: '{"answer":"Hi"}' });
  });
});
