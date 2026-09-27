update system_settings
set setting_value = jsonb_set(
  setting_value,
  '{value}',
  coalesce(setting_value->'value', '{}'::jsonb) - 'risproPublicBaseUrl',
  true
)
where category = 'patient_qr_self_service'
  and setting_key = 'config'
  and setting_value->'value' ? 'risproPublicBaseUrl';
