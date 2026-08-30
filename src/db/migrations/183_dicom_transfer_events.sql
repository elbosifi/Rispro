create table dicom_transfer_events (
  id bigserial primary key,
  direction text not null check (direction in ('RECEIVED', 'SENT')),
  status text not null check (status in ('ACTIVE', 'SUCCESS', 'FAILED')),
  patient_id text,
  patient_name text,
  accession_number text,
  study_instance_uid text not null,
  study_description text,
  source_aet text,
  source_ip text,
  destination_aet text,
  instance_count integer check (instance_count is null or instance_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  orthanc_job_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dicom_transfer_events_newest_idx
  on dicom_transfer_events (created_at desc);

create index dicom_transfer_events_accession_number_idx
  on dicom_transfer_events (accession_number);

create index dicom_transfer_events_study_instance_uid_idx
  on dicom_transfer_events (study_instance_uid);

create index dicom_transfer_events_direction_status_time_idx
  on dicom_transfer_events (direction, status, completed_at desc nulls last, last_seen_at desc);

create unique index dicom_transfer_events_idempotency_key_idx
  on dicom_transfer_events (idempotency_key)
  where idempotency_key is not null;
