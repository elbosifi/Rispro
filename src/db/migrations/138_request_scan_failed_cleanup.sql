alter table request_scan_jobs
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by bigint references users(id) on delete set null,
  add column if not exists dismiss_reason text,
  add column if not exists failure_category text;

alter table request_scan_jobs drop constraint if exists request_scan_jobs_failure_category_check;
alter table request_scan_jobs add constraint request_scan_jobs_failure_category_check check (failure_category is null or failure_category in ('recognition','identifier_conflict','smb_storage','source_missing','processing_interrupted','duplicate_or_existing','internal_processing','unknown'));
alter table request_scan_jobs drop constraint if exists request_scan_jobs_dismiss_reason_length_check;
alter table request_scan_jobs add constraint request_scan_jobs_dismiss_reason_length_check check (dismiss_reason is null or char_length(dismiss_reason) <= 500);

update request_scan_jobs set failure_category = case
  when error_message ilike '%no valid appointment identifier%' or error_message ilike '%no readable barcode%' or error_message ilike '%valid RISpro accession%' then 'recognition'
  when error_message ilike '%conflict%' or error_message ilike '%multiple appointment%' or error_message ilike '%multiple different%' or error_message ilike '%disagreement%' then 'identifier_conflict'
  when error_message ilike '%source scan file could not be found%' then 'source_missing'
  when error_message ilike '%interrupted repeatedly%' then 'processing_interrupted'
  when error_message ilike '%SMB%' or error_message ilike '%destination%' or error_message ilike '%network share%' then 'smb_storage'
  when error_message ilike '%duplicate%' or error_message ilike '%existing attachment%' then 'duplicate_or_existing'
  else 'unknown' end
where status = 'failed' and failure_category is null;

create index if not exists request_scan_jobs_visible_failed_idx on request_scan_jobs(created_at desc, id desc) where status='failed' and dismissed_at is null;
create index if not exists request_scan_jobs_dismissed_idx on request_scan_jobs(dismissed_at desc, id desc) where status='failed' and dismissed_at is not null;
create index if not exists request_scan_jobs_failed_category_idx on request_scan_jobs(failure_category, created_at desc, id desc) where status='failed';
