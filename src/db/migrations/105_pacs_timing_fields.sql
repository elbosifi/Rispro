alter table appointments_v2.bookings
  add column if not exists pacs_study_started_at timestamptz,
  add column if not exists pacs_first_seen_at timestamptz,
  add column if not exists pacs_timing_source text,
  add column if not exists pacs_timing_confidence text,
  add column if not exists pacs_timing_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_pacs_timing_confidence_check'
  ) then
    alter table appointments_v2.bookings
      add constraint bookings_pacs_timing_confidence_check
      check (pacs_timing_confidence is null or pacs_timing_confidence in ('high', 'medium', 'low'));
  end if;
end $$;
