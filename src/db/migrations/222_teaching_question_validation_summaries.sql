create table if not exists teaching.question_validation_summaries (
  question_revision_id bigint primary key references teaching.question_revisions(id) on delete cascade,
  revision_version integer not null check (revision_version > 0),
  classification text not null check (classification in ('valid', 'valid_with_warnings', 'invalid')),
  errors_json jsonb not null default '[]'::jsonb check (jsonb_typeof(errors_json) = 'array'),
  warnings_json jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings_json) = 'array'),
  validated_by_identity_issuer text not null,
  validated_by_identity_subject text not null,
  validated_at timestamptz not null default now(),
  foreign key (validated_by_identity_issuer, validated_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create index if not exists teaching_question_validation_classification_idx
  on teaching.question_validation_summaries(classification, validated_at desc);
