# Usage Metering and Quota Service

A TypeScript backend that records document-processing credits and enforces both an application's shared account plan and each user's individual plan. It uses Node.js 24, the native HTTP server, PostgreSQL 18, and `pg`. A CLI demonstrates accepted actions, both kinds of rejection, and live plan changes.

## Run the complete stack

Install Docker Desktop with Linux containers and Docker Compose. Node.js 24 is only needed for local development and tests.

For a fresh checkout, copy `.env.example` to `.env` and replace its password placeholder with a local password. Keep `.env` private and retain an existing configuration if you have one. If you already have a database volume, use its existing database name, user and password; environment changes do not change an existing database's credentials.

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
docker compose logs example
```

The API is at [http://localhost:3000](http://localhost:3000); [GET /health](http://localhost:3000/health) checks PostgreSQL. Set `PORT` in `.env` to change the host port. The database is private to the Compose network.

Startup initializes the schema before the predefined plans on a new volume. Existing volumes are retained and initialization does not run again. The API waits for PostgreSQL, and the example waits for a healthy API. The example exits with code 0 after its assertions pass; this is expected.

The example creates a separate demo account with Alice on Basic and Bob on Premium, then:

1. Accepts Alice's 20-credit action.
2. Rejects Alice's 60-credit action because Basic allows at most 50 per request.
3. Accepts Bob's 70-credit action.
4. Rejects Bob's next 20 credits because only 10 shared account credits remain.
5. Updates the custom account plan and switches Alice to Premium.
6. Accepts Alice's 60 credits and displays the remaining allowances and recorded outcomes.

Run it again with `docker compose run --rm example`. Each run creates a new demo account. Stop the stack with `docker compose stop`; data stays in the named volume.

## Local development

```powershell
npm ci
npm run typecheck
npm run build
```

Set `DATABASE_URL` in your local environment or a private env file to a PostgreSQL connection URL. Alternatively, set the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` variables. The Compose `POSTGRES_*` variables configure the database container; Compose maps them to the API's `PG*` variables.

For a new, empty local database:

```powershell
npm run db:init
npm start
```

`db:init` creates the existing SQL schema and seed data in one transaction. It refuses to initialize a database that already has an accounts table and never resets existing data. To use a private env file, run `node --env-file=.env.local scripts/init-db.js` and `node --env-file=.env.local dist/index.js`. Local startup defaults to port 3000.

For a locally running API, run `npm run example`. Set `API_URL` to use another address. The client simulates document processing and prints decisions, remaining credits, and history. It does not print the account's API key.

## Plans and model

| Plan | Type | Monthly credits | Maximum per request |
| --- | --- | ---: | ---: |
| Starter | account | 1,000 | 100 |
| Pro | account | 10,000 | 1,000 |
| Basic | user | 200 | 50 |
| Premium | user | 2,000 | 200 |

An account starts on a predefined account plan and receives a random 256-bit API key once. Only its SHA-256 hash is stored. Users belong to exactly one account. Custom plans belong to their creating account; several users can share one definition but each keeps its own usage total. Plan types cannot change. Predefined plans are read-only.

Account creation and the public predefined-plan list do not require a key. All account data, custom plans, users, consumption, and reporting require the header `x-api-key`. Supplying an invalid key to the plan list is rejected rather than treated as anonymous. There is no end-user login.

Requests use camelCase fields. Database-backed plan, account, user, and history listings use snake_case fields, matching the SQL names. Database IDs and quota totals in responses are decimal strings to preserve PostgreSQL BIGINT precision. Input `planId` values and rule quantities are positive safe-integer JSON numbers; input `userId` values are positive decimal strings. Obtain plan IDs from `GET /plans` instead of assuming their numeric values.

## API

