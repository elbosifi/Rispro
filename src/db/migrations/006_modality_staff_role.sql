alter table users
drop constraint if exists users_role_check;

alter table users
add constraint users_role_check
check (role in ('receptionist', 'supervisor', 'modality_staff'));

update system_settings
set setting_value = jsonb_build_object('value', 'supervisor,receptionist,modality_staff'),
    updated_at = now()
where category = 'users_and_roles'
  and setting_key = 'roles_enabled';
