create table if not exists mpps_event_log (
  id bigserial primary key,
  dedupe_key text not null unique,
  event_type text not null check (event_type in ('n-create', 'n-set')),
  source_ae_title text not null,
  patient_id text,
  accession_number text,
  study_instance_uid text,
  mpps_instance_uid text,
  performed_step_status text not null,
  requested_procedure_id text,
  scheduled_step_id text,
  modality text,
  scheduled_start_date text,
  scheduled_start_time text,
  payload_json jsonb not null default '{}'::jsonb,
  correlated_appointment_id bigint,
  correlation_status text not null default 'unmatched' check (correlation_status in ('matched', 'unmatched', 'ambiguous')),
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  processing_error text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mpps_event_log_mpps_uid_idx on mpps_event_log (mpps_instance_uid);
create index if not exists mpps_event_log_study_uid_idx on mpps_event_log (study_instance_uid);
create index if not exists mpps_event_log_accession_idx on mpps_event_log (accession_number);
create index if not exists mpps_event_log_correlated_appointment_idx on mpps_event_log (correlated_appointment_id);
