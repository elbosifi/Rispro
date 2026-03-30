alter table appointments
drop constraint if exists appointments_status_check;

alter table appointments
add constraint appointments_status_check check (
  status in ('scheduled', 'arrived', 'waiting', 'in-progress', 'completed', 'discontinued', 'no-show', 'cancelled')
);

alter table appointments
add column if not exists scan_started_at timestamptz,
add column if not exists scan_finished_at timestamptz,
add column if not exists mpps_sop_instance_uid text,
add column if not exists scheduled_station_ae_title text;

create table if not exists dicom_devices (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete cascade,
  device_name text not null,
  modality_ae_title text not null unique,
  scheduled_station_ae_title text not null,
  station_name text,
  station_location text,
  source_ip text,
  mwl_enabled boolean not null default true,
  mpps_enabled boolean not null default true,
  is_active boolean not null default true,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dicom_devices_modality_id_idx
  on dicom_devices (modality_id);

create table if not exists dicom_message_log (
  id bigserial primary key,
  source_type text not null check (source_type in ('mpps')),
  source_path text,
  event_type text not null,
  source_ip text,
  remote_ae_title text,
  device_id bigint references dicom_devices(id) on delete set null,
  appointment_id bigint references appointments(id) on delete set null,
  accession_number text,
  mpps_sop_instance_uid text,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received' check (
    processing_status in ('received', 'processed', 'ignored', 'failed')
  ),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists dicom_message_log_appointment_id_idx
  on dicom_message_log (appointment_id);

create index if not exists dicom_message_log_mpps_uid_idx
  on dicom_message_log (mpps_sop_instance_uid);

insert into system_settings (category, setting_key, setting_value)
values
  ('dicom_gateway', 'enabled', '{"value":"enabled"}'::jsonb),
  ('dicom_gateway', 'bind_host', '{"value":"0.0.0.0"}'::jsonb),
  ('dicom_gateway', 'mwl_ae_title', '{"value":"RISPRO_MWL"}'::jsonb),
  ('dicom_gateway', 'mwl_port', '{"value":"11112"}'::jsonb),
  ('dicom_gateway', 'mpps_ae_title', '{"value":"RISPRO_MPPS"}'::jsonb),
  ('dicom_gateway', 'mpps_port', '{"value":"11113"}'::jsonb),
  ('dicom_gateway', 'worklist_output_dir', '{"value":"storage/dicom/worklists"}'::jsonb),
  ('dicom_gateway', 'worklist_source_dir', '{"value":"storage/dicom/worklist-source"}'::jsonb),
  ('dicom_gateway', 'mpps_inbox_dir', '{"value":"storage/dicom/mpps/inbox"}'::jsonb),
  ('dicom_gateway', 'mpps_processed_dir', '{"value":"storage/dicom/mpps/processed"}'::jsonb),
  ('dicom_gateway', 'mpps_failed_dir', '{"value":"storage/dicom/mpps/failed"}'::jsonb),
  ('dicom_gateway', 'callback_secret', '{"value":"change-me-dicom-callback"}'::jsonb),
  ('dicom_gateway', 'rebuild_behavior', '{"value":"incremental_on_write"}'::jsonb),
  ('dicom_gateway', 'dump2dcm_command', '{"value":"dump2dcm"}'::jsonb),
  ('dicom_gateway', 'dcmdump_command', '{"value":"dcmdump"}'::jsonb)
on conflict (category, setting_key) do nothing;
