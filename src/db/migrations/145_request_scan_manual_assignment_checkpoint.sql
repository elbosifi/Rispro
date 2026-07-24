alter table request_scan_jobs
  add column if not exists manual_assignment_requested_at timestamptz,
  add column if not exists manual_assignment_requested_by bigint references users(id) on delete set null,
  add column if not exists manual_assignment_confirmed_at timestamptz,
  add column if not exists manual_assignment_appointment_id bigint references appointments_v2.bookings(id) on delete set null;

create index if not exists request_scan_jobs_manual_assignment_idx
  on request_scan_jobs(manual_assignment_appointment_id)
  where manual_assignment_appointment_id is not null;
