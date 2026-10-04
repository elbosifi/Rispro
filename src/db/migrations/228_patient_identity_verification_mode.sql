insert into system_settings (category, setting_key, setting_value)
values ('patient_registration', 'patient_identity_verification_mode', '{"value":"ambiguous_only"}'::jsonb)
on conflict (category, setting_key) do nothing;
