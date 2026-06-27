alter table appointments_v2.bookings
  add column if not exists arrived_at timestamptz,
  add column if not exists waiting_started_at timestamptz,
  add column if not exists completed_at timestamptz;

update appointments_v2.bookings b
set arrived_at = status_times.arrived_at
from (
  select
    audit_log.entity_id as booking_id,
    min(audit_log.created_at) as arrived_at
  from audit_log
  where audit_log.entity_type = 'appointment_v2_booking'
    and audit_log.new_values->>'status' in ('arrived', 'waiting')
  group by audit_log.entity_id
) status_times
where b.id = status_times.booking_id
  and b.arrived_at is null;

update appointments_v2.bookings b
set waiting_started_at = status_times.waiting_started_at
from (
  select
    audit_log.entity_id as booking_id,
    min(audit_log.created_at) as waiting_started_at
  from audit_log
  where audit_log.entity_type = 'appointment_v2_booking'
    and audit_log.new_values->>'status' = 'waiting'
  group by audit_log.entity_id
) status_times
where b.id = status_times.booking_id
  and b.waiting_started_at is null;

-- Use the latest completed audit event to preserve the modality worklist's existing
-- behavior when a completed booking was reopened and completed again.
update appointments_v2.bookings b
set completed_at = status_times.completed_at
from (
  select
    audit_log.entity_id as booking_id,
    max(audit_log.created_at) as completed_at
  from audit_log
  where audit_log.entity_type = 'appointment_v2_booking'
    and audit_log.new_values->>'status' = 'completed'
  group by audit_log.entity_id
) status_times
where b.id = status_times.booking_id
  and b.completed_at is null;
