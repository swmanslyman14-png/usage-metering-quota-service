# Performance evidence

Measured on 20 October 2026. The final raw run is in [performance-results.json](performance-results.json); the earlier measurement is in [performance-baseline.json](performance-baseline.json).

## Reproduce

Requirements: Node.js 24, Docker Desktop, PostgreSQL 18, and the locked npm dependencies.

```powershell
npm ci
./scripts/test-db.ps1
npm run load
```

Alternatively set `TEST_DATABASE_URL` to a disposable PostgreSQL database. The runner creates its own schema, applies the SQL and seed, starts the real native HTTP server on a random localhost port, sends requests using `fetch`, checks persisted totals/history through the API, then removes only that schema. The JSON result file is replaced by the new measurement.

Defaults are 500 requests per scenario and 20 concurrent workers. To change these:

```powershell
$env:LOAD_REQUESTS = "1000"
$env:LOAD_CONCURRENCY = "40"
npm run load
```

The request count must be divisible by four. Fixture setup and final correctness queries are excluded from timings. Every timed request includes the real HTTP response and committed PostgreSQL transaction. Timing uses a monotonic clock. Percentiles use the nearest-rank method. HTTP failures or incorrect accounting fail the run.

## Environment

- Node.js v24.15.0 on Windows x64.
- PostgreSQL 18.6 in a local Docker Linux container, accessed over a localhost port.
- API in a local Node process; default pool size ten.
- No network service, external load generator, mocked database, or cached decision layer.
- Ordinary desktop workload; one run per version, with no controlled hardware isolation or dedicated warm-up. Results are local evidence, not production capacity claims.

## Results

Each row represents 500 requests at concurrency 20.

| Scenario | Accepted responses | Rejected responses | Baseline req/s | Final req/s | Final p50 ms | Final p95 ms | Final p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| One shared account; quota 250 | 250 | 250 | 30.44 | 44.10 | 409.55 | 840.74 | 950.41 |
| Four independent accounts | 500 | 0 | 61.83 | 170.47 | 112.98 | 144.93 | 157.49 |
| One identical request retried | 500 | 0 | 108.75 | 124.63 | 155.75 | 213.98 | 231.30 |

All 1,500 requests completed with valid decisions and no HTTP errors. The shared-account test recorded exactly 250 used credits and 500 decisions; the four-account test recorded 500 accepted credits in total. The retry test returned 500 accepted responses but recorded exactly **one** credit and **one** decision. Each scenario also checked that summed user usage equaled the account total and that accepted history units matched usage.

## What changed and what it shows

The first implementation separately read the two plans, the database processing time, and the two usage rows while holding the account lock. The final version reads that data together in one parameterized SQL query after acquiring the same lock. This removes four database round trips from each new decision and gives the quota calculation one consistent snapshot. The full correctness suite passed again afterward, including a transaction waiting behind a plan change, concurrent quota exhaustion, concurrent retries, UTC month boundaries under a non-UTC database session, and rollback after an injected database failure.

The final one-account throughput was about 45% higher in these runs. Four accounts benefited more from independent locks and fewer reads. The retry path already reads a recorded decision and skips quota work, so grouping quota reads does not directly optimize retries; its smaller measured difference can reflect ordinary run-to-run variation.

The important bottleneck remains serialization within a single account: all of its users spend a shared allowance, and configuration changes use the same lock. A busy account queues requests; independent accounts can proceed in parallel. This was kept deliberately for correctness and simplicity. The measurements do not isolate individual SQL execution costs, and they do not establish sustained throughput, cold-start latency, database size scaling, or multi-host behavior. Offset-based history pagination may slow down as history grows; the schema includes the account/time and user/time indexes needed for this project's queries.
