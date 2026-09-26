create schema if not exists teaching;

create table if not exists teaching.sessions (
  id bigserial primary key,
  identity_issuer text not null,
  identity_subject text not null,
  mode text not null check (mode in ('study', 'exam', 'review')),
  status text not null default 'active' check (status in ('active', 'submitted', 'abandoned')),
  question_count integer not null check (question_count between 1 and 100),
  timed boolean not null default false,
  time_limit_seconds integer,
  filters_json jsonb not null default '{}'::jsonb check (jsonb_typeof(filters_json) = 'object'),
  current_position integer not null default 1 check (current_position > 0),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  unique (id, identity_issuer, identity_subject),
  check ((timed and mode = 'exam' and time_limit_seconds between 60 and 14400)
      or (not timed and time_limit_seconds is null)),
  check ((status = 'submitted') = (submitted_at is not null))
);

create table if not exists teaching.session_questions (
  id bigserial primary key,
  session_id bigint not null references teaching.sessions(id) on delete restrict,
  question_id bigint not null,
  question_revision_id bigint not null,
  position integer not null check (position > 0),
  opened_at timestamptz,
  draft_selected_option_key text,
  draft_selected_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (question_revision_id, question_id)
    references teaching.question_revisions(id, question_id) on delete restrict,
  foreign key (question_revision_id, draft_selected_option_key)
    references teaching.question_options(question_revision_id, option_key) on delete restrict,
  unique (session_id, position),
  unique (session_id, question_id),
  unique (id, session_id, question_id, question_revision_id),
  check ((draft_selected_option_key is null) = (draft_selected_at is null))
);

create table if not exists teaching.attempts (
  id bigserial primary key,
  identity_issuer text not null,
  identity_subject text not null,
  session_id bigint not null,
  session_question_id bigint not null,
  question_id bigint not null,
  question_revision_id bigint not null,
  selected_option_key text not null,
  is_correct boolean not null,
  mode text not null check (mode in ('study', 'exam', 'review')),
  answered_at timestamptz not null default now(),
  answer_duration_ms integer check (answer_duration_ms between 0 and 86400000),
  foreign key (session_id, identity_issuer, identity_subject)
    references teaching.sessions(id, identity_issuer, identity_subject) on delete restrict,
  foreign key (session_question_id, session_id, question_id, question_revision_id)
    references teaching.session_questions(id, session_id, question_id, question_revision_id) on delete restrict,
  foreign key (question_revision_id, selected_option_key)
    references teaching.question_options(question_revision_id, option_key) on delete restrict,
  unique (session_question_id),
  unique (id, identity_issuer, identity_subject, question_id)
);

create table if not exists teaching.user_question_state (
  identity_issuer text not null,
  identity_subject text not null,
  question_id bigint not null references teaching.questions(id) on delete restrict,
  state text not null check (state in ('correct', 'incorrect')),
  last_attempt_id bigint not null,
  last_answered_at timestamptz not null,
  primary key (identity_issuer, identity_subject, question_id),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (last_attempt_id, identity_issuer, identity_subject, question_id)
    references teaching.attempts(id, identity_issuer, identity_subject, question_id) on delete restrict
);

create table if not exists teaching.bookmarks (
  identity_issuer text not null,
  identity_subject text not null,
  question_id bigint not null references teaching.questions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (identity_issuer, identity_subject, question_id),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create table if not exists teaching.notes (
  identity_issuer text not null,
  identity_subject text not null,
  question_id bigint not null references teaching.questions(id) on delete restrict,
  note_text text not null check (length(btrim(note_text)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (identity_issuer, identity_subject, question_id),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create index if not exists teaching_question_revisions_published_latest_idx
  on teaching.question_revisions(question_id, revision_number desc, id desc)
  where status = 'published';
create index if not exists teaching_sessions_learner_status_activity_idx
  on teaching.sessions(identity_issuer, identity_subject, status, last_activity_at desc, id desc);
create index if not exists teaching_session_questions_revision_idx
  on teaching.session_questions(question_revision_id, question_id);
create index if not exists teaching_attempts_learner_answered_idx
  on teaching.attempts(identity_issuer, identity_subject, answered_at desc, id desc);
create index if not exists teaching_attempts_learner_question_idx
  on teaching.attempts(identity_issuer, identity_subject, question_id, answered_at desc, id desc);
create index if not exists teaching_user_question_state_state_idx
  on teaching.user_question_state(identity_issuer, identity_subject, state, last_answered_at desc);
create index if not exists teaching_bookmarks_learner_idx
  on teaching.bookmarks(identity_issuer, identity_subject, created_at desc);

create or replace function teaching.reject_attempt_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Finalized Teaching attempts are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists teaching_attempts_immutable on teaching.attempts;
create trigger teaching_attempts_immutable
  before update or delete on teaching.attempts
  for each row execute function teaching.reject_attempt_mutation();

create or replace function teaching.protect_session_question_snapshot() returns trigger
language plpgsql as $$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Teaching session question snapshots cannot be deleted.' using errcode = '55000';
  end if;
  if new.session_id is distinct from old.session_id
    or new.question_id is distinct from old.question_id
    or new.question_revision_id is distinct from old.question_revision_id
    or new.position is distinct from old.position then
    raise exception 'Teaching session question snapshots are immutable.' using errcode = '55000';
  end if;
  if new.draft_selected_option_key is distinct from old.draft_selected_option_key
    or new.draft_selected_at is distinct from old.draft_selected_at then
    select status into parent_status from teaching.sessions where id = old.session_id;
    if parent_status <> 'active' then
      raise exception 'Responses cannot change after a Teaching session is submitted.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists teaching_session_questions_snapshot_immutable on teaching.session_questions;
create trigger teaching_session_questions_snapshot_immutable
  before update or delete on teaching.session_questions
  for each row execute function teaching.protect_session_question_snapshot();
