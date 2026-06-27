alter table appointments_v2.bookings
  add column if not exists arrived_at timestamptz,
  add column if not exists waiting_started_at timestamptz,
  add column if not exists completed_at timestamptz;

do $$
declare
  arrived_backfilled integer := 0;
  waiting_started_backfilled integer := 0;
  completed_backfilled integer := 0;
  missing_arrived integer := 0;
  missing_completed integer := 0;
begin
  with status_times as (
    select
      audit_log.entity_id as booking_id,
      min(audit_log.created_at) as arrived_at
    from audit_log
    where audit_log.entity_type = 'appointment_v2_booking'
      and audit_log.new_values->>'status' in ('arrived', 'waiting')
    group by audit_log.entity_id
  ),
  updated as (
    update appointments_v2.bookings b
    set arrived_at = status_times.arrived_at
    from status_times
    where b.id = status_times.booking_id
      and b.arrived_at is null
    returning 1
  )
  select count(*) into arrived_backfilled from updated;

  with status_times as (
    select
      audit_log.entity_id as booking_id,
      min(audit_log.created_at) as waiting_started_at
    from audit_log
    where audit_log.entity_type = 'appointment_v2_booking'
      and audit_log.new_values->>'status' = 'waiting'
    group by audit_log.entity_id
  ),
  updated as (
    update appointments_v2.bookings b
    set waiting_started_at = status_times.waiting_started_at
    from status_times
    where b.id = status_times.booking_id
      and b.waiting_started_at is null
    returning 1
  )
  select count(*) into waiting_started_backfilled from updated;

  -- Use the first completed audit event as the operational completed_at.
  -- Later reopen/re-complete cycles are status history, not the first completion time.
  with status_times as (
    select
      audit_log.entity_id as booking_id,
      min(audit_log.created_at) as completed_at
    from audit_log
    where audit_log.entity_type = 'appointment_v2_booking'
      and audit_log.new_values->>'status' = 'completed'
    group by audit_log.entity_id
  ),
  updated as (
    update appointments_v2.bookings b
    set completed_at = status_times.completed_at
    from status_times
    where b.id = status_times.booking_id
      and b.completed_at is null
    returning 1
  )
  select count(*) into completed_backfilled from updated;

  select count(*) into missing_arrived
  from appointments_v2.bookings
  where status in ('arrived', 'waiting')
    and arrived_at is null;

  select count(*) into missing_completed
  from appointments_v2.bookings
  where status = 'completed'
    and completed_at is null;

  raise notice 'appointments_v2 booking workflow timestamps backfill: arrived_at from audit_log=%, waiting_started_at from audit_log=%, completed_at from audit_log=%',
    arrived_backfilled,
    waiting_started_backfilled,
    completed_backfilled;
  raise notice 'appointments_v2 booking workflow timestamps still missing: arrived/waiting without arrived_at=%, completed without completed_at=%',
    missing_arrived,
    missing_completed;
end $$;
