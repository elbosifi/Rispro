create table if not exists action_pin_idle_locks (
  user_id bigint primary key references users(id) on delete cascade,
  locked_at timestamptz not null default now(),
  unlocked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists action_pin_idle_locks_active_idx
  on action_pin_idle_locks (user_id)
  where unlocked_at is null;

update system_settings
set setting_value = jsonb_set(
  coalesce(setting_value, '{}'::jsonb),
  '{value}',
  coalesce(setting_value->'value', '{}'::jsonb) || '{
    "idleLockRoleMode": "all",
    "idleLockRoles": [],
    "idleLockUserIds": [],
    "idleLockExcludedUserIds": []
  }'::jsonb,
  true
)
where category = 'users_and_roles'
  and setting_key = 'action_pin_policy';
