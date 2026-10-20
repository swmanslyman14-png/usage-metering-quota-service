# Usage Metering and Quota Service

Author: Suleiman Ahmad

A TypeScript API for document-processing credits. Accounts have a shared allowance, and each user has an individual allowance. Uses Node.js 24 and PostgreSQL 18.

## Setup

Install Docker Compose. Copy `.env.example` to `.env` and set a local database password. Keep existing credentials when reusing a database volume.
```powershell
docker compose up --build -d
docker compose logs example
```
The API runs at http://localhost:3000. Startup initializes a new database and runs the CLI example. The example shows acceptance, user and account rejections, and plan changes. Run it again with `docker compose run --rm example`.
Account plans (monthly/per-request): Starter 1000/100 and Pro 10000/1000. User plans: Basic 200/50 and Premium 2000/200. Predefined plans are read-only; accounts can create and update their own plans.

## API

Create an account to receive its API key once; only its SHA-256 hash is stored. Send it in `x-api-key` for access to that account's data. Anonymous `GET /plans` lists predefined plans; authenticated calls also list owned plans.

- `GET /`, `GET /health`: service and database status.
- `GET /plans`: available plans and their IDs.
- `POST /accounts`, `POST /users`: create with `{name, planId}`; return `{accountId, apiKey}` or `{userId}`.
- `GET /account`, `GET /users`: account, users and applied plans.
- `PATCH /account/plan`, `PATCH /users/:id/plan`: assign with `{planId}`.
- `POST /plans`, `PUT /plans/:id`: create or update with `{name, planType, monthlyLimit, maxPerRequest}`.
- `POST /consume`: send `{"userId":"1","units":10,"requestId":"document-123"}`; receive `{accepted, rejectionReason}` naming the account/user rule on rejection.
- `GET /usage`, `GET /history`: totals and outcomes; optional `userId` and `month=2026-10`. Usage defaults to this month; history to all months. Users/history accept `limit` (1–100, default 50) and `offset` (default 0).

Use `planType: "account"` or `"user"`. Input plan IDs are numbers; user IDs and response IDs/totals are strings. Units and limits must be positive whole numbers. Request errors return `{error}`.
Both plans' monthly and per-request limits apply. Accepted units count toward both totals; rejection consumes nothing. Users sharing a plan keep separate usage. Months use UTC, and previous months remain queryable.
Plan changes preserve usage and apply to new requests. Remaining allowance is zero below existing usage. Historical totals use current limits; request history retains original decisions and plan IDs.
Request IDs are 1–128 visible ASCII characters, unique per account across months. Retrying the same ID/user/units returns the original outcome; different data returns 409. Transactions and an account row lock keep concurrent requests consistent. One busy account queues requests; different accounts can proceed independently.

## Tests

Install Node.js 24; the test database helper also needs Docker and PowerShell 7. Alternatively set `TEST_DATABASE_URL` to a disposable PostgreSQL database that permits creating schemas.
```powershell
npm ci
npm run build
npm run typecheck
npm test
./scripts/test-db.ps1
npm run test:integration
npm run load
```
Tests use isolated schemas and cover authentication, account isolation, quotas, retries, plan changes and concurrency. Load testing sends 500 requests at concurrency 20 per scenario: shared quota, four accounts and identical retries. It checks accounting and writes [performance results](docs/performance-results.json).
Recorded on Windows x64, Node 24.15.0 and PostgreSQL 18.6: 32.53, 103.77 and 75.68 requests/s respectively, with correct accounting for all 1,500 requests. These local results show that the shared account lock limits throughput.

For local startup, set `DATABASE_URL`, run `npm run db:init` only on an empty database, then `npm run build` and `npm start`. Run `npm run example` against the API; `API_URL` selects another address. Offset pagination can slow down with large histories.
