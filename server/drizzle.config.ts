import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATA_DIR ? `${process.env.DATA_DIR}/starlly.db` : "./data/starlly.db",
  },
});