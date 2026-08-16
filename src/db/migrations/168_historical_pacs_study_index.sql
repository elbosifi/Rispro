create table if not exists historical_pacs_studies (
  orthanc_study_id text primary key,
  study_instance_uid text,
  accession_number text,
  patient_id text,
  patient_name_raw text,
  patient_birth_date text,
  patient_sex text,
  study_date text,
  study_description text,
  modalities_in_study text[] not null default array[]::text[],
  series_count integer not null default 0 check (series_count >= 0),
  instance_count integer not null default 0 check (instance_count >= 0),
  normalized_name_primary text not null default '',
  normalized_name_reordered text not null default '',
  normalized_arabic_name_primary text not null default '',
  normalized_arabic_name_reordered text not null default '',
  normalized_arabic_compact_primary text not null default '',
  normalized_arabic_compact_reordered text not null default '',
  synchronized_at timestamptz not null default now()
);

create index if not exists historical_pacs_studies_study_uid_idx
  on historical_pacs_studies (study_instance_uid);

create index if not exists historical_pacs_studies_patient_id_idx
  on historical_pacs_studies (patient_id);

create index if not exists historical_pacs_studies_name_primary_trgm_idx
  on historical_pacs_studies using gin (normalized_name_primary gin_trgm_ops);

create index if not exists historical_pacs_studies_name_reordered_trgm_idx
  on historical_pacs_studies using gin (normalized_name_reordered gin_trgm_ops);

create index if not exists historical_pacs_studies_arabic_primary_trgm_idx
  on historical_pacs_studies using gin (normalized_arabic_name_primary gin_trgm_ops);

create index if not exists historical_pacs_studies_arabic_reordered_trgm_idx
  on historical_pacs_studies using gin (normalized_arabic_name_reordered gin_trgm_ops);

create index if not exists historical_pacs_studies_arabic_compact_primary_trgm_idx
  on historical_pacs_studies using gin (normalized_arabic_compact_primary gin_trgm_ops);

create index if not exists historical_pacs_studies_arabic_compact_reordered_trgm_idx
  on historical_pacs_studies using gin (normalized_arabic_compact_reordered gin_trgm_ops);

create table if not exists historical_pacs_sync_state (
  singleton_key boolean primary key default true check (singleton_key),
  last_change_sequence bigint,
  last_full_sync_at timestamptz,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into historical_pacs_sync_state (singleton_key)
values (true)
on conflict (singleton_key) do nothing;
