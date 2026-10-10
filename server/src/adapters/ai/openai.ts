// OpenAI-style Chat Completions adapter. POST {base}/chat/completions with
// { model, messages, max_tokens?, temperature? }, Authorization: Bearer.
// Errors: 401 auth, 400/404 validation, 429 rate_limit, 5xx temporary.
import { aiFetch, streamCompletion } from "./streaming.js";
import {
  aiError,
  sanitizeAiErrorText,
  type AiAdapter,
  type AiChatResult,
  type AiTestResult,
  type ChatMessage,
  type AiConfig,
  type AiChatOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAiErrorBody {
  error?: { message?: string; code?: string };
}

async function classifyResponse(
  response: Response,
): Promise<{
  kind: "auth" | "validation" | "rate_limit" | "temporary" | "permanent";
  message: string;
}> {
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const parsed = (await response.json()) as OpenAiErrorBody;
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

interface CompletionBody {
  choices?: {
    finish_reason?: string;
    message?: { role?: string; content?: unknown; reasoning_content?: unknown };
  }[];
}

type CompletionResult =
  | { data: CompletionBody }
  | { error: ReturnType<typeof aiError> };

async function requestCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  options?: AiChatOptions,
): Promise<CompletionResult> {
  if (!config.apiKey)
    return { error: aiError("auth", "Missing API key.", false) };
  if (!config.model)
    return { error: aiError("validation", "Missing model ID.", false) };
  const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let request: Awaited<ReturnType<typeof aiFetch>> | undefined;
  try {
    request = await aiFetch(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
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
    return { data: (await response.json()) as CompletionBody };
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
}

export const openAiAdapter: AiAdapter = {
  style: "openai",
  stream(config, messages, options) {
    return streamCompletion("openai", config, messages, options);
  },
  async test(config): Promise<AiTestResult> {
    const result = await requestCompletion(
      config,
      [{ role: "user", content: "ping" }],
      { maxTokens: 1 },
    );
    if ("error" in result) return { ok: false, error: result.error };
    const choice = result.data.choices?.[0];
    const message = choice?.message;
    // A reasoning model may spend the one-token probe on reasoning. A valid
    // assistant completion ending at the token limit proves connectivity;
    // normal chat below still requires actual answer text.
    const reasoningProbe =
      choice?.finish_reason === "length" &&
      message?.role === "assistant" &&
      typeof message.reasoning_content === "string";
    if (typeof message?.content === "string" || reasoningProbe)
      return { ok: true };
    return {
      ok: false,
      error: aiError(
        "validation",
        "Provider response had no message content.",
        false,
      ),
    };
  },
  async chat(config, messages: ChatMessage[], options): Promise<AiChatResult> {
    const result = await requestCompletion(config, messages, options);
    if ("error" in result) return result;
    const text = result.data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return {
        error: aiError(
          "validation",
          "Provider response had no message content.",
          false,
        ),
      };
    }
    return { text };
  },
};
