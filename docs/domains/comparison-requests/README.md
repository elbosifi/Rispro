# Comparison Requests

## Purpose

Comparison requests track doctor-requested comparison-study work that is separate from appointments but visible in comparison and reporting workflows.

## Current Known Code Locations

- Backend routes: `src/routes/comparisons.ts`
- Backend service: `src/services/comparison-request-service.ts`
- Frontend page: `frontend/src/pages/comparisons/comparisons-page.tsx`
- Comparison paper UI: `frontend/src/pages/comparisons/comparison-documents-panel.tsx`
- Reporting Board integration: `src/modules/doctor-portal/reporting-board-*`, `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, `frontend/src/types/api.ts`
- Frontend route registry: `frontend/src/lib/route-registry.ts`

## Preparation Architecture

- Comparison requests remain separate from appointments and preserve their existing pending, ready, assigned, finalized, and cancelled lifecycle.
- Papers are ordinary canonical `documents` rows with patient ownership. `comparison_request_documents` is only an explicit request-to-document relationship; it stores no binary content and does not attach papers deceptively to the historical appointment.
- Browser scanning reuses the configured NAPS2 WebScan path and uploads the resulting PDF through the same canonical document service.
- DICOM preparation launches the existing PACS Remap page in a comparison-scoped context. The backend locks replacement identity to the comparison request's patient and stores the nullable `dicom_remap_jobs.comparison_request_id` relationship.
- The latest linked remap job is authoritative for image readiness. Only `sent` is displayed as PACS-ready; queued, staging, processing, sending, awaiting-confirmation, and failed states remain distinct.
- Remap success does not release a request. The existing explicit three-part material confirmation remains the transition to `ready_for_reporting`.
- Cancellation is an audited status transition for supervisors and super-admins. Finalized and already-cancelled requests cannot be cancelled.

## Current Known Risks

- Comparison requests are intentionally not appointments.
- They share Reporting Board assignment/bulk action surfaces with appointment-backed cases.
- Case identity must distinguish `appointmentId` and `comparisonRequestId`.
- Canonical documents can also have appointment links, so removal must reject a document still used outside the target comparison request.
- A comparison-linked remap route grants access only to that pending request context; it is not general PACS administration access.

## What Agents Must Not Do

- Do not create MWL rows for comparison requests.
- Do not consume modality capacity for comparison requests.
- Do not force comparison requests through appointment queue/check-in/status flows.
- Do not collapse `caseType`, `caseKey`, `appointmentId`, and `comparisonRequestId` into a single appointment-only identity.
- Do not duplicate document binary storage or DICOM processing for comparison preparation.
- Do not infer PACS readiness from browser state or an independent boolean; use the linked remap job state and retain human confirmation.

## Recommended Tests Before Touching

- Backend source/unit: `node --import tsx --test src/services/comparison-request-service.test.ts src/modules/doctor-portal/reporting-board.test.ts`
- Backend DB: `npm run test:db:one -- src/services/comparison-preparation.integration.test.ts`
- Frontend: `cd frontend && npm run test -- src/pages/comparisons/comparisons-page.test.tsx src/pages/comparisons/comparison-documents-panel.test.tsx src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/reporting-board-mobile-page.test.tsx`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: end-to-end comparison lifecycle coverage from request through reporting board finalization.
- Needs inspection: cache invalidation parity between comparison page and reporting board.
- Needs inspection: audit/reporting requirements for comparison final text.
