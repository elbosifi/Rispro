update system_settings
set setting_value = '{"value":"enabled"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'enabled';
