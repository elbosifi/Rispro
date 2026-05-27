insert into system_settings (category, setting_key, setting_value)
values ('documents_and_uploads','storage_path','{"value":"/app/external-doc-validation"}'::jsonb)
on conflict (category, setting_key) do update set setting_value = excluded.setting_value;

insert into public.users (username, full_name, password_hash, role, is_active)
values ('restore_validation_backup_user', 'Backup User', 'x', 'receptionist', true)
on conflict (username) do nothing;

select count(*) as backup_user_count from public.users where username = 'restore_validation_backup_user';
select setting_value from system_settings where category='documents_and_uploads' and setting_key='storage_path';
