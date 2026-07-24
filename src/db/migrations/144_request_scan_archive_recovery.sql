-- Archive transfer is a durable, independent stage.  A successful RIS document
-- attachment must remain authoritative when the secondary SMB move is unavailable.
alter table request_scan_jobs
  add column if not exists archive_attempt_count integer not null default 0,
  add column if not exists last_archive_attempt_at timestamptz,
  add column if not exists archive_last_error text,
  add column if not exists archive_next_retry_at timestamptz;

alter table request_scan_jobs drop constraint if exists request_scan_jobs_archive_attempt_count_check;
alter table request_scan_jobs add constraint request_scan_jobs_archive_attempt_count_check check (archive_attempt_count >= 0);

create index if not exists request_scan_jobs_archive_retry_idx
  on request_scan_jobs(archive_next_retry_at)
  where status = 'failed' and attachment_completed_at is not null and source_moved_at is null;
