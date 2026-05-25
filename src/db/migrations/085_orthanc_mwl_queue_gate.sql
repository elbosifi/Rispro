insert into system_settings (category, setting_key, setting_value)
values
  ('orthanc_mwl_sync', 'send_only_when_patient_enters_queue', '{"value":"false"}'::jsonb)
on conflict (category, setting_key) do nothing;
