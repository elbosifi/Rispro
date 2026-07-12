# Execution Plan: OHIF Viewer integration

## Problem

Authorized Reporting Board doctors cannot open a safely resolved current study and bounded priors in a same-domain web viewer. Existing PACS nodes describe DIMSE only, StudyInstanceUID is not reliably populated, and there is no scoped DICOMweb proxy or retrieval-session contract.

## Scope

- Deploy a pinned OHIF container under `/ohif/` and route `/ohif-dicomweb/` through RISpro authorization.
- Add normalized OHIF/PACS web settings, source resolutions, launch sessions, and Orthanc retrieval jobs.
- Implement native DICOMweb and Orthanc gateway adapters, safe accession matching, prior discovery, launch/status APIs, audit, diagnostics, and cache cleanup.
- Add a dedicated Settings integration and a Reporting Board `Open Images` action.
- Add focused behavior tests and deployment/rollback documentation.

## Files Likely to Touch

- `src/modules/ohif-viewer/`
- `src/modules/doctor-portal/reporting-board-routes.ts`
- `src/modules/doctor-portal/reporting-board-service.ts`
- `src/db/migrations/123_ohif_viewer_integration.sql`
- `src/app.ts`
- `src/server.ts`
- `src/config/env.ts`
- `frontend/src/pages/settings/ohif-viewer-section.tsx`
- `frontend/src/pages/settings/settings-page.tsx`
- `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`
- `docker-compose.yml`
- `docker/ohif/`
- `docker/reverse-proxy/`
- deployment and domain documentation

## Explicit Non-Goals

- Key images, screenshots, measurements, DICOM SR/KOS, report text insertion, signing/finalization, or patient-facing viewer access.
- Automatic multi-PACS fallback, archive migration, source-PACS deletion, scheduling changes, or QR-worklist authentication redesign.

## Acceptance Criteria

- Feature is disabled safely by default and uses an independently selected active PACS node.
- Authorized Reporting Board appointment cases resolve exact accession matches, reject unsafe ambiguity/PatientID mismatch, persist UIDs, and return distinct failure states.
- Current study plus a bounded prior list opens through a hashed, expiring launch session and protected same-origin DICOMweb route.
- Native DICOMweb and selected Orthanc gateway strategies have explicit configuration/diagnostics; no credentials reach the browser.
- Existing SonicDICOM, PACS, Reporting Board, and public QR flows remain intact.

## Validation Commands

- `node --import tsx --test src/modules/ohif-viewer/*.test.ts`
- `node --import tsx --test src/modules/doctor-portal/reporting-board.test.ts`
- `npm run db:test:up && npm run db:test:check`
- `npm run test:db:one -- src/modules/ohif-viewer/ohif-viewer.integration.test.ts`
- `cd frontend && ./node_modules/.bin/vitest run src/pages/settings/ohif-viewer-section.test.tsx src/pages/doctor/doctor-reporting-board-page.test.tsx`
- `npm run typecheck`
- `npm run typecheck:frontend`
- `npm run build:frontend`
- `./scripts/validate-docker-modes.sh`

## Rollback Considerations

Set `OHIF_ENABLED=false` and disable the singleton OHIF setting. This removes the doctor action and blocks new launch/proxy sessions without changing source PACS data or existing SonicDICOM workflows. Containers and migration tables can remain dormant; no code surgery or source-study deletion is required.

## Execution Notes

- 2026-07-12: Agent contract passed. Preflight classified Docker access as `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`; Docker/OsiriX/LAN/domain smoke checks require a host environment with those systems available.
- 2026-07-12: No application-level secret store exists. New HTTP credentials will be referenced from environment variables rather than persisted as plaintext settings.
- 2026-07-12: The doctor QR worklist is readable through a permanent public token with optional authentication, so viewer launch is intentionally excluded pending a separate mandatory-auth design.
- 2026-07-12: Implementation added a protected exact-study DICOMweb proxy, native and Orthanc adapters, persisted resolution/session/retrieval state, bounded priors, a retrieval/cleanup worker, Reporting Board and Settings UI, diagnostics, and disabled-by-default deployment controls.
- 2026-07-12: Final executable checks passed: 10 OHIF backend unit tests, 48 focused frontend tests, both typechecks, production frontend build, agent contract, repository harness, shell syntax, and diff whitespace checks.
- 2026-07-12: Docker remained unavailable, so DB-backed migration tests, Compose/OHIF smoke tests, and real OsiriX/LAN/domain validation remain rollout gates. Overall readiness remains not ready until those checks pass.
