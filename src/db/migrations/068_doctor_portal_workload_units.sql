create table if not exists doctor_portal.workload_unit_catalog (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete restrict,
  exam_type_id bigint references exam_types(id) on delete restrict,
  case_category text,
  assignment_type text not null check (
    assignment_type in ('imaging', 'protocol', 'reporting', 'ultrasound_operator', 'mammography_episode')
  ),
  base_units numeric(8,2) not null check (base_units >= 0),
  report_required_multiplier numeric(8,2) not null default 1 check (report_required_multiplier >= 0),
  no_report_units numeric(8,2) not null default 0 check (no_report_units >= 0),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists workload_unit_catalog_lookup_idx
  on doctor_portal.workload_unit_catalog(modality_id, exam_type_id, case_category, assignment_type, active);

create table if not exists doctor_portal.case_workload_units (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  case_team_assignment_id bigint not null references doctor_portal.case_team_assignments(id) on delete cascade,
  roster_assignment_id bigint not null references doctor_portal.doctor_roster_assignments(id) on delete restrict,
  modality_id bigint not null references modalities(id) on delete restrict,
  exam_type_id bigint references exam_types(id) on delete restrict,
  case_category text,
  assignment_type text not null check (
    assignment_type in ('imaging', 'protocol', 'reporting', 'ultrasound_operator', 'mammography_episode')
  ),
  requires_report boolean not null,
  workload_units numeric(8,2) not null check (workload_units >= 0),
  source text not null default 'auto' check (source in ('auto', 'manual_adjustment')),
  status text not null default 'active' check (status in ('active', 'superseded', 'cancelled')),
  catalog_rule_id bigint references doctor_portal.workload_unit_catalog(id) on delete set null,
  defaulted boolean not null default false,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists case_workload_units_active_unique
  on doctor_portal.case_workload_units(case_team_assignment_id, assignment_type)
  where status = 'active';

create index if not exists case_workload_units_appointment_idx
  on doctor_portal.case_workload_units(appointment_id);

create index if not exists case_workload_units_case_assignment_idx
  on doctor_portal.case_workload_units(case_team_assignment_id);

create index if not exists case_workload_units_roster_assignment_idx
  on doctor_portal.case_workload_units(roster_assignment_id);

create index if not exists case_workload_units_modality_idx
  on doctor_portal.case_workload_units(modality_id);

create index if not exists case_workload_units_status_idx
  on doctor_portal.case_workload_units(status);

create index if not exists case_workload_units_calculated_idx
  on doctor_portal.case_workload_units(calculated_at);
