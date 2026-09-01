# DICOM Remap Upload and PACS Send Transport

RISpro offers two operator workflows. Both upload through RISpro into private durable staging; neither uploads from the browser directly to Orthanc.

## Operator workflows

Folder or file selection first runs the existing bounded, distributed header preview so a preliminary study card appears quickly. The card shows source name, patient ID, date of birth and sex when available, modality, study date, and Study Instance UID. It is explicitly preliminary until the server verifies the durable source.

1. **Complete browser scan.** RISpro scans every DICOM-like browser file locally and replaces the preliminary result when the scan completes. The operator selects a study and `POST /api/pacs/remap/jobs/process-multipart` uploads only that study's files. Existing `single_study_folder_unverified` validation remains strict and rejects mixed studies.
2. **Fast server verification.** After selecting an identifiable preliminary study and explicitly acknowledging it, the browser cancels the complete scan and immediately sends all DICOM-like candidates once to `POST /api/pacs/remap/jobs/stage-multipart`. Patient and destination selection remain usable during that upload. The server writes manifest version 2 and finishes with both `status` and `processing_stage` set to `awaiting_confirmation`; the worker cannot claim that state.

When patient, destination, replacement preview, and final identity confirmation are ready, the fast workflow sends only JSON to `POST /api/pacs/remap/jobs/:jobId/confirm-staged`. The endpoint atomically attaches the selected Study Instance UID and processing inputs and moves the same job to `uploaded` / `queued`. Duplicate identical confirmation returns the same job and cannot create a second processing attempt. The source files are not placed in a second `FormData`, so the CD is not read or uploaded again after secure staging begins.

The recommended operator wording is: **“Confirm this source study and begin secure staging. RISpro will verify every staged DICOM file on the server and will remap only the selected Study Instance UID. Other studies on the CD will not be sent.”**

## Server verification and selected-study isolation

Manifest version 1 retains the existing final-at-upload selected UID behavior. Manifest version 2 records immutable file metadata, byte sizes, SHA-256 values, the provisional selected UID, and the provisional identity snapshot while the job cannot be claimed. Final confirmation stores the authoritative processing selection in the database; it does not silently mutate the staging manifest.

After confirmation, the restart-safe worker validates every manifest hash and size, parses every valid staged DICOM candidate, groups candidates by Study Instance UID, and requires the confirmed UID to exist. It builds the persisted deterministic UID plan, rewrites, and uploads only files in that exact group. Files from other studies are never rewritten, uploaded to Orthanc, or sent. Sanitized processing counts record total staged files, valid DICOM files, selected-study files, excluded other-study files, excluded study count, and skipped/unparsed files; filenames, paths, and patient identifiers are excluded.

Patient ID and patient name must be internally consistent within the selected study. Birth date and sex must also be consistent when present. Identity differences in excluded studies do not block the selected study. Non-empty provisional identity fields are compared with the authoritative selected-study identity. A material difference fails safely with `DICOM_REMAP_SOURCE_IDENTITY_MISMATCH`; an absent confirmed UID fails with `DICOM_REMAP_SELECTED_STUDY_NOT_FOUND`. Neither condition rewrites or uploads an instance.

Once queued, the worker records compact per-file outcomes in the private UID plan. Every metadata-only rewrite must preserve transfer syntax, pixel representation, image-defining attributes, and the SHA-256 of the native or canonical encapsulated pixel payload before the instance can be uploaded to Orthanc. The worker then verifies the final Orthanc study against the unique accepted replacement SOP Instance UID set. Only after all accepted instances and the resulting Orthanc study pass does RISpro record the current DICOM integrity version and allow asynchronous PACS send. Confirmed selected-instance loss or unresolved likely-DICOM membership moves the job to `awaiting_confirmation` / `awaiting_send_confirmation`; the operator must review and acknowledge the warning before send. Zero accepted instances, a known failed multiframe object, or a fatal study/infrastructure invariant fails the job.

## Gateway transport for large CT/MR studies

Ordinary RISpro API requests remain limited to **75 MiB** at the bundled Nginx gateway. Both full-size remap endpoints, `POST /api/pacs/remap/jobs/process-multipart` and `POST /api/pacs/remap/jobs/stage-multipart`, have exact dedicated routes with a **21 GiB** gateway allowance, 900-second upload/proxy timeouts, and both `proxy_request_buffering off` and `proxy_buffering off`. Nginx therefore streams the browser request to RISpro instead of buffering a full study.

