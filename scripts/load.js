const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { writeFile } = require("node:fs/promises");
const { startTestServer } = require("./test-server.js");

const count = Number(process.env.LOAD_REQUESTS || 500);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 20);
let base;

async function call(path, key, method = "GET", body) {
  const headers = {};
  if (key) {
    headers["x-api-key"] = key;
  }
  const options = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(base + path, options);
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  return data;
}

async function account(plans, monthly) {
  const starter = plans.find((p) => p.name === "Starter");
  const basic = plans.find((p) => p.name === "Basic");
  const a = await call("/accounts", null, "POST", { name: "Load", planId: Number(starter.id) });
  const key = a.apiKey;
  const ap = await call("/plans", key, "POST", {
    name: "Load account", planType: "account", monthlyLimit: monthly, maxPerRequest: monthly,
  });
  const up = await call("/plans", key, "POST", {
    name: "Load users", planType: "user", monthlyLimit: count * 10, maxPerRequest: count * 10,
  });
  await call("/account/plan", key, "PATCH", { planId: Number(ap.id) });
  const users = [];
  for (let i = 0; i < 4; i++) {
    const u = await call("/users", key, "POST", { name: "User " + i, planId: Number(basic.id) });
    await call("/users/" + u.userId + "/plan", key, "PATCH", { planId: Number(up.id) });
    users.push(u.userId);
  }
  return { key, users, accepted: 0 };
}

async function run(name, accounts, retries) {
  let next = 0;
  let accepted = 0;
  const latencies = [];
  async function worker() {
    while (next < count) {
      const i = next;
      next += 1;
      const a = accounts[i % accounts.length];
      let userId = a.users[i % a.users.length];
      let requestId = name + "-" + i;
      if (retries) {
        userId = a.users[0];
        requestId = "one-shared-retry";
      }
      const start = performance.now();
      const result = await call("/consume", a.key, "POST", { userId, units: 1, requestId });
      latencies.push(performance.now() - start);
      if (result.accepted) {
        accepted += 1;
        a.accepted += 1;
      }
    }
  }
  const start = performance.now();
  const jobs = [];
  for (let i = 0; i < concurrency; i++) {
    jobs.push(worker());
  }
  await Promise.all(jobs);
  const elapsed = performance.now() - start;
  for (const a of accounts) {
    const accountUsage = await call("/usage", a.key);
    let expected = a.accepted;
    if (retries) {
      expected = 1;
    }
    assert.equal(accountUsage.account.used, String(expected));
    let total = 0;
    for (const id of a.users) {
      const u = await call("/usage?userId=" + id, a.key);
      total += Number(u.user.used);
    }
    assert.equal(total, expected);
    let outcomes = 0;
    let acceptedUnits = 0;
    for (let offset = 0; ; offset += 100) {
      const data = await call("/history?limit=100&offset=" + offset, a.key);
      outcomes += data.history.length;
      for (const row of data.history) {
        if (row.accepted) {
          acceptedUnits += Number(row.units);
        }
      }
      if (data.history.length < 100) {
        break;
      }
    }
    assert.equal(acceptedUnits, expected);
    if (retries) {
      assert.equal(outcomes, 1);
    } else {
      assert.equal(outcomes, count / accounts.length);
    }
  }
  latencies.sort((a, b) => a - b);
  function percentile(p) {
    return Number(latencies[Math.ceil(latencies.length * p) - 1].toFixed(2));
  }
  return {
    name, requests: count, concurrency, accounts: accounts.length,
    acceptedResponses: accepted, rejectedResponses: count - accepted,
    elapsedMs: Number(elapsed.toFixed(2)),
    requestsPerSecond: Number((count * 1000 / elapsed).toFixed(2)),
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    correctness: "Usage equals accepted unique units; account equals summed users; history agrees",
  };
}

async function main() {
  assert.ok(Number.isSafeInteger(count) && count >= 20 && count <= 100000 && count % 4 === 0);
  assert.ok(Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= 200);
  const app = await startTestServer();
  base = app.base;
  try {
    const plans = await call("/plans");
    const capped = await account(plans, count / 2);
    const shared = await run("shared-account-quota", [capped], false);
    assert.equal(shared.acceptedResponses, count / 2);
    assert.equal(shared.rejectedResponses, count / 2);
    const accounts = [];
    for (let i = 0; i < 4; i++) {
      accounts.push(await account(plans, count));
    }
    const independent = await run("four-accounts", accounts, false);
    assert.equal(independent.acceptedResponses, count);
    const retry = await account(plans, count);
    const retries = await run("same-request-retries", [retry], true);
    assert.equal(retries.acceptedResponses, count);
    const result = {
      timestamp: new Date().toISOString(), node: process.version,
      platform: process.platform, architecture: process.arch,
      database: (await app.pool.query("SHOW server_version")).rows[0].server_version,
      scenarios: [shared, independent, retries],
    };
    await writeFile("docs/performance-results.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
