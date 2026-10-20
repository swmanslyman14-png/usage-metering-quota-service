const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { startTestServer } = require("../scripts/test-server.js");

let app;
let pool;
let base;
let starter;
let basic;

before(async () => {
  app = await startTestServer();
  pool = app.pool;
  base = app.base;
  const plans = await ok("/plans");
  starter = Number(plans.find((p) => p.name === "Starter").id);
  basic = Number(plans.find((p) => p.name === "Basic").id);
});

after(async () => {
  if (app) {
    await app.close();
  }
});

async function call(path, key, method = "GET", body) {
  const headers = {};
  if (key !== undefined) {
    headers["x-api-key"] = key;
  }
  const options = { method, headers, signal: AbortSignal.timeout(20000) };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(base + path, options);
  return { status: res.status, data: await res.json() };
}

async function ok(path, key, method = "GET", body) {
  const res = await call(path, key, method, body);
  assert.ok(res.status >= 200 && res.status < 300, JSON.stringify(res));
  return res.data;
}

async function fixture(monthly = 100, max = 100, userMonthly = 50, userMax = 50) {
  const a = await ok("/accounts", undefined, "POST", { name: "Test", planId: starter });
  const key = a.apiKey;
  const ap = await ok("/plans", key, "POST", {
    name: "Account", planType: "account", monthlyLimit: monthly, maxPerRequest: max,
  });
  const up = await ok("/plans", key, "POST", {
    name: "User", planType: "user", monthlyLimit: userMonthly, maxPerRequest: userMax,
  });
  await ok("/account/plan", key, "PATCH", { planId: Number(ap.id) });
  const u = await ok("/users", key, "POST", { name: "Alice", planId: Number(up.id) });
  return { a, key, ap, up, userId: u.userId };
}

async function consume(f, units, requestId = randomUUID(), userId = f.userId) {
  return ok("/consume", f.key, "POST", { userId, units, requestId });
}

async function usage(f, suffix = "") {
  return ok("/usage?userId=" + f.userId + suffix, f.key);
}

test("manual database initialization seeds once and refuses to reset existing data", async () => {
  const schema = "init_" + randomUUID().replaceAll("-", "");
  await pool.query('CREATE SCHEMA "' + schema + '"');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", "-c search_path=" + schema);
  const env = Object.assign({}, process.env);
  env.DATABASE_URL = url.toString();
  try {
    const first = spawnSync(process.execPath, ["scripts/init-db.js"], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, ["scripts/init-db.js"], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already has accounts/);
    const row = await pool.query('SELECT count(*)::int AS n FROM "' + schema + '".plans');
    assert.equal(row.rows[0].n, 4);
  } finally {
    await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
  }
});

test("startup, seeding, health, account creation and API key security", async () => {
  assert.equal((await ok("/health")).database, "connected");
  assert.equal((await ok("/plans")).length, 4);
  assert.equal((await call("/accounts", undefined, "POST", { name: "x", planId: basic })).status, 400);
  const f = await fixture();
  for (const key of [undefined, "", "x", "a".repeat(64)]) {
    assert.equal((await call("/account", key)).status, 401);
  }
  const a = await ok("/account", f.key);
  assert.equal(a.id, f.a.accountId);
  assert.ok(!JSON.stringify(a).includes("api_key"));
  const row = await pool.query("SELECT api_key_hash FROM accounts WHERE id = $1", [a.id]);
  assert.notEqual(row.rows[0].api_key_hash, f.key);
  assert.equal((await call("/plans", "invalid")).status, 401);
});

test("invalid bodies and paths have consistent errors and leave the API working", async () => {
  const f = await fixture();
  for (const body of [null, [], {}, { userId: f.userId, units: 0, requestId: "r" },
    { userId: 1, units: 1, requestId: "r" }, { userId: "9223372036854775808", units: 1, requestId: "r" }]) {
    assert.equal((await call("/consume", f.key, "POST", body)).status, 400);
  }
  for (const path of ["/usage?month=2026-13", "/usage?userId=-1", "/history?limit=0",
    "/history?limit=101", "/history?offset=-1", "/users?limit=0"]) {
    assert.equal((await call(path, f.key)).status, 400);
  }
  assert.equal((await call("/unknown", f.key)).status, 404);
  assert.equal((await call("/consume", f.key, "GET")).status, 405);
  const malformed = await fetch(base + "/consume", {
    method: "POST", headers: { "x-api-key": f.key }, body: "{",
  });
  assert.equal(malformed.status, 400);
  const large = await fetch(base + "/consume", {
    method: "POST", headers: { "x-api-key": f.key }, body: "x".repeat(20000),
  });
  assert.equal(large.status, 413);
  assert.equal((await ok("/health")).status, "ok");
});

