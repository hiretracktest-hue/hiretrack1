import pg from "pg";
import { config } from "../server/config.js";

/**
 * The database layer. One PostgreSQL connection pool, shared by the
 * whole API, talking to our Supabase project.
 *
 * `pg` (node-postgres) is the official PostgreSQL driver for Node.js.
 * We send real SQL - Supabase is a hosted PostgreSQL server, not a
 * different kind of database - so everything in database/schema.sql is
 * ordinary PostgreSQL.
 */

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set.\n" +
      "  1. Create a free project at https://supabase.com\n" +
      "  2. Project Settings -> Database -> Connection string -> URI\n" +
      "  3. Copy .env.example to .env and paste it in as DATABASE_URL\n" +
      "See database/README.md for the full walkthrough."
  );
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // The automated tests point this at their own throw-away schema, so a
  // test run can never touch the real tables.
  options: process.env.DATABASE_SCHEMA
    ? "-c search_path=" + process.env.DATABASE_SCHEMA
    : undefined,
  // Supabase requires TLS. Their certificate is signed by a root that
  // Node does not ship with, so we accept it explicitly rather than
  // turning encryption off.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

/**
 * Run a query. Always use $1, $2 … placeholders and pass the values
 * separately - never build SQL by joining strings, or you open the door
 * to SQL injection.
 */
export async function query(text, params = []) {
  const started = Date.now();
  try {
    const result = await pool.query(text, params);
    if (config.logSlowQueries) {
      const ms = Date.now() - started;
      if (ms > 400) console.warn("[db] slow query (" + ms + "ms):", text.slice(0, 90));
    }
    return result;
  } catch (err) {
    // Add the failing statement to the message - a bare "syntax error"
    // with no context is painful to debug.
    err.sql = text;
    throw err;
  }
}

/** One row, or undefined. Replaces better-sqlite3's .get(). */
export async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0];
}

/** Every row. Replaces .all(). */
export async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

/** How many rows were affected. Replaces .run().changes. */
export async function run(text, params = []) {
  const result = await query(text, params);
  return result.rowCount;
}

/**
 * Run several statements as one unit: either all of them happen or none
 * of them do. Used where a half-finished write would leave bad data,
 * for example replacing a position's interview stages.
 */
export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Used by the health check and on startup. */
export async function ping() {
  const row = await one("SELECT version() AS version, current_database() AS name");
  return row;
}

export async function closePool() {
  await pool.end();
}
