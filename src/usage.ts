import { pool, beginAccount } from "./db.js";
import { HttpError } from "./http-error.js";

export async function getUsage(accountId: string, userId: string | null, month: string | null) {
  const client = await beginAccount(accountId);
  try {
    if (month === null) {
      const result = await client.query<{ time: Date }>("SELECT clock_timestamp() AS time");
      month = result.rows[0].time.toISOString().slice(0, 7) + "-01";
    }

    const account = await client.query(
      `SELECT a.id, a.plan_id, p.monthly_limit, p.max_per_request
       FROM accounts AS a
       JOIN plans AS p ON p.id = a.plan_id
       WHERE a.id = $1`,
      [accountId],
    );

    const accousage = await client.query<{ units_used: string }>(
      "SELECT units_used FROM account_usage WHERE account_id = $1 AND month = $2",
      [accountId, month],
    );

    let accused = 0n;
    if (accousage.rows.length > 0) {
      accused = BigInt(accousage.rows[0].units_used);
    }

    let remaining = BigInt(account.rows[0].monthly_limit) - accused;
    if (remaining < 0n) {
      remaining = 0n;
    }

    const a = {
      id: account.rows[0].id,
      planId: account.rows[0].plan_id,
      monthlyLimit: account.rows[0].monthly_limit,
      maxPerRequest: account.rows[0].max_per_request,
      used: accused.toString(),
      remaining: remaining.toString(),
    };

    if (userId === null) {
      await client.query("COMMIT");
      return { month: month.slice(0, 7), account: a, user: null };
    }

    const user = await client.query(
      `SELECT u.id, u.plan_id, p.monthly_limit, p.max_per_request
       FROM users AS u
       JOIN plans AS p ON p.id = u.plan_id
       WHERE u.id = $1 AND u.account_id = $2`,
      [userId, accountId],
    );

    if (user.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }

    const userusage = await client.query<{ units_used: string }>(
      "SELECT units_used FROM user_usage WHERE account_id = $1 AND user_id = $2 AND month = $3",
      [accountId, userId, month],
    );

    let usused = 0n;
    if (userusage.rows.length > 0) {
      usused = BigInt(userusage.rows[0].units_used);
    }

    remaining = BigInt(user.rows[0].monthly_limit) - usused;
    if (remaining < 0n) {
      remaining = 0n;
    }

    const u = {
      id: user.rows[0].id,
      planId: user.rows[0].plan_id,
      monthlyLimit: user.rows[0].monthly_limit,
      maxPerRequest: user.rows[0].max_per_request,
      used: usused.toString(),
      remaining: remaining.toString(),
    };

    await client.query("COMMIT");
    return { month: month.slice(0, 7), account: a, user: u };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
