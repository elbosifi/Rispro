insert into system_settings (category, setting_key, setting_value)
values
  ('orthanc_mwl_sync', 'enabled', '{"value":"false"}'::jsonb),
  ('orthanc_mwl_sync', 'shadow_mode', '{"value":"false"}'::jsonb),
  ('orthanc_mwl_sync', 'base_url', '{"value":""}'::jsonb),
  ('orthanc_mwl_sync', 'username', '{"value":""}'::jsonb),
  ('orthanc_mwl_sync', 'password', '{"value":""}'::jsonb),
  ('orthanc_mwl_sync', 'timeout_seconds', '{"value":"10"}'::jsonb),
  ('orthanc_mwl_sync', 'verify_tls', '{"value":"true"}'::jsonb),
  ('orthanc_mwl_sync', 'worklist_target', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;
