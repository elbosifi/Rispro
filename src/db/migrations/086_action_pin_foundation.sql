create table if not exists user_action_pins (
  user_id bigint primary key references users(id) on delete cascade,
  pin_hash text not null,
  pin_rotated_at timestamptz not null default now(),
  pin_expires_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_user_id bigint references users(id)
);

create index if not exists user_action_pins_locked_until_idx
  on user_action_pins (locked_until)
  where locked_until is not null;

create table if not exists action_pin_verifications (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  action_key text,
  reason text,
  verification_token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

create index if not exists action_pin_verifications_lookup_idx
  on action_pin_verifications (user_id, verification_token_hash, expires_at)
  where consumed_at is null;

create index if not exists action_pin_verifications_action_idx
  on action_pin_verifications (user_id, action_key, expires_at)
  where consumed_at is null;

insert into system_settings (category, setting_key, setting_value)
values (
  'users_and_roles',
  'action_pin_policy',
  '{
    "value": {
      "enabled": false,
      "pinLength": 4,
      "rotationMode": "manual",
      "rotationIntervalDays": 0,
      "expirePinAfterRotation": false,
      "verificationTtlSeconds": 300,
      "idleLockEnabled": false,
      "idleLockSeconds": 180,
      "maxFailedAttempts": 5,
      "lockoutMinutes": 15,
      "allowUserPinChange": true,
      "allowUserPinRegenerate": false,
      "requirePinToViewOwnPinSettings": false,
      "notifyUserOnPinChange": false,
      "actionModes": {},
      "reasonRequiredModes": {},
      "disabledForRoleModes": {}
    }
  }'::jsonb
)
on conflict (category, setting_key) do nothing;
