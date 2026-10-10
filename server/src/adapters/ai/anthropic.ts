// Anthropic Messages adapter. POST {base}/v1/messages with x-api-key +
// anthropic-version headers, body { model, max_tokens, messages }.
// Errors: {type:"error", error:{type, message}} — 401 invalid_api_key,
// 400 invalid_request_error, 429 rate_limit_error, 5xx api_error/overloaded.
import { aiFetch, streamCompletion } from "./streaming.js";
import {
  aiError,
  sanitizeAiErrorText,
  type AiAdapter,
  type AiChatResult,
  type AiTestResult,
  type ChatMessage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicErrorBody {
  type?: string;
  error?: { type?: string; message?: string };
}

async function classifyResponse(
  response: Response,
): Promise<{
  kind: "auth" | "validation" | "rate_limit" | "temporary" | "permanent";
  message: string;
}> {
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const parsed = (await response.json()) as AnthropicErrorBody;
    if (parsed.error?.message)
      message = sanitizeAiErrorText(parsed.error.message);
  } catch {
    // non-JSON body
  }
  if (response.status === 401 || response.status === 403)
    return { kind: "auth", message };
  if (response.status === 400 || response.status === 404)
    return { kind: "validation", message };
  if (response.status === 429) return { kind: "rate_limit", message };
  if (response.status >= 500) return { kind: "temporary", message };
  return { kind: "permanent", message };
}

function headers(config: { apiKey: string }): Record<string, string> {
  return {
    "x-api-key": config.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

export const anthropicAdapter: AiAdapter = {
  style: "anthropic",
  stream(config, messages, options) {
    return streamCompletion("anthropic", config, messages, options);
  },
  async test(config): Promise<AiTestResult> {
    const result = await this.chat(
      config,
      [{ role: "user", content: "ping" }],
      { maxTokens: 1 },
    );
    if ("text" in result) return { ok: true };
    return { ok: false, error: result.error };
  },
  async chat(config, messages: ChatMessage[], options): Promise<AiChatResult> {
    if (!config.apiKey)
      return { error: aiError("auth", "Missing API key.", false) };
    if (!config.model)
      return { error: aiError("validation", "Missing model ID.", false) };
    const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    let request: Awaited<ReturnType<typeof aiFetch>> | undefined;
    try {
      request = await aiFetch(
        `${base}/v1/messages`,
        {
          method: "POST",
          headers: headers(config),
          body: JSON.stringify({
            model: config.model,
            max_tokens: options?.maxTokens ?? 1024, // required by the Messages API
            system: messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n"),
            messages: messages.filter((m) => m.role !== "system"),
            ...(options?.temperature != null
              ? { temperature: options.temperature }
              : {}),
          }),
        },
        options?.signal,
      );
      const response = request.response;
      if (!response.ok) {
        const { kind, message } = await classifyResponse(response);
        return {
          error: aiError(
            kind,
            message,
            kind === "rate_limit" || kind === "temporary",
          ),
        };
      }
      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = (data.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
      if (!text) {
        return {
          error: aiError(
            "validation",
            "Provider response had no text content.",
            false,
          ),
        };
      }
      return { text };
    } catch {
      return {
        error: aiError(
          "temporary",
          "The AI provider could not complete the request. Please try again.",
          true,
        ),
      };
    } finally {
      request?.dispose();
    }
  },
};
