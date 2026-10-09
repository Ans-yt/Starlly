import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { createApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = openDb(config.dbPath);
  const app = createApp({ db: handle.db, config });
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
