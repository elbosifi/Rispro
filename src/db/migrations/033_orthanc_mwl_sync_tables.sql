create table if not exists external_mwl_sync (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  external_system text not null check (external_system in ('orthanc')),
  external_worklist_id text,
  sync_status text not null check (sync_status in ('pending', 'in_progress', 'synced', 'failed', 'deleted')),
  payload_hash text,
  last_synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, external_system)
);

create index if not exists external_mwl_sync_system_status_idx
  on external_mwl_sync (external_system, sync_status, updated_at desc);

create table if not exists external_mwl_outbox (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  external_system text not null check (external_system in ('orthanc')),
  operation text not null check (operation in ('upsert', 'delete')),
  status text not null check (status in ('pending', 'processing', 'failed', 'completed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  payload_hash text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_mwl_outbox_status_retry_idx
  on external_mwl_outbox (external_system, status, next_attempt_at asc, id asc);

create index if not exists external_mwl_outbox_booking_idx
  on external_mwl_outbox (booking_id, external_system, created_at desc);
