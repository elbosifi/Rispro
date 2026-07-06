# QR Patient Portal

## Purpose

The QR patient portal exposes patient-facing appointment, report, image, and cancellation flows based on configurable QR/public-link settings.

## Current Known Code Locations

- Backend settings utility: `src/modules/appointments-v2/public/utils/patient-qr-settings.ts`
- Backend public routes: `src/modules/appointments-v2/api/routes/public-appointments-cancel-routes.ts`
- Frontend settings: `frontend/src/pages/settings/patient-qr-settings-section.tsx`
- Registration/printing surface: `frontend/src/pages/registrations/registrations-page.tsx`
- Public cancel page: `frontend/src/pages/public/cancel-appointment-page.tsx`
- Frontend API hooks/types: `frontend/src/lib/api-hooks`, `frontend/src/types/api.ts`

## Current Known Risks

- Public links and QR pages expose patient-facing data and must preserve access settings.
- Report/image access depends on SonicDICOM/PACS availability and modality settings.
- Settings defaults must stay complete as new required fields are added.

## What Agents Must Not Do

- Do not expose private appointment data without checking QR/public-link settings.
- Do not log patient identifiers or report/image access details as raw fields.
- Do not make public flows depend on authenticated-only frontend state.
- Do not change cancellation semantics while only editing QR display/settings.

## Recommended Tests Before Touching

- Backend: `node --import tsx --test src/modules/appointments-v2/public/utils/patient-qr-settings.test.ts src/modules/appointments-v2/public/utils/appointment-slip-settings.test.ts`
- Public route tests when route behavior changes: `node --import tsx --test src/modules/appointments-v2/tests/integration/public-cancel-flow.test.ts` after `npm run db:test:check`
- Frontend: `cd frontend && npm run test -- src/pages/settings/patient-qr-settings-section.test.tsx src/pages/public/cancel-appointment-page.test.tsx`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: full public-link validity and revocation matrix.
- Needs inspection: QR report/image access tests across SonicDICOM unavailable, draft, final, and study-not-found states.
- Needs inspection: print slip coverage for all QR settings.
