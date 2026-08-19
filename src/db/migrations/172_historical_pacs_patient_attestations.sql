create table if not exists historical_pacs_patient_attestations (
  id bigserial primary key,
  patient_id integer not null references patients(id) on delete cascade,
  study_instance_uid text not null,
  status text not null check (status in ('confirmed', 'denied')),
  recorded_by_user_id integer not null references users(id),
  recorded_at timestamptz not null default now(),
  unique (patient_id, study_instance_uid)
);

create index if not exists historical_pacs_patient_attestations_patient_idx
  on historical_pacs_patient_attestations (patient_id);