All responses are JSON. Errors have the shape `{"error":"message"}`. JSON bodies are limited to 16 KiB.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/` | Service information |
| GET | `/health` | Database readiness; 503 when unavailable |
| GET | `/plans` | Predefined plans; with a key also includes that account's custom plans |
| POST | `/accounts` | Create account: `{name, planId}`; 201 with `{accountId, apiKey}` |
| GET | `/account` | Account and its current plan limits |
| PATCH | `/account/plan` | Assign account plan: `{planId}` |
| POST | `/users` | Register user: `{name, planId}`; 201 with `{userId}` |
| GET | `/users?limit=50&offset=0` | Account's users and their currently applied plans |
| PATCH | `/users/:id/plan` | Assign user plan: `{planId}` |
| POST | `/plans` | Create custom plan: `{name, planType, monthlyLimit, maxPerRequest}`; 201 |
| PUT | `/plans/:id` | Replace a custom plan's settings using the same complete body |
| POST | `/consume` | Decide and record: `{userId, units, requestId}` |
| GET | `/usage?userId=1&month=2026-10` | Account and optional user's usage and remaining allowance |
| GET | `/history?userId=1&month=2026-10&limit=50&offset=0` | Recorded decisions, including rejections |

`planType` is `account` or `user`. For usage, omitting `month` selects the current UTC month. For history, omitting it includes all months. Omitting `userId` selects account-wide history or account-only usage. Iterate `GET /users` and request usage for each ID to inspect all users.

History and users return `{history|users, limit, offset}`. Limits are 1–100, default 50; offsets are 0–1,000,000. An empty page ends pagination. History is sorted by processing time descending and then ID descending. Missing or foreign users return 404. Foreign plans cannot be assigned or updated.

Validation failures return 400, invalid/missing API keys 401, unavailable resources 404, conflicting retries 409, oversized bodies 413, unsupported methods on protected routes 405, and unexpected failures 500 without internal details. A valid quota rejection returns 200 because the service successfully made and recorded a decision.

### Example requests

PowerShell keeps the issued key in a variable, without embedding it in source:

```powershell
$base = "http://localhost:3000"
$plans = Invoke-RestMethod "$base/plans"
$id = [int]($plans | Where-Object name -eq Starter).id
$a = Invoke-RestMethod "$base/accounts" -Method Post -ContentType application/json -Body (@{name="Documents"; planId=$id} | ConvertTo-Json)
$h = @{"x-api-key"=$a.apiKey}
$id = [int]($plans | Where-Object name -eq Basic).id
$u = Invoke-RestMethod "$base/users" -Method Post -Headers $h -ContentType application/json -Body (@{name="Alice"; planId=$id} | ConvertTo-Json)
Invoke-RestMethod "$base/consume" -Method Post -Headers $h -ContentType application/json -Body (@{userId=$u.userId; units=10; requestId="document-123"} | ConvertTo-Json)
Invoke-RestMethod "$base/usage?userId=$($u.userId)" -Headers $h
```

Accepted response:

```json
{"accepted":true,"rejectionReason":null}
```

A valid request for 51 credits from Basic:

```json
{"accepted":false,"rejectionReason":"User max per request exceeded"}
```

Usage after the accepted 10-credit request, assuming account ID 1, user ID 1, account plan ID 1 and user plan ID 3:

```json
{
  "month": "2026-10",
  "account": {"id":"1","planId":"1","monthlyLimit":"1000","maxPerRequest":"100","used":"10","remaining":"990"},
  "user": {"id":"1","planId":"3","monthlyLimit":"200","maxPerRequest":"50","used":"10","remaining":"190"}
}
```

## Decisions, plan changes, and retries

Only the two required rules are supported. Both apply to both levels. All units are accepted or none are. When several rules fail, the returned reason uses this fixed order: account per-request maximum, user per-request maximum, account monthly allowance, user monthly allowance. This makes decisions predictable and identifies both the rule and its owner.

Months are UTC calendar months. PostgreSQL supplies one processing timestamp after the account lock is obtained, and both usage rows and the decision use that timestamp's month. A new month starts with zero usage through a new monthly row, so no reset job is needed. Previous rows remain queryable.

Changing a plan or assignment preserves consumption. New requests use the current rules, including updates to a shared custom plan. If a limit drops below used units, remaining is clamped to zero and further consumption is rejected. Past decisions retain their original result, reason, units, processing time and plan IDs. Plan definitions are editable; historical reports show consumed units against **current** plan limits rather than reconstructing old allowances. This keeps history immutable without adding plan versioning.

A `requestId` is 1–128 visible ASCII characters and is unique within an account, across all months. Repeating the same user, units, and ID returns the original decision, including rejections, without new history or increments. Reusing it with different data returns 409. A caller retrying after a lost response must reuse its ID. A new business action needs a new ID. Invalid requests, authentication failures and unknown users are errors and are not recorded as quota decisions.

## Transactions and performance choices

Consumption locks its account row inside a PostgreSQL transaction. Only after obtaining that lock does it read the plan settings and usage. Plan updates and assignments acquire the same lock. This serializes decisions and configuration changes within an account, prevents two requests spending the same allowance, and avoids reading stale rules after waiting for a lock. Different accounts can proceed independently.

Accepted consumption updates both usage tables and records history before commit. Rejections only record history. Any database failure rolls back the entire transaction. The account/request unique constraint also protects retry identity. Foreign keys, positive-rule constraints, nonnegative usage constraints, and monthly primary keys support the application checks. Queries use SQL parameters.

A single SQL statement reads account and user usage together for a consistent report. Monthly rows provide fast totals; history indexes support account and user pagination. The pool has ten connections, a five-second connection timeout, and a ten-second account-lock timeout. Overload failures can be retried with the same request ID. A busy account is deliberately serialized, and large offset pagination becomes more expensive. There is no cache or distributed lock to invalidate when rules change.

## Tests

The tests use Node's built-in runner and real HTTP. Unit tests need no database:

```powershell
npm test
npm run typecheck
npm run build
```

For integration tests, use a disposable PostgreSQL database. On PowerShell 7, Docker can create one with a random local port and password:

```powershell
./scripts/test-db.ps1
npm run test:integration
npm run load
```

The helper saves its connection in ignored `.local/test.env`. Alternatively, set `TEST_DATABASE_URL` yourself; do not use a production database. Each integration/load process creates a random isolated schema, initializes it, starts the API on a random localhost port, and removes only its own schema afterward. The test database role needs schema creation permission. Explicit shell environment variables take precedence over the local env file.

To stop the helper's database, run `docker stop (Get-Content .local/test-container)`. Reuse it later with `docker start (Get-Content .local/test-container)` before running integration or load tests.

To repeat the separate full-stack restart check against a running local API:

```powershell
node scripts/check-stack.js seed
docker compose restart db api
docker compose up -d --wait db api
node scripts/check-stack.js check
```

This creates a small test account and saves its key only in ignored `.local/stack-fixture.json`. It checks that authentication, assignments, usage, history and the original retry decision survive the restart.

Coverage includes safe database initialization, authentication, tenant isolation, input and body errors, both rule types at both levels, exact boundaries, shared plans with separate totals, plan updates and switching, both kinds of retry, conflicting retry data, previous months, pagination, concurrent spending, concurrent retries, constraint enforcement, and an injected database failure proving full rollback. The failure test intentionally logs a database exception while asserting a generic client error.

Load tests default to 500 requests at concurrency 20 for each of three scenarios: one account with an exhausted quota, four independent accounts, and concurrent identical retries. They assert the totals and history agree, and account usage equals summed user usage. Override `LOAD_REQUESTS` (20–100,000, divisible by four) and `LOAD_CONCURRENCY` (1–200) to repeat at other sizes.

Measured results and methodology are in [docs/performance.md](docs/performance.md) and [docs/performance-results.json](docs/performance-results.json). The load command replaces the JSON with a new measurement.

## Files and submission

- `src/`: native HTTP routes, validation, authentication, plans, usage, and transactional consumption.
- `db/schema.sql`, `db/seed.sql`: original relational schema and predefined plans.
- `examples/client.js`: executable document-processing demo.
- `test/`, `scripts/`: focused automated tests, isolated database setup, initialization, and load testing.
- `Dockerfile`, `compose.yaml`: API, PostgreSQL, and the short-lived example client.

The database schema is compatible with the original project; no data migration or reset is required. No billing, refunds, extra resource types, end-user login, or speculative rule framework is included. API keys have account scope; rotation, public-service abuse controls and historical plan versioning are outside this assignment implementation.

See [docs/submission.md](docs/submission.md) for the remaining publishing and submission steps. Never publish `.env`, `.local/`, `node_modules/` or generated `dist/`; they are ignored.
