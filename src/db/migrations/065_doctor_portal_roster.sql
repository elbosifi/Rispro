create table if not exists doctor_portal.doctor_roster_weeks (
  id bigserial primary key,
  week_start_date date not null unique,
  week_end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by bigint references users(id) on delete set null,
  published_by bigint references users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end_date >= week_start_date)
);

create index if not exists doctor_roster_weeks_status_idx
  on doctor_portal.doctor_roster_weeks(status, week_start_date desc);

create table if not exists doctor_portal.doctor_roster_assignments (
  id bigserial primary key,
  roster_week_id bigint not null references doctor_portal.doctor_roster_weeks(id) on delete cascade,
  date date not null,
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
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doctor_roster_assignments_week_idx
  on doctor_portal.doctor_roster_assignments(roster_week_id, date, duty_type);

create table if not exists doctor_portal.doctor_roster_members (
  id bigserial primary key,
  roster_assignment_id bigint not null references doctor_portal.doctor_roster_assignments(id) on delete cascade,
  doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete restrict,
  team_role text not null check (team_role in ('lead', 'specialist', 'sho', 'supervisor', 'observer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_assignment_id, doctor_id)
);

create index if not exists doctor_roster_members_doctor_idx
  on doctor_portal.doctor_roster_members(doctor_id, roster_assignment_id);
