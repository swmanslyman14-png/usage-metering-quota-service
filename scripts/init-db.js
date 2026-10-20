const { readFile } = require("node:fs/promises");
const pg = require("pg");

async function main() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error("Set DATABASE_URL or PostgreSQL connection variables first");
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    const row = await db.query("SELECT to_regclass('accounts') AS name");
    if (row.rows[0].name !== null) {
      throw new Error("Database already has accounts; initialization stopped without changing existing data");
    }
    await db.query(await readFile("db/schema.sql", "utf8"));
    await db.query(await readFile("db/seed.sql", "utf8"));
    await db.query("COMMIT");
    console.log("Schema and predefined plans initialized");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
