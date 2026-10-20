import { pool, beginAccount } from "./db.js";
import { HttpError } from "./http-error.js";

export async function getPlans(accountId: string | null) {
  const row = await pool.query(
    `SELECT id, name, plan_type, monthly_limit, max_per_request, is_predefined
     FROM plans WHERE is_predefined = TRUE OR owner_account_id = $1 ORDER BY id`, [accountId],
  );
  return row.rows;
}

export async function createPlan(accountId: string, name: string, type: string, monthly: number, max: number) {
  const row = await pool.query(
    `INSERT INTO plans (owner_account_id, name, plan_type, monthly_limit, max_per_request)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, plan_type, monthly_limit, max_per_request, is_predefined`,
    [accountId, name, type, monthly, max],
  );
  return row.rows[0];
}

export async function updatePlan(accountId: string, id: string, name: string, type: string, monthly: number, max: number) {
  const db = await beginAccount(accountId);
  try {
    const row = await db.query(
      `UPDATE plans SET name = $3, monthly_limit = $4, max_per_request = $5
       WHERE id = $1 AND owner_account_id = $2 AND plan_type = $6 AND is_predefined = FALSE
       RETURNING id, name, plan_type, monthly_limit, max_per_request, is_predefined`,
      [id, accountId, name, monthly, max, type],
    );
    if (row.rowCount === 0) {
      throw new HttpError(404, "Custom plan not found or plan type does not match");
    }
    await db.query("COMMIT");
    return row.rows[0];
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function changePlan(accountId: string, planId: number, userId: string | null) {
  const db = await beginAccount(accountId);
  try {
    let type = "account";
    if (userId !== null) {
      type = "user";
    }
    const plan = await db.query(
      `SELECT id FROM plans
       WHERE id = $1 AND plan_type = $2 AND (is_predefined = TRUE OR owner_account_id = $3)`,
      [planId, type, accountId],
    );
    if (plan.rowCount === 0) {
      throw new HttpError(400, "Invalid " + type + " plan");
    }
    if (userId === null) {
      await db.query("UPDATE accounts SET plan_id = $2 WHERE id = $1", [accountId, planId]);
    } else {
      const row = await db.query(
        "UPDATE users SET plan_id = $3 WHERE account_id = $1 AND id = $2",
        [accountId, userId, planId],
      );
      if (row.rowCount === 0) {
        throw new HttpError(404, "User not found");
      }
    }
    await db.query("COMMIT");
    return { planId: String(planId) };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
