update system_settings
set setting_value = jsonb_set(
  jsonb_set(setting_value, '{qrModalityMode}', to_jsonb(coalesce(setting_value->>'qrModalityMode', 'all')), true),
  '{qrModalityIds}',
  case
    when jsonb_typeof(setting_value->'qrModalityIds') = 'array' then setting_value->'qrModalityIds'
    else '[]'::jsonb
  end,
  true
)
where category = 'appointment_slip'
  and setting_key = 'config';
