// AI adapter registry + settings resolution (mirrors the email seam).
import { envKey } from "../../config.js";
import { anthropicAdapter } from "./anthropic.js";
import { openAiAdapter } from "./openai.js";
import type { AiAdapter, AiConfig } from "./types.js";
import type { BusinessRow } from "../../storage/business.js";

const ADAPTERS: Record<string, AiAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

const ENV_DEFAULTS: Record<string, { key: string; baseUrl: string; model: string }> = {
  openai: { key: "AI_API_KEY", baseUrl: "AI_BASE_URL", model: "AI_MODEL" },
  anthropic: { key: "AI_API_KEY", baseUrl: "AI_BASE_URL", model: "AI_MODEL" },
};

export function getAiAdapter(style: string | null | undefined): AiAdapter | undefined {
  if (!style) return undefined;
  return ADAPTERS[style];
}

export function aiStyles(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * DB settings win over env defaults. Returns null when AI is not configured
 * (style or model or key missing) — callers must degrade gracefully.
 */
export function resolveAiSettings(business: BusinessRow): { adapter: AiAdapter; config: AiConfig } | null {
  const style = business.aiStyle || envKey("AI_PROVIDER_STYLE") || null;
  if (!style) return null;
  const adapter = getAiAdapter(style);
  const env = ENV_DEFAULTS[style];
  if (!adapter || !env) return null;
  const baseUrl = business.aiBaseUrl || envKey(env.baseUrl) || DEFAULT_BASE_URLS[style] || "";
  const model = business.aiModel || envKey(env.model) || "";
  const apiKey = business.aiApiKey || envKey(env.key) || "";
  if (!model || !apiKey) return null;
  return { adapter, config: { baseUrl, apiKey, model } };
}

/** Test-only: replace the adapter for a style (e.g., a deterministic stub). */
export function _registerAiAdapterForTests(style: string, adapter: AiAdapter): void {
  ADAPTERS[style] = adapter;
}
