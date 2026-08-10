create table if not exists cd_robot_deliveries (
  id bigserial primary key,
  patient_id bigint not null references patients(id),
  booking_id bigint not null references appointments_v2.bookings(id),
  study_instance_uid text,
  destination_key text not null,
  orthanc_study_id text,
  orthanc_job_id text,
  status text not null check (status in ('sending', 'success', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  resend_reason_code text,
  resend_reason_text text,
  requested_by_user_id bigint not null references users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cd_robot_deliveries_one_active_patient_idx
  on cd_robot_deliveries (patient_id)
  where status = 'sending';

create index if not exists cd_robot_deliveries_sending_monitor_idx
  on cd_robot_deliveries (last_checked_at asc nulls first, requested_at asc)
  where status = 'sending' and orthanc_job_id is not null;

create index if not exists cd_robot_deliveries_booking_history_idx
  on cd_robot_deliveries (booking_id, requested_at desc);
