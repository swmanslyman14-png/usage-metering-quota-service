import type { IncomingMessage } from "node:http";
import { HttpError } from "./http-error.js";
import { hashApiKey } from "./api-keys.js";
import { pool } from "./db.js";

export async function authenticate(req: IncomingMessage) {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key)) {
    throw new HttpError(401, "Invalid or missing API key");
  }
  const row = await pool.query<{ id: string }>(
    "SELECT id FROM accounts WHERE api_key_hash = $1", [hashApiKey(key)],
  );
  if (row.rowCount === 0) {
    throw new HttpError(401, "Invalid or missing API key");
  }
  return row.rows[0].id;
}
