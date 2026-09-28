insert into system_settings (category, setting_key, setting_value)
values (
  'deployment_identity',
  'public_app_base_url',
  '{"value":"https://rispro.nccb.com.ly"}'::jsonb
)
on conflict (category, setting_key) do nothing;
