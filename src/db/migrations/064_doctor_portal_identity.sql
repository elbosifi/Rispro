create schema if not exists doctor_portal;

create table if not exists doctor_portal.doctor_profiles (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete restrict,
  display_name text not null,
  doctor_role text not null check (doctor_role in ('consultant', 'specialist', 'senior_house_officer', 'resident')),
  active boolean not null default true,
  can_finalize_reports boolean not null default false,
  can_assign_protocols boolean not null default false,
  can_supervise boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doctor_profiles_active_user_idx
  on doctor_portal.doctor_profiles(user_id)
  where active = true;

create table if not exists doctor_portal.doctor_modality_permissions (
  id bigserial primary key,
  doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete cascade,
  modality_id bigint not null references modalities(id) on delete restrict,
  can_protocol boolean not null default false,
  can_report boolean not null default false,
  can_supervise boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_id, modality_id)
);

create index if not exists doctor_modality_permissions_doctor_idx
  on doctor_portal.doctor_modality_permissions(doctor_id, active);

create table if not exists doctor_portal.doctor_module_audit_events (
  id bigserial primary key,
  actor_user_id bigint references users(id) on delete set null,
  actor_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  event_type text not null,
  target_type text not null,
  target_id bigint,
  metadata_json jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists doctor_module_audit_events_target_idx
  on doctor_portal.doctor_module_audit_events(target_type, target_id, created_at desc);
