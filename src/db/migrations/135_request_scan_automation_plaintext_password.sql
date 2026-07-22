insert into system_settings (category, setting_key, setting_value)
values ('request_scan_automation', 'password', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;
