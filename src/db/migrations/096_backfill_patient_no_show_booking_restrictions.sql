with no_show_summary as (
  select
    patient_id,
    count(*)::integer as no_show_count
  from appointments_v2.bookings
  where status = 'no-show'
  group by patient_id
)
update patients p
set
  no_show_count = greatest(p.no_show_count, no_show_summary.no_show_count),
  no_show_booking_blocked = case
    when p.no_show_block_reset_at is null then true
    else p.no_show_booking_blocked
  end,
  updated_at = now()
from no_show_summary
where p.id = no_show_summary.patient_id;

insert into patient_no_show_events (patient_id, appointment_id, event_type, reason, created_by, created_at)
select
  b.patient_id,
  b.id,
  event_type.event_type,
  'Backfilled from existing no-show appointment history.',
  null,
  now()
from appointments_v2.bookings b
cross join (
  values
    ('no_show_marked'),
    ('no_show_count_incremented')
) as event_type(event_type)
where b.status = 'no-show'
  and not exists (
    select 1
    from patient_no_show_events existing
    where existing.appointment_id = b.id
      and existing.event_type = event_type.event_type
  );

insert into patient_no_show_events (patient_id, appointment_id, event_type, reason, created_by, created_at)
select distinct on (b.patient_id)
  b.patient_id,
  b.id,
  'booking_restriction_activated',
  'Backfilled from existing no-show appointment history.',
  null,
  now()
from appointments_v2.bookings b
where b.status = 'no-show'
  and not exists (
    select 1
    from patient_no_show_events existing
    where existing.patient_id = b.patient_id
      and existing.event_type = 'booking_restriction_activated'
  )
order by b.patient_id, b.booking_date desc, b.id desc;
