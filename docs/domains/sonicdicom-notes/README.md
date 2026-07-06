# SonicDICOM Notes

## Purpose

SonicDICOM integration provides external report status and study notes for RISpro surfaces such as Reporting Board, registrations, and patient QR report access.

## Current Known Code Locations

- Backend report service/settings: `src/services/sonicdicom-report-service.ts`, `src/services/sonicdicom-report-settings.ts`
- Settings route: `src/routes/settings.ts`
- Appointments V2 read routes: `src/modules/appointments-v2/api/routes/read-v2-routes.ts`
- Patient QR/public routes: `src/modules/appointments-v2/api/routes/public-appointments-cancel-routes.ts`
- Settings UI: `frontend/src/pages/settings/sonicdicom-reports-section.tsx`
- Registration display: `frontend/src/pages/registrations/registrations-page.tsx`
- Reporting Board types: `frontend/src/types/api.ts`

## Current Known Risks

- SonicDICOM is external and can be unavailable; UI should degrade without crashing.
- Notes may contain clinical text and must not be logged raw.
- Visibility differs by surface; Reporting Board, registration, and QR access need explicit validation when changing fields.

## What Agents Must Not Do

- Do not expose raw notes in logs or new telemetry fields.
- Do not make frontend code query SonicDICOM directly.
- Do not assume report status or notes are always present.
- Do not change QR report access rules while only working on staff-facing notes.

## Recommended Tests Before Touching

- Backend: `node --import tsx --test src/services/sonicdicom-study-notes.test.ts src/services/sonicdicom-staff-viewer-url.test.ts src/modules/appointments-v2/tests/unit/reception-sonicdicom-study-note-read.test.ts`
- Frontend registration note coverage: `cd frontend && npm run test -- src/pages/registrations/registrations-page.print.test.tsx`
- Reporting Board tests when board fields change: `cd frontend && npm run test -- src/pages/doctor/doctor-reporting-board-page.test.tsx`

## Follow-Up Gaps

- Needs inspection: complete matrix of note visibility in Reporting Board, registration, QR, and print surfaces.
- Needs inspection: stale-note timestamp UX and fallback messages.
- Needs inspection: structured observability fields for SonicDICOM failures without PHI.