test("account isolation applies to users, plans, assignments, usage, history and retry IDs", async () => {
  const a = await fixture();
  const b = await fixture();
  assert.equal((await call("/consume", a.key, "POST", { userId: b.userId, units: 1, requestId: "foreign" })).status, 404);
  assert.equal((await call("/usage?userId=" + b.userId, a.key)).status, 404);
  assert.equal((await call("/history?userId=" + b.userId, a.key)).status, 404);
  assert.equal((await call("/users", a.key, "POST", { name: "x", planId: Number(b.up.id) })).status, 400);
  assert.equal((await call("/users/" + b.userId + "/plan", a.key, "PATCH", { planId: basic })).status, 404);
  assert.equal((await call("/account/plan", a.key, "PATCH", { planId: Number(b.ap.id) })).status, 400);
  assert.equal((await call("/plans/" + b.up.id, a.key, "PUT", {
    name: "x", planType: "user", monthlyLimit: 1, maxPerRequest: 1,
  })).status, 404);
  const plans = await ok("/plans", a.key);
  assert.ok(!plans.some((p) => p.id === b.up.id || p.id === b.ap.id));
  const users = await ok("/users", a.key);
  assert.ok(users.users.every((u) => u.id !== b.userId));
  await consume(a, 1, "same");
  await consume(b, 1, "same");
  assert.equal((await ok("/history", a.key)).history.length, 1);
  assert.equal((await usage(b)).account.used, "1");
});

test("both maximum-per-request rules reject without usage and record reasons", async () => {
  const a = await fixture(100, 10, 100, 20);
  assert.deepEqual(await consume(a, 11), { accepted: false, rejectionReason: "Account max per request exceeded" });
  const b = await fixture(100, 20, 100, 10);
  assert.deepEqual(await consume(b, 11), { accepted: false, rejectionReason: "User max per request exceeded" });
  assert.equal((await usage(a)).account.used, "0");
  assert.equal((await usage(b)).user.used, "0");
  assert.equal((await ok("/history", b.key)).history[0].accepted, false);
  assert.equal((await consume(b, 10)).accepted, true);
});

test("user monthly boundary, shared plans and account shared monthly boundary", async () => {
  const f = await fixture(30, 100, 20, 100);
  const b = await ok("/users", f.key, "POST", { name: "Bob", planId: Number(f.up.id) });
  assert.equal((await consume(f, 20)).accepted, true);
  assert.equal((await consume(f, 1)).rejectionReason, "User monthly limit exceeded");
  assert.equal((await consume(f, 10, randomUUID(), b.userId)).accepted, true);
  assert.equal((await consume(f, 1, randomUUID(), b.userId)).rejectionReason, "Account monthly limit exceeded");
  const u = await usage(f);
  assert.equal(u.account.used, "30");
  assert.equal(u.account.remaining, "0");
  assert.equal(u.user.used, "20");
  assert.equal((await ok("/usage?userId=" + b.userId, f.key)).user.used, "10");
});

test("accepted and rejected retries remain identical across plan changes, and conflicts return 409", async () => {
  const f = await fixture();
  const result = await consume(f, 10, "accepted");
  assert.deepEqual(await consume(f, 10, "accepted"), result);
  assert.equal((await call("/consume", f.key, "POST", { userId: f.userId, units: 11, requestId: "accepted" })).status, 409);
  const b = await ok("/users", f.key, "POST", { name: "Bob", planId: Number(f.up.id) });
  assert.equal((await call("/consume", f.key, "POST", { userId: b.userId, units: 10, requestId: "accepted" })).status, 409);
  const rejected = await consume(f, 51, "rejected");
  await ok("/plans/" + f.up.id, f.key, "PUT", {
    name: "Bigger", planType: "user", monthlyLimit: 100, maxPerRequest: 100,
  });
  assert.deepEqual(await consume(f, 51, "rejected"), rejected);
  assert.equal((await consume(f, 51)).accepted, true);
  assert.equal((await usage(f)).account.used, "61");
  assert.equal((await ok("/history", f.key)).history.length, 3);
});

