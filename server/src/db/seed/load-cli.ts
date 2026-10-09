// CLI: npm run sample:load -- <path-to-sample.json>
// Loads the owner-supplied sample dataset (format: sample-data.example.json)
// into the local database, flagged as sample data.
import fs from "node:fs";
import { loadConfig } from "../../config.js";
import { openDb } from "../client.js";
import { loadSampleData } from "./load-sample.js";

const path = process.argv[2] ?? "../fixtures/sample/sample-data.json";
if (!fs.existsSync(path)) {
  console.error(`Sample file not found: ${path}`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(path, "utf-8"));
const config = loadConfig();
const handle = openDb(config.dbPath);
const result = loadSampleData(handle.db, data);
handle.close();
if (!result.ok) {
  console.error("Sample data rejected:");
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log("Sample data loaded:", result.loaded);
