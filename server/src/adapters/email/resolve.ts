// Resolve the effective email settings: DB-entered values win over env defaults.
import { envKey } from "../../config.js";
import type { BusinessRow } from "../../storage/business.js";

const ENV_DEFAULTS: Record<string, Record<string, string>> = {
  agentboxd: {
    apiKey: "AGENTBOXD_API_KEY",
    inboxId: "AGENTBOXD_INBOX_ID",
    baseUrl: "AGENTBOXD_BASE_URL",
  },
  openmail: {
    apiKey: "OPENMAIL_API_KEY",
    inboxId: "OPENMAIL_INBOX_ID",
    baseUrl: "OPENMAIL_BASE_URL",
  },
};

export function resolveEmailSettings(business: BusinessRow): {
  adapterId: string;
  config: Record<string, string>;
} {
  const adapterId = business.emailAdapterId || "copy-only";
  const config: Record<string, string> = {};
  for (const [field, envName] of Object.entries(ENV_DEFAULTS[adapterId] ?? {})) {
    const value = envKey(envName);
    if (value) config[field] = value;
  }
  for (const [key, value] of Object.entries(business.emailConfig ?? {})) {
    if (typeof value === "string" && value.trim()) config[key] = value.trim();
  }
  return { adapterId, config };
}
