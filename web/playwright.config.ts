import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = 8790;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "../server");

// Hermetic runs: every run gets its own unique data directory, so a stale
// database (or a transient file lock from a watcher) can never poison a run.
// Old directories are cleaned up best-effort — never fatally.
const dataDirName = `.e2e-data-${process.pid}`;
for (const entry of fs.readdirSync(serverDir)) {
  if (entry.startsWith(".e2e-data")) {
    try {
      fs.rmSync(path.join(serverDir, entry), { recursive: true, force: true });
    } catch {
      // A lock from a previous run — leave it for a later cleanup pass
      // rather than failing this run.
    }
  }
}

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // Flows share one server + database and build on each other.
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  webServer: [
    {
      command: "node dist/index.js",
      cwd: "../server",
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(PORT),
        DATA_DIR: `./${dataDirName}`,
      },
    },
    {
      // OpenAI-compatible stub so the setup gate's required "Test connection"
      // can pass honestly over real HTTP during e2e flows.
      command: "node tests/ai-stub.cjs",
      cwd: ".",
      url: "http://localhost:8791/health",
      reuseExistingServer: false,
      timeout: 15_000,
      env: {
        STUB_PORT: "8791",
      },
    },
  ],
});
