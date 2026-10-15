import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config, ROOT_DIR } from "../config";
import * as schema from "./schema";

mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const sqlite = new Database(config.DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(ROOT_DIR, "drizzle") });
}

export function closeDb() {
  sqlite.close();
}
