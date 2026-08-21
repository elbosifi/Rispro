alter table appointments_v2.scheduling_override_requests
  add column override_types text[];

update appointments_v2.scheduling_override_requests
set override_types = array[override_type]
where override_types is null;

alter table appointments_v2.scheduling_override_requests
  alter column override_types set not null,
  add constraint scheduling_override_requests_override_types_check check (
    cardinality(override_types) >= 1
    and array_position(override_types, null) is null
    and override_types <@ array[
      'closed_weekday_override', 'category_override', 'total_capacity_override',
      'exam_mix_override', 'exam_restriction_override', 'modality_block_override'
    ]::text[]
    and override_type = override_types[1]
  );
