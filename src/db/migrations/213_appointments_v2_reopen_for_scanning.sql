alter table appointments_v2.bookings
  add column if not exists reopened_for_scanning_at timestamptz;
