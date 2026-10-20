const { once } = require("node:events");
const { readFile } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const pg = require("pg");

async function startTestServer() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Set TEST_DATABASE_URL or run scripts/test-db.ps1 and load .local/test.env");
  }
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let server;
  let pool;
  async function close() {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (pool) {
      await pool.end();
    }
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await admin.end();
  }
  try {
    const db = await admin.connect();
    try {
      await db.query('CREATE SCHEMA "' + schema + '"');
      await db.query('SET search_path TO "' + schema + '"');
      await db.query(await readFile("db/schema.sql", "utf8"));
      await db.query(await readFile("db/seed.sql", "utf8"));
    } finally {
      db.release();
    }
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema + " -c timezone=America/Los_Angeles");
    url.searchParams.set("application_name", schema);
    process.env.DATABASE_URL = url.toString();
    server = require("../dist/server.js").server;
    pool = require("../dist/db.js").pool;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { server, pool, base: "http://127.0.0.1:" + server.address().port, close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { startTestServer };
