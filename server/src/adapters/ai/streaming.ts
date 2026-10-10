import type {
  AiConfig,
  AiChatOptions,
  ChatMessage,
  AiStreamDelta,
} from "./types.js";
/** Deadline covers response headers AND consumption of the body. */
export async function aiFetch(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal,
    });
    return { response, dispose: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
export async function* readSse(response: Response): AsyncGenerator<any> {
  if (!response.body) throw new Error("Empty provider stream.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      total += value?.byteLength ?? 0;
      if (total > 1000000)
        throw new Error("Provider response exceeded the size limit.");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        yield JSON.parse(data);
      }
      if (done) {
        if (buffer.trim()) {
          const data = buffer
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (data && data !== "[DONE]") yield JSON.parse(data);
        }
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function* streamCompletion(
  style: "openai" | "anthropic",
  config: AiConfig,
  messages: ChatMessage[],
  options?: AiChatOptions,
): AsyncGenerator<AiStreamDelta> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const body =
    style === "openai"
      ? {
          model: config.model,
          messages,
          max_tokens: options?.maxTokens ?? 4096,
          temperature: options?.temperature ?? 0.4,
          stream: true,
        }
      : {
          model: config.model,
          system,
          messages: messages.filter((m) => m.role !== "system"),
          max_tokens: options?.maxTokens ?? 4096,
          stream: true,
        };
  const request = await aiFetch(
    `${base}${style === "openai" ? "/chat/completions" : "/v1/messages"}`,
    {
      method: "POST",
      headers:
        style === "openai"
          ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            }
          : {
              "Content-Type": "application/json",
              "x-api-key": config.apiKey,
              "anthropic-version": "2023-06-01",
            },
      body: JSON.stringify(body),
    },
    options?.signal,
  );
  try {
    if (!request.response.ok)
      throw new Error(
        `AI provider returned HTTP ${request.response.status}. Check your model and connection in Settings.`,
      );
    if (
      !request.response.headers
        .get("content-type")
        ?.includes("text/event-stream")
    ) {
      const data = (await request.response.json()) as any;
      if (style === "openai") {
        const msg = data.choices?.[0]?.message;
        if (typeof msg?.reasoning_content === "string")
          yield { reasoning: msg.reasoning_content };
        if (typeof msg?.content === "string") yield { text: msg.content };
        else throw new Error("Provider returned no answer.");
      } else
        for (const block of data.content ?? []) {
          if (block.type === "text" && typeof block.text === "string")
            yield { text: block.text };
          if (block.type === "thinking" && typeof block.thinking === "string")
            yield { reasoning: block.thinking };
        }
      return;
    }
    let finished = false;
    for await (const data of readSse(request.response)) {
      if (data.error || data.type === "error")
        throw new Error("The provider stopped the stream. Please try again.");
      if (style === "openai") {
        const choice = data.choices?.[0],
          delta = choice?.delta;
        if (choice?.finish_reason) {
          if (choice.finish_reason === "length")
            throw new Error(
              "The answer reached the model token limit. Please try a shorter question.",
            );
          finished = true;
        }
        if (typeof delta?.reasoning_content === "string")
          yield { reasoning: delta.reasoning_content };
        else if (typeof delta?.reasoning === "string")
          yield { reasoning: delta.reasoning };
        if (typeof delta?.content === "string") yield { text: delta.content };
      } else {
        if (data.type === "message_stop") finished = true;
        if (data.type === "content_block_delta") {
          if (data.delta?.type === "text_delta")
            yield { text: data.delta.text };
          if (data.delta?.type === "thinking_delta")
            yield { reasoning: data.delta.thinking };
        }
      }
    }
    if (!finished)
      throw new Error(
        "The provider stream ended before the answer was complete. Please try again.",
      );
  } finally {
    request.dispose();
  }
}
/** Decode only the answer string while the JSON object is still arriving. */
export function partialAnswer(text: string): string {
  const start = /"answer"\s*:\s*"/.exec(text);
  if (!start) return "";
  const raw = text.slice(start.index + start[0].length);
  let end = 0;
  while (end < raw.length) {
    if (raw[end] === '"') break;
    if (raw[end] === "\\") {
      if (end + 1 >= raw.length) break;
      if (raw[end + 1] === "u") {
        if (end + 6 > raw.length) break;
        end += 6;
      } else end += 2;
    } else end++;
  }
  try {
    return JSON.parse('"' + raw.slice(0, end) + '"') as string;
  } catch {
    return "";
  }
}
export function splitThinking(text: string): {
  text: string;
  reasoning: string;
} {
  let reasoning = "";
  const cleaned = text.replace(
    /<think>([\s\S]*?)(?:<\/think>|$)/gi,
    (_match, inner: string) => {
      reasoning += inner;
      return "";
    },
  );
  return { text: cleaned, reasoning };
}
