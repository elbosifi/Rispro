create table if not exists queue_entries (
  id bigserial primary key,
  appointment_id bigint not null unique references appointments(id) on delete cascade,
  queue_date date not null,
  queue_number integer not null,
  queue_status text not null default 'waiting',
  scanned_at timestamptz not null default now(),
  queued_by_user_id bigint references users(id),
  updated_at timestamptz not null default now(),
  constraint queue_entries_status_check check (queue_status in ('waiting', 'called', 'in-progress', 'removed')),
  constraint queue_entries_unique_number unique (queue_date, queue_number)
);
