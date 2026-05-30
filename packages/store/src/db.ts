import Database from "better-sqlite3";
import { readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIRS = [resolve(here, "../migrations"), resolve(here, "../../migrations")];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  ensureTokenOpsProviderAttemptUsageColumns(db);
  return db;
}

function migrate(db: DB): void {
  const runRaw = (db as unknown as { exec: (s: string) => void }).exec.bind(db);
  for (const dir of MIGRATION_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if (files.length === 0) continue;
    for (const file of files) runRaw(readFileSync(resolve(dir, file), "utf8"));
    return;
  }
  throw new Error("nerve: migration SQL not found");
}

function ensureTokenOpsProviderAttemptUsageColumns(db: DB): void {
  const columns = new Set(
    db.prepare("PRAGMA table_info(tokenops_provider_attempts)").all().map((row) => (row as { name: string }).name),
  );
  const addColumn = (name: string, definition: string) => {
    if (!columns.has(name)) db.prepare(`ALTER TABLE tokenops_provider_attempts ADD COLUMN ${name} ${definition}`).run();
  };
  addColumn("input_tokens", "INTEGER");
  addColumn("output_tokens", "INTEGER");
  addColumn("estimated_cost_usd", "REAL");
}
