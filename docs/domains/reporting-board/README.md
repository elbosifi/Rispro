# Reporting Board

## Purpose

The Reporting Board is the doctor-facing worklist for reportable cases. It includes appointment-backed rows and comparison-request rows, assignment flows, filters, stats, saved/mobile views, print views, and SonicDICOM report status/note display.

## Current Known Code Locations

- Backend: `src/modules/doctor-portal/reporting-board-routes.ts`
- Backend service/repository/types: `src/modules/doctor-portal/reporting-board-service.ts`, `src/modules/doctor-portal/reporting-board-repository.ts`, `src/modules/doctor-portal/reporting-board-types.ts`
- Worker: `src/services/reporting-board-bulk-assignment-worker.ts`
- Frontend pages: `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/pages/doctor/reporting-board-mobile-page.tsx`, `frontend/src/pages/print/reporting-board-print-page.tsx`
- Frontend API/types: `frontend/src/lib/reporting-board.api-hooks*`, `frontend/src/types/api.ts`
- Authorized image launch: `src/modules/ohif-viewer/`, `frontend/src/pages/settings/ohif-viewer-section.tsx`
- Validation doc: `docs/doctor-portal/reporting-board-staging-validation.md`

## Current Known Risks

- Appointment rows and comparison-request rows share board surfaces but have different domain semantics.
- Filtering, assignment, bulk assignment, saved mobile views, and print views can drift from each other.
- SonicDICOM status and notes are external-system data; unavailable status must not crash board rendering.
- Background refresh/cache behavior needs more explicit ownership.

## What Agents Must Not Do

- Do not treat comparison requests as appointments.
- Do not create modality worklist entries or consume modality capacity for comparison-only rows.
- Do not hide filters or actions while refactoring layout.
- Do not query Orthanc/SonicDICOM directly from the frontend.
- Do not expose OHIF from public saved-view/QR tokens; launch must re-check the authenticated doctor's case scope.

## Recommended Tests Before Touching

- Backend unit: `node --import tsx --test src/modules/doctor-portal/reporting-board.test.ts`
- Backend integration after DB check: `npm run db:test:check`, then `node --import tsx --test src/modules/doctor-portal/reporting-board.integration.test.ts`
- Frontend: `cd frontend && npm run test -- src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/reporting-board-mobile-page.test.tsx`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: exact cache invalidation/background refresh contract for all board mutations.
- Needs inspection: persistent filter visibility and saved-view parity on narrow screens.
- Needs inspection: UI E2E coverage for assignment, bulk assignment, mobile saved views, and print flow.
