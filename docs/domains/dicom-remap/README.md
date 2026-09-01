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
- `dicom-remap-processing-worker.ts` claims queued jobs with a database lease, validates hashes and the one-selected-study boundary, atomically persists a UID plan, performs a metadata-only rewrite that preserves the original transfer syntax and pixel payload, uploads only integrity-verified instances to Orthanc, verifies the resulting study and identity, and then reuses the durable asynchronous send worker.
- Restart/reclaim reuses the same staged manifest and UID plan. Multiple workers cannot own a job while its lease is valid. The staging root must be shared by multiple backend instances.
- Staged DICOM is PHI and must remain outside public static serving. Use `DICOM_REMAP_STAGING_DIR` on the persistent RISpro storage volume. Pristine staging is retained through PACS send and cleaned after confirmed send success, explicit safe cancellation/reset, or the applicable retention expiry.
- A remapped study cannot enter or re-enter PACS send unless its current `dicom_integrity_version` is recorded with `dicom_integrity_verified_at`. Legacy unverified jobs must use the explicit Orthanc recovery path while pristine staging remains, or be re-uploaded.
- An eligible technical processing failure exposes a manual **Retry with Orthanc** action. It revalidates the staged manifest, uploads the original bytes unchanged, uses Orthanc's existing study-modify operation, verifies the modified study, records the current integrity version, and then invokes the same durable PACS send implementation. Source-selection, manifest-integrity, and identity-safety failures are never eligible.
- A failed job with retained private staging may expose **Recover Source**. It streams only the confirmed selected source study after manifest, size, SHA-256, and DICOM Study Instance UID validation. ZIP entries are neutral sequential names; their contents are the pristine staged bytes, never remapped, Orthanc-modified, or delimiter-repaired working copies. The export is available only for the existing staging-retention window and does not retry, reset, or mutate the job.
- A remap job may have a nullable `comparison_request_id`. Comparison preparation uses the same staging, verification, rewrite, Orthanc, PACS send, retry, and recovery pipeline; the relationship only supplies durable clinical context.
- Pending requests under `/comparisons/:id/remap` use the comparison page permission plus backend comparison-context validation. Every remap API call carries the request context, and replacement-patient operations verify the request's authoritative patient. This does not grant access to unrelated PACS administration or ordinary remap jobs.

## Current Known Risks

- The workflow handles patient identity in DICOM metadata and must avoid accidental wrong-patient sends.
- Large studies require a persistent staging volume shared with the processing worker.
- A failed Orthanc ingestion is intentionally retained for controlled diagnosis and manual recovery; it must not be treated as resendable until a remapped study has verified.
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
