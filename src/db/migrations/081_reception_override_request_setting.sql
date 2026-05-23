-- Gate receptionist deferred override requests from availability rows.

insert into system_settings (category, setting_key, setting_value)
values (
  'scheduling_and_capacity',
  'allow_reception_override_requests_from_availability',
  '{"value":"enabled"}'::jsonb
)
on conflict (category, setting_key) do nothing;
