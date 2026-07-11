alter table dicom_remap_jobs
  add column if not exists orthanc_send_job_id text,
  add column if not exists send_attempt_count integer not null default 0,
  add column if not exists send_started_at timestamptz,
  add column if not exists send_completed_at timestamptz,
  add column if not exists send_last_checked_at timestamptz,
  add column if not exists send_last_heartbeat_at timestamptz,
  add column if not exists send_error_code text,
  add column if not exists send_error_details jsonb;

create index if not exists dicom_remap_jobs_sending_monitor_idx
  on dicom_remap_jobs (send_last_checked_at asc nulls first, send_started_at asc nulls first)
  where status = 'sending' and orthanc_send_job_id is not null;

create index if not exists dicom_remap_jobs_sending_missing_orthanc_job_idx
  on dicom_remap_jobs (send_started_at asc)
  where status = 'sending' and orthanc_send_job_id is null;
