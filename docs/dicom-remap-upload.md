# DICOM Remap Upload and PACS Send Transport

RISpro uses `POST /api/pacs/remap/jobs/process-multipart` for the active DICOM remap workflow. The browser sends `multipart/form-data` to RISpro; RISpro streams those bytes to private durable job staging, writes a versioned manifest with byte counts and SHA-256 values, and returns `202 Accepted` once staging and the queued job commit are complete.

The request does not parse, rewrite, upload, validate, or transmit DICOM after the upload bytes have completed. The restart-safe processing worker claims the queued job under a database lease, validates staged files, persists a UID replacement plan, rewrites and uploads to Orthanc, verifies one study and replacement identity, then invokes the existing asynchronous C-STORE flow. The frontend polls RISpro job status through `uploaded`, `processing`, `sending`, `sent`, or `failed`.

Deployment proxy requirements for large CT/MR studies:

- Apply body-size and upload timeout settings to `/api/pacs/remap/jobs/process-multipart`.
- Keep the proxy open only for browser upload and durable staging.
- The proxy does not need to remain open for DICOM rewriting, Orthanc ingestion/verification, or PACS C-STORE; those continue through background workers after the response.
- For Nginx-style proxies, configure `client_max_body_size` for the expected study size (for example `20g`), use `proxy_request_buffering off` where streaming is desired, and use `proxy_read_timeout`/`proxy_send_timeout` high enough for ingestion (for example `600s`).

Worker recovery and failed sends:

## Durable staging and processing deployment

- `DICOM_REMAP_STAGING_DIR` defaults to `storage/dicom/remap-staging`. It must be a private, persistent, non-public filesystem location. The standard Docker `/app/storage` volume already covers the default path.
- The application creates the root and job directories with owner-only permissions where the filesystem supports them. Staging keys are opaque; APIs never return server paths, filenames, manifests, or UID-plan locations.
- Set `DICOM_REMAP_PROCESSING_WORKER_INTERVAL_MS` (default `5000`), `DICOM_REMAP_PROCESSING_LEASE_SECONDS` (default `120`), and `DICOM_REMAP_PROCESSING_BATCH_SIZE` (default `5`) to size the worker conservatively.
- Multiple backend instances must share this staging volume. Alternatively run exactly one dedicated processing worker with access to the same volume and database. A lease prevents concurrent processing of one job; a lease expiry allows restart recovery.
- A UID plan is atomically written before the first Orthanc instance upload. Retries reuse identical Study, Series, and SOP Instance UIDs, making a partial Orthanc upload restart-safe. Conflicting existing instances fail safely.
- Successful jobs remove staged DICOM only after verified Orthanc ingestion and durable send enqueue. Cancelled queued and interrupted uploads are cleaned promptly. Failed-processing staging is retained for the configured retention window (`DICOM_REMAP_FAILED_STAGING_RETENTION_HOURS`, default `72`) for controlled diagnosis.
- DICOM staging contains PHI. Do not expose the directory through a web server, backup it to unapproved locations, or log file names, paths, metadata, file contents, or credentials.

To inspect work, use Recent Jobs or the authenticated job endpoint. `uploaded` means durable staging is queued; `processing` exposes the persisted stage/counters/heartbeat; `sending` has an Orthanc C-STORE job; `sent` is terminal success; and `failed` exposes only sanitized error code/details. Ordinary resend is unavailable for a processing failure unless a verified remapped Orthanc study exists.

Worker recovery and failed sends:

- On startup, the worker resumes every `sending` remap job that has an Orthanc job ID; browser navigation and refresh do not cancel monitoring.
- A persisted Orthanc job returning `404` is marked failed with `ORTHANC_SEND_JOB_NOT_FOUND`; RISpro never marks it sent or starts another transfer automatically.
- A `sending` row that never persisted an Orthanc job ID becomes a recoverable failed job after the configured stale-enqueue threshold. An operator must use explicit resend.
- Inspect the remap job in RISpro for its send status and sanitized diagnostics (`send_error_code` and `send_error_details`), then inspect the referenced Orthanc job ID server-side if needed. Do not place Orthanc credentials or patient identifiers in logs or diagnostic notes.

Orthanc remains server-side only. Browsers must upload to RISpro, never directly to Orthanc.
