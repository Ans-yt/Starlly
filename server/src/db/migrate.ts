// CLI: apply migrations to the configured database. Usage: npm run db:migrate
import { loadConfig } from "../config.js";
import { openDb } from "./client.js";

const { dbPath } = loadConfig();
const handle = openDb(dbPath);
handle.close();
console.log(`Migrations applied to ${dbPath}`);
