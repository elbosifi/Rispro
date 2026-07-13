# DICOM Remap Upload and PACS Send Transport

RISpro uses `POST /api/pacs/remap/jobs/process-multipart` for the active DICOM remap workflow. The browser sends `multipart/form-data` to RISpro; RISpro streams those bytes to private durable job staging, writes a versioned manifest with byte counts and SHA-256 values, and returns `202 Accepted` once staging and the queued job commit are complete.

## Folder study detection

Folder selection first sends a bounded, distributed header-only preview so the study chooser can appear quickly. RISpro then scans every DICOM-like browser file locally in batches, reading header bytes only and replacing the preliminary result when the complete scan finishes. A completed scan uploads only the files belonging to the explicitly selected Study Instance UID.

If the complete scan is taking too long, it can be skipped only after a one-study preliminary result and a separate acknowledgement. That mode uploads every DICOM-like candidate with `uploadMode=single_study_folder_unverified` and the provisional selected Study Instance UID. The durable worker parses every valid staged DICOM before it creates a UID plan, rewrites data, uploads to Orthanc, verifies Orthanc, or enqueues PACS send. Any mixed-study folder fails safely with `DICOM_REMAP_MULTIPLE_STUDIES_DETECTED`; diagnostics contain only the stable error code and sanitized counts.

The request does not parse, rewrite, upload, validate, or transmit DICOM after the upload bytes have completed. The restart-safe processing worker claims the queued job under a database lease, validates staged files, persists a UID replacement plan, rewrites and uploads to Orthanc, verifies one study and replacement identity, then invokes the existing asynchronous C-STORE flow. The frontend polls RISpro job status through `uploaded`, `processing`, `sending`, `sent`, or `failed`.

## Gateway transport for large CT/MR studies

Ordinary RISpro API requests remain limited to **75 MiB** at the bundled Nginx gateway. The active remap endpoint, `POST /api/pacs/remap/jobs/process-multipart`, has an exact dedicated route with a **21 GiB** gateway allowance, 900-second upload/proxy timeouts, and both `proxy_request_buffering off` and `proxy_buffering off`. Nginx therefore streams the browser request to RISpro instead of buffering a full study.

The extra 1 GiB is transport headroom for multipart boundaries and request metadata. It does not expand the accepted DICOM content limit: RISpro remains authoritative and enforces `DICOM_REMAP_STAGING_MAX_FILES=5000` and `DICOM_REMAP_STAGING_MAX_TOTAL_BYTES=21474836480` (20 GiB) by default. Ensure the private persistent staging volume has adequate free space for the configured application limit.

The proxy connection is required only until durable staging commits and RISpro returns `202 Accepted`. Rewriting, Orthanc verification, and PACS sending continue through background workers after that response.

After deploying an update, verify the loaded gateway configuration and restart the mounted configuration using the supported update path (`./scripts/update-docker.sh`, which recreates the Compose services), or for a configuration-only change:

```bash
docker compose exec gateway nginx -t
docker compose exec gateway nginx -T
docker compose restart gateway
```

Confirm the rendered output includes `location = /api/pacs/remap/jobs/process-multipart`, `client_max_body_size 21g`, `proxy_request_buffering off`, and `proxy_buffering off`.

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

## Disposable Compose smoke test

For host-side validation of the durable remap deployment mount and worker startup, run:

```bash
scripts/test-dicom-remap-compose-smoke.sh
```

The script creates a unique disposable Compose project with an internal PostgreSQL container, synthetic secrets, nonproduction ports, and the lightweight restore-validation image target. It waits for PostgreSQL and `/api/health`, verifies migration 119 and processing-worker startup, checks `/app/storage/dicom/remap-staging` is on the project `rispro-storage` volume, and confirms a non-PHI sentinel survives application restart and recreation. It also checks graceful shutdown and removes the temporary `.env`, containers, network, and volumes with a shell trap. It never connects to Orthanc, PACS, or production services.
