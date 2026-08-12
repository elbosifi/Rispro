insert into system_settings (category, setting_key, setting_value)
values (
  'mwl_policy',
  'require_protocol_before_mwl_for_protocoling_modalities',
  '{"value":"disabled"}'::jsonb
)
on conflict (category, setting_key) do nothing;
