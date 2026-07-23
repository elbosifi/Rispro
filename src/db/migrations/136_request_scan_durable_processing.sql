alter table request_scan_jobs
  add column if not exists processing_stage text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists stage_started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists progress_current integer,
  add column if not exists progress_total integer,
  add column if not exists recovery_count integer not null default 0;

alter table request_scan_jobs drop constraint if exists request_scan_jobs_progress_current_check;
alter table request_scan_jobs add constraint request_scan_jobs_progress_current_check check (progress_current is null or progress_current >= 0);
alter table request_scan_jobs drop constraint if exists request_scan_jobs_progress_total_check;
alter table request_scan_jobs add constraint request_scan_jobs_progress_total_check check (progress_total is null or progress_total >= 0);
alter table request_scan_jobs drop constraint if exists request_scan_jobs_progress_bounds_check;
alter table request_scan_jobs add constraint request_scan_jobs_progress_bounds_check check (progress_current is null or progress_total is null or progress_current <= progress_total);
alter table request_scan_jobs drop constraint if exists request_scan_jobs_recovery_count_check;
alter table request_scan_jobs add constraint request_scan_jobs_recovery_count_check check (recovery_count >= 0);

create index if not exists request_scan_jobs_pending_claim_idx on request_scan_jobs(id) where status = 'pending';
create index if not exists request_scan_jobs_expired_lease_idx on request_scan_jobs(lease_expires_at) where status = 'processing';
create index if not exists request_scan_jobs_active_queue_idx on request_scan_jobs(status, processing_started_at, created_at) where status in ('pending', 'processing');
