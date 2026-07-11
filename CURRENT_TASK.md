# Current Task

## Task

- One sentence: Complete host-side database and fake-Orthanc validation for durable DICOM-remap processing.
- Scope: migration 119 verification, DB-backed staging/claim/recovery/send-handoff integration, worker coverage, temporary-directory race classification, and disposable Docker validation.
- Out of scope: product feature expansion, UI redesign, DICOM identity-policy changes, production databases, production Orthanc/PACS, and deployment.

## Inspection

- Files checked: migration 119, remap processing service/worker/send worker, PACS route, server lifecycle, Docker compose, deployment docs, and existing focused tests.
- Current behavior: Durable staging and lease-based processing existed; host DB/fake-Orthanc coverage was missing, the worker suite only covered idle processing, and the route test observed service-test temp directories by prefix.
- Root cause: Validation fixtures and test isolation did not cover the real DB locking, lease expiry, UID-plan reuse, partial Orthanc upload, or send-handoff crash boundary.

## Plan

- Minimal change: Add a disposable DB/fake-Orthanc integration test, expand worker tests through dependency injection, narrow route temp-dir assertions to exact production names, and correct any failures found by the host run.
- Targeted tests: migration/integration DB test, processing worker, remap service, send worker, PACS route, frontend remap page, typechecks, build, and diff check.
- Stop conditions: Never use production data. Docker/DB failures are environment blockers only when the host daemon/database cannot be made available.

## Result

- Files changed: durable DB/fake-Orthanc integration test, worker test coverage/hooks, remap failure persistence, conflicting-instance test, route temp-dir isolation, docs cleanup, and this task record.
- Validation run: Docker disposable PostgreSQL, migration 119, DB/fake-Orthanc integration (2/2), full remap service tests (80/80), worker/send/route tests (9/9), frontend remap test (14/14), typechecks, production build, and diff check passed.
- Blockers or skipped checks: Full RISpro compose startup was not executed because the repository has no `.env` and the stack requires deployment-specific settings. Compose inspection plus a temporary `rispro-storage` volume/sentinel across two containers verified `/app/storage` persistence; no production services were used.
