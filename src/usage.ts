import { pool } from "./db.js";
import { HttpError } from "./http-error.js";

export async function getUsage(accountId: string, userId: string | null, month: string | null) {
  const row = await pool.query(
    `WITH period AS (
       SELECT COALESCE($3::date, date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date) AS month
     )
     SELECT to_char(t.month, 'YYYY-MM') AS month,
            a.id AS account_id, a.plan_id AS account_plan_id,
            ap.monthly_limit AS account_limit, ap.max_per_request AS account_max_per_request,
            COALESCE(au.units_used, 0)::text AS account_used,
            GREATEST(ap.monthly_limit - COALESCE(au.units_used, 0), 0)::text AS account_remaining,
            u.id AS user_id, u.plan_id AS user_plan_id,
            up.monthly_limit AS user_limit, up.max_per_request AS user_max_per_request,
            COALESCE(uu.units_used, 0)::text AS user_used,
            GREATEST(up.monthly_limit - COALESCE(uu.units_used, 0), 0)::text AS user_remaining
     FROM accounts a JOIN plans ap ON ap.id = a.plan_id CROSS JOIN period t
     LEFT JOIN account_usage au ON au.account_id = a.id AND au.month = t.month
     LEFT JOIN users u ON u.account_id = a.id AND u.id = $2
     LEFT JOIN plans up ON up.id = u.plan_id
     LEFT JOIN user_usage uu ON uu.user_id = u.id AND uu.month = t.month
     WHERE a.id = $1`, [accountId, userId, month],
  );
  const n = row.rows[0];
  if (userId !== null && n.user_id === null) {
    throw new HttpError(404, "User not found");
  }
  const account = {
    id: n.account_id, planId: n.account_plan_id, monthlyLimit: n.account_limit,
    maxPerRequest: n.account_max_per_request, used: n.account_used, remaining: n.account_remaining,
  };
  if (userId !== null) {
    const user = {
      id: n.user_id, planId: n.user_plan_id, monthlyLimit: n.user_limit,
      maxPerRequest: n.user_max_per_request, used: n.user_used, remaining: n.user_remaining,
    };
    return { month: n.month, account, user };
  }
  return { month: n.month, account, user: null };
}

export async function getHistory(accountId: string, userId: string | null, month: string | null, limit: number, offset: number) {
  if (userId !== null) {
    const user = await pool.query("SELECT id FROM users WHERE account_id = $1 AND id = $2", [accountId, userId]);
    if (user.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }
  }
  const row = await pool.query(
    `SELECT id, user_id, request_id, units, accepted, rejection_reason,
            account_plan_id, user_plan_id, created_at
     FROM consumption_requests
     WHERE account_id = $1 AND ($2::bigint IS NULL OR user_id = $2)
       AND ($3::date IS NULL OR (
         created_at >= ($3::date::timestamp AT TIME ZONE 'UTC')
         AND created_at < (($3::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC')
       ))
     ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5`,
    [accountId, userId, month, limit, offset],
  );
  return row.rows;
}
