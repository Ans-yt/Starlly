import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: AppDatabase;
  sqlite: Database.Database;
  close(): void;
}

/**
 * Migrations live in `<workspace>/migrations` (npm scripts and tsx run with
 * the server workspace as cwd). Generate with `npm run db:generate`.
 */
export function migrationsFolder(): string {
  return path.resolve(process.cwd(), "migrations");
}

export function openDb(dbPath: string, options: { migrate?: boolean } = {}): DbHandle {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  if (options.migrate !== false) {
    const folder = migrationsFolder();
    if (!fs.existsSync(folder)) {
      sqlite.close();
      throw new Error(`Migrations folder not found at ${folder}. Run "npm run db:generate" first.`);
    }
    migrate(db, { migrationsFolder: folder });
  }
  return { db, sqlite, close: () => sqlite.close() };
}
