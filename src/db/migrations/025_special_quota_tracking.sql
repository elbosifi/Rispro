-- ---------------------------------------------------------------------------
-- Appointments V2 — Special quota consumption tracking
-- ---------------------------------------------------------------------------
-- Adds a flag to bookings indicating whether the booking consumed a special
-- quota slot instead of standard capacity. This enables the evaluator to
-- compute remaining special quota as (configured total - consumed count)
-- rather than always returning the configured total.
-- ---------------------------------------------------------------------------

alter table appointments_v2.bookings
  add column if not exists uses_special_quota boolean not null default false;

create index if not exists v2_bookings_special_quota_lookup
  on appointments_v2.bookings (modality_id, booking_date, case_category, exam_type_id)
  where status <> 'cancelled' and uses_special_quota = true;
