import { beginAccount } from "./db.js";
import { HttpError } from "./http-error.js";

export async function consume(accountId: string, userId: string, units: number, requestId: string) {
  const client = await beginAccount(accountId);
  try {
    const account = await client.query(
      `SELECT a.id, a.plan_id, p.monthly_limit, p.max_per_request
       FROM accounts AS a
       JOIN plans AS p ON p.id = a.plan_id
       WHERE a.id = $1`,
      [accountId],
    );

    if (account.rowCount === 0) {
      throw new HttpError(404, "Account not found");
    }

    const user = await client.query(
      `SELECT u.id, u.plan_id, p.monthly_limit, p.max_per_request
       FROM users AS u
       JOIN plans AS p ON p.id = u.plan_id
       WHERE u.id = $1
         AND u.account_id = $2`,
      [userId, accountId],
    );

    if (user.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }

    const existing = await client.query<{
      user_id: string; units: string; accepted: boolean; rejection_reason: string | null;
    }>(
      `SELECT user_id, units, accepted, rejection_reason
       FROM consumption_requests
       WHERE account_id = $1
         AND request_id = $2`,
      [accountId, requestId],
    );

    if (existing.rowCount !== 0) {
      const previous = existing.rows[0];

      if (String(previous.user_id) !== userId || BigInt(previous.units) !== BigInt(units)) {
        throw new HttpError(409, "Request ID already used with different data");
      }

      await client.query("COMMIT");

      return {
        accepted: previous.accepted,
        rejectionReason: previous.rejection_reason,
      };
    }

    const result = await client.query<{ time: Date }>("SELECT clock_timestamp() AS time");
    const time = result.rows[0].time;
    const month = time.toISOString().slice(0, 7) + "-01";

    const accousage = await client.query<{ units_used: string }>(
      `SELECT units_used
       FROM account_usage
       WHERE account_id = $1 AND month = $2`,
      [accountId, month],
    );

    const userusage = await client.query<{ units_used: string }>(
      `SELECT units_used
       FROM user_usage
       WHERE account_id = $1
         AND user_id = $2
         AND month = $3`,
      [accountId, userId, month],
    );

    let accused = 0n;
    let usused = 0n;

    if (accousage.rows.length > 0) {
      accused = BigInt(accousage.rows[0].units_used);
    }

    if (userusage.rows.length > 0) {
      usused = BigInt(userusage.rows[0].units_used);
    }

    const accountML = BigInt(account.rows[0].monthly_limit);
    const accountMR = BigInt(account.rows[0].max_per_request);
    const userML = BigInt(user.rows[0].monthly_limit);
    const userMR = BigInt(user.rows[0].max_per_request);
    const qty = BigInt(units);
    let reason: string | null = null;

    if (qty > accountMR) {
      reason = "Account max per request exceeded";
    } else if (qty > userMR) {
      reason = "User max per request exceeded";
    } else if (accused + qty > accountML) {
      reason = "Account monthly limit exceeded";
    } else if (usused + qty > userML) {
      reason = "User monthly limit exceeded";
    }

    const accepted = reason === null;

    if (accepted) {
      if (accousage.rows.length === 0) {
        await client.query(
          "INSERT INTO account_usage (account_id, month, units_used) VALUES ($1, $2, $3)",
          [accountId, month, units],
        );
      } else {
        await client.query(
          `UPDATE account_usage
           SET units_used = units_used + $3
           WHERE account_id = $1 AND month = $2`,
          [accountId, month, units],
        );
      }

      if (userusage.rows.length === 0) {
        await client.query(
          "INSERT INTO user_usage (account_id, user_id, month, units_used) VALUES ($1, $2, $3, $4)",
          [accountId, userId, month, units],
        );
      } else {
        await client.query(
          `UPDATE user_usage
           SET units_used = units_used + $4
           WHERE account_id = $1 AND user_id = $2 AND month = $3`,
          [accountId, userId, month, units],
        );
      }
    }

    await client.query(
      `INSERT INTO consumption_requests
       (account_id, user_id, request_id, units, accepted, rejection_reason, account_plan_id, user_plan_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [accountId, userId, requestId, units, accepted, reason, account.rows[0].plan_id, user.rows[0].plan_id, time],
    );

    await client.query("COMMIT");

    return {
      accepted,
      rejectionReason: reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
