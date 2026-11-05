create table gamma_knife_patient_attribution_corrections (
  id bigserial primary key,
  episode_id bigint not null unique references gamma_knife_episodes(id),
  original_patient_id bigint not null references patients(id),
  corrected_patient_id bigint not null references patients(id),
  confirmed_mrn text not null,
  confirmed_name text not null,
  reason text not null check (length(trim(reason)) > 0),
  authorized_by_user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  check (original_patient_id <> corrected_patient_id)
);

create index gamma_knife_patient_attribution_corrected_patient on gamma_knife_patient_attribution_corrections(corrected_patient_id,created_at desc);
