// OpenAI-style Chat Completions adapter. POST {base}/chat/completions with
// { model, messages, max_tokens?, temperature? }, Authorization: Bearer.
// Errors: 401 auth, 400/404 validation, 429 rate_limit, 5xx temporary.
import { providerFetch } from "../email/fetch.js";
import { aiError, sanitizeAiErrorText, type AiAdapter, type AiChatResult, type AiTestResult, type ChatMessage } from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAiErrorBody {
  error?: { message?: string; code?: string };
}

async function classifyResponse(response: Response): Promise<{ kind: "auth" | "validation" | "rate_limit" | "temporary" | "permanent"; message: string }> {
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const parsed = (await response.json()) as OpenAiErrorBody;
    if (parsed.error?.message) message = sanitizeAiErrorText(parsed.error.message);
  } catch {
    // non-JSON body
  }
  if (response.status === 401 || response.status === 403) return { kind: "auth", message };
  if (response.status === 400 || response.status === 404) return { kind: "validation", message };
  if (response.status === 429) return { kind: "rate_limit", message };
  if (response.status >= 500) return { kind: "temporary", message };
  return { kind: "permanent", message };
}

export const openAiAdapter: AiAdapter = {
  style: "openai",
  async test(config): Promise<AiTestResult> {
    // Cheapest honest check: a one-token chat completion via the documented endpoint.
    const result = await this.chat(config, [{ role: "user", content: "ping" }], { maxTokens: 1 });
    if ("text" in result) return { ok: true };
    return { ok: false, error: result.error };
  },
  async chat(config, messages: ChatMessage[], options): Promise<AiChatResult> {
    if (!config.apiKey) return { error: aiError("auth", "Missing API key.", false) };
    if (!config.model) return { error: aiError("validation", "Missing model ID.", false) };
    const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const response = await providerFetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      }),
    });
    if (!response.ok) {
      const { kind, message } = await classifyResponse(response);
      return { error: aiError(kind, message, kind === "rate_limit" || kind === "temporary") };
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return { error: aiError("validation", "Provider response had no message content.", false) };
    }
    return { text };
  },
};
