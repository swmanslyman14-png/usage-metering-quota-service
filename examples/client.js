const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");

const base = process.env.API_URL || "http://localhost:3000";
let key = "";

async function call(path, method = "GET", body) {
  const headers = {};
  if (key) {
    headers["x-api-key"] = key;
  }
  const options = { method, headers, signal: AbortSignal.timeout(15000) };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(method + " " + path + ": " + JSON.stringify(data));
  }
  return data;
}

async function action(label, userId, units, accepted, reason) {
  const data = await call("/consume", "POST", { userId, units, requestId: randomUUID() });
  assert.equal(data.accepted, accepted);
  assert.equal(data.rejectionReason, reason);
  console.log(label + ": " + JSON.stringify(data));
  console.log("Allowances: " + JSON.stringify(await call("/usage?userId=" + userId)));
}

async function main() {
  const plans = await call("/plans");
  const starter = plans.find((p) => p.name === "Starter" && p.plan_type === "account");
  const basic = plans.find((p) => p.name === "Basic" && p.plan_type === "user");
  const premium = plans.find((p) => p.name === "Premium" && p.plan_type === "user");
  assert.ok(starter && basic && premium, "Predefined plans must be seeded");
  const account = await call("/accounts", "POST", { name: "Document demo", planId: Number(starter.id) });
  key = account.apiKey;
  console.log("Created demo account " + account.accountId);
  const plan = await call("/plans", "POST", {
    name: "Shared demo allowance", planType: "account", monthlyLimit: 100, maxPerRequest: 100,
  });
  await call("/account/plan", "PATCH", { planId: Number(plan.id) });
  const a = await call("/users", "POST", { name: "Alice", planId: Number(basic.id) });
  const b = await call("/users", "POST", { name: "Bob", planId: Number(premium.id) });
  await action("Alice processes a small document", a.userId, 20, true, null);
  await action("Alice exceeds Basic per-request limit", a.userId, 60, false, "User max per request exceeded");
  await action("Bob uses the shared allowance", b.userId, 70, true, null);
  await action("Bob exceeds the remaining account allowance", b.userId, 20, false, "Account monthly limit exceeded");
  await call("/plans/" + plan.id, "PUT", {
    name: "Shared demo allowance", planType: "account", monthlyLimit: 200, maxPerRequest: 100,
  });
  await call("/users/" + a.userId + "/plan", "PATCH", { planId: Number(premium.id) });
  await action("Alice succeeds after live plan changes", a.userId, 60, true, null);
  console.log("History: " + JSON.stringify(await call("/history?limit=10")));
  console.log("Demo complete. Existing usage was preserved after the plan changes.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
