// Unit tests for the AI adapters against mocked fetch (no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAiAdapter } from "../src/adapters/ai/openai.js";
import { anthropicAdapter } from "../src/adapters/ai/anthropic.js";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-style adapter", () => {
  it("extracts message text from a chat completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { choices: [{ message: { content: "Hello there" } }] }),
      ),
    );
    const result = await openAiAdapter.chat(
      { baseUrl: "https://api.example/v1", apiKey: "sk-test", model: "test-model" },
      [{ role: "user", content: "hi" }],
    );
    expect("text" in result && result.text).toBe("Hello there");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("normalizes a 401 into an auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { message: "Incorrect API key" } })));
    const result = await openAiAdapter.chat(
      { baseUrl: "https://api.example/v1", apiKey: "sk-bad", model: "m" },
      [{ role: "user", content: "hi" }],
    );
    expect("error" in result && result.error.kind).toBe("auth");
    expect("error" in result && result.error.retryable).toBe(false);
  });

  it("normalizes a 429 into a retryable rate-limit error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { message: "Rate limit" } })));
    const result = await openAiAdapter.chat(
      { baseUrl: "https://api.example/v1", apiKey: "sk-ok", model: "m" },
      [{ role: "user", content: "hi" }],
    );
    expect("error" in result && result.error.kind).toBe("rate_limit");
    expect("error" in result && result.error.retryable).toBe(true);
  });

  it("rejects a missing API key without any network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await openAiAdapter.chat({ baseUrl: "", apiKey: "", model: "m" }, [{ role: "user", content: "x" }]);
    expect("error" in result && result.error.kind).toBe("auth");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Anthropic Messages adapter", () => {
  it("joins text blocks and sends the documented headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { content: [{ type: "text", text: "Part one. " }, { type: "text", text: "Part two." }] }),
      ),
    );
    const result = await anthropicAdapter.chat(
      { baseUrl: "https://api.example", apiKey: "ak-test", model: "claude-test" },
      [{ role: "user", content: "hi" }],
    );
    expect("text" in result && result.text).toBe("Part one. Part two.");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ak-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body)) as { max_tokens: number; model: string };
    expect(body.max_tokens).toBeGreaterThan(0); // required by the Messages API
    expect(body.model).toBe("claude-test");
  });

  it("normalizes a 400 into a validation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens required" } })),
    );
    const result = await anthropicAdapter.chat(
      { baseUrl: "https://api.example", apiKey: "ak", model: "m" },
      [{ role: "user", content: "x" }],
    );
    expect("error" in result && result.error.kind).toBe("validation");
  });
});
