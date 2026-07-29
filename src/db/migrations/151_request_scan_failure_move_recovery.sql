alter table request_scan_jobs
  add column if not exists failure_destination_path text,
  add column if not exists failure_moved_at timestamptz,
  add column if not exists archive_recovered_from_path text,
  add column if not exists archive_recovered_at timestamptz;

alter table request_scan_jobs
  drop constraint if exists request_scan_jobs_failure_move_checkpoint_check;
alter table request_scan_jobs
  add constraint request_scan_jobs_failure_move_checkpoint_check
  check (failure_moved_at is null or failure_destination_path is not null);

alter table request_scan_jobs
  drop constraint if exists request_scan_jobs_archive_recovery_checkpoint_check;
alter table request_scan_jobs
  add constraint request_scan_jobs_archive_recovery_checkpoint_check
  check (archive_recovered_at is null or archive_recovered_from_path is not null);
