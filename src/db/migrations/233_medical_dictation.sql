create table medical_dictation_configuration (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  base_url text not null default '',
  api_key_secret jsonb,
  timeout_seconds integer not null default 180 check (timeout_seconds between 10 and 600),
  allow_insecure_http boolean not null default false,
  updated_by_user_id bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into medical_dictation_configuration (id) values (1);
