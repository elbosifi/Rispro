alter table doctor_portal.reporting_board_bulk_assignment_jobs
  drop constraint if exists reporting_board_bulk_assignment_jobs_status_check;

alter table doctor_portal.reporting_board_bulk_assignment_jobs
  add constraint reporting_board_bulk_assignment_jobs_status_check
  check (status in ('scheduled', 'running', 'completed', 'partial', 'failed', 'cancelled', 'undone', 'partially_undone'));
