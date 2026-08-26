/**
 * Applies database/schema.sql to the Supabase PostgreSQL database.
 *
 *   npm run db:migrate
 *
 * The script drops and recreates every table, so running it twice is
 * safe and always leaves the same structure. It will refuse to run
 * against a database that already holds data unless you pass --force,
 * so nobody wipes the group's work by accident.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, one, closePool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");

async function tableExists(name) {
  const row = await one(
    "SELECT to_regclass($1) AS found",
    ["public." + name]
  );
  return Boolean(row.found);
}

async function main() {
  console.log("");
  const info = await one("SELECT current_database() AS db, version() AS version");
  console.log("  Database : " + info.db);
  console.log("  Server   : " + info.version.split(",")[0]);
  console.log("");

  if (await tableExists("users")) {
    const { count } = await one("SELECT COUNT(*)::int AS count FROM users");
    if (count > 0 && !FORCE) {
      console.error(
        "  This database already has " +
          count +
          " user(s).\n" +
          "  Running the schema again would delete every table.\n" +
          "  If that is really what you want:  npm run db:migrate -- --force\n"
      );
      process.exitCode = 1;
      return;
    }
  }

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("  Applying database/schema.sql …");
  await query(sql);

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'public' ORDER BY table_name"
  );

  console.log("  Done. Tables now in the database:");
  for (const row of tables.rows) console.log("    - " + row.table_name);
  console.log("");
  console.log("  Next:  npm run seed");
  console.log("");
}

main()
  .catch((err) => {
    console.error("\n  Migration failed: " + err.message);
    if (err.sql) console.error("  While running:\n" + err.sql.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(closePool);
