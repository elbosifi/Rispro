create table if not exists sante_hl7_outbox (
  id bigserial primary key,
  booking_id bigint references appointments_v2.bookings(id) on delete set null,
  event_type text not null check (event_type in ('create', 'update', 'cancel', 'test')),
  order_control text not null check (order_control in ('NW', 'XO', 'CA')),
  status text not null check (
    status in (
      'pending',
      'writing',
      'written',
      'pending_import',
      'imported_assumed',
      'imported_done',
      'import_failed',
      'pending_timeout',
      'retry_scheduled',
      'dead_letter',
      'skipped'
    )
  ),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  payload_hash text,
  message_control_id text,
  file_stem text,
  final_extension text not null default '.hl7',
  target_path text,
  tmp_path text,
  observed_path text,
  last_file_state text,
  last_error text,
  scheduled_date date,
  modality_code text,
  accession_number text,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sante_hl7_outbox_status_retry_idx
  on sante_hl7_outbox (status, next_attempt_at asc, id asc);

create index if not exists sante_hl7_outbox_booking_idx
  on sante_hl7_outbox (booking_id, created_at desc);

create index if not exists sante_hl7_outbox_reconcile_idx
  on sante_hl7_outbox (scheduled_date, modality_code, accession_number);

create table if not exists sante_worklist_sync (
  id bigserial primary key,
  booking_id bigint references appointments_v2.bookings(id) on delete cascade,
  sync_status text not null check (
    sync_status in (
      'pending',
      'written',
      'imported_assumed',
      'imported_done',
      'import_failed',
      'pending_timeout',
      'retry_scheduled',
      'dead_letter',
      'skipped'
    )
  ),
  payload_hash text,
  last_outbox_id bigint references sante_hl7_outbox(id) on delete set null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists sante_worklist_sync_status_idx
  on sante_worklist_sync (sync_status, updated_at desc);

