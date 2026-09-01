create table appointments_v2.complementary_recall_contact_attempts (
  id bigserial primary key,
  recall_request_id bigint not null references appointments_v2.complementary_recall_requests(id) on delete restrict,
  contact_method text not null,
  contact_value text,
  outcome text not null,
  note text,
  follow_up_at timestamptz,
  recorded_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint complementary_recall_contact_attempts_method_check
    check (contact_method in ('phone', 'whatsapp', 'in_person', 'clinical_team', 'other')),
  constraint complementary_recall_contact_attempts_outcome_check
    check (outcome in ('reached_agreed', 'no_answer', 'unreachable', 'wrong_number', 'callback_requested', 'declined', 'temporarily_unavailable', 'inpatient', 'completed_elsewhere', 'other')),
  constraint complementary_recall_contact_attempts_contact_value_check
    check (contact_method not in ('phone', 'whatsapp') or length(trim(coalesce(contact_value, ''))) > 0),
  constraint complementary_recall_contact_attempts_other_note_check
    check (outcome <> 'other' or length(trim(coalesce(note, ''))) > 0)
);

create index complementary_recall_contact_attempts_recall_created_idx
  on appointments_v2.complementary_recall_contact_attempts(recall_request_id, created_at desc, id desc);
