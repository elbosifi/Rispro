create table if not exists doctor_portal.roster_templates (
  id bigserial primary key,
  name text not null,
  description text,
  modality_id bigint references modalities(id) on delete restrict,
  template_type text not null check (
    template_type in ('ct_weekly', 'mri_weekly', 'ultrasound_weekly', 'mammography_weekly', 'mixed_weekly', 'custom')
  ),
  active boolean not null default true,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roster_templates_active_type_idx
  on doctor_portal.roster_templates(active, template_type, name);

create table if not exists doctor_portal.roster_template_assignments (
  id bigserial primary key,
  template_id bigint not null references doctor_portal.roster_templates(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 1 and 7),
  modality_id bigint references modalities(id) on delete restrict,
  duty_type text not null check (
    duty_type in (
      'ct_protocol_day',
      'ct_reporting_day',
      'mri_supervision_reporting',
      'ultrasound_term_1',
      'ultrasound_term_2',
      'ultrasound_term_3',
      'mammography_session',
      'general_reporting',
      'on_call',
      'leave',
      'admin',
      'teaching'
    )
  ),
  session_name text,
  start_time time,
  end_time time,
  team_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index if not exists roster_template_assignments_template_idx
  on doctor_portal.roster_template_assignments(template_id, day_of_week, sort_order, id);

create table if not exists doctor_portal.roster_template_members (
  id bigserial primary key,
  template_assignment_id bigint not null references doctor_portal.roster_template_assignments(id) on delete cascade,
  doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  team_role text not null check (team_role in ('lead', 'specialist', 'sho', 'supervisor', 'observer')),
  placeholder_label text,
  required_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roster_template_members_assignment_idx
  on doctor_portal.roster_template_members(template_assignment_id, id);

create index if not exists roster_template_members_doctor_idx
  on doctor_portal.roster_template_members(doctor_id)
  where doctor_id is not null;
