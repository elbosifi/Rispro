create schema if not exists teaching;

alter table teaching.question_revisions
  add column if not exists evidence_status text not null default 'not_verified',
  add column if not exists evidence_checked_at date,
  add column if not exists evidence_summary text not null default '',
  add column if not exists evidence_update text;

alter table teaching.question_revisions
  drop constraint if exists teaching_question_revisions_evidence_status_check;

alter table teaching.question_revisions
  add constraint teaching_question_revisions_evidence_status_check
  check (evidence_status in ('confirmed', 'updated', 'uncertain', 'not_verified'));
