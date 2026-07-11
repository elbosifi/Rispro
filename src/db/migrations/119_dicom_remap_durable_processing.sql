alter table dicom_remap_jobs
  add column if not exists processing_stage text,
  add column if not exists staged_storage_key text,
  add column if not exists staged_manifest_version integer,
  add column if not exists staged_file_count integer,
  add column if not exists staged_total_bytes bigint,
  add column if not exists processed_file_count integer not null default 0,
  add column if not exists processing_skipped_file_count integer not null default 0,
  add column if not exists processing_attempt_count integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz,
  add column if not exists processing_last_checked_at timestamptz,
  add column if not exists processing_last_heartbeat_at timestamptz,
  add column if not exists processing_lease_owner text,
  add column if not exists processing_lease_expires_at timestamptz,
  add column if not exists processing_error_code text,
  add column if not exists processing_error_details jsonb,
  add column if not exists staging_cleanup_completed_at timestamptz;

alter table dicom_remap_jobs
  drop constraint if exists dicom_remap_jobs_status_check;

alter table dicom_remap_jobs
  add constraint dicom_remap_jobs_status_check
  check (status in ('uploaded', 'processing', 'awaiting_confirmation', 'remapped', 'sending', 'sent', 'failed', 'cancelled'));

drop index if exists dicom_remap_jobs_single_active_per_user_idx;
create unique index if not exists dicom_remap_jobs_single_active_per_user_idx
  on dicom_remap_jobs (created_by_user_id)
  where status in ('uploaded', 'processing', 'awaiting_confirmation', 'remapped', 'sending');

create index if not exists dicom_remap_jobs_processing_queue_idx
  on dicom_remap_jobs (created_at asc)
  where status = 'uploaded' and processing_stage = 'queued';

create index if not exists dicom_remap_jobs_processing_lease_idx
  on dicom_remap_jobs (processing_lease_expires_at asc)
  where status = 'processing';
