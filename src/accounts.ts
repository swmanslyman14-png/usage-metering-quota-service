import { pool } from "./db.js";
import { generateApiKey, hashApiKey } from "./api-keys.js";
import { HttpError } from "./http-error.js";

export async function createAccount(name: string, planId: number) {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const plan = await pool.query(
    `SELECT id
     FROM plans
     WHERE id = $1
       AND plan_type = 'account'
       AND is_predefined = TRUE`,
    [planId],
  );

  if (plan.rowCount === 0) {
    throw new HttpError(400, "Invalid account plan");
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, api_key_hash, plan_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [name, apiKeyHash, planId],
  );

  return {
    accountId: result.rows[0].id,
    apiKey,
  };
}

export async function getAccount(id: string) {
  const row = await pool.query(
    `SELECT a.id, a.name, a.created_at, p.id AS plan_id, p.name AS plan_name,
            p.monthly_limit, p.max_per_request
     FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = $1`, [id],
  );
  return row.rows[0];
}
