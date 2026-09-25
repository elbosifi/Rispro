create table if not exists teaching.import_batches (
  id uuid primary key,
  uploaded_by_identity_issuer text not null,
  uploaded_by_identity_subject text not null,
  original_filename text not null check (length(btrim(original_filename)) > 0),
  input_type text not null check (input_type in ('json', 'zip')),
  schema_version text,
  status text not null check (status in ('uploaded', 'inspected', 'invalid', 'validated', 'confirmed', 'failed', 'expired')),
  question_count integer not null default 0 check (question_count >= 0),
  case_count integer not null default 0 check (case_count >= 0),
  asset_count integer not null default 0 check (asset_count >= 0),
  validation_summary_json jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_summary_json) = 'object'),
  payload_json jsonb,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  inspected_at timestamptz,
  validated_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_identity_issuer text,
  confirmed_by_identity_subject text,
  failure_message text,
  foreign key (uploaded_by_identity_issuer, uploaded_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (confirmed_by_identity_issuer, confirmed_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  check ((confirmed_by_identity_issuer is null) = (confirmed_by_identity_subject is null)),
  check ((confirmed_at is null) = (confirmed_by_identity_issuer is null)),
  check (status <> 'confirmed' or (confirmed_at is not null and payload_json is null)),
  check (status <> 'expired' or payload_json is null)
);

create index if not exists teaching_import_batches_expiry_idx
  on teaching.import_batches(status, expires_at);
create index if not exists teaching_import_batches_uploader_created_idx
  on teaching.import_batches(uploaded_by_identity_issuer, uploaded_by_identity_subject, created_at desc);

alter table teaching.question_revisions
  add column if not exists import_batch_id uuid references teaching.import_batches(id) on delete restrict;
create index if not exists teaching_question_revisions_import_batch_idx
  on teaching.question_revisions(import_batch_id, question_id)
  where import_batch_id is not null;

-- externalId is the Teaching content identity across the full Teaching domain.
create unique index if not exists teaching_questions_external_id_global_idx
  on teaching.questions(external_id);

-- The Phase 2 source vocabulary includes original and unknown, which need not
-- have fabricated titles. Other source kinds continue to require a real title.
alter table teaching.sources alter column title drop not null;
alter table teaching.sources drop constraint if exists sources_title_check;
alter table teaching.sources drop constraint if exists teaching_sources_title_by_type_check;
alter table teaching.sources
  add constraint teaching_sources_title_by_type_check
  check (source_type in ('original', 'unknown') or (title is not null and length(btrim(title)) > 0));
