/**
 * Applies database/upgrade.sql - the additive changes that are safe to
 * run against a database which already holds real data.
 *
 *   npm run db:upgrade
 *
 * Use this, not db:migrate, once the project is live: db:migrate drops
 * and recreates every table.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { one, many, query, closePool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const info = await one("SELECT current_database() AS db, version() AS version");
  console.log("");
  console.log("  Database : " + info.db);
  console.log("  Server   : " + info.version.split(",")[0]);
  console.log("");

  const before = await many(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'candidates'"
  );

  console.log("  Applying database/upgrade.sql …");
  await query(fs.readFileSync(path.join(__dirname, "upgrade.sql"), "utf8"));

  const after = await many(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'candidates'"
  );

  const added = after
    .map((r) => r.column_name)
    .filter((name) => !before.some((r) => r.column_name === name));

  if (added.length) {
    console.log("  Added to candidates: " + added.join(", "));
  } else {
    console.log("  Nothing to do - the database is already up to date.");
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("\n  Upgrade failed: " + err.message);
    if (err.sql) console.error("  While running:\n" + err.sql.slice(0, 400));
    process.exitCode = 1;
  })
  .finally(closePool);
