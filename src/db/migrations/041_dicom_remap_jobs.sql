create table if not exists dicom_remap_jobs (
  id bigserial primary key,
  created_by_user_id bigint not null references users(id),
  status text not null check (status in ('uploaded', 'awaiting_confirmation', 'remapped', 'sending', 'sent', 'failed')),
  source_orthanc_study_id text,
  modified_orthanc_study_id text,
  rispro_patient_id bigint references patients(id),
  destination_pacs_key text,
  original_patient_id text,
  original_patient_name text,
  original_patient_sex text,
  original_patient_birth_date text,
  replacement_patient_id text,
  replacement_patient_name text,
  replacement_patient_sex text,
  replacement_patient_birth_date text,
  send_result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dicom_remap_jobs_user_created_idx
  on dicom_remap_jobs (created_by_user_id, created_at desc);

create index if not exists dicom_remap_jobs_status_updated_idx
  on dicom_remap_jobs (status, updated_at desc);

create unique index if not exists dicom_remap_jobs_single_active_per_user_idx
  on dicom_remap_jobs (created_by_user_id)
  where status in ('uploaded', 'awaiting_confirmation', 'remapped', 'sending');
