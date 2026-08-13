alter table dicom_remap_jobs
  add column if not exists dicom_integrity_version integer,
  add column if not exists dicom_integrity_verified_at timestamptz,
  add column if not exists orthanc_recovery_status text not null default 'none',
  add column if not exists orthanc_recovery_attempt_count integer not null default 0,
  add column if not exists orthanc_recovery_source_study_id text,
  add column if not exists orthanc_recovery_started_at timestamptz,
  add column if not exists orthanc_recovery_completed_at timestamptz,
  add column if not exists orthanc_recovery_error_code text,
  add column if not exists orthanc_recovery_error_details jsonb,
  add column if not exists orthanc_recovery_expires_at timestamptz;

alter table dicom_remap_jobs
  drop constraint if exists dicom_remap_jobs_orthanc_recovery_status_check;

alter table dicom_remap_jobs
  add constraint dicom_remap_jobs_orthanc_recovery_status_check
  check (orthanc_recovery_status in ('none', 'available', 'processing', 'failed', 'completed'));

update dicom_remap_jobs
set orthanc_recovery_status = 'available',
    orthanc_recovery_expires_at = now() + interval '168 hours'
where status = 'failed'
  and staged_storage_key is not null
  and staging_cleanup_completed_at is null
  and orthanc_recovery_status = 'none'
  and processing_error_code in (
    'DICOM_REMAP_DICOM_REWRITE_FAILED',
    'DICOM_REMAP_PIXEL_INTEGRITY_FAILED',
    'DICOM_REMAP_ORTHANC_UPLOAD_FAILED',
    'DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED',
    'DICOM_REMAP_ORTHANC_FILE_REJECTED',
    'DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT',
    'DICOM_REMAP_ORTHANC_AUTH_FAILED',
    'DICOM_REMAP_ORTHANC_INFRASTRUCTURE_FAILURE',
    'DICOM_REMAP_ORTHANC_VERIFICATION_FAILED',
    'DICOM_REMAP_IDENTITY_VERIFICATION_FAILED',
    'DICOM_REMAP_MULTIFRAME_OBJECT_FAILED'
  );

create index if not exists dicom_remap_jobs_orthanc_recovery_cleanup_idx
  on dicom_remap_jobs (orthanc_recovery_expires_at)
  where status = 'failed'
    and staged_storage_key is not null
    and staging_cleanup_completed_at is null
    and orthanc_recovery_status in ('available', 'processing', 'failed');
