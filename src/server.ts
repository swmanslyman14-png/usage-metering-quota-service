import { createServer } from "node:http";
import { pool } from "./db.js";
import { createAccount, getAccount } from "./accounts.js";
import { authenticate } from "./auth.js";
import { createUser, getUsers } from "./users.js";
import { getPlans, createPlan, updatePlan, changePlan } from "./plans.js";
import { consume } from "./consumption.js";
import { getUsage, getHistory } from "./usage.js";
import { sendJson, handleHttpError, readJson } from "./http.js";
import { HttpError } from "./http-error.js";
import {
  validateNameAndPlanId, validatePlanId, validatePlan, validateConsumption,
  validateId, validateMonth, validatePage,
} from "./validation.js";

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;
    const method = request.method;
    if (method === "GET" && path === "/") {
      sendJson(response, 200, { service: "Usage Metering and Quota Service", status: "running" });
      return;
    }
    if (method === "GET" && path === "/health") {
      try {
        await pool.query("SELECT 1");
        sendJson(response, 200, { status: "ok", database: "connected" });
      } catch {
        sendJson(response, 503, { status: "error", database: "unavailable" });
      }
      return;
    }
    if (method === "POST" && path === "/accounts") {
      const body = await readJson(request);
      const { name, planId } = validateNameAndPlanId(body);
      const account = await createAccount(name, planId);
      sendJson(response, 201, account);
      return;
    }
    if (method === "GET" && path === "/plans") {
      let id: string | null = null;
      if (request.headers["x-api-key"] !== undefined) {
        id = await authenticate(request);
      }
      sendJson(response, 200, await getPlans(id));
      return;
    }
    const known = ["/account", "/account/plan", "/users", "/plans", "/consume", "/usage", "/history"];
    const userPlan = /^\/users\/([^/]+)\/plan$/.exec(path);
    const plan = /^\/plans\/([^/]+)$/.exec(path);
    if (!known.includes(path) && userPlan === null && plan === null) {
      throw new HttpError(404, "Not found");
    }
    const id = await authenticate(request);
    if (method === "GET" && path === "/account") {
      sendJson(response, 200, await getAccount(id));
    } else if (method === "PATCH" && path === "/account/plan") {
      const planId = validatePlanId(await readJson(request));
      sendJson(response, 200, await changePlan(id, planId, null));
    } else if (method === "POST" && path === "/users") {
      const accountId = id;
      const body = await readJson(request);
      const { name, planId } = validateNameAndPlanId(body);
      const result = await createUser(accountId, name, planId);
      sendJson(response, 201, result);
    } else if (method === "GET" && path === "/users") {
      const limit = validatePage(url.searchParams.get("limit"), 50, 100);
      const offset = validatePage(url.searchParams.get("offset"), 0, 1000000);
      if (limit === 0) {
        throw new HttpError(400, "Limit must be positive");
      }
      sendJson(response, 200, { users: await getUsers(id, limit, offset), limit, offset });
    } else if (method === "PATCH" && userPlan !== null) {
      const userId = validateId(userPlan[1]);
      const planId = validatePlanId(await readJson(request));
      sendJson(response, 200, await changePlan(id, planId, userId));
    } else if (method === "POST" && path === "/plans") {
      const body = validatePlan(await readJson(request));
      sendJson(response, 201, await createPlan(id, body.name, body.planType, body.monthlyLimit, body.maxPerRequest));
    } else if (method === "PUT" && plan !== null) {
      const planId = validateId(plan[1]);
      const body = validatePlan(await readJson(request));
      sendJson(response, 200, await updatePlan(id, planId, body.name, body.planType, body.monthlyLimit, body.maxPerRequest));
    } else if (method === "POST" && path === "/consume") {
      const body = validateConsumption(await readJson(request));
      sendJson(response, 200, await consume(id, body.userId, body.units, body.requestId));
    } else if (method === "GET" && (path === "/usage" || path === "/history")) {
      let userId: string | null = null;
      if (url.searchParams.has("userId")) {
        userId = validateId(url.searchParams.get("userId"));
      }
      const month = validateMonth(url.searchParams.get("month"));
      if (path === "/usage") {
        sendJson(response, 200, await getUsage(id, userId, month));
      } else {
        const limit = validatePage(url.searchParams.get("limit"), 50, 100);
        const offset = validatePage(url.searchParams.get("offset"), 0, 1000000);
        if (limit === 0) {
          throw new HttpError(400, "Limit must be positive");
        }
        sendJson(response, 200, { history: await getHistory(id, userId, month, limit, offset), limit, offset });
      }
    } else {
      throw new HttpError(405, "Method not allowed");
    }
  } catch (error) {
    handleHttpError(response, error);
  } finally {
    if (!request.complete) {
      request.resume();
    }
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
