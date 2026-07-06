# Follow-Up Backlog

## Reporting Board Filter Visibility and State Persistence

- Problem: Filter visibility and saved filter state can drift across desktop, mobile saved views, and print.
- Why it matters: Doctors need predictable worklist slices; hidden or reset filters can lead to missed cases.
- Likely files: `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/pages/doctor/reporting-board-mobile-page.tsx`, `frontend/src/pages/print/reporting-board-print-page.tsx`, `frontend/src/lib/reporting-board.api-hooks*`.
- Suggested acceptance criteria: Filters remain visible/discoverable, persisted state survives refresh where intended, mobile/print use the same documented filter contract.
- Suggested validation commands: `cd frontend && npm run test -- src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/reporting-board-mobile-page.test.tsx`.

## Reporting Board Cache and Background Refresh

- Problem: Mutation invalidation and background refresh ownership are not documented as a contract.
- Why it matters: Assignment and report-status changes must not leave stale board rows.
- Likely files: `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/lib/reporting-board.api-hooks*`, `src/modules/doctor-portal/reporting-board-service.ts`.
- Suggested acceptance criteria: Documented query keys, invalidation points after mutations, and tests covering refresh after assignment/bulk actions.
- Suggested validation commands: `cd frontend && npm run test -- src/pages/doctor/doctor-reporting-board-page.test.tsx`; `node --import tsx --test src/modules/doctor-portal/reporting-board.test.ts`.

## DICOM Remap Job Persistence When User Leaves Page

- Problem: Long-running remap uploads/jobs can outlive the current page state.
- Why it matters: Operators need safe resume/status behavior for large studies and failed sends.
- Likely files: `src/services/dicom-remap-service.ts`, `src/routes/pacs.ts`, `frontend/src/pages/pacs/pacs-remap-page.tsx`.
- Suggested acceptance criteria: Jobs have durable state, page refresh can recover current/recent job status, cleanup is server-owned.
- Suggested validation commands: `node --import tsx --test src/services/dicom-remap-service.test.ts src/routes/pacs.test.ts`; `cd frontend && npm run test -- src/pages/pacs/pacs-remap-page.test.tsx`.

## SonicDICOM Notes Visibility in Reporting Board and Registration

- Problem: SonicDICOM notes appear in some staff surfaces, but visibility rules need a documented matrix.
- Why it matters: Clinical notes must be visible where useful and absent where unsafe or confusing.
- Likely files: `src/services/sonicdicom-report-service.ts`, `src/modules/appointments-v2/api/routes/read-v2-routes.ts`, `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/pages/registrations/registrations-page.tsx`.
- Suggested acceptance criteria: Matrix documents each surface, tests cover present/empty/unavailable note states.
- Suggested validation commands: `node --import tsx --test src/services/sonicdicom-study-notes.test.ts src/modules/appointments-v2/tests/unit/reception-sonicdicom-study-note-read.test.ts`; `cd frontend && npm run test -- src/pages/registrations/registrations-page.print.test.tsx`.

## UI E2E Harness for Critical Journeys

- Problem: Critical RISpro journeys rely mostly on unit/component tests and manual validation.
- Why it matters: Agents need browser-level feedback for login, registration, appointment creation, queue, modality, reporting board, PACS remap, and QR flows.
- Likely files: new E2E harness under a future `e2e/` or `tests/e2e/`, plus CI wiring after stabilization.
- Suggested acceptance criteria: One smoke journey per critical workflow, deterministic seed data, screenshots or trace output on failure.
- Suggested validation commands: Needs inspection.

## Structured Observability Migration

- Problem: Existing logs mix console text, JSON-lines, and ad hoc warnings.
- Why it matters: Future agents need queryable, PHI-safe signals.
- Likely files: `src/observability/logger.ts`, `src/server.ts`, `src/modules/appointments-v2/observability/shadow-diff.ts`, DICOM/PACS worker services.
- Suggested acceptance criteria: One domain migrated at a time to shared structured events with no raw PHI fields.
- Suggested validation commands: `npm run typecheck`; focused tests for migrated call sites.

## Large-File Ownership Boundaries

- Problem: Some TypeScript/TSX files are large enough to make agent edits risky.
- Why it matters: Large files increase context load and accidental regression risk.
- Likely files: use `npm run harness:quality` large-file output.
- Suggested acceptance criteria: For each selected file, document owner/domain and extract only stable subcomponents or pure helpers with tests.
- Suggested validation commands: domain-specific focused tests plus `npm run typecheck` or `npm run typecheck:frontend`.

## Frontend Test Coverage Gaps

- Problem: Dense operational screens have uneven component tests and no broad browser journey harness.
- Why it matters: UI regressions are easy to miss in filter/action-heavy workflows.
- Likely files: `frontend/src/pages/doctor/`, `frontend/src/pages/pacs/`, `frontend/src/pages/registrations/`, `frontend/src/pages/modality/`, `frontend/src/v2/appointments/`.
- Suggested acceptance criteria: Add focused tests for the highest-risk action paths before UI changes.
- Suggested validation commands: `cd frontend && npm run test -- <targeted files>`.

## Database-Backed Test Coverage Gaps

- Problem: DB-backed validation is valuable but environment availability is a recurring blocker.
- Why it matters: Scheduling, booking, reporting, and DICOM state bugs often need real PostgreSQL semantics.
- Likely files: `docs/CODEX_DB_TESTING.md`, `scripts/check-db-test.js`, targeted integration tests under `src/modules/**/tests/integration/` and `src/services/*.integration.test.ts`.
- Suggested acceptance criteria: Each DB-backed domain README names its minimum integration tests and setup command.
- Suggested validation commands: `npm run db:test:check`, then targeted DB tests using `codex-db-test.env`.
