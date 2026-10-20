import pg from "pg";
import { HttpError } from "./http-error.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
  console.error("Database connection failed", error.message);
});

export async function beginAccount(id: string) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '10s'");
    const row = await db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [id]);
    if (row.rowCount === 0) {
      throw new HttpError(404, "Account not found");
    }
    return db;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } finally {
      db.release();
    }
    throw error;
  }
}
