alter table appointments_v2.override_audit_events
add column if not exists override_type text;

update appointments_v2.override_audit_events
set override_type = coalesce(override_type, 'closed_weekday_override');

alter table appointments_v2.override_audit_events
alter column override_type set not null;

alter table appointments_v2.override_audit_events
drop constraint if exists appointments_v2_override_audit_events_override_type_check;

alter table appointments_v2.override_audit_events
add constraint appointments_v2_override_audit_events_override_type_check
check (override_type in ('closed_weekday_override', 'category_override', 'total_capacity_override'));
