insert into system_settings (category, setting_key, setting_value)
values
  ('authoritative_orthanc', 'enabled', '{"value":"disabled"}'::jsonb),
  ('authoritative_orthanc', 'base_url', '{"value":""}'::jsonb),
  ('authoritative_orthanc', 'username', '{"value":""}'::jsonb),
  ('authoritative_orthanc', 'password', '{"value":""}'::jsonb),
  ('authoritative_orthanc', 'timeout_seconds', '{"value":"10"}'::jsonb),
  ('authoritative_orthanc', 'verify_tls', '{"value":"true"}'::jsonb),
  ('authoritative_orthanc', 'display_name', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;
