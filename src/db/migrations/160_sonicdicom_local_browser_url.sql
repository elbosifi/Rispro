update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object('sonicDicomLocalBaseUrl', '')
)
where category = 'sonicdicom_reports'
  and setting_key = 'config'
  and not coalesce(system_settings.setting_value->'value', '{}'::jsonb) ? 'sonicDicomLocalBaseUrl';
