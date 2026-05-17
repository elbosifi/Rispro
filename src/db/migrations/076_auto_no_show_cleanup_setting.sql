insert into system_settings (category, setting_key, setting_value)
values ('queue_and_arrival', 'auto_no_show_cleanup_days', '{"value":"1"}'::jsonb)
on conflict (category, setting_key) do nothing;
