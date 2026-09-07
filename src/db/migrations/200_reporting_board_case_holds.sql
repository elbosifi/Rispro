create table if not exists doctor_portal.reporting_board_case_holds (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  reason text not null,
  created_by_user_id bigint references users(id),
  created_by_doctor_id bigint references doctor_portal.doctor_profiles(id),
  created_at timestamptz not null default now(),
  cleared_by_user_id bigint references users(id),
  cleared_by_doctor_id bigint references doctor_portal.doctor_profiles(id),
  cleared_at timestamptz,
  clear_reason text,
  check (char_length(btrim(reason)) between 1 and 1000)
);

create unique index if not exists reporting_board_case_holds_active_idx
  on doctor_portal.reporting_board_case_holds(appointment_id)
  where cleared_at is null;
