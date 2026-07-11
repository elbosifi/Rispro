# DICOM Remap Upload and PACS Send Transport

RISpro uses `POST /api/pacs/remap/jobs/process-multipart` for the active DICOM remap workflow. The browser sends `multipart/form-data` to RISpro; RISpro stages and rewrites the selected study, ingests it into Orthanc, validates the replacement identity and one-study boundary, then requests an asynchronous Orthanc C-STORE job.

The request returns `202 Accepted` only after RISpro has persisted the Orthanc job ID with remap status `sending`. It does not mean the PACS transfer has completed. The frontend polls RISpro job status; the server-side DICOM remap send worker monitors the exact persisted Orthanc job and updates the job to `sent` or `failed`.

Deployment proxy requirements for large CT/MR studies:

- Apply body-size and upload timeout settings to `/api/pacs/remap/jobs/process-multipart`.
- Keep the proxy open for browser upload, rewrite, Orthanc ingestion, and validation.
- The proxy no longer needs to remain open for the complete PACS C-STORE; it continues through the backend worker after the response.
- For Nginx-style proxies, configure `client_max_body_size` for the expected study size (for example `20g`), use `proxy_request_buffering off` where streaming is desired, and use `proxy_read_timeout`/`proxy_send_timeout` high enough for ingestion (for example `600s`).

Worker recovery and failed sends:

- On startup, the worker resumes every `sending` remap job that has an Orthanc job ID; browser navigation and refresh do not cancel monitoring.
- A persisted Orthanc job returning `404` is marked failed with `ORTHANC_SEND_JOB_NOT_FOUND`; RISpro never marks it sent or starts another transfer automatically.
- A `sending` row that never persisted an Orthanc job ID becomes a recoverable failed job after the configured stale-enqueue threshold. An operator must use explicit resend.
- Inspect the remap job in RISpro for its send status and sanitized diagnostics (`send_error_code` and `send_error_details`), then inspect the referenced Orthanc job ID server-side if needed. Do not place Orthanc credentials or patient identifiers in logs or diagnostic notes.

Orthanc remains server-side only. Browsers must upload to RISpro, never directly to Orthanc.
