# System Diagnostics

Audit Log records who changed RISpro business or configuration data. System Diagnostics records why application operations failed, their component, and their request reference. They are intentionally separate.

Every HTTP request receives an `X-Request-Id` UUID. Staff can use that reference to find a matching diagnostic event without exposing request bodies, patient data, or credentials.

System Diagnostics is available only to a recently re-authenticated `super_admin` in Settings. Backup and restore failures are recorded with source `backup_restore`; use the request ID returned by an unexpected server error to locate the event.

Diagnostic events are retained for 30 days; the cleanup service removes expired rows. Stored messages, technical details, routes, and metadata redact passwords, passphrases, tokens, cookies, authorization headers, database URLs, API keys, SMTP/PACS/Orthanc/SonicDICOM credentials, request bodies, uploads, and patient or clinical fields. Query strings are not stored.

System Diagnostics does not replace Docker logs. If diagnostic persistence itself fails, RISpro safely logs a sanitized fallback to `console.error`; Docker/service logs remain the final operational fallback.

The overview includes an OHIF Viewer status card with feature gates, selected strategy/source, last QIDO/WADO outcomes, active retrieval jobs, and recent retrieval failures. It never includes DICOMweb/Orthanc credentials, PatientID, patient name, accession, or full DICOM metadata.
