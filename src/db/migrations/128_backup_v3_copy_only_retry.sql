-- A copy-only retry is a new auditable job that references the original,
-- canonical artifact.  It must not create a second archive merely because a
-- destination transfer failed.
alter table backup_jobs
  add column if not exists reused_artifact_id uuid references backup_artifacts(artifact_id) on delete restrict;

create index if not exists backup_jobs_reused_artifact_idx on backup_jobs (reused_artifact_id)
  where reused_artifact_id is not null;
