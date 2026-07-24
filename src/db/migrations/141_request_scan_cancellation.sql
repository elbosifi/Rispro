alter table request_scan_jobs
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by bigint references users(id) on delete set null,
  add column if not exists cancel_reason text;
