create table if not exists doctor_portal.roster_duty_types (
  code text primary key,
  label text not null,
  active boolean not null default true,
  requires_specialist boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into doctor_portal.roster_duty_types (code, label, active)
select distinct duty_type, initcap(replace(duty_type, '_', ' ')), true
from doctor_portal.doctor_roster_assignments
on conflict (code) do nothing;

insert into doctor_portal.roster_duty_types (code, label, active)
select distinct duty_type, initcap(replace(duty_type, '_', ' ')), true
from doctor_portal.roster_template_assignments
on conflict (code) do nothing;

create table if not exists doctor_portal.roster_shift_import_mappings (
  id bigserial primary key,
  source_system text not null default 'abc',
  source_shift_name text,
  source_shift_type text,
  source_shift_abbreviation text,
  duty_type_code text not null references doctor_portal.roster_duty_types(code) on delete restrict,
  modality_id bigint references modalities(id) on delete set null,
  team_name text,
  active boolean not null default true,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    nullif(trim(coalesce(source_shift_name, '')), '') is not null or
    nullif(trim(coalesce(source_shift_type, '')), '') is not null or
    nullif(trim(coalesce(source_shift_abbreviation, '')), '') is not null
  )
);

create unique index if not exists roster_shift_import_mappings_unique_active
  on doctor_portal.roster_shift_import_mappings (
    source_system,
    coalesce(lower(source_shift_name), ''),
    coalesce(lower(source_shift_type), ''),
    coalesce(lower(source_shift_abbreviation), '')
  )
  where active = true;

alter table doctor_portal.case_team_assignments
  add column if not exists assigned_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null;

alter table doctor_portal.case_team_assignments
  alter column roster_assignment_id drop not null;

create index if not exists case_team_assignments_assigned_doctor_idx
  on doctor_portal.case_team_assignments(assigned_doctor_id)
  where status = 'active';

alter table doctor_portal.case_workload_units
  add column if not exists assigned_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null;

alter table doctor_portal.case_workload_units
  alter column roster_assignment_id drop not null;

create index if not exists case_workload_units_assigned_doctor_idx
  on doctor_portal.case_workload_units(assigned_doctor_id)
  where status = 'active';

create or replace function doctor_portal.sync_report_case_eligibility()
returns trigger
language plpgsql
as $$
begin
  if new.requires_report = false or new.status in ('cancelled', 'discontinued', 'voided') then
    update doctor_portal.case_team_assignments
       set status = 'cancelled', updated_at = now()
     where appointment_id = new.id
       and status = 'active';

    update doctor_portal.case_workload_units
       set status = 'cancelled', updated_at = now()
     where appointment_id = new.id
       and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_report_case_eligibility_on_booking on appointments_v2.bookings;
create trigger sync_report_case_eligibility_on_booking
after update of requires_report, status on appointments_v2.bookings
for each row
when (
  old.requires_report is distinct from new.requires_report or
  old.status is distinct from new.status
)
execute function doctor_portal.sync_report_case_eligibility();

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conrelid::regclass::text as table_name, conname
    from pg_constraint
    where contype = 'c'
      and connamespace = 'doctor_portal'::regnamespace
      and conrelid in (
        'doctor_portal.doctor_roster_assignments'::regclass,
        'doctor_portal.roster_template_assignments'::regclass
      )
      and pg_get_constraintdef(oid) like '%duty_type%'
  loop
    execute format('alter table %s drop constraint %I', constraint_record.table_name, constraint_record.conname);
  end loop;
end $$;
