# Verification report

Completed locally on 20 October 2026 against the assignment supplied by the project owner.

| Check | Observed result |
| --- | --- |
| Locked dependencies | `npm ci --ignore-scripts` installed all 19 packages; Docker also completed ordinary `npm ci` and production-only installation |
| TypeScript | `npm run typecheck -- --noUnusedLocals --noUnusedParameters` passed |
| Unit tests | `npm test`: 5 passed, zero failed |
| PostgreSQL/API integration | `npm run test:integration`: 14 passed, zero failed |
| Production build | `npm run build` passed locally and in the Docker build |
| Compose configuration | `docker compose config --quiet` passed |
| Fresh database | Separate verification Compose project initialized schema and all four predefined plans successfully |
| Existing database | Default Compose project restarted using the existing database volume and credentials; no schema reset or data migration |
| Native SQL initialization | Initialization script succeeded on an empty isolated schema, refused the second run, and retained exactly four predefined plans |
| Example | Compose client completed all asserted actions and exited 0 |
| Restart persistence | API and PostgreSQL restarted; saved account authentication, assignments, totals, history and retry identity were unchanged |
| Load | Three scenarios, 500 requests each at concurrency 20; all accounting/history assertions passed |

The integration suite covers authentication and account isolation, both rules at both levels, boundaries, independent users sharing a plan, immutable retry decisions, conflict detection, plan changes without resets, current and historical usage, UTC history boundaries with a non-UTC database session, pagination, competing requests, and SQL constraints. A failing history trigger verifies that an unexpected database error rolls back both usage increments and exposes only a generic client error. Its exception log is expected test output.

The plan-change concurrency test waits until PostgreSQL reports the consumption connection blocked on a lock, then commits a changed plan and checks that the pending request uses the changed limit.

Performance measurements, sample limitations, and reproduction commands are in [performance.md](performance.md). The original SQL schema and seed were preserved unchanged. The original project files are backed up locally in ignored `.local/original.zip`; secrets and generated dependencies/builds are ignored.

No known assignment functionality remains unfinished. Publishing the GitHub repository and completing the course's submission form remain owner actions; see [submission.md](submission.md). Historical remaining allowance uses current plan limits, pagination uses offsets, and a busy account serializes consumption; these documented choices are intentional scope/performance tradeoffs.
