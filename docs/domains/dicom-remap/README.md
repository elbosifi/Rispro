# DICOM Remap

## Purpose

DICOM Remap lets authenticated users upload a selected external DICOM study, map it to the correct RISpro patient, rewrite identity fields, and send the corrected study to PACS through server-side orchestration.

## Current Known Code Locations

- Backend routes: `src/routes/pacs.ts` under `/api/pacs/remap`
- Backend service: `src/services/dicom-remap-service.ts`
- Frontend page: `frontend/src/pages/pacs/pacs-remap-page.tsx`
- Frontend scan helper: `frontend/src/lib/dicom-study-scan.ts`
- Upload doc: `docs/dicom-remap-upload.md`
- Settings: `frontend/src/pages/settings/pacs-settings-section.tsx`

## Current Known Risks

- The workflow handles patient identity in DICOM metadata and must avoid accidental wrong-patient sends.
- Large studies can take minutes and need stable staging/cleanup behavior.
- Current job persistence when the user leaves the page needs improvement.
- Orthanc must remain server-side.

## What Agents Must Not Do

- Do not send browser requests directly to Orthanc.
- Do not weaken identity confirmation, one-study validation, or destination confirmation.
- Do not make upload cleanup depend only on frontend state.
- Do not log raw patient names, IDs, MRNs, phone numbers, accession numbers, or clinical notes.

## Recommended Tests Before Touching

- Backend: `node --import tsx --test src/services/dicom-remap-service.test.ts src/routes/pacs.test.ts`
- Frontend: `cd frontend && npm run test -- src/pages/pacs/pacs-remap-page.test.tsx src/lib/dicom-study-scan.test.ts`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: durable remap job persistence and resume behavior after navigation or refresh.
- Needs inspection: cleanup/retry semantics for long-running uploads and failed Orthanc operations.
- Needs inspection: operator audit trail for remap identity decisions.
