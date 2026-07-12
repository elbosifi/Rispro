# Current Task

## Task

- One sentence: Implement an authorized, same-domain OHIF Viewer launch from Doctor Portal Reporting Board cases with safe accession resolution, prior studies, native DICOMweb, and Orthanc gateway fallback.
- Scope: OHIF deployment/configuration, normalized settings and persistence, source adapters, launch sessions, protected DICOMweb proxy, retrieval jobs, Reporting Board action, diagnostics, focused tests, and operational documentation.
- Out of scope: Key images, screenshots, measurements, report insertion/finalization, DICOM SR/KOS, patient-facing access, automatic multi-PACS fallback, PACS migration, and unrelated scheduling/UI work.

## Inspection

- Files checked: Doctor Portal/Reporting Board routes, service, repository, UI and tests; PACS node/DIMSE/Orthanc services; Settings, auth, audit, diagnostics, server lifecycle, migrations, compose files, deployment scripts, and domain/deployment docs.
- Current behavior: Reporting Board can open SonicDICOM and RadiAnt, PACS nodes are DIMSE-only, StudyInstanceUID is nullable, Orthanc supports search/verification but not OHIF retrieval sessions, and no repository-managed OHIF/reverse-proxy service exists.
- Root cause: RISpro lacks an OHIF-specific source contract, safe accession-to-UID persistence, scoped viewer sessions, protected DICOMweb routing, and a doctor-facing launch action.

## Plan

- Minimal change: Add a bounded OHIF domain module and dedicated settings component, reuse existing doctor case authorization/audit/Orthanc configuration, keep credentials environment-backed, and preserve existing SonicDICOM/PACS/QR workflows.
- Targeted tests: OHIF service/matching/token/proxy tests, backend launch integration, Settings and Reporting Board interaction tests, existing PACS/Reporting Board tests, typechecks/build, DB-backed migration tests, compose validation, and Docker smoke when available.
- Stop conditions: First unrelated repository failure; Docker/PACS/OsiriX/LAN/domain checks blocked by the environment are reported without workarounds or false pass claims.

## Result

- Files changed: Added migration `123_ohif_viewer_integration.sql`; the `src/modules/ohif-viewer/` backend domain; Reporting Board launch routing/UI; the dedicated Settings integration and System Diagnostics card; pinned OHIF/reverse-proxy Docker services; deployment scripts; smoke test; and architecture, domain, operations, troubleshooting, rollout, and rollback documentation.
- Validation run: OHIF backend unit tests 10/10 passed; focused Settings/Reporting Board frontend tests 48/48 passed; backend and frontend typechecks passed; production frontend build passed; agent contract passed; harness passed with report-only baseline warnings; shell syntax and `git diff --check` passed.
- Blockers or skipped checks: `npm run agent:preflight` and `npm run db:test:up` report `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT` because the sandbox cannot access the Docker socket. Therefore the portable DB migration/integration checks, Compose rendering, OHIF container build/health, mock-source smoke test, and real OsiriX/LAN/domain/current-plus-prior launch validation were not claimed as passing. A standalone existing PACS service test also reached its audit DB dependency and could not complete without the portable test DB.
