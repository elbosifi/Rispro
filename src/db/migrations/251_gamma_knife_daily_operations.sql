alter table gamma_knife_investigations
  add column priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent'));

create table gamma_knife_readiness_items (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  item_key text not null,
  label text not null check (length(trim(label)) > 0),
  required boolean not null default true,
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  responsible_user_id bigint references users(id),
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  notes text not null default '',
  completed_at timestamptz,
  completed_by_user_id bigint references users(id),
  created_by_user_id bigint not null references users(id),
  updated_by_user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id,item_key),
  check ((status='completed') = (completed_at is not null and completed_by_user_id is not null))
);
create index gamma_knife_readiness_open_due on gamma_knife_readiness_items(status,due_date,priority,episode_id) where status <> 'completed';
create index gamma_knife_readiness_episode on gamma_knife_readiness_items(episode_id,status,required,id);

insert into gamma_knife_readiness_items(episode_id,item_key,label,required,created_by_user_id,updated_by_user_id)
select e.id,v.key,v.label,true,e.created_by,e.created_by
from gamma_knife_episodes e
cross join (values
  ('identity_verification','Patient identity verification'),
  ('consent_documentation','Consent documentation'),
  ('required_imaging','Required MRI/CT imaging')
) v(key,label)
where e.created_by is not null
on conflict (episode_id,item_key) do nothing;

create table gamma_knife_patient_communications (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  kind text not null check (kind in ('telephone_attempt','successful_contact','appointment_confirmed','unreachable','postponement_requested','treatment_declined','followup_reminder')),
  outcome text not null check (length(trim(outcome)) > 0),
  notes text not null default '',
  next_action text,
  next_action_date date,
  created_by_user_id bigint not null references users(id),
  created_at timestamptz not null default now()
);
create index gamma_knife_patient_communications_episode on gamma_knife_patient_communications(episode_id,created_at desc,id desc);
create index gamma_knife_patient_communications_action on gamma_knife_patient_communications(next_action_date,id) where next_action_date is not null;

create table gamma_knife_operation_task_assignments (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  task_key text not null check (length(trim(task_key)) between 1 and 120),
  owner_user_id bigint references users(id),
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  updated_by_user_id bigint not null references users(id),
  updated_at timestamptz not null default now(),
  unique (episode_id,task_key)
);
create index gamma_knife_operation_task_due on gamma_knife_operation_task_assignments(due_date,priority,episode_id);
