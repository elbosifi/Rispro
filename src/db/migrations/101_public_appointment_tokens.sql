create table if not exists appointments_v2.public_appointment_tokens (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  revoked_by_user_id bigint references users(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists public_appointment_tokens_booking_idx
  on appointments_v2.public_appointment_tokens (booking_id);

update system_settings
set setting_value = jsonb_set(
  coalesce(setting_value, '{}'::jsonb),
  '{value}',
  coalesce(setting_value->'value', '{}'::jsonb) || '{"publicLinkValidityDays": 14}'::jsonb,
  true
)
where category = 'patient_qr_self_service'
  and setting_key = 'config'
  and not (coalesce(setting_value->'value', '{}'::jsonb) ? 'publicLinkValidityDays');
