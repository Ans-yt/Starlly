// Eval CLI: npm run eval [-- --stub]
// Runs the tagger over fixtures/eval/reviews.v1.jsonl against themes.v1.json
// and prints per-theme precision/recall/F1 plus sentiment accuracy, separately.
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../db/client.js";
import { loadConfig } from "../config.js";
import { embedCached, embedRaw, type EmbedFn } from "./embedder.js";
import { runEval, type EvalRecord, type EvalTheme, type EvalReport } from "./eval.js";

const fixtureDir = path.resolve(process.cwd(), "../fixtures/eval");

function loadFixtures(): { themes: EvalTheme[]; records: EvalRecord[] } {
  const themes = JSON.parse(fs.readFileSync(path.join(fixtureDir, "themes.v1.json"), "utf-8")) as EvalTheme[];
  const lines = fs
    .readFileSync(path.join(fixtureDir, "reviews.v1.jsonl"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const records = lines.map((line, i) => {
    const parsed = JSON.parse(line) as EvalRecord;
    if (!parsed.text || !Array.isArray(parsed.themes) || !parsed.sentiment) {
      throw new Error(`Invalid eval record at line ${i + 1} (needs text, themes[], sentiment)`);
    }
    return parsed;
  });
  return { themes, records };
}

// A stub embedder for offline runs: keyword-hash vectors — deterministic but
// weak. Real evaluation needs the real model (default when installed).
const stubEmbed: EmbedFn = async (texts) =>
  texts.map((t) => {
    const seed = t.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
    const v = [seed % 100, (seed * 7) % 100, (seed * 13) % 100, (seed * 29) % 100];
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  });

async function main(): Promise<void> {
  const useStub = process.argv.includes("--stub");
  const { themes, records } = loadFixtures();
  console.log(`Evaluating ${records.length} records against ${themes.length} themes (${useStub ? "STUB embedder — not meaningful" : "real model"}).\n`);

  let embed: EmbedFn;
  if (useStub) {
    embed = stubEmbed;
  } else {
    const config = loadConfig();
    const handle = openDb(config.dbPath); // cache DB for embeddings
    embed = (texts) => embedCached(handle.db, texts);
  }

  const report: EvalReport = await runEval(records, themes, embed);

  console.log("Per-theme results (tagging):");
  console.table(
    report.perTheme.map((r) => ({
      theme: r.theme,
      tp: r.tp,
      fp: r.fp,
      fn: r.fn,
      precision: r.precision,
      recall: r.recall,
      f1: r.f1,
    })),
  );
  console.log(`\nSentiment accuracy: ${report.sentimentAccuracy} (${report.sentimentTotal} records) — evaluated separately.`);
  if (report.themeMisses.length > 0) {
    console.log(`\nTheme misses (${report.themeMisses.length}):`);
    for (const miss of report.themeMisses) {
      console.log(`  expected [${miss.expected.join(", ")}] got [${miss.got.join(", ")}] — "${miss.text}"`);
    }
  }
  if (report.sentimentMisses.length > 0) {
    console.log(`\nSentiment misses (${report.sentimentMisses.length}):`);
    for (const miss of report.sentimentMisses) {
      console.log(`  expected ${miss.expected} got ${miss.got} — "${miss.text}"`);
    }
  }
  void embedRaw;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