The extra 1 GiB is transport headroom for multipart boundaries and request metadata. It does not expand the accepted DICOM content limit: RISpro remains authoritative and enforces `DICOM_REMAP_STAGING_MAX_FILES=10000` and `DICOM_REMAP_STAGING_MAX_TOTAL_BYTES=21474836480` (20 GiB) by default. The supported Docker setup/update path upgrades only the former standard file-count value `5000` to `10000`; explicitly customized values are preserved. Ensure the private persistent staging volume has adequate free space for the configured application limit.

The proxy connection is required only until durable staging commits and RISpro returns `202 Accepted`. Rewriting, Orthanc verification, and PACS sending continue through background workers after that response.

After deploying an update, verify the loaded gateway configuration and restart the mounted configuration using the supported update path (`./scripts/update-docker.sh`, which recreates the Compose services), or for a configuration-only change:

```bash
docker compose exec gateway nginx -t
docker compose exec gateway nginx -T
docker compose restart gateway
```

Confirm the rendered output includes exact locations for both `/api/pacs/remap/jobs/process-multipart` and `/api/pacs/remap/jobs/stage-multipart`, each with `client_max_body_size 21g`, `proxy_request_buffering off`, and `proxy_buffering off`.

## Durable staging and processing deployment

- `DICOM_REMAP_STAGING_DIR` defaults to `storage/dicom/remap-staging`. It must be a private, persistent, non-public filesystem location. The standard Docker `/app/storage` volume already covers the default path.
- The application creates the root and job directories with owner-only permissions where the filesystem supports them. Staging keys are opaque; APIs never return server paths, filenames, manifests, or UID-plan locations.
- Set `DICOM_REMAP_PROCESSING_WORKER_INTERVAL_MS` (default `5000`), `DICOM_REMAP_PROCESSING_LEASE_SECONDS` (default `120`), `DICOM_REMAP_PROCESSING_BATCH_SIZE` (default `5`), and `DICOM_REMAP_PROCESSING_CONCURRENCY` (default `4`, clamped to `1`–`8`) to size the worker conservatively. A worker claims a job only when one of its processing lanes is free, so no more than the configured number of jobs from that worker hold active processing leases. `DICOM_REMAP_ORTHANC_STABILITY_TIMEOUT_SECONDS` defaults to `90`; configure it to exceed the deployed Orthanc `StableAge`. Stability is only an inactivity signal and never replaces exact expected-versus-actual SOP Instance UID set verification.
- The processing concurrency limit applies per worker-enabled application process. The standard Compose topology has one embedded DICOM remap processing worker in the `app` service; the separate worker service is only for Request Scan. Multiple backend instances must share the remap staging volume, and each additional worker-enabled application process adds its own processing lanes. A row lease prevents concurrent processing of one job and lease expiry allows restart recovery. Orthanc PACS sends remain asynchronous and their monitoring is not capped by the heavy-processing lane setting.
- A UID plan is atomically written before the first Orthanc instance upload and updated after each conclusive per-file outcome. Retries reuse identical Study, Series, and SOP Instance UIDs, making partial Orthanc work restart-safe. `AlreadyStored` is accepted only after its parent study and replacement SOP identity are verified; conflicting existing instances fail safely.
- Successful jobs remove staged DICOM only after PACS send is confirmed successful. Enqueue alone does not remove the pristine recovery copy. Operator reset aborts an active browser upload where possible; cancelling an `awaiting_confirmation` job marks it cancelled and removes staged PHI. Abandoned `awaiting_confirmation` jobs expire and are cleaned after `DICOM_REMAP_AWAITING_CONFIRMATION_RETENTION_HOURS` (default `24`). Eligible technical processing failures keep staging while Orthanc recovery is available, processing, or failed and `orthanc_recovery_expires_at` remains in the future; `DICOM_REMAP_ORTHANC_RECOVERY_RETENTION_HOURS` defaults to `168` (seven days). After expiry, the normal failed-staging retention cleanup may securely remove it.
- DICOM staging contains PHI. Do not expose the directory through a web server, backup it to unapproved locations, or log file names, paths, metadata, file contents, or credentials.

To inspect work, use Recent Jobs or the authenticated job endpoint. `awaiting_confirmation` with stage `awaiting_confirmation` means durable staging is complete but processing has not begun. The same status with stage `awaiting_send_confirmation` means Orthanc ingestion was verified but the study is partial or completeness is uncertain and explicit acknowledgement is required. `uploaded` means queued; `processing` exposes persisted stage/counters/heartbeat; `sending` has an Orthanc C-STORE job; `sent` is terminal success; and `failed` exposes only allowlisted error details. Partial/uncertain counts and acknowledgement remain visible after send. Refresh or re-entry resumes only the initial staged-confirmation state at patient selection.

