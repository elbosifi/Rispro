create table if not exists pacs_web_endpoints (
  id bigserial primary key,
  pacs_node_id bigint not null unique references pacs_nodes(id) on delete cascade,
  enabled boolean not null default false,
  dicomweb_base_url text not null,
  qido_root text not null,
  wado_rs_root text not null,
  wado_uri_root text,
  stow_root text,
  auth_type text not null default 'none'
    check (auth_type in ('none', 'basic', 'bearer')),
  username_env_key text,
  password_env_key text,
  bearer_token_env_key text,
  verify_tls boolean not null default true,
  timeout_seconds integer not null default 30 check (timeout_seconds between 1 and 300),
  osirix_version text,
  dicomweb_server_enabled boolean,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_message text,
  qido_last_status text,
  wado_metadata_last_status text,
  wado_frame_last_status text,
  authentication_last_status text,
  tls_last_status text,
  cors_last_status text,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pacs_web_endpoint_auth_reference_check check (
    (auth_type = 'none' and username_env_key is null and password_env_key is null and bearer_token_env_key is null)
    or (auth_type = 'basic' and nullif(trim(coalesce(username_env_key, '')), '') is not null and nullif(trim(coalesce(password_env_key, '')), '') is not null and bearer_token_env_key is null)
    or (auth_type = 'bearer' and username_env_key is null and password_env_key is null and nullif(trim(coalesce(bearer_token_env_key, '')), '') is not null)
  )
);

create table if not exists ohif_viewer_settings (
  singleton_key boolean primary key default true check (singleton_key),
  enabled boolean not null default false,
  ohif_public_base_url text not null default '/ohif',
  selected_pacs_node_id bigint references pacs_nodes(id) on delete restrict,
  access_strategy text not null default 'native_dicomweb'
    check (access_strategy in ('native_dicomweb', 'orthanc_gateway')),
  orthanc_gateway_enabled boolean not null default false,
  orthanc_modality_key text,
  open_mode text not null default 'new_tab'
    check (open_mode in ('new_tab', 'same_tab')),
  allow_prior_studies boolean not null default true,
  max_prior_studies integer not null default 5 check (max_prior_studies between 0 and 20),
  launch_token_ttl_seconds integer not null default 600 check (launch_token_ttl_seconds between 60 and 3600),
  cache_retention_hours integer not null default 24 check (cache_retention_hours between 1 and 720),
  retrieval_timeout_seconds integer not null default 300 check (retrieval_timeout_seconds between 10 and 3600),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ohif_gateway_strategy_check check (
    access_strategy <> 'orthanc_gateway' or orthanc_gateway_enabled = true
  )
);

insert into ohif_viewer_settings (singleton_key, enabled)
values (true, false)
on conflict (singleton_key) do nothing;

create table if not exists study_source_resolutions (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  accession_number text not null,
  patient_id_value text,
  study_instance_uid text not null,
  source_pacs_node_id bigint not null references pacs_nodes(id) on delete restrict,
  resolution_method text not null
    check (resolution_method in ('persisted_uid_verified', 'exact_accession', 'orthanc_remote_query')),
  safe_diagnostic_json jsonb not null default '{}'::jsonb,
  resolved_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, source_pacs_node_id),
  unique (source_pacs_node_id, accession_number, study_instance_uid)
);

create index if not exists study_source_resolutions_uid_source_idx
  on study_source_resolutions(study_instance_uid, source_pacs_node_id);

create table if not exists viewer_launch_sessions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  case_type text not null default 'appointment' check (case_type in ('appointment')),
  case_id bigint not null,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  source_pacs_node_id bigint not null references pacs_nodes(id) on delete restrict,
  access_strategy text not null check (access_strategy in ('native_dicomweb', 'orthanc_gateway')),
  study_instance_uid text not null,
  permitted_study_uids jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists viewer_launch_sessions_user_active_idx
  on viewer_launch_sessions(user_id, expires_at desc)
  where revoked_at is null;

create table if not exists ohif_retrieval_jobs (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  accession_number text not null,
  study_instance_uid text,
  source_pacs_node_id bigint not null references pacs_nodes(id) on delete restrict,
  requested_by_user_id bigint not null references users(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'resolving', 'retrieving', 'available', 'not_found', 'ambiguous', 'failed', 'timed_out')),
  orthanc_job_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ohif_retrieval_jobs_active_source_accession_idx
  on ohif_retrieval_jobs(source_pacs_node_id, accession_number)
  where status in ('queued', 'resolving', 'retrieving');

create index if not exists ohif_retrieval_jobs_status_created_idx
  on ohif_retrieval_jobs(status, created_at);
