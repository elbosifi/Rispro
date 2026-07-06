# Comparison Requests

## Purpose

Comparison requests track doctor-requested comparison-study work that is separate from appointments but visible in comparison and reporting workflows.

## Current Known Code Locations

- Backend routes: `src/routes/comparisons.ts`
- Backend service: `src/services/comparison-request-service.ts`
- Frontend page: `frontend/src/pages/comparisons/comparisons-page.tsx`
- Reporting Board integration: `src/modules/doctor-portal/reporting-board-*`, `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/types/api.ts`
- Frontend route registry: `frontend/src/lib/route-registry.ts`

## Current Known Risks

- Comparison requests are intentionally not appointments.
- They share Reporting Board assignment/bulk action surfaces with appointment-backed cases.
- Case identity must distinguish `appointmentId` and `comparisonRequestId`.

## What Agents Must Not Do

- Do not create MWL rows for comparison requests.
- Do not consume modality capacity for comparison requests.
- Do not force comparison requests through appointment queue/check-in/status flows.
- Do not collapse `caseType`, `caseKey`, `appointmentId`, and `comparisonRequestId` into a single appointment-only identity.

## Recommended Tests Before Touching

- Backend: `node --import tsx --test src/services/comparison-request-service.test.ts src/modules/doctor-portal/reporting-board.test.ts`
- Frontend: `cd frontend && npm run test -- src/pages/comparisons/comparisons-page.test.tsx src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/reporting-board-mobile-page.test.tsx`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: end-to-end comparison lifecycle coverage from request through reporting board finalization.
- Needs inspection: cache invalidation parity between comparison page and reporting board.
- Needs inspection: audit/reporting requirements for comparison final text.