Migration `146_dicom_remap_staged_confirmation.sql` adds the confirmed selected UID, provisional source snapshot, and sanitized selection-count columns. Deploy the migration before or with application instances and reload the two Nginx exact routes. Rollback is application-first: return all instances to the prior code and gateway configuration; the added nullable columns may remain safely in place. Jobs already confirmed and queued continue under the existing worker. Before rollback, cancel or complete any `awaiting_confirmation` jobs so old code does not leave staged PHI indefinitely.

Migration `158_dicom_remap_multi_job_concurrency.sql` removes the obsolete one-active-remap-job-per-user index. Confirmed jobs for one operator may coexist in queued, processing, remapped, and sending states; same-job conditional transitions, leases, and persisted Orthanc send job IDs remain the duplicate-processing and duplicate-send boundaries.

Migration `166_dicom_remap_integrity_recovery.sql` adds the versioned study-integrity fields and the constrained Orthanc recovery state (`none`, `available`, `processing`, `failed`, or `completed`), attempt counters, persisted source-study checkpoint, sanitized recovery diagnostics, and recovery expiry. Recovery is manual and does not replace the primary RISpro remapping path. It reuses persisted source and modified Orthanc study IDs after interruption, avoiding duplicate uploads or modifications.

To roll back to an application version that assumes one active remap job per user, first stop or pause creation of new remap jobs. Allow active jobs to finish or explicitly resolve them, then verify that no user has multiple non-terminal remap jobs before rolling back the application. Recreate `dicom_remap_jobs_single_active_per_user_idx` only when permanently returning to the old model and only after every conflicting row has been resolved. Migration 158 intentionally has no destructive automatic down migration because existing jobs must never be discarded to restore the old constraint.

Worker recovery and failed sends:

- On startup, the worker resumes every `sending` remap job that has an Orthanc job ID; browser navigation and refresh do not cancel monitoring.
- A persisted Orthanc job returning `404` is marked failed with `ORTHANC_SEND_JOB_NOT_FOUND`; RISpro never marks it sent or starts another transfer automatically.
- A `sending` row that never persisted an Orthanc job ID becomes a recoverable failed job after the configured stale-enqueue threshold. An operator must use explicit resend.
- **Retry Send** is limited to a currently integrity-verified modified study whose failure occurred during PACS send; it never reruns remapping. An unverified legacy study is blocked. If its pristine staging is still eligible, the UI offers **Retry with Orthanc**; otherwise it reports that re-upload is required.
- **Retry with Orthanc** revalidates the staged hashes, uploads the original selected-study bytes unchanged, creates or reconciles the Orthanc-native modified copy, verifies its identity, count, distinct Study Instance UID, stability, and readability, and only then calls the existing PACS send path. Recovery failure keeps the original staging and persists only sanitized technical diagnostics.
- **Recover Source** is a status-independent export of finalized private staging, available to authorized DICOM Remap users whenever that staging remains retained and validates. `GET /api/pacs/remap/jobs/:jobId/recover-source` revalidates the manifest, hashes, sizes, and confirmed selected-study membership before streaming a ZIP of neutral `000001.dcm` entries. Its bytes are always the pristine private staged source: no remapped output, Orthanc content, or delimiter repair is used. Downloading does not extend retention, retry, reset, or otherwise change the remap job; successful-send cleanup behavior is unchanged, and recovery is unavailable once staging is securely removed. **Retry with Orthanc** remains the separate recovery action.
- Inspect the remap job in RISpro for its send status and sanitized diagnostics (`send_error_code` and `send_error_details`), then inspect the referenced Orthanc job ID server-side if needed. Do not place Orthanc credentials or patient identifiers in logs or diagnostic notes.

Orthanc remains server-side only. Browsers must upload to RISpro, never directly to Orthanc.

## Disposable Compose smoke test

For host-side validation of the durable remap deployment mount and worker startup, run:

```bash
scripts/test-dicom-remap-compose-smoke.sh
```

The script creates a unique disposable Compose project with an internal PostgreSQL container, synthetic secrets, nonproduction ports, and the lightweight restore-validation image target. It waits for PostgreSQL and `/api/health`, verifies DICOM remap migrations 119 and 146 plus processing-worker startup, checks `/app/storage/dicom/remap-staging` is on the project `rispro-storage` volume, and confirms a non-PHI sentinel survives application restart and recreation. It also checks graceful shutdown and removes the temporary `.env`, containers, network, and volumes with a shell trap. It never connects to Orthanc, PACS, or production services.
