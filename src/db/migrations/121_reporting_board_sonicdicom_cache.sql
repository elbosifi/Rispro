create table if not exists doctor_portal.reporting_board_sonicdicom_cache (
  appointment_id bigint primary key references appointments_v2.bookings(id) on delete cascade,
  report_status text not null default 'unavailable',
  report_final_at timestamptz,
  sonicdicom_study_note text,
  source text not null default 'sonicdicom',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_check_at timestamptz not null default now(),
  status_changed_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  study_instance_uid_snapshot text,
  accession_number_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_board_sonicdicom_cache_status_check
    check (report_status in ('final', 'draft', 'no_report', 'study_not_found', 'unavailable')),
  constraint reporting_board_sonicdicom_cache_failure_count_check check (failure_count >= 0)
);

create index if not exists reporting_board_sonicdicom_cache_due_idx
  on doctor_portal.reporting_board_sonicdicom_cache(next_check_at, appointment_id);
create index if not exists reporting_board_sonicdicom_cache_identity_idx
  on doctor_portal.reporting_board_sonicdicom_cache(study_instance_uid_snapshot, accession_number_snapshot);

comment on table doctor_portal.reporting_board_sonicdicom_cache is
  'Durable SonicDICOM report-status and study-note cache for appointment Reporting Board reads. Manual final overrides remain in their own authoritative table.';
