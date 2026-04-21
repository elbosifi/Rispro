create table if not exists patient_import_batches (
  id bigserial primary key,
  source_filename text not null,
  source_sheet_name text,
  imported_by_user_id bigint references users(id),
  imported_at timestamptz not null default now(),
  status text not null default 'staged' check (status in ('uploaded', 'staged', 'reviewed', 'migrated', 'failed')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  migrated_rows integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patient_import_staging_rows (
  id bigserial primary key,
  batch_id bigint not null references patient_import_batches(id) on delete cascade,
  row_number integer not null,
  arabic_full_name text,
  english_full_name text,
  national_id text,
  phone text,
  derived_birth_date date,
  derived_age_years integer,
  derived_sex text,
  validation_status text not null check (validation_status in ('valid', 'invalid', 'duplicate', 'migrated', 'skipped')),
  validation_message text,
  matched_existing_patient_id bigint references patients(id),
  is_selected_for_migration boolean not null default false,
  migrated_patient_id bigint references patients(id),
  raw_row_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index if not exists patient_import_staging_rows_batch_status_idx
  on patient_import_staging_rows (batch_id, validation_status);

create index if not exists patient_import_staging_rows_batch_selected_idx
  on patient_import_staging_rows (batch_id, is_selected_for_migration);

create index if not exists patient_import_staging_rows_batch_national_id_idx
  on patient_import_staging_rows (batch_id, national_id);
