alter table backup_restore_preview_jobs add column if not exists compatibility_classification text;
alter table backup_restore_preview_jobs add column if not exists compatibility_message text;

create table if not exists backup_restore_migration_rehearsals (
  rehearsal_id uuid primary key,
  preview_job_id uuid not null references backup_restore_preview_jobs(preview_job_id) on delete restrict,
  status text not null check (status in ('queued','running','succeeded','failed')),
  compatibility_classification text not null,
  source_migrations jsonb not null default '[]'::jsonb,
  target_migrations jsonb not null default '[]'::jsonb,
  applied_migrations jsonb not null default '[]'::jsonb,
  postgres_findings jsonb not null default '[]'::jsonb,
  progress smallint not null default 0 check (progress between 0 and 100),
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  validation_results jsonb not null default '{}'::jsonb,
  cleanup_status text not null default 'pending',
  promotion_ready boolean not null default false,
  created_at timestamptz not null default now(), completed_at timestamptz, cleanup_at timestamptz
);
