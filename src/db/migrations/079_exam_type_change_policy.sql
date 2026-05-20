-- Appointments V2 exam type change policy default

insert into system_settings (category, setting_key, setting_value)
values (
  'scheduling_and_capacity',
  'exam_type_change_policy',
  '{"value":"allowed_without_supervisor"}'::jsonb
)
on conflict (category, setting_key) do nothing;
