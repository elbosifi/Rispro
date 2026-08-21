alter table appointments_v2.override_audit_events
  drop constraint if exists override_audit_events_override_type_check;

alter table appointments_v2.override_audit_events
  drop constraint if exists appointments_v2_override_audit_events_override_type_check;

alter table appointments_v2.override_audit_events
  add constraint override_audit_events_override_type_check
  check (override_type in ('closed_weekday_override', 'category_override', 'exam_mix_override', 'exam_restriction_override', 'total_capacity_override'));
