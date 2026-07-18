-- Durable state for the Backup V3 Control Center. Secrets are deliberately
-- stored separately from profile configuration and only as encrypted blobs.

create table if not exists backup_destination_profiles (
  destination_id uuid primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  destination_type text not null check (destination_type in ('local', 'smb', 'sftp', 'nextcloud', 'onedrive')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  encrypted_credentials text,
  last_connection_at timestamptz,
  last_connection_status text,
  last_failure_message text,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists backup_control_secrets (
  secret_name text primary key,
  encrypted_value text not null,
  updated_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists backup_schedules (
  schedule_id uuid primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  frequency text not null check (frequency in ('daily', 'weekdays', 'weekly', 'monthly')),
  time_of_day text not null check (time_of_day ~ '^[0-2][0-9]:[0-5][0-9]$'),
  timezone text not null default 'Africa/Tripoli',
  selected_weekdays smallint[] not null default '{}'::smallint[],
  selected_day_of_month smallint,
  destination_ids uuid[] not null default '{}'::uuid[],
  retention_policy jsonb not null default '{}'::jsonb,
  restore_verification_frequency text not null default 'disabled' check (restore_verification_frequency in ('disabled', 'weekly', 'monthly')),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_scheduled_slot text,
  next_run_at timestamptz,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists backup_jobs (
  job_id uuid primary key,
  job_kind text not null default 'backup' check (job_kind in ('backup', 'restore_verification', 'retention')),
  status text not null check (status in ('queued', 'generating', 'generated', 'copying', 'verifying', 'completed', 'failed', 'cancelled')),
  source_schedule_id uuid references backup_schedules(schedule_id) on delete set null,
  initiated_by_user_id bigint references users(id) on delete set null,
  requested_destination_ids uuid[] not null default '{}'::uuid[],
  archive_name text,
  staging_path text,
  archive_size_bytes bigint,
  archive_sha256 text,
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  retry_of_job_id uuid references backup_jobs(job_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backup_artifacts (
  artifact_id uuid primary key,
  job_id uuid not null unique references backup_jobs(job_id) on delete cascade,
  archive_name text not null,
  staging_path text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists backup_destination_copy_attempts (
  copy_attempt_id uuid primary key,
  job_id uuid not null references backup_jobs(job_id) on delete cascade,
  artifact_id uuid references backup_artifacts(artifact_id) on delete set null,
  destination_id uuid not null references backup_destination_profiles(destination_id) on delete restrict,
  status text not null check (status in ('queued', 'copying', 'verified', 'failed', 'cancelled')),
  remote_path text,
  byte_size bigint,
  sha256 text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, destination_id)
);

create table if not exists backup_verification_attempts (
  verification_attempt_id uuid primary key,
  artifact_id uuid references backup_artifacts(artifact_id) on delete cascade,
  copy_attempt_id uuid references backup_destination_copy_attempts(copy_attempt_id) on delete cascade,
  verification_kind text not null check (verification_kind in ('archive', 'destination_copy', 'restore')),
  status text not null check (status in ('queued', 'running', 'passed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((artifact_id is not null) or (copy_attempt_id is not null))
);

create table if not exists backup_restore_verification_jobs (
  restore_verification_job_id uuid primary key,
  artifact_id uuid references backup_artifacts(artifact_id) on delete set null,
  destination_id uuid references backup_destination_profiles(destination_id) on delete set null,
  source_schedule_id uuid references backup_schedules(schedule_id) on delete set null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  report jsonb not null default '{}'::jsonb,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backup_retention_actions (
  retention_action_id uuid primary key,
  destination_id uuid references backup_destination_profiles(destination_id) on delete set null,
  artifact_id uuid references backup_artifacts(artifact_id) on delete set null,
  action text not null check (action in ('preview', 'delete', 'failed')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  performed_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists backup_worker_state (
  singleton_key boolean primary key default true check (singleton_key),
  instance_id text,
  heartbeat_at timestamptz,
  last_successful_tick_at timestamptz,
  last_failure_message text,
  updated_at timestamptz not null default now()
);

create index if not exists backup_jobs_pending_idx on backup_jobs (status, created_at)
  where status in ('queued', 'generating', 'copying', 'verifying');
create index if not exists backup_jobs_started_idx on backup_jobs (started_at desc);
create index if not exists backup_schedules_due_idx on backup_schedules (enabled, next_run_at);
create index if not exists backup_copy_attempts_job_idx on backup_destination_copy_attempts (job_id, status);
create index if not exists backup_verification_attempts_status_idx on backup_verification_attempts (status, created_at desc);