test("plan updates and switches preserve usage, clamp remaining, and preserve decision history", async () => {
  const f = await fixture();
  await consume(f, 20);
  await ok("/plans/" + f.up.id, f.key, "PUT", {
    name: "Reduced", planType: "user", monthlyLimit: 10, maxPerRequest: 50,
  });
  let u = await usage(f);
  assert.equal(u.user.used, "20");
  assert.equal(u.user.remaining, "0");
  assert.equal((await consume(f, 1)).rejectionReason, "User monthly limit exceeded");
  await ok("/users/" + f.userId + "/plan", f.key, "PATCH", { planId: basic });
  assert.equal((await usage(f)).user.used, "20");
  assert.equal((await consume(f, 1)).accepted, true);
  await ok("/plans/" + f.ap.id, f.key, "PUT", {
    name: "Reduced account", planType: "account", monthlyLimit: 10, maxPerRequest: 100,
  });
  u = await usage(f);
  assert.equal(u.account.used, "21");
  assert.equal(u.account.remaining, "0");
  assert.equal((await consume(f, 1)).rejectionReason, "Account monthly limit exceeded");
  await ok("/account/plan", f.key, "PATCH", { planId: starter });
  assert.equal((await usage(f)).account.used, "21");
  const history = (await ok("/history", f.key)).history;
  assert.equal(history.find((r) => r.units === "20").accepted, true);
  assert.equal(history.find((r) => r.units === "20").user_plan_id, f.up.id);
  assert.equal((await call("/plans/" + basic, f.key, "PUT", {
    name: "Cannot change", planType: "user", monthlyLimit: 1, maxPerRequest: 1,
  })).status, 404);
  assert.equal((await call("/plans/" + f.up.id, f.key, "PUT", {
    name: "Cannot change type", planType: "account", monthlyLimit: 1, maxPerRequest: 1,
  })).status, 404);
});

test("previous months, UTC processing timestamps, zero new month and history pagination", async () => {
  const f = await fixture();
  await pool.query("INSERT INTO account_usage (account_id, month, units_used) VALUES ($1, '2020-01-01', 50)", [f.a.accountId]);
  await pool.query("INSERT INTO user_usage (account_id, user_id, month, units_used) VALUES ($1, $2, '2020-01-01', 50)", [f.a.accountId, f.userId]);
  await pool.query(
    `INSERT INTO consumption_requests
     (account_id, user_id, request_id, units, accepted, account_plan_id, user_plan_id, created_at)
     VALUES ($1, $2, 'old-month', 50, TRUE, $3, $4, '2020-01-31T23:59:59.999Z')`,
    [f.a.accountId, f.userId, f.ap.id, f.up.id],
  );
  await pool.query(
    `INSERT INTO consumption_requests
     (account_id, user_id, request_id, units, accepted, rejection_reason, account_plan_id, user_plan_id, created_at)
     VALUES ($1, $2, 'february-boundary', 51, FALSE, 'User max per request exceeded', $3, $4, '2020-02-01T00:00:00Z')`,
    [f.a.accountId, f.userId, f.ap.id, f.up.id],
  );
  assert.equal((await usage(f)).account.used, "0");
  assert.equal((await usage(f, "&month=2020-01")).user.used, "50");
  assert.equal((await usage(f, "&month=2020-02")).account.used, "0");
  assert.deepEqual(await consume(f, 50, "old-month"), { accepted: true, rejectionReason: null });
  assert.equal((await usage(f)).account.used, "0");
  await consume(f, 2);
  await consume(f, 3);
  const a = await ok("/history?limit=1&offset=0", f.key);
  const b = await ok("/history?limit=1&offset=1", f.key);
  assert.notEqual(a.history[0].id, b.history[0].id);
  assert.equal((await ok("/history?month=2020-01", f.key)).history.length, 1);
  assert.equal((await ok("/history?month=2020-02", f.key)).history.length, 1);
  const current = (await usage(f)).month;
  assert.equal((await ok("/history?month=" + current, f.key)).history.length, 2);
  assert.equal((await usage(f)).user.used, "5");
  assert.equal((await usage(f, "&month=2020-01")).account.used, "50");
});

