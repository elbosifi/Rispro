create table if not exists doctor_portal.reporting_board_bulk_assignment_jobs (
  id bigserial primary key,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'completed', 'partial', 'failed', 'cancelled', 'undone', 'partially_undone')),
  scheduled_for timestamptz not null,
  run_started_at timestamptz,
  run_completed_at timestamptz,
  cancelled_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  resumed_from_job_id bigint references doctor_portal.reporting_board_bulk_assignment_jobs(id) on delete set null,
  target_doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete restrict,
  case_count integer not null check (case_count between 1 and 100),
  filters_json jsonb not null default '{}'::jsonb,
  saved_view_id bigint references doctor_portal.reporting_board_saved_views(id) on delete set null,
  saved_view_name text,
  unassigned_only boolean not null default true,
  reason text,
  result_json jsonb,
  last_error text,
  attempt_count integer not null default 0,
  created_by_user_id bigint references users(id) on delete set null,
  created_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  cancelled_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reporting_board_bulk_assignment_jobs_due_idx
  on doctor_portal.reporting_board_bulk_assignment_jobs(status, scheduled_for, id);

create index if not exists reporting_board_bulk_assignment_jobs_creator_idx
  on doctor_portal.reporting_board_bulk_assignment_jobs(created_by_user_id, created_at desc);

create index if not exists reporting_board_bulk_assignment_jobs_target_doctor_idx
  on doctor_portal.reporting_board_bulk_assignment_jobs(target_doctor_id, scheduled_for desc);

create index if not exists reporting_board_bulk_assignment_jobs_resumed_from_idx
  on doctor_portal.reporting_board_bulk_assignment_jobs(resumed_from_job_id);

create or replace function doctor_portal.touch_reporting_board_bulk_assignment_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_reporting_board_bulk_assignment_jobs_updated_at on doctor_portal.reporting_board_bulk_assignment_jobs;
create trigger trg_reporting_board_bulk_assignment_jobs_updated_at
before update on doctor_portal.reporting_board_bulk_assignment_jobs
for each row execute function doctor_portal.touch_reporting_board_bulk_assignment_jobs_updated_at();
