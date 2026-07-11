# Current Task

## Task

- One sentence: Make DICOM remap PACS C-STORE durable and asynchronous through Orthanc jobs monitored by a RISpro background worker.
- Scope: remap send-state persistence, Orthanc asynchronous C-STORE enqueue, duplicate-safe resend, worker monitoring/recovery, route and frontend status behavior, audits, migration, documentation, and focused tests.
- Out of scope: background upload/remap processing, direct browser-to-Orthanc access, local rewriting replacement, PACS settings redesign, MWL work, source-study deletion, automatic retry after ambiguous enqueue, and production data.

## Inspection and Plan

- Inspect the current service, routes, migrations, frontend polling, audit conventions, Orthanc client behavior, and worker lifecycle before patching.
- Preserve existing identity confirmation, validation, access controls, destination choice, and audit policy.
- Implement the smallest durable transition: browser upload/rewrite/Orthanc ingestion/validation, asynchronous C-STORE acceptance with persisted Orthanc job ID and RISpro `sending`, then worker-owned monitoring to terminal `sent` or `failed`.
- Validate with the requested focused backend, route, worker, frontend, typecheck, build, and portable database commands where environment access permits.

## Stop Conditions

- Stop and report if the configured Orthanc cannot support `POST /modalities/{key}/store` with `{ Resources, Synchronous: false }`; do not fall back to synchronous transmission.
- Treat Docker EPERM as environment-blocked, not a product failure. Do not touch production data or commit generated DICOM worklist files.

## Result

- Added durable asynchronous Orthanc send fields and partial monitoring indexes in migration `118_dicom_remap_async_send_jobs.sql`.
- Replaced synchronous/legacy PACS store fallbacks with `POST /modalities/{key}/store` using `{ Resources: [studyId], Synchronous: false }`; RISpro persists the returned Orthanc job ID and returns `sending`/HTTP 202.
- Added a restart-safe DICOM remap send worker with exact-job polling, sanitized terminal diagnostics, stale enqueue recovery, and lifecycle integration.
- Added duplicate-safe send claims, explicit resend enqueue, status-aware frontend polling, migration/unit/worker/frontend coverage, and updated deployment documentation.
- Validation: agent contract, targeted service/route/worker/frontend tests, disposable-DB migration test, backend/frontend typechecks, frontend production build, and diff check passed.
