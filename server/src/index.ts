import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { createApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = openDb(config.dbPath);
  const app = createApp({ db: handle.db, config });
  // Local-only owner hooks (never committed — kept out of git via
  // .git/info/exclude). The computed specifier keeps tsc quiet when the
  // drop-in module is absent, and the import fails silently everywhere else.
  const localHref = new URL("./local/index.js", import.meta.url).href;
  const local = (await import(localHref).catch(() => null)) as
    | { register?: (app: ReturnType<typeof createApp>, ctx: { db: typeof handle.db }) => void }
    | null;
  local?.register?.(app, { db: handle.db });
  app.listen(config.port, () => {
    console.log(`Starlly listening on http://localhost:${config.port}`);
    if (config.publicBaseUrl) {
      console.log(`Customer links base: ${config.publicBaseUrl}/c/<token>`);
    } else {
      console.log("PUBLIC_BASE_URL not set — customer links use localhost preview URLs.");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
