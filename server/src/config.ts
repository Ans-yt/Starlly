import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  /** Public HTTPS base URL for customer links (deploy or tunnel; ADR-0005). */
  publicBaseUrl: string | undefined;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Invalid PORT");
  }
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.mkdirSync(dataDir, { recursive: true });
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined;
  return {
    port,
    dataDir,
    dbPath: path.join(dataDir, "starlly.db"),
    publicBaseUrl,
  };
}

/** Read an optional env-provided key (trimmed). Env keys are defaults; DB settings can override. */
export function envKey(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}
