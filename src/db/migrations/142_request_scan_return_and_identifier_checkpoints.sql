alter table request_scan_jobs
  add column if not exists return_requested_at timestamptz,
  add column if not exists return_source_path text,
  add column if not exists return_destination_path text,
  add column if not exists return_completed_at timestamptz,
  add column if not exists identifier_verified_at timestamptz,
  add column if not exists identifier_strategy text;

create index if not exists request_scan_jobs_incomplete_return_idx
  on request_scan_jobs(return_requested_at)
  where return_requested_at is not null and return_completed_at is null;
