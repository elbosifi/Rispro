insert into system_settings (category, setting_key, setting_value)
values ('queue_and_arrival', 'no_show_grace_minutes', '{"value":"30"}'::jsonb)
on conflict (category, setting_key) do nothing;

create table if not exists appointments_v2.no_show_worker_state (
  singleton boolean primary key default true check (singleton = true),
  last_run_at timestamptz null,
  last_successful_run_at timestamptz null,
  last_processed_count integer not null default 0,
  last_error text null,
  updated_at timestamptz not null default now()
);
