alter table request_scan_jobs add column if not exists priority_requested_at timestamptz;
create index if not exists request_scan_jobs_pending_priority_idx on request_scan_jobs(priority_requested_at asc nulls last, created_at asc, id asc) where status = 'pending';
