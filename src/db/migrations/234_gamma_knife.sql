alter table users add column gamma_knife_permissions text[] not null default '{}';

create table gamma_knife_episodes (
  id bigserial primary key,
  patient_id bigint not null references patients(id),
  diagnosis text not null check (length(trim(diagnosis)) > 0),
  diagnosis_category text not null,
  status text not null default 'referrals' check (status in ('referrals','clinical_review','mdt','preparation','treatment','followup','closed')),
  active boolean not null default true,
  revision integer not null default 1,
  data jsonb not null default '{}',
  qr_hash text unique,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active = (status <> 'closed'))
);
create unique index gamma_knife_one_active_episode on gamma_knife_episodes(patient_id) where active;
create index gamma_knife_episode_status on gamma_knife_episodes(status, updated_at);

create table gamma_knife_history (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  revision integer not null,
  action text not null,
  snapshot jsonb not null,
  actor_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  unique (episode_id, revision)
);

create table gamma_knife_documents (
  document_id bigint primary key references documents(id),
  episode_id bigint not null references gamma_knife_episodes(id),
  category text not null check (category in ('referral','investigation','consent','treatment_report','patient_instructions','other')),
  released boolean not null default false,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now()
);
create index gamma_knife_document_episode on gamma_knife_documents(episode_id);

insert into system_settings(category, setting_key, setting_value)
values ('gamma_knife','config','{"revision":1,"diagnoses":[{"name":"Other","checklist":[]}],"consultants":[],"documentVisibility":{"referral":"internal","investigation":"sensitive","consent":"internal","treatment_report":"sensitive","patient_instructions":"routine","other":"internal"},"treatmentExamTypeId":null,"followupExamTypeId":null,"reminderDays":14,"diagnosisDetailsEnabled":true,"qrEnabled":true}');
