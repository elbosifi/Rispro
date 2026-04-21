insert into system_settings (category, setting_key, setting_value)
values ('patient_registration', 'mrn_prefix', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;
