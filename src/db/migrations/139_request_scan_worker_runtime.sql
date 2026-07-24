create table if not exists request_scan_worker_runtime (
  singleton_key smallint primary key default 1 check (singleton_key = 1),
  request_sequence bigint not null default 0 check (request_sequence >= 0),
  acknowledged_sequence bigint not null default 0 check (acknowledged_sequence >= 0 and acknowledged_sequence <= request_sequence),
  run_requested_at timestamptz,
  worker_id text,
  worker_started_at timestamptz,
  worker_heartbeat_at timestamptz,
  cycle_started_at timestamptz,
  cycle_completed_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into request_scan_worker_runtime(singleton_key)
values (1)
on conflict (singleton_key) do nothing;
