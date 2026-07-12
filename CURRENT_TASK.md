# Current Task

## Task

- One sentence: Add a durable PostgreSQL SonicDICOM state/note cache and in-process refresh worker for Doctor Portal Reporting Board reads.
- Scope: Reporting Board repository/service, SonicDICOM batch lookup, cache migration, worker lifecycle, assignment revalidation, and focused tests.
- Out of scope: PACS/Orthanc behavior, comparison-request assignment, frontend redesign, and external queues/services.

## Inspection

- Files checked: SonicDICOM report service/settings, Reporting Board repository/service/types, existing worker/server lifecycle, migrations, and focused tests.
- Current behavior: Board rows synchronously look up SonicDICOM status and notes, while statistics fall back to a process-local status map.
- Root cause: No durable status/note representation exists at the Reporting Board PostgreSQL query boundary.

## Plan

- Minimal change: Persist appointment cache rows, join them into normal board/stat queries, refresh with an advisory-locked bounded worker, and direct-revalidate assignment candidates.
- Targeted tests: Reporting Board unit/integration tests, cache worker tests, SonicDICOM batch tests, and Reporting Board frontend tests.
- Stop conditions: Docker/database environment blocker or unrelated baseline failure after focused checks.

## Result

- Files changed:
- Validation run:
- Blockers or skipped checks:
