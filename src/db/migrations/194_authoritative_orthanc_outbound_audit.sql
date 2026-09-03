create table authoritative_orthanc_outbound_audit_state (
  singleton_key boolean primary key default true check (singleton_key),
  initialized_at timestamptz not null,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create unique index dicom_transfer_events_sent_job_study_idx
  on dicom_transfer_events (orthanc_job_id, study_instance_uid)
  where direction = 'SENT' and orthanc_job_id is not null;
