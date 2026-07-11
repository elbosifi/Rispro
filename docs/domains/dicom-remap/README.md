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

## Durable Processing Architecture

- `POST /api/pacs/remap/jobs/process-multipart` finishes after authenticated browser bytes have been staged to private persistent storage and a versioned manifest is committed. It returns `202` with a job in `uploaded` / `queued` state.
- `dicom-remap-processing-worker.ts` claims queued jobs with a database lease, validates hashes and the one-selected-study boundary, atomically persists a UID plan, uploads remapped instances to Orthanc, verifies the resulting study and identity, and then reuses the durable asynchronous send worker.
- Restart/reclaim reuses the same staged manifest and UID plan. Multiple workers cannot own a job while its lease is valid. The staging root must be shared by multiple backend instances.
- Staged DICOM is PHI and must remain outside public static serving. Use `DICOM_REMAP_STAGING_DIR` on the persistent RISpro storage volume; successful staging is cleaned after send enqueue, while failed staging is retained only for the documented controlled retention period.

## Current Known Risks

- The workflow handles patient identity in DICOM metadata and must avoid accidental wrong-patient sends.
- Large studies require a persistent staging volume shared with the processing worker.
- A failed Orthanc ingestion is intentionally retained for controlled diagnosis; it must not be treated as resendable until a remapped study has verified.
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
