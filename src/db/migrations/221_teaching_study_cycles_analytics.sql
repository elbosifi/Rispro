create schema if not exists teaching;

create table if not exists teaching.study_cycles (
  id bigserial primary key,
  identity_issuer text not null,
  identity_subject text not null,
  question_bank_id bigint not null references teaching.question_banks(id) on delete restrict,
  scope_type text not null check (scope_type in ('bank', 'domain', 'topic')),
  scope_id bigint not null,
  cycle_number integer not null check (cycle_number > 0),
  reset_event_id uuid not null,
  request_key uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  eligible_question_count integer check (eligible_question_count >= 0),
  attempted_question_count integer check (attempted_question_count >= 0),
  correct_question_count integer check (correct_question_count >= 0),
  incorrect_question_count integer check (incorrect_question_count >= 0),
  completion_percentage numeric(5, 2) check (completion_percentage between 0 and 100),
  accuracy_percentage numeric(5, 2) check (accuracy_percentage between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  check ((ended_at is null) = (eligible_question_count is null)),
  check ((eligible_question_count is null) = (attempted_question_count is null)),
  check ((attempted_question_count is null) = (correct_question_count is null)),
  check ((correct_question_count is null) = (incorrect_question_count is null)),
  check ((attempted_question_count is null) = (completion_percentage is null)),
  check (accuracy_percentage is null or attempted_question_count > 0),
  check (attempted_question_count is null or (attempted_question_count = correct_question_count + incorrect_question_count
    and (attempted_question_count = 0 or accuracy_percentage is not null)))
);

create unique index if not exists teaching_study_cycles_active_scope_idx
  on teaching.study_cycles(identity_issuer, identity_subject, question_bank_id, scope_type, scope_id)
  where ended_at is null;
create unique index if not exists teaching_study_cycles_request_key_idx
  on teaching.study_cycles(identity_issuer, identity_subject, request_key)
  where request_key is not null;
create unique index if not exists teaching_study_cycles_event_scope_idx
  on teaching.study_cycles(reset_event_id, scope_type, scope_id);
create unique index if not exists teaching_study_cycles_sequence_idx
  on teaching.study_cycles(identity_issuer, identity_subject, question_bank_id, scope_type, scope_id, cycle_number);
create index if not exists teaching_study_cycles_scope_history_idx
  on teaching.study_cycles(identity_issuer, identity_subject, question_bank_id, scope_type, scope_id, started_at desc);
