alter table dicom_remap_jobs
  add column if not exists orthanc_recovery_stage text,
  add column if not exists orthanc_recovery_lease_owner text,
  add column if not exists orthanc_recovery_lease_expires_at timestamptz,
  add column if not exists orthanc_recovery_last_heartbeat_at timestamptz;

create index if not exists dicom_remap_jobs_orthanc_recovery_stale_idx
  on dicom_remap_jobs (orthanc_recovery_lease_expires_at)
  where orthanc_recovery_status = 'processing';