test("concurrent consumption never exceeds the shared account quota", async () => {
  const f = await fixture(25, 100, 100, 100);
  const b = await ok("/users", f.key, "POST", { name: "Bob", planId: Number(f.up.id) });
  const jobs = [];
  for (let i = 0; i < 60; i++) {
    let userId = f.userId;
    if (i % 2 === 1) {
      userId = b.userId;
    }
    jobs.push(consume(f, 1, "load-" + i, userId));
  }
  const results = await Promise.all(jobs);
  assert.equal(results.filter((r) => r.accepted).length, 25);
  assert.equal((await usage(f)).account.used, "25");
  const rows = await pool.query(
    "SELECT sum(units_used)::text AS total FROM user_usage WHERE account_id = $1", [f.a.accountId],
  );
  assert.equal(rows.rows[0].total, "25");
  assert.equal((await ok("/history?limit=100", f.key)).history.length, 60);
});

test("concurrent user quota and concurrent identical retries count once", async () => {
  const f = await fixture(100, 100, 7, 100);
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => consume(f, 1, "unique-" + i)));
  assert.equal(results.filter((r) => r.accepted).length, 7);
  const g = await fixture();
  const retries = await Promise.all(Array.from({ length: 25 }, () => consume(g, 10, "retry")));
  assert.ok(retries.every((r) => r.accepted));
  assert.equal((await usage(g)).account.used, "10");
  assert.equal((await ok("/history", g.key)).history.length, 1);
});

test("usage reports keep account and user totals consistent during consumption", async () => {
  const f = await fixture(100, 100, 100, 100);
  const jobs = [];
  const reports = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(consume(f, 1, "report-" + i));
    reports.push(usage(f));
  }
  const data = await Promise.all(reports);
  await Promise.all(jobs);
  for (const row of data) {
    assert.equal(row.account.used, row.user.used);
    assert.equal(row.account.remaining, row.user.remaining);
  }
  assert.equal((await usage(f)).account.used, "20");
});

test("requests waiting behind a committed plan update use the new rules", async () => {
  const f = await fixture();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [f.a.accountId]);
    await db.query("UPDATE plans SET monthly_limit = 1 WHERE id = $1", [f.ap.id]);
    const pending = consume(f, 2);
    const name = new URL(process.env.DATABASE_URL).searchParams.get("application_name");
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const row = await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [name],
      );
      if (row.rows[0].n > 0) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "Consumption must wait for the account lock before the plan update commits");
    await db.query("COMMIT");
    assert.equal((await pending).rejectionReason, "Account monthly limit exceeded");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("database failure rolls back both usage rows and history, and hides internals", async () => {
  const f = await fixture();
  await pool.query(
    `CREATE FUNCTION fail_history() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.account_id = '${f.a.accountId}'::bigint THEN
         RAISE EXCEPTION 'test internal failure';
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query("CREATE TRIGGER test_fail BEFORE INSERT ON consumption_requests FOR EACH ROW EXECUTE FUNCTION fail_history()");
  try {
    const res = await call("/consume", f.key, "POST", { userId: f.userId, units: 5, requestId: "rollback" });
    assert.equal(res.status, 500);
    assert.deepEqual(res.data, { error: "Internal server error" });
    assert.equal((await usage(f)).account.used, "0");
    assert.equal((await usage(f)).user.used, "0");
    assert.equal((await ok("/history", f.key)).history.length, 0);
  } finally {
    await pool.query("DROP TRIGGER test_fail ON consumption_requests");
    await pool.query("DROP FUNCTION fail_history()");
  }
  assert.equal((await consume(f, 5, "rollback")).accepted, true);
});

test("database constraints reject inconsistent usage, orphans and malformed decisions", async () => {
  const a = await fixture();
  const b = await fixture();
  await assert.rejects(pool.query(
    "INSERT INTO user_usage (account_id, user_id, month, units_used) VALUES ($1, $2, '2020-01-01', 1)",
    [a.a.accountId, b.userId],
  ), { code: "23503" });
  await assert.rejects(pool.query(
    "INSERT INTO account_usage (account_id, month, units_used) VALUES ($1, '2020-01-02', 1)", [a.a.accountId],
  ), { code: "23514" });
  await assert.rejects(pool.query(
    "INSERT INTO account_usage (account_id, month, units_used) VALUES ($1, '2020-01-01', -1)", [a.a.accountId],
  ), { code: "23514" });
  await assert.rejects(pool.query(
    `INSERT INTO consumption_requests
     (account_id, user_id, request_id, units, accepted, account_plan_id, user_plan_id)
     VALUES ($1, $2, 'bad', 1, FALSE, $3, $4)`, [a.a.accountId, a.userId, a.ap.id, a.up.id],
  ), { code: "23514" });
});
