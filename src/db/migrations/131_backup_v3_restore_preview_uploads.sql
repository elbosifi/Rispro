-- Durable, private staging for operator-supplied restore archives and their
-- review jobs. Passphrases are intentionally never persisted.
create table if not exists backup_restore_upload_sessions (
  upload_session_id uuid primary key,
  created_by_user_id bigint references users(id) on delete set null,
  status text not null check (status in ('active', 'completed', 'cancelled', 'failed', 'expired')),
  archive_name text not null,
  staging_path text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  expected_sha256 text,
  received_offset bigint not null default 0 check (received_offset >= 0),
  failure_message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cleanup_at timestamptz
);

create table if not exists backup_restore_preview_jobs (
  preview_job_id uuid primary key,
  created_by_user_id bigint references users(id) on delete set null,
  source_type text not null check (source_type in ('artifact', 'destination_copy', 'upload_session')),
  artifact_id uuid references backup_artifacts(artifact_id) on delete restrict,
  copy_attempt_id uuid references backup_destination_copy_attempts(copy_attempt_id) on delete restrict,
  upload_session_id uuid references backup_restore_upload_sessions(upload_session_id) on delete restrict,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'expired', 'consumed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  archive_path text,
  archive_sha256 text,
  archive_size_bytes bigint,
  manifest_summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  passphrase_valid boolean,
  failure_diagnostics text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  cleanup_at timestamptz,
  consumed_at timestamptz,
  check (
    (source_type = 'artifact' and artifact_id is not null and copy_attempt_id is null and upload_session_id is null) or
    (source_type = 'destination_copy' and copy_attempt_id is not null and artifact_id is null and upload_session_id is null) or
    (source_type = 'upload_session' and upload_session_id is not null and artifact_id is null and copy_attempt_id is null)
  )
);

create index if not exists backup_restore_upload_sessions_cleanup_idx
  on backup_restore_upload_sessions (status, expires_at) where cleanup_at is null;
create index if not exists backup_restore_preview_jobs_queue_idx
  on backup_restore_preview_jobs (status, created_at) where status in ('queued', 'running');
create index if not exists backup_restore_preview_jobs_cleanup_idx
  on backup_restore_preview_jobs (status, expires_at) where cleanup_at is null;
