import type { IncomingMessage } from "node:http";
import { HttpError } from "./http-error.js";
import { hashApiKey } from "./api-keys.js";
import { pool } from "./db.js";

export async function authenticate(request: IncomingMessage) {
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new HttpError(401, "Invalid or missing API key");
  }

  const apiKeyHash = hashApiKey(apiKey);
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM accounts WHERE api_key_hash = $1",
    [apiKeyHash],
  );

  if (result.rowCount === 0) {
    throw new HttpError(401, "Invalid or missing API key");
  } else {
    return result.rows[0].id;
  }
}
