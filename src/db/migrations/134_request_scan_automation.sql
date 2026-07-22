create table if not exists request_scan_jobs (
  id bigserial primary key,
  filename text not null,
  source_relative_path text not null,
  mime_type text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'duplicate', 'failed')),
  barcode_value text,
  appointment_id bigint references appointments_v2.bookings(id) on delete set null,
  document_id bigint references documents(id) on delete set null,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists request_scan_jobs_source_relative_path_key on request_scan_jobs(source_relative_path);
create index if not exists request_scan_jobs_status_created_at_idx on request_scan_jobs(status, created_at desc);

alter table documents drop constraint if exists documents_source_check;
alter table documents add constraint documents_source_check
  check (source in ('manual_upload', 'naps2_webscan', 'scanner_app', 'request_scan_automation'));

insert into system_settings (category, setting_key, setting_value)
values
  ('request_scan_automation', 'enabled', '{"value":"disabled"}'::jsonb),
  ('request_scan_automation', 'server', '{"value":""}'::jsonb),
  ('request_scan_automation', 'share', '{"value":""}'::jsonb),
  ('request_scan_automation', 'domain', '{"value":""}'::jsonb),
  ('request_scan_automation', 'username', '{"value":""}'::jsonb),
  ('request_scan_automation', 'password_encrypted', '{"value":""}'::jsonb),
  ('request_scan_automation', 'incoming_subfolder', '{"value":"Requests/Incoming"}'::jsonb),
  ('request_scan_automation', 'processed_subfolder', '{"value":"Requests/Processed"}'::jsonb),
  ('request_scan_automation', 'failed_subfolder', '{"value":"Requests/Failed"}'::jsonb),
  ('request_scan_automation', 'polling_interval_seconds', '{"value":"15"}'::jsonb),
  ('request_scan_automation', 'file_ready_delay_seconds', '{"value":"15"}'::jsonb)
on conflict (category, setting_key) do nothing;
