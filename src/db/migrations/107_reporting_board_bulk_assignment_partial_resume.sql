alter table doctor_portal.reporting_board_bulk_assignment_jobs
  add column if not exists resumed_from_job_id bigint references doctor_portal.reporting_board_bulk_assignment_jobs(id) on delete set null;

alter table doctor_portal.reporting_board_bulk_assignment_jobs
  drop constraint if exists reporting_board_bulk_assignment_jobs_status_check;

alter table doctor_portal.reporting_board_bulk_assignment_jobs
  add constraint reporting_board_bulk_assignment_jobs_status_check
  check (status in ('scheduled', 'running', 'completed', 'partial', 'failed', 'cancelled', 'undone', 'partially_undone'));

create index if not exists reporting_board_bulk_assignment_jobs_resumed_from_idx
  on doctor_portal.reporting_board_bulk_assignment_jobs(resumed_from_job_id);

update doctor_portal.reporting_board_bulk_assignment_jobs
set
  status = 'partial',
  result_json = coalesce(result_json, '{}'::jsonb) || jsonb_build_object(
    'remainingCount',
    greatest(
      coalesce(case when (result_json->>'requestedCount') ~ '^[0-9]+$' then (result_json->>'requestedCount')::int end, case_count)
        - coalesce(case when (result_json->>'assignedCount') ~ '^[0-9]+$' then (result_json->>'assignedCount')::int end, 0),
      0
    )
  ),
  updated_at = now()
where status = 'completed'
  and jsonb_typeof(result_json) = 'object'
  and coalesce(case when (result_json->>'assignedCount') ~ '^[0-9]+$' then (result_json->>'assignedCount')::int end, 0)
    < coalesce(case when (result_json->>'requestedCount') ~ '^[0-9]+$' then (result_json->>'requestedCount')::int end, case_count);
