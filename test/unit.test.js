const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { generateApiKey, hashApiKey } = require("../dist/api-keys.js");
const { readJson, sendJson, handleHttpError } = require("../dist/http.js");
const { HttpError } = require("../dist/http-error.js");
const {
  validateNameAndPlanId, validateConsumption, validateId, validatePlan, validateMonth, validatePage,
} = require("../dist/validation.js");

test("API keys are random, hashed, and never stored as the original key", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(hashApiKey(a), hashApiKey(a));
  assert.notEqual(hashApiKey(a), a);
  assert.notEqual(hashApiKey(a), hashApiKey(b));
});

test("names and plan IDs use the existing request shape", () => {
  assert.deepEqual(validateNameAndPlanId({ name: " Alice ", planId: 1 }), { name: "Alice", planId: 1 });
  for (const body of [null, [], 1, {}, { name: " " }, { name: "a", planId: "1" },
    { name: "a", planId: 0 }, { name: "a", planId: 1.5 }, { name: "a", planId: 2 ** 53 },
    { name: "a".repeat(101), planId: 1 }, { name: "a\u0000", planId: 1 }]) {
    assert.throws(() => validateNameAndPlanId(body), HttpError);
  }
});

test("consumption validates numbers, IDs, and retry tokens", () => {
  assert.deepEqual(validateConsumption({ userId: "001", units: 1, requestId: "a-1" }),
    { userId: "1", units: 1, requestId: "a-1" });
  for (const units of [0, -1, 1.1, "1", null, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => validateConsumption({ userId: "1", units, requestId: "r" }), HttpError);
  }
  for (const id of ["", "0", "-1", "1e2", "1.2", "9223372036854775808", 1, null]) {
    assert.throws(() => validateId(id), HttpError);
  }
  for (const requestId of ["", "a b", "a\n", "a".repeat(129), null]) {
    assert.throws(() => validateConsumption({ userId: "1", units: 1, requestId }), HttpError);
  }
});

test("plan rules, UTC months and pagination reject invalid input", () => {
  assert.equal(validatePlan({ name: "x", planType: "user", monthlyLimit: 10, maxPerRequest: 20 }).monthlyLimit, 10);
  assert.throws(() => validatePlan({ name: "x", planType: "other", monthlyLimit: 10, maxPerRequest: 1 }), HttpError);
  assert.equal(validateMonth("2024-02"), "2024-02-01");
  assert.equal(validateMonth(null), null);
  for (const m of ["0000-01", "2024-13", "2024-00", "2024-1", "2024-02-01", ""]) {
    assert.throws(() => validateMonth(m), HttpError);
  }
  assert.equal(validatePage(null, 50, 100), 50);
  assert.equal(validatePage("0", 50, 100), 0);
  for (const n of ["-1", "1.5", "101", "NaN", ""]) {
    assert.throws(() => validatePage(n, 50, 100), HttpError);
  }
});

test("HTTP body errors return one JSON response and the server remains available", async () => {
  const server = createServer(async (req, res) => {
    try {
      sendJson(res, 200, await readJson(req));
    } catch (error) {
      handleHttpError(res, error);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    for (const [body, status] of [["{", 400], ["", 400], ['"' + "a".repeat(17000) + '"', 413], ['{"ok":true}', 200]]) {
      const res = await fetch(url, { method: "POST", body });
      assert.equal(res.status, status);
      assert.match(res.headers.get("content-type"), /application\/json/);
      await res.json();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
