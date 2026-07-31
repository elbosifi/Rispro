# Clinical-document Secondary Capture export

RISpro queues a `secondary_capture` clinical-document export for documents created by Modality Request Scans with `document_type=clinical_document` and `source=modality_scan_automation`. The server worker only claims exports after the linked V2 appointment is `completed` and the global `authoritative_orthanc.enabled` setting is enabled.

The worker finds an existing matched Orthanc study; it never creates a replacement study. It renders the document into RGB pages and writes one DICOM Secondary Capture instance per page. All scanned clinical documents for one appointment currently share a single Secondary Capture series, with sequential instance numbers. This is the implemented behavior and requires product/clinical governance before it is changed.

## Current policy boundaries

- Deleting a RISpro document does not remove an already-exported DICOM object from Orthanc.
- Reassignment or replacement does not automatically retract a prior export.
- Non-completed appointments remain unclaimed; they are not explicitly cancelled.
- The global Authoritative Orthanc enabled setting controls both study lookup and export processing; there is no separate Secondary Capture toggle.

Changing retraction, supersession, cancellation, appointment-wide series grouping, or the series number requires an explicit product and clinical-governance decision.

## Non-production staging runbook

Use only a disposable PostgreSQL database, a non-production Orthanc, and a non-PHI two-page fixture.

1. Confirm migrations 149 and 154 are applied, Authoritative Orthanc is enabled, the connection test succeeds, and logs show `clinical_document_export_worker` with `worker_started`.
2. Create a V2 test appointment and a matching Orthanc study first. Record test appointment ID, synthetic accession, and Orthanc study ID.
3. Ingest a two-page modality scan. Confirm its document ID, `clinical_document` type, `modality_scan_automation` source, and the waiting status before appointment completion.
4. Complete the appointment. Observe pending, exporting, then exported in Request Scans. Record export ID, series ID, generated page count, verified page count, and sanitized log events.
5. In Orthanc/OHIF, confirm exactly one new Secondary Capture series in the original study and exactly two instances with the correct patient, accession, and study identity.
6. Rerun the worker. Confirm neither another series nor extra instances are created.
7. Repeat with a missing study (retryable), patient/accession/modality mismatch or ambiguous study (blocked), and an interruption after page one followed by retry. Capture pass/fail, UI status, counts, IDs, and sanitized logs for every scenario.

This runbook has not been executed by the sandbox validation pass.
