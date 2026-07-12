# Current Task

## Task

- One sentence: Harden the completed OHIF Viewer integration for safe Orthanc cache ownership, one-time launch-token exchange, and constrained OHIF study browsing before internal clinical testing.
- Scope: OHIF retrieval cache ownership/cleanup, token/session semantics, OHIF runtime configuration, focused tests, disposable-DB/Docker validation when available, and focused operational documentation.
- Out of scope: Key images, measurements, DICOM SR/KOS, report integration, patient-facing access, multi-PACS fallback, unrelated UI work, and production database access.

## Inspection

- Files checked: Existing OHIF adapters, repository, worker, service, migration 123, runtime configuration, Docker deployment, tests, and OHIF operations documentation.
- Current behavior: Cache cleanup searches a shared Orthanc instance by StudyInstanceUID then deletes every match; launch token exchange accepts a reused token and uses that same token as the DICOMweb cookie; the OHIF runtime study list is enabled despite the exact-UID proxy boundary.
- Root cause: Retrieval jobs do not record a proven, exact cache-owned Orthanc resource; launch and viewer-session secrets are not separate; runtime configuration permits unsupported generic PACS browsing.

## Plan

- Minimal change: Use explicit retrieval ownership rather than a new Orthanc deployment: capture pre-existing cache IDs before C-MOVE, mark only a newly discovered exact ID as owned, and delete only that owned ID when cleanup is explicitly enabled. Split launch and viewer-session token hashes and make launch exchange atomic/one-time. Disable OHIF study-list browsing.
- Targeted tests: Cache ownership/deletion safety, launch/session repository semantics, OHIF config assertion, existing OHIF units, reporting-board frontend test, typechecks, build, and Docker/DB validation when Docker access exists.
- Stop conditions: Docker/OsiriX/LAN/domain checks blocked by environment are reported accurately; do not touch production data or weaken the proxy to work around viewer behavior.

## Result

- Files changed: Added hardening migration `124_ohif_viewer_hardening.sql`, ownership-safe cleanup helpers/tests, token/session tests, schema integration test, a separate viewer-session token hash, safe retrieval-job ownership fields, `OHIF_CACHE_CLEANUP_ENABLED=false`, disabled OHIF study browsing, and focused documentation/UI wording.
- Validation run: Agent contract passed; targeted OHIF units 18/18 passed; schema integration 2/2 passed against the disposable Docker DB; `db:test:check` passed; migrations 123/124 applied and reran idempotently; both typechecks, focused frontend tests 48/48, production frontend build, docs/quality harness, shell syntax, and diff check passed. Compose config rendered both enabled and disabled profile service sets successfully using a temporary example environment.
- Blockers or skipped checks: Initial preflight Docker socket restriction was resolved only for the disposable DB. `docker compose --profile ohif up -d --build` remains blocked before image pull/build because Docker Desktop cannot execute `docker-credential-desktop`. No app/gateway/OHIF container health, runtime smoke, real OsiriX, authorized current/prior launch, LAN/domain, or live Orthanc gateway validation was performed. The disposable test DB was removed after validation.
