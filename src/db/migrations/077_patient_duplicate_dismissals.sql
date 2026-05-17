create table if not exists patient_duplicate_dismissals (
  id bigserial primary key,
  patient_a_id bigint not null references patients(id) on delete cascade,
  patient_b_id bigint not null references patients(id) on delete cascade,
  reason text,
  dismissed_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_duplicate_dismissals_order_check check (patient_a_id < patient_b_id),
  constraint patient_duplicate_dismissals_pair_unique unique (patient_a_id, patient_b_id)
);

create index if not exists patient_duplicate_dismissals_created_idx
  on patient_duplicate_dismissals(created_at desc);
