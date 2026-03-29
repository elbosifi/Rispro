update system_settings
set setting_value = '{"value":"enabled"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'enabled';

update system_settings
set setting_value = '{"value":"192.9.101.164"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'host';

update system_settings
set setting_value = '{"value":"103"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'port';

update system_settings
set setting_value = '{"value":"osirixr"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'called_ae_title';

update system_settings
set setting_value = '{"value":"RISPRO"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'calling_ae_title';

update system_settings
set setting_value = '{"value":"10"}'::jsonb
where category = 'pacs_connection'
  and setting_key = 'timeout_seconds';
