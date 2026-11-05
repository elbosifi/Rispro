create table gamma_knife_patient_identity_correction_requests (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  patient_id bigint not null references patients(id),
  requested_fields jsonb not null check (jsonb_typeof(requested_fields)='object' and requested_fields <> '{}'::jsonb),
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by_user_id bigint not null references users(id),
  decided_by_user_id bigint references users(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status='pending' and decided_by_user_id is null and decided_at is null and decision_reason is null)
      or (status in ('approved','rejected') and decided_by_user_id is not null and decided_at is not null and length(trim(coalesce(decision_reason,''))) > 0))
);
create index gamma_knife_patient_correction_queue on gamma_knife_patient_identity_correction_requests(status,created_at,id);
create index gamma_knife_patient_correction_episode on gamma_knife_patient_identity_correction_requests(episode_id,created_at desc,id desc);

create table gamma_knife_post_closure_corrections (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  kind text not null check (kind in ('clinical_addendum','administrative_correction')),
  affected_record text not null check (length(trim(affected_record)) > 0),
  reason text not null check (length(trim(reason)) > 0),
  previous_content jsonb not null,
  corrected_content jsonb not null check (jsonb_typeof(corrected_content) in ('object','array')),
  created_by_user_id bigint not null references users(id),
  created_at timestamptz not null default now()
);
create index gamma_knife_post_closure_corrections_episode on gamma_knife_post_closure_corrections(episode_id,created_at,id);
