import { pool } from "./db.js";
import { HttpError } from "./http-error.js";

export async function createUser(accountId: string, name: string, planId: number) {
  const plan = await pool.query(
    `SELECT id
     FROM plans
     WHERE id = $1
       AND plan_type = 'user'
       AND (
         is_predefined = TRUE
         OR owner_account_id = $2
       )`,
    [planId, accountId],
  );

  if (plan.rowCount === 0) {
    throw new HttpError(400, "Invalid user plan");
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (account_id, name, plan_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [accountId, name, planId],
  );

  return {
    userId: result.rows[0].id,
  };
}

export async function getUsers(accountId: string, limit: number, offset: number) {
  const row = await pool.query(
    `SELECT u.id, u.name, u.created_at, p.id AS plan_id, p.name AS plan_name,
            p.monthly_limit, p.max_per_request
     FROM users u JOIN plans p ON p.id = u.plan_id
     WHERE u.account_id = $1 ORDER BY u.id LIMIT $2 OFFSET $3`, [accountId, limit, offset],
  );
  return row.rows;
}
