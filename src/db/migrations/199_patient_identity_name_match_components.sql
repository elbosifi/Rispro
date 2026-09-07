insert into system_settings (category, setting_key, setting_value)
values ('patient_registration', 'patient_identity_name_match_components', '{"value":"3"}'::jsonb)
on conflict (category, setting_key) do nothing;
