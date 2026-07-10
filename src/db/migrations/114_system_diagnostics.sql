create table if not exists system_diagnostic_events (
  id bigserial primary key,
  event_id uuid not null unique,
  occurred_at timestamptz not null default now(),
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  source text not null,
  component text not null,
  operation text,
  request_id uuid,
  route text,
  http_method text,
  status_code integer,
  user_id bigint references users(id) on delete set null,
  error_name text,
  error_code text,
  message text not null,
  technical_details text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by_user_id bigint references users(id) on delete set null,
  resolution_note text
);

create index if not exists system_diagnostic_events_occurred_at_idx on system_diagnostic_events (occurred_at desc);
create index if not exists system_diagnostic_events_severity_idx on system_diagnostic_events (severity);
create index if not exists system_diagnostic_events_source_component_idx on system_diagnostic_events (source, component);
create index if not exists system_diagnostic_events_request_id_idx on system_diagnostic_events (request_id);
create index if not exists system_diagnostic_events_unresolved_idx on system_diagnostic_events (occurred_at desc) where resolved_at is null;
