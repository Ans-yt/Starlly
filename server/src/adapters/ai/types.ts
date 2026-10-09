// AI provider contract — mirrors the email contract (ADR-0004 discipline):
// normalized errors, documented endpoints only, no invented capabilities.
import type { EmailErrorKind } from "../../domain/types.js";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface NormalizedAiError {
  kind: EmailErrorKind; // auth | validation | rate_limit | temporary | permanent
  message: string;
  retryable: boolean;
}

export type AiTestResult = { ok: true; note?: string } | { ok: false; error: NormalizedAiError };

export type AiChatResult = { text: string } | { error: NormalizedAiError };

export interface AiAdapter {
  style: string; // "openai" | "anthropic"
  test(config: AiConfig): Promise<AiTestResult>;
  chat(config: AiConfig, messages: ChatMessage[], options?: AiChatOptions): Promise<AiChatResult>;
}

export function aiError(kind: EmailErrorKind, message: string, retryable: boolean): NormalizedAiError {
  return { kind, message, retryable };
}

/** Strip anything that looks like a key from provider error text. */
export function sanitizeAiErrorText(text: string): string {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/gi, "[redacted]")
    .slice(0, 500);
}
