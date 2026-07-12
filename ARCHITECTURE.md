# RISpro Architecture

RISpro is a Node.js, PostgreSQL, and React application for radiology reception, scheduling, modality worklists, reporting workflows, PACS integration, and patient-facing QR flows.

## Backend Stack

- Runtime: Node.js 20+ using ES modules.
- Server: Express, mounted from `src/`.
- Language: TypeScript with `tsx` for local execution and Node test runs.
- Database access: PostgreSQL through the shared pool in `src/db/pool.ts`.
- Module pattern: new backend domains should live under `src/modules/<domain>/`; existing shared services live under `src/services/`.

## Frontend Stack

- Framework: React 19 with TypeScript.
- Build: Vite from `frontend/`.
- Routing and pages: `frontend/src/App.tsx`, `frontend/src/pages/`, and Appointments V2 pages under `frontend/src/v2/appointments/`.
- API contracts: shared frontend API types live in `frontend/src/types/api.ts`; domain API hooks live under `frontend/src/lib/` and feature folders.

## Database

- Primary database: PostgreSQL.
- Migrations run through `npm run migrate`.
- DB-backed tests must follow [docs/CODEX_DB_TESTING.md](docs/CODEX_DB_TESTING.md): run `npm run db:test:up`, then `npm run db:test:check`, and use `codex-db-test.env`.

## Major Domains

- Appointments V2: `src/modules/appointments-v2/` and `frontend/src/v2/appointments/`.
- Legacy scheduling/appointments: existing code outside Appointments V2; maintained for compatibility, not the target for new scheduling features.
- Doctor Portal and Reporting Board: `src/modules/doctor-portal/`, `frontend/src/pages/doctor/`, reporting board public/mobile/print surfaces.
- Comparison requests: `src/routes/comparisons.ts`, `src/services/comparison-request-service.ts`, `frontend/src/pages/comparisons/`, and comparison-aware Reporting Board rows.
- DICOM/MWL/PACS: `src/routes/dicom.ts`, `src/routes/pacs.ts`, `src/services/dicom-*`, `src/services/mwl-*`, `src/services/orthanc-*`, `src/services/pacs-*`, and PACS/remap UI under `frontend/src/pages/pacs/`.
- QR patient portal: Appointments V2 public routes/utilities plus settings and registration surfaces.
- Settings/admin: `src/routes/settings.ts`, `src/routes/admin.ts`, and `frontend/src/pages/settings/`.

## Legacy vs V2 Boundaries

Appointments V2 is the scheduling target architecture. New scheduling, booking, capacity, policy, and appointment-rule work belongs in `src/modules/appointments-v2/` and `frontend/src/v2/appointments/`.

Legacy appointment and scheduling code may receive critical containment or compatibility fixes only. Do not add new scheduling behavior to legacy paths unless the task explicitly says so.

Comparison requests are not appointments. They must not create modality worklist rows, consume appointment capacity, or be forced through appointment-only queues.

## Deployment Model

- GitHub Actions validate and then call server-side deployment through `.github/workflows/deploy.yml`.
- The server deployment script is `deploy.sh`.
- Deployment references live in [docs/production-rollout.md](docs/production-rollout.md), [docs/deployment-guide.md](docs/deployment-guide.md), and [docs/docker-deployment.md](docs/docker-deployment.md).
- Docker deployment supports embedded MWL, internal Orthanc, external Orthanc, and optional MPPS bridge modes documented in `docs/docker-deployment.md`.

## DICOM, MWL, and PACS Integration Areas

- Modality Worklist generation and serving: `src/services/dicom-service.ts`, `src/services/dicom-gateway-service.ts`, `src/services/mwl-dataset-builder.ts`.
- Orthanc MWL projection/sync: `src/services/orthanc-mwl-*`, `src/services/mwl-sync-service.ts`.
- PACS search/send/remap: `src/routes/pacs.ts`, `src/services/pacs-service.ts`, `src/services/dicom-remap-service.ts`, `frontend/src/pages/pacs/`.
- SonicDICOM report status/notes: `src/services/sonicdicom-report-service.ts`, settings UI, Reporting Board, registration, and patient QR report access.

Keep Orthanc/PACS orchestration server-side. Frontend code should call RISpro APIs, not Orthanc directly.

## OHIF Viewer

OHIF is a separate pinned container served under `/ohif/` by `rispro-gateway`. `/ohif-dicomweb/` remains a RISpro route: it requires the normal authenticated user plus a short-lived, HttpOnly viewer-session cookie and permits only exact study UIDs authorized by the Reporting Board launch service. Native DICOMweb credentials are environment-backed and injected server-side. Orthanc gateway mode performs bounded on-demand DIMSE retrieval and exposes only its temporary DICOMweb projection; the source PACS remains authoritative. See [OHIF Viewer Integration](docs/domains/ohif-viewer/README.md).

## Where Future Agents Should Add Work

- New scheduling behavior: Appointments V2 module only.
- New Doctor Portal behavior: `src/modules/doctor-portal/` and `frontend/src/pages/doctor/`.
- New DICOM/PACS backend behavior: server routes/services under `src/routes/` and `src/services/`; document operational risks under `docs/domains/`.
- New observability wrappers: `src/observability/`, then migrate call sites in small follow-up changes.
- New plans: `docs/plans/active/`, using `docs/plans/templates/EXECUTION_PLAN_TEMPLATE.md`.
