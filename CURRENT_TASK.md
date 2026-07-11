# Current Task

## Task

- One sentence: Move DICOM remap upload processing out of the browser request into durable staging and a restart-safe background processing worker.
- Scope: persistent staged DICOM storage, processing state and lease persistence, worker lifecycle and recovery, persistent UID plans, Orthanc idempotency/verification, handoff to the existing async PACS-send worker, safe cleanup, frontend progress polling, migration, documentation, and focused tests.
- Out of scope: resumable or direct-to-Orthanc uploads, S3/object storage, PACS configuration redesign, dcmjs replacement, MWL/auto-completion work, production data migration, UI redesign, and automatic ambiguous-send resend.

## Inspection

- Files checked: Pending: existing remap route/service/send worker/server, frontend page/tests, migrations, storage conventions, and deployment mounts.
- Current behavior: The multipart route rewrites and ingests DICOM synchronously before returning; only C-STORE monitoring is asynchronous.
- Root cause: CPU-heavy parsing/rewriting and Orthanc ingestion remain coupled to the browser request and use a non-persistent UID plan.

## Plan

- Minimal change: Stage multipart files durably, persist an uploaded/queued job, claim it under a database lease in a processing worker, persist and reuse the UID plan, verify Orthanc, then idempotently hand off to the existing send flow.
- Targeted tests: remap service/route/processing/send worker tests, frontend remap page test, portable-DB migration/integration tests, then typechecks/build and diff check.
- Stop conditions: Treat Docker EPERM as an environment blocker. Do not proceed only if inspection proves persistent storage cannot be supported by current deployment; otherwise use a configurable durable storage root.

## Result

- Files changed: durable-processing migration; remap staging/processing service and worker; multipart route; server lifecycle; remap UI status/progress; environment example; deployment/domain docs; focused tests.
- Validation run: agent contract, backend and frontend typechecks, frontend production build, isolated remap route/processing-worker/service-focused tests, frontend remap-page test, and diff check passed.
- Blockers or skipped checks: Docker is blocked by the sandbox (`DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`), so the portable DB migration/integration run could not be performed. The broader remap service test file has existing audit tests that attempt a blocked local PostgreSQL connection and a concurrent temporary-directory assertion race; those were not changed.
