create table patient_identity_reconciliation_jobs (
  id bigserial primary key,
  operation_type text not null check (operation_type in ('reconcile', 'reverse')),
  patient_id bigint not null references patients(id),
  study_instance_uid text not null,
  accession_number text,
  study_date text,
  orthanc_study_id_before text,
  orthanc_study_id_after text,
  old_patient_id text,
  new_patient_id text,
  original_other_patient_ids jsonb,
  result_other_patient_ids jsonb,
  original_patient_name text,
  original_patient_birth_date text,
  original_patient_sex text,
  original_series_instance_uids jsonb,
  original_sop_instance_uids jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  stage text not null default 'queued',
  orthanc_job_id text,
  requested_by_user_id bigint not null references users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  reverses_job_id bigint references patient_identity_reconciliation_jobs(id),
  reversed_by_job_id bigint references patient_identity_reconciliation_jobs(id),
  failure_code text,
  failure_details jsonb,
  processing_attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index patient_identity_reconciliation_one_active_study
  on patient_identity_reconciliation_jobs (study_instance_uid)
  where status in ('queued', 'processing');
create index patient_identity_reconciliation_patient_history
  on patient_identity_reconciliation_jobs (patient_id, created_at desc);
create index patient_identity_reconciliation_old_id
  on patient_identity_reconciliation_jobs (old_patient_id)
  where status = 'completed';
create index patient_identity_reconciliation_new_id
  on patient_identity_reconciliation_jobs (new_patient_id)
  where status = 'completed';
create index patient_identity_reconciliation_accession
  on patient_identity_reconciliation_jobs (accession_number)
  where status = 'completed';
create index patient_identity_reconciliation_study_uid
  on patient_identity_reconciliation_jobs (study_instance_uid, created_at desc);
