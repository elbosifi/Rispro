create table if not exists doctor_portal.reporting_assignment_intents (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  intended_doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'activated', 'cancelled', 'superseded', 'failed')),
  requested_by_user_id bigint references users(id) on delete set null,
  requested_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  reason text,
  created_from_context text not null,
  activated_assignment_id bigint references doctor_portal.case_team_assignments(id) on delete set null,
  activated_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- unique (appointment_id) where status = 'pending'
create unique index if not exists reporting_assignment_intents_one_pending_idx
  on doctor_portal.reporting_assignment_intents (appointment_id)
  where status = 'pending';

create index if not exists reporting_assignment_intents_doctor_idx
  on doctor_portal.reporting_assignment_intents (intended_doctor_id);

create or replace function doctor_portal.touch_reporting_assignment_intents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_reporting_assignment_intents_updated_at on doctor_portal.reporting_assignment_intents;
create trigger trg_reporting_assignment_intents_updated_at
before update on doctor_portal.reporting_assignment_intents
for each row execute function doctor_portal.touch_reporting_assignment_intents_updated_at();

create or replace function doctor_portal.sync_report_case_eligibility()
returns trigger
language plpgsql
as $$
begin
  if new.requires_report = false or new.status in ('cancelled', 'discontinued', 'voided') then
    update doctor_portal.case_team_assignments
    set status = 'cancelled', updated_at = now()
    where appointment_id = new.id and assignment_type = 'reporting' and status = 'active';

    update doctor_portal.case_workload_units
    set status = 'cancelled', updated_at = now()
    where appointment_id = new.id and status = 'active';

    update doctor_portal.reporting_assignment_intents
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancelled_reason = case
        when new.requires_report = false then 'requires_report=false'
        else 'booking_status_' || new.status
      end,
      updated_at = now()
    where appointment_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;
