create table if not exists appointments_v2.pacs_auto_completion_settings (
  id bigserial primary key,
  modality_id bigint not null unique references modalities(id) on delete cascade,
  enabled boolean not null default false,
  orthanc_target_type text not null default 'local'
    check (orthanc_target_type in ('local', 'remote_modality')),
  orthanc_target_key text,
  matching_strategy text not null default 'study_uid_preferred_accession_fallback'
    check (matching_strategy in ('study_uid_preferred_accession_fallback')),
  completion_threshold text not null default 'study_exists'
    check (completion_threshold in ('study_exists', 'series_exists', 'instance_exists')),
  poll_interval_minutes integer not null default 15 check (poll_interval_minutes > 0),
  lookback_hours integer not null default 24 check (lookback_hours >= 0),
  stop_after_hours integer not null default 72 check (stop_after_hours > 0),
  last_check_status text,
  last_check_result_json jsonb,
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pacs_auto_completion_target_key_check check (
    (orthanc_target_type = 'local' and nullif(trim(coalesce(orthanc_target_key, '')), '') is null)
    or
    (orthanc_target_type = 'remote_modality' and nullif(trim(coalesce(orthanc_target_key, '')), '') is not null)
  )
);

create index if not exists pacs_auto_completion_settings_enabled_idx
  on appointments_v2.pacs_auto_completion_settings (enabled, modality_id);

create table if not exists appointments_v2.pacs_auto_completion_verification_history (
  id bigserial primary key,
  booking_id bigint references appointments_v2.bookings(id) on delete cascade,
  modality_id bigint references modalities(id) on delete set null,
  setting_id bigint references appointments_v2.pacs_auto_completion_settings(id) on delete set null,
  orthanc_target_type text not null
    check (orthanc_target_type in ('local', 'remote_modality')),
  orthanc_target_key text,
  match_key text,
  match_value text,
  result_status text not null
    check (result_status in ('matched', 'not_found', 'ambiguous', 'error', 'insufficient_evidence')),
  result_json jsonb,
  series_count integer,
  instance_count integer,
  last_error text,
  completed_booking boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists pacs_auto_completion_history_booking_created_idx
  on appointments_v2.pacs_auto_completion_verification_history (booking_id, created_at desc);

create index if not exists pacs_auto_completion_history_modality_created_idx
  on appointments_v2.pacs_auto_completion_verification_history (modality_id, created_at desc);

create index if not exists pacs_auto_completion_history_status_created_idx
  on appointments_v2.pacs_auto_completion_verification_history (result_status, created_at desc);

alter table appointments_v2.bookings
  add column if not exists auto_completed_by text,
  add column if not exists auto_completed_at timestamptz,
  add column if not exists auto_completion_check_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_auto_completion_check_fk'
  ) then
    alter table appointments_v2.bookings
      add constraint bookings_auto_completion_check_fk
      foreign key (auto_completion_check_id)
      references appointments_v2.pacs_auto_completion_verification_history(id)
      on delete set null;
  end if;
end $$;
