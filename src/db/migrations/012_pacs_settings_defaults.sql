insert into system_settings (category, setting_key, setting_value)
values
  ('pacs_connection', 'enabled', '{"value":"enabled"}'::jsonb),
  ('pacs_connection', 'host', '{"value":"192.9.101.164"}'::jsonb),
  ('pacs_connection', 'port', '{"value":"103"}'::jsonb),
  ('pacs_connection', 'called_ae_title', '{"value":"osirixr"}'::jsonb),
  ('pacs_connection', 'calling_ae_title', '{"value":"RISPRO"}'::jsonb),
  ('pacs_connection', 'timeout_seconds', '{"value":"10"}'::jsonb)
on conflict (category, setting_key) do nothing;
