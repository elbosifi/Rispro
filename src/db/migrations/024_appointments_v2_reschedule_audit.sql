-- ---------------------------------------------------------------------------
-- Appointments V2 reschedule audit events
-- ---------------------------------------------------------------------------

create table if not exists appointments_v2.reschedule_audit_events (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  previous_date date not null,
  previous_time time,
  new_date date not null,
  new_time time,
  changed_by_user_id bigint references users(id),
  changed_at timestamptz not null default now(),
  override_used boolean not null default false,
  supervisor_user_id bigint references users(id),
  reason text
);

create index if not exists v2_reschedule_audit_booking_idx
  on appointments_v2.reschedule_audit_events(booking_id);

create index if not exists v2_reschedule_audit_changed_at_idx
  on appointments_v2.reschedule_audit_events(changed_at desc);
