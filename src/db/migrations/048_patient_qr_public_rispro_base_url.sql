-- Patient QR appointment links must use a RISpro public base URL, not SonicDICOM URLs.

update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'risproPublicBaseUrl',
    coalesce(nullif(system_settings.setting_value->'value'->>'risproPublicBaseUrl', ''), 'https://rispro.nccb.com.ly')
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';
