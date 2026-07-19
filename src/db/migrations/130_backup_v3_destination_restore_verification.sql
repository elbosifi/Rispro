-- Restore drills must prove a specific retained destination copy, rather than
-- silently validating the server-local artifact used to create it.
alter table backup_restore_verification_jobs
  add column if not exists copy_attempt_id uuid references backup_destination_copy_attempts(copy_attempt_id) on delete set null,
  add column if not exists retrieval jsonb not null default '{}'::jsonb;

create index if not exists backup_restore_verification_copy_attempt_idx
  on backup_restore_verification_jobs (copy_attempt_id)
  where copy_attempt_id is not null;
