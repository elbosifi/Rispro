alter table users
drop constraint if exists users_role_check;

alter table users
add constraint users_role_check
check (role in ('receptionist', 'supervisor', 'super_admin', 'modality_staff', 'doctor', 'administrative'));

update system_settings
set setting_value = jsonb_build_object('value', 'supervisor,super_admin,receptionist,modality_staff,doctor,administrative'),
    updated_at = now()
where category = 'users_and_roles'
  and setting_key = 'roles_enabled';

insert into system_settings (category, setting_key, setting_value)
values (
  'users_and_roles',
  'page_visibility_by_role',
  '{
    "value": {
      "dashboard": ["receptionist", "supervisor", "administrative", "super_admin"],
      "patients": ["receptionist", "supervisor", "doctor", "super_admin"],
      "appointments": ["receptionist", "supervisor", "super_admin"],
      "v2.appointments.admin": ["supervisor", "super_admin"],
      "calendar": ["receptionist", "supervisor", "super_admin"],
      "registrations": ["receptionist", "supervisor", "super_admin"],
      "queue": ["receptionist", "supervisor", "modality_staff", "super_admin"],
      "queue.checkin": ["receptionist", "supervisor", "super_admin"],
      "modality": ["modality_staff", "supervisor", "super_admin"],
      "doctor": ["doctor", "supervisor", "super_admin"],
      "print": ["receptionist", "supervisor", "doctor", "super_admin"],
      "statistics": ["administrative", "supervisor", "super_admin"],
      "pacs": ["supervisor", "doctor", "super_admin"],
      "legacy": ["supervisor", "super_admin"],
      "settings": ["super_admin"]
    }
  }'::jsonb
)
on conflict (category, setting_key) do nothing;
