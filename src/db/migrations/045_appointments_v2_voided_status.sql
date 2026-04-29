alter table appointments_v2.bookings
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_user_id bigint references users(id),
  add column if not exists void_reason text;

alter table appointments_v2.bookings
  drop constraint if exists bookings_status_check;

alter table appointments_v2.bookings
  add constraint bookings_status_check
  check (status in ('scheduled', 'arrived', 'waiting', 'completed', 'no-show', 'cancelled', 'discontinued', 'voided'));

drop index if exists appointments_v2.v2_bookings_bucket_idx;

create index if not exists v2_bookings_bucket_idx
  on appointments_v2.bookings(modality_id, booking_date, case_category)
  where status not in ('cancelled', 'discontinued', 'voided');

drop index if exists appointments_v2.v2_bookings_special_quota_lookup;

create index if not exists v2_bookings_special_quota_lookup
  on appointments_v2.bookings (modality_id, booking_date, case_category, exam_type_id)
  where status not in ('cancelled', 'discontinued', 'voided') and uses_special_quota = true;
