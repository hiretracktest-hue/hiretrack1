import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_FILE = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(__dirname, "app.db");

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new Database(DB_FILE);

// WAL keeps reads fast while a write is in progress; foreign keys are
// off by default in SQLite and must be switched on per connection.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create every table if it does not exist yet (safe to run on each boot).
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

export const DB_PATH = DB_FILE;
