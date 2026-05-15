create table if not exists scan_sessions (
  id bigserial primary key,
  token_hash text not null unique,
  appointment_id bigint references appointments(id) on delete cascade,
  v2_booking_id bigint references appointments_v2.bookings(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete restrict,
  appointment_ref_type text not null check (appointment_ref_type in ('legacy_appointment', 'v2_booking')),
  document_type text not null default 'appointment_request',
  requested_by_user_id bigint references users(id),
  status text not null default 'created' check (status in ('created', 'opened', 'scanned', 'uploaded', 'expired', 'cancelled', 'failed')),
  expires_at timestamptz not null,
  opened_at timestamptz,
  uploaded_at timestamptz,
  cancelled_at timestamptz,
  workstation_name text,
  scanner_name text,
  app_version text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scan_sessions_one_appointment_reference check (
    (appointment_ref_type = 'legacy_appointment' and appointment_id is not null and v2_booking_id is null)
    or
    (appointment_ref_type = 'v2_booking' and v2_booking_id is not null and appointment_id is null)
  )
);

create index if not exists scan_sessions_appointment_id_idx
  on scan_sessions(appointment_id);

create index if not exists scan_sessions_v2_booking_id_idx
  on scan_sessions(v2_booking_id);

create index if not exists scan_sessions_patient_id_idx
  on scan_sessions(patient_id);

create index if not exists scan_sessions_status_expires_at_idx
  on scan_sessions(status, expires_at);

alter table documents
  add column if not exists scan_session_id bigint references scan_sessions(id) on delete set null,
  add column if not exists page_count integer,
  add column if not exists scanner_name text,
  add column if not exists workstation_name text,
  add column if not exists app_version text;

create index if not exists documents_scan_session_id_idx
  on documents(scan_session_id);

alter table documents
  drop constraint if exists documents_source_check;

alter table documents
  add constraint documents_source_check
  check (source in ('manual_upload', 'naps2_webscan', 'scanner_app'));

insert into system_settings (category, setting_key, setting_value)
values
  ('documents_and_uploads', 'scanner_app_enabled', '{"value":"enabled"}'::jsonb),
  ('documents_and_uploads', 'scanner_app_download_url', '{"value":"/assets/downloads/RISproScannerSetup.msi"}'::jsonb),
  ('documents_and_uploads', 'scan_session_expiry_minutes', '{"value":"15"}'::jsonb)
on conflict (category, setting_key) do nothing;
