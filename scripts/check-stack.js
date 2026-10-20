const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

const base = process.env.API_URL || "http://localhost:3000";
const path = ".local/stack-fixture.json";

async function call(url, key, method = "GET", body) {
  const headers = {};
  if (key) {
    headers["x-api-key"] = key;
  }
  const options = { method, headers, signal: AbortSignal.timeout(15000) };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, options);
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  return data;
}

async function main() {
  if (process.argv[2] === "seed") {
    const plans = await call("/plans");
    const ap = plans.find((p) => p.name === "Starter");
    const up = plans.find((p) => p.name === "Basic");
    const a = await call("/accounts", null, "POST", { name: "Restart check", planId: Number(ap.id) });
    const u = await call("/users", a.apiKey, "POST", { name: "Restart user", planId: Number(up.id) });
    const result = await call("/consume", a.apiKey, "POST", { userId: u.userId, units: 1, requestId: "restart-check" });
    assert.equal(result.accepted, true);
    const usage = await call("/usage?userId=" + u.userId, a.apiKey);
    await fs.mkdir(".local", { recursive: true });
    await fs.writeFile(path, JSON.stringify({ key: a.apiKey, userId: u.userId, usage }));
    console.log("Restart fixture saved privately");
  } else if (process.argv[2] === "check") {
    const f = JSON.parse(await fs.readFile(path, "utf8"));
    const result = await call("/consume", f.key, "POST", { userId: f.userId, units: 1, requestId: "restart-check" });
    assert.equal(result.accepted, true);
    const usage = await call("/usage?userId=" + f.userId + "&month=" + f.usage.month, f.key);
    assert.deepEqual(usage, f.usage);
    const history = await call("/history?userId=" + f.userId, f.key);
    assert.equal(history.history.length, 1);
    console.log("Restart preserved authentication, assignments, totals, history and retry identity");
  } else {
    throw new Error("Use node scripts/check-stack.js seed or check");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
