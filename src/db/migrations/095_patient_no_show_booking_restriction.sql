alter table patients
add column if not exists no_show_count integer not null default 0,
add column if not exists no_show_booking_blocked boolean not null default false,
add column if not exists no_show_block_reset_at timestamptz,
add column if not exists no_show_block_reset_by bigint references users(id),
add column if not exists no_show_block_reset_reason text;

create table if not exists patient_no_show_events (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  appointment_id bigint references appointments_v2.bookings(id) on delete set null,
  event_type text not null check (
    event_type in (
      'no_show_marked',
      'no_show_count_incremented',
      'booking_restriction_activated',
      'booking_restriction_authorized'
    )
  ),
  reason text,
  created_by bigint references users(id),
  created_at timestamptz not null default now()
);

create index if not exists patient_no_show_events_patient_created_idx
  on patient_no_show_events(patient_id, created_at desc);
