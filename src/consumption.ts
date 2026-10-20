import { beginAccount } from "./db.js";
import { HttpError } from "./http-error.js";

type Quota = {
  account_plan_id: string;
  user_plan_id: string;
  account_limit: string;
  account_max: string;
  user_limit: string;
  user_max: string;
  account_used: string;
  user_used: string;
  month: string;
  time: Date;
};

export async function consume(accountId: string, userId: string, units: number, requestId: string) {
  const db = await beginAccount(accountId);
  try {
    const existing = await db.query<{
      user_id: string; units: string; accepted: boolean; rejection_reason: string | null;
    }>(
      `SELECT user_id, units, accepted, rejection_reason
       FROM consumption_requests WHERE account_id = $1 AND request_id = $2`, [accountId, requestId],
    );
    if (existing.rowCount !== 0) {
      const row = existing.rows[0];
      if (String(row.user_id) !== userId || BigInt(row.units) !== BigInt(units)) {
        throw new HttpError(409, "Request ID already used with different data");
      }
      await db.query("COMMIT");
      return { accepted: row.accepted, rejectionReason: row.rejection_reason };
    }
    const result = await db.query<Quota>(
      `WITH t AS (SELECT clock_timestamp() AS time)
       SELECT a.plan_id AS account_plan_id, u.plan_id AS user_plan_id,
              ap.monthly_limit AS account_limit, ap.max_per_request AS account_max,
              up.monthly_limit AS user_limit, up.max_per_request AS user_max,
              COALESCE(au.units_used, 0)::text AS account_used,
              COALESCE(uu.units_used, 0)::text AS user_used,
              to_char(t.time AT TIME ZONE 'UTC', 'YYYY-MM-01') AS month, t.time
       FROM accounts a
       JOIN users u ON u.account_id = a.id AND u.id = $2
       JOIN plans ap ON ap.id = a.plan_id
       JOIN plans up ON up.id = u.plan_id
       CROSS JOIN t
       LEFT JOIN account_usage au ON au.account_id = a.id
         AND au.month = date_trunc('month', t.time AT TIME ZONE 'UTC')::date
       LEFT JOIN user_usage uu ON uu.account_id = a.id AND uu.user_id = u.id
         AND uu.month = date_trunc('month', t.time AT TIME ZONE 'UTC')::date
       WHERE a.id = $1`, [accountId, userId],
    );
    if (result.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }
    const row = result.rows[0];
    const qty = BigInt(units);
    let reason: string | null = null;
    if (qty > BigInt(row.account_max)) {
      reason = "Account max per request exceeded";
    } else if (qty > BigInt(row.user_max)) {
      reason = "User max per request exceeded";
    } else if (BigInt(row.account_used) + qty > BigInt(row.account_limit)) {
      reason = "Account monthly limit exceeded";
    } else if (BigInt(row.user_used) + qty > BigInt(row.user_limit)) {
      reason = "User monthly limit exceeded";
    }
    const accepted = reason === null;
    if (accepted) {
      await db.query(
        `INSERT INTO account_usage (account_id, month, units_used) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, month) DO UPDATE
         SET units_used = account_usage.units_used + EXCLUDED.units_used`, [accountId, row.month, units],
      );
      await db.query(
        `INSERT INTO user_usage (account_id, user_id, month, units_used) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, month) DO UPDATE
         SET units_used = user_usage.units_used + EXCLUDED.units_used`, [accountId, userId, row.month, units],
      );
    }
    await db.query(
      `INSERT INTO consumption_requests
       (account_id, user_id, request_id, units, accepted, rejection_reason, account_plan_id, user_plan_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [accountId, userId, requestId, units, accepted, reason, row.account_plan_id, row.user_plan_id, row.time],
    );
    await db.query("COMMIT");
    return { accepted, rejectionReason: reason };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
