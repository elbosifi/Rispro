create table if not exists doctor_portal.case_team_assignments (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  roster_assignment_id bigint not null references doctor_portal.doctor_roster_assignments(id) on delete restrict,
  modality_id bigint not null references modalities(id) on delete restrict,
  assignment_type text not null check (
    assignment_type in ('imaging', 'protocol', 'reporting', 'ultrasound_operator', 'mammography_episode')
  ),
  expected_reporting_date date,
  assigned_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'superseded', 'corrected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists case_team_assignments_active_unique
  on doctor_portal.case_team_assignments(appointment_id, assignment_type)
  where status = 'active';

create index if not exists case_team_assignments_appointment_idx
  on doctor_portal.case_team_assignments(appointment_id);

create index if not exists case_team_assignments_roster_assignment_idx
  on doctor_portal.case_team_assignments(roster_assignment_id);

create index if not exists case_team_assignments_modality_idx
  on doctor_portal.case_team_assignments(modality_id);

create index if not exists case_team_assignments_expected_reporting_idx
  on doctor_portal.case_team_assignments(expected_reporting_date);

create index if not exists case_team_assignments_status_idx
  on doctor_portal.case_team_assignments(status);
